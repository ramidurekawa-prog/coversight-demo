import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CREW } from '../lib/agents/crew.js';
import { runCycle } from '../lib/agents/cycle.js';
import { agentStatus, ask, decide, runAgents } from '../server/agents/service';
import { dbStore } from '../server/agents/store';
import type { Db } from '../server/db/client';
import { actions, agentEvents, agentProposals, agentRuns, notifications, orgs, tasks, testWindows, users } from '../server/db/schema';
import { runJob } from '../server/jobs';
import { createSampleOrg } from '../server/org';
import { freshDb } from './helpers/db';

const NOW = new Date('2026-10-28T15:00:00Z');
let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
const gm = () => ({ orgId, userId: 'u1', role: 'gm' as const, rooms: ['berkeley'] });

beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'Maria Reyes', email: 'maria@example.com' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });

const open = async (kind?: string) => (await db.select().from(agentProposals).where(eq(agentProposals.orgId, orgId))).filter((p) => p.status === 'open' && (!kind || p.kind === kind));

describe('the crew on the server', () => {
  it('a cycle hands work from agent to agent and leaves a ranked plan for a person', async () => {
    const r = await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    expect(r).toMatchObject({ ok: true, refused: 0, errors: 0 });
    const events = await db.select().from(agentEvents).where(eq(agentEvents.orgId, orgId));
    const chain = ['cycle.start', 'ingest.due', 'data.loaded', 'data.ok', 'findings.updated', 'ranked', 'plan.drafted', 'experiment.designed', 'controls.selected', 'cycle.end'];
    for (const t of chain) expect(events.some((e) => e.type === t), t).toBe(true);
    // Every agent with a scheduled job ran at least once (copilots answer questions instead).
    const ran = new Set((await db.select().from(agentRuns).where(eq(agentRuns.orgId, orgId))).map((x) => x.agent));
    for (const a of CREW.filter((x) => !x.on.includes('question'))) expect(ran.has(a.id), a.id).toBe(true);
    const plans = await open('plan');
    expect(plans.length).toBeGreaterThanOrEqual(6);
    const ribeye = plans.find((p) => p.key === 'plan:oakland:ribeye')!;
    expect(ribeye.payload).toMatchObject({ approval: { approvalId: 'price:ribeye:44', system: 'Toast menu' }, experiment: { metric: 'dishMargin', measurable: true, windowDays: 28 } });
    expect((await open('ranking')).map((p) => p.roomId).sort()).toEqual(['berkeley', 'oakland', 'walnut']);
    expect((await db.select().from(notifications).where(eq(notifications.orgId, orgId))).filter((n) => n.title.endsWith('morning brief'))).toHaveLength(3);
    const st = await agentStatus(db, orgId);
    expect(st.crew).toHaveLength(19);
    expect(st.never).toHaveLength(11);
    expect(st.last!.events.length).toBeGreaterThan(20);
  }, 60_000);

  it('running again changes nothing that didn’t change, and never runs twice at once', async () => {
    await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const before = await db.select().from(agentProposals).where(eq(agentProposals.orgId, orgId));
    const r2 = await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const changed = (await db.select().from(agentProposals).where(eq(agentProposals.orgId, orgId))).filter((p) => { const b = before.find((x) => x.key === p.key); return !b || JSON.stringify(b.payload) !== JSON.stringify(p.payload) || b.status !== p.status || b.body !== p.body; }).map((p) => p.key);
    expect(changed).toEqual([]);
    expect(r2).toMatchObject({ ok: true, proposals: 0 });
    const after = await db.select().from(agentProposals).where(eq(agentProposals.orgId, orgId));
    expect(after).toHaveLength(before.length);
    expect((await db.select().from(notifications).where(eq(notifications.orgId, orgId))).filter((n) => n.title.endsWith('morning brief'))).toHaveLength(3);
  }, 60_000);

  it('accepting a plan creates the task and starts its test as the person; the crew then stops proposing it', async () => {
    await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const p = (await open('plan')).find((x) => x.key === 'plan:oakland:ribeye')!;
    const r = await decide(db, owner(), p.id, { decision: 'accept' });
    expect(r.outcome).toMatch(/Task .* created.*28-day test started/);
    expect((await db.select().from(tasks).where(eq(tasks.orgId, orgId))).map((t) => t.approvalId)).toContain('price:ribeye:44');
    const [w] = await db.select().from(testWindows).where(and(eq(testWindows.orgId, orgId), eq(testWindows.dish, 'ribeye')));
    expect(w!.status).toBe('running');
    expect(w!.userId).toBe('u1'); // the person started it, not an agent
    await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const rank = (await open('ranking')).find((x) => x.roomId === 'oakland')!;
    expect((rank.payload as { items: { id: string }[] }).items.some((i) => i.id === 'ribeye')).toBe(false);
    await expect(decide(db, owner(), p.id, { decision: 'accept' })).rejects.toThrow(/Already accepted/);
  }, 90_000);

  it('a rejection holds: the crew doesn’t re-propose it for 14 days', async () => {
    await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const p = (await open('plan')).find((x) => x.key === 'plan:oakland:vendor')!;
    await decide(db, owner(), p.id, { decision: 'reject', note: 'We just renegotiated' });
    await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const [again] = await db.select().from(agentProposals).where(and(eq(agentProposals.orgId, orgId), eq(agentProposals.key, 'plan:oakland:vendor')));
    expect(again!.status).toBe('rejected');
    expect(again!.note).toBe('We just renegotiated');
  }, 90_000);

  it('a GM decides only in their rooms, and can’t confirm account mappings', async () => {
    await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const oak = (await open('plan')).find((x) => x.roomId === 'oakland')!;
    await expect(decide(db, gm(), oak.id, { decision: 'reject' })).rejects.toThrow(/not one of yours/);
    const st = await agentStatus(db, orgId, ['berkeley']);
    expect(st.proposals.every((p) => !p.roomId || p.roomId === 'berkeley')).toBe(true);
  }, 60_000);

  it('the policy refuses what no agent may do, logs it, and nothing happens', async () => {
    const rogue = {
      id: 'rogue', name: 'Rogue', permission: 'propose', does: 'tries everything', on: ['cycle.start'], emits: [],
      run: () => [
        { type: 'window.start', roomId: 'oakland', lever: 'labour' }, { type: 'autonomy.raise', roomId: 'oakland', lever: 'Menu', to: 4 },
        { type: 'mapping.confirm', lever: 'Menu' }, { type: 'input.commit', kind: 'recipes' }, { type: 'job.sync' },
        { type: 'autonomy.lower', roomId: 'oakland', lever: 'Labour', from: 2, to: 1 }, { type: 'propose', orgId: '00000000-0000-0000-0000-000000000000', key: 'x', kind: 'todo', title: 'x' },
        { type: 'delete', what: 'audit_log' },
      ],
    };
    const r = await runCycle({ store: dbStore(db, orgId, { now: NOW }), crew: [rogue], trigger: 'manual' });
    expect(r.refused).toBe(8);
    const refused = await db.select().from(agentEvents).where(and(eq(agentEvents.orgId, orgId), eq(agentEvents.type, 'policy.refused')));
    expect(refused.map((e) => (e.payload as { rule: string }).rule).sort()).toEqual(['autonomy', 'delete', 'input', 'mapping', 'scope', 'scope', 'tenant', 'window']);
    expect(await db.select().from(testWindows).where(eq(testWindows.orgId, orgId))).toHaveLength(0);
    expect((await db.select().from(actions).where(eq(actions.orgId, orgId))).filter((a) => a.key === 'autonomy')).toHaveLength(0);
  }, 60_000);

  it('a guardrail breach lowers that lever’s autonomy, once, and tells the room', async () => {
    await runAgents(db, orgId, { trigger: 'manual', now: NOW }); // sets lastCycleAt
    await db.insert(testWindows).values({ orgId, roomId: 'oakland', lever: 'labour', metric: 'idleServerHours', title: 'Trim Tuesday dinner', direction: 'down', baseline: 20, centsPerUnitWeek: 1800, startedAt: '2026-09-27', guard: { avgCheckBase: 38, turnBase: 60 }, status: 'reversed', bookedCents: 0, day: 28, closedAt: new Date(NOW.getTime() - 864e5), reversedAt: new Date(Date.now() + 1000) });
    await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const auto = (await db.select().from(actions).where(and(eq(actions.orgId, orgId), eq(actions.key, 'autonomy'), eq(actions.roomId, 'oakland'))));
    expect(auto).toHaveLength(1);
    expect(auto[0]!.value).toMatchObject({ Labour: 1 });
    expect(auto[0]!.userId).toBeNull();
    expect((await db.select().from(notifications).where(eq(notifications.orgId, orgId))).some((n) => n.title === 'Guardrail broke: Trim Tuesday dinner')).toBe(true);
  }, 90_000);

  it('a verified test gets a ledger mapping proposal that only an owner or admin confirms, with their name', async () => {
    await db.insert(testWindows).values({ orgId, roomId: 'walnut', lever: 'void_comp', metric: 'exceptionDollars', title: 'Comp policy', direction: 'down', baseline: 430, centsPerUnitWeek: 100, startedAt: '2026-09-27', guard: { avgCheckBase: 38, turnBase: 60 }, status: 'verified', bookedCents: 9100, day: 28, method: 'before_after', closedAt: new Date() });
    await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const m = (await open('mapping')).find((p) => p.key === 'mapping:walnut:Controls')!;
    expect(m.payload).toMatchObject({ account: '4900 Comps, voids and discounts' });
    const r = await decide(db, owner(), m.id, { decision: 'accept' });
    expect(r.outcome).toMatch(/confirmed by Maria Reyes/);
    const [gl] = (await db.select().from(actions).where(and(eq(actions.orgId, orgId), eq(actions.key, 'glmap'))));
    expect(gl!.value).toMatchObject({ Controls: { account: '4900 Comps, voids and discounts', by: 'Maria Reyes' } });
    // Portfolio intelligence offers it to the sister rooms that have the same finding.
    expect((await open('replicate')).length).toBeGreaterThan(0);
  }, 90_000);

  it('the copilots answer from facts; Claude may only rephrase without adding numbers', async () => {
    await runAgents(db, orgId, { trigger: 'manual', now: NOW });
    const a = await ask(db, owner(), { who: 'operator', question: 'What should Oakland do first?' });
    expect(a.topic).toBe('priorities');
    expect(a.text).toMatch(/ribeye/i);
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const invent = (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Raise the ribeye; it will make $9,999 a week.' }] }), { status: 200 })) as unknown as typeof fetch;
    const b = await ask(db, owner(), { who: 'operator', question: 'What should Oakland do first?' }, invent);
    expect(b.phrased).toBe(false);
    expect(b.text).toBe(a.text);
    const c = await ask(db, owner(), { who: 'accountant', question: 'where do savings land in the ledger?' });
    expect(c.topic).toBe('ledger');
    expect(c.text).toMatch(/Nothing verified/);
  }, 90_000);

  it('the nightly job runs the crew for real groups only', async () => {
    await db.update(orgs).set({ sample: false }).where(eq(orgs.id, orgId));
    const other = (await createSampleOrg(db, { ownerId: 'u1' })).id;
    const res = await runJob(db, 'agents', { now: NOW });
    expect(res.map((x) => x.orgId)).toEqual([orgId]);
    expect(res.map((x) => x.orgId)).not.toContain(other);
    expect(res[0]!.ok).toBe(true);
  }, 90_000);
});
