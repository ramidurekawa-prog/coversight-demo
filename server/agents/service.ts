// The crew from the outside: run a cycle, show what it did, let a person
// decide what it proposed, and ask the copilots. A person's decision is
// carried out by the same services as everywhere else (startWindow,
// createTask, saveAction), with that person as the actor, never an agent.
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import { answer } from '../../lib/agents/copilot.js';
import { approvalFor, CREW, LEVER_ACCOUNT } from '../../lib/agents/crew.js';
import { runCycle } from '../../lib/agents/cycle.js';
import { LEVEL_LABEL, NEVER } from '../../lib/agents/policy.js';
import { findingTest } from '../../lib/data/findings.js';
import { deriveRoom } from '../../lib/data/model.js';
import type { Db } from '../db/client';
import { agentCycles, agentEvents, agentProposals, agentRuns, auditLog, orgs, users } from '../db/schema';
import { GROUP, loadActions, saveAction } from '../actions';
import { loadDataset } from '../dataset';
import { InputError } from '../org';
import { startWindow } from '../proof';
import { AuthError, type Viewer } from '../session';
import { createTask } from '../tasks';
import { dbStore } from './store';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;

/** One cycle for one group. Two at once for the same group would race, so a running one is waited out. */
export async function runAgents(db: Db, orgId: string, { trigger = 'schedule', now = new Date(), fetchImpl }: { trigger?: string; now?: Date; fetchImpl?: typeof fetch } = {}) {
  const [busy] = await db.select({ id: agentCycles.id }).from(agentCycles).where(and(eq(agentCycles.orgId, orgId), sql`${agentCycles.finishedAt} is null`, gt(agentCycles.startedAt, new Date(Date.now() - 5 * 60e3))));
  if (busy) return { ok: false as const, error: 'The crew is already running for this group. Give it a minute.' };
  const r = await runCycle({ store: dbStore(db, orgId, { now, ...(fetchImpl ? { fetchImpl } : {}) }), trigger });
  const { log: _log, ...summary } = r;
  return { ok: true as const, ...summary };
}

const crewMeta = () => CREW.map((a) => ({ id: a.id, name: a.name, does: a.does, permission: a.permission, level: LEVEL_LABEL[a.permission as keyof typeof LEVEL_LABEL], on: a.on, emits: a.emits }));

/** System screen: the crew, its last cycle's handoffs, and what waits on a person. */
export async function agentStatus(db: Db, orgId: string, roomScope: string[] | null = null) {
  const inScope = (roomId: string | null) => !roomScope || !roomId || roomScope.includes(roomId);
  const cycles = await db.select().from(agentCycles).where(eq(agentCycles.orgId, orgId)).orderBy(desc(agentCycles.startedAt)).limit(10);
  const last = cycles.find((c) => c.finishedAt) ?? null;
  const events = last ? (await db.select().from(agentEvents).where(eq(agentEvents.cycleId, last.id)).orderBy(agentEvents.seq)).filter((e) => inScope(e.roomId)) : [];
  const runs = last ? (await db.select().from(agentRuns).where(eq(agentRuns.cycleId, last.id))).filter((r) => inScope(r.roomId)) : [];
  const recent = await db.select({ agent: agentRuns.agent, n: sql<number>`count(*)::int`, errors: sql<number>`sum(case when ${agentRuns.ok} then 0 else 1 end)::int`, at: sql<Date>`max(${agentRuns.at})` }).from(agentRuns)
    .where(and(eq(agentRuns.orgId, orgId), gt(agentRuns.at, new Date(Date.now() - 30 * 864e5)))).groupBy(agentRuns.agent);
  const proposals = (await db.select().from(agentProposals).where(eq(agentProposals.orgId, orgId)).orderBy(desc(agentProposals.updatedAt)).limit(200)).filter((p) => inScope(p.roomId));
  const refused = (await db.select().from(agentEvents).where(and(eq(agentEvents.orgId, orgId), eq(agentEvents.type, 'policy.refused'))).orderBy(desc(agentEvents.at)).limit(20)).filter((e) => inScope(e.roomId));
  return {
    crew: crewMeta().map((a) => {
      const mine = runs.filter((r) => r.agent === a.id);
      const s = recent.find((x) => x.agent === a.id);
      return { ...a, lastCycle: { runs: mine.length, ok: mine.every((r) => r.ok), notes: mine.flatMap((r) => r.notes as string[]).slice(0, 6), applied: mine.reduce((acc, r) => { for (const [k, v] of Object.entries(r.applied as Record<string, number>)) acc[k] = (acc[k] || 0) + v; return acc; }, {} as Record<string, number>), errors: mine.filter((r) => !r.ok).map((r) => r.error) }, month: s ? { runs: s.n, errors: s.errors, at: s.at } : null };
    }),
    cycles: cycles.map((c) => ({ id: c.id, trigger: c.trigger, startedAt: c.startedAt, finishedAt: c.finishedAt, summary: c.summary })),
    last: last ? { id: last.id, trigger: last.trigger, startedAt: last.startedAt, summary: last.summary, events: events.map((e) => ({ seq: e.seq, type: e.type, from: e.from, to: e.to, roomId: e.roomId, payload: e.payload })) } : null,
    proposals: proposals.map((p) => ({ id: p.id, key: p.key, agent: p.agent, kind: p.kind, roomId: p.roomId, title: p.title, body: p.body, needs: p.needs, payload: p.payload, status: p.status, decidedBy: p.decidedBy, decidedAt: p.decidedAt, note: p.note, updatedAt: p.updatedAt })),
    refused: refused.map((e) => ({ from: e.from, at: e.at, ...(e.payload as object) })),
    never: NEVER.map((n) => ({ id: n.id, text: n.text })),
  };
}

const who = async (db: Db, userId: string) => {
  const [u] = await db.select({ name: users.name, email: users.email, anon: users.isAnonymous }).from(users).where(eq(users.id, userId));
  return u ? (u.anon ? 'Sample guest' : u.name || u.email) : 'someone';
};

/** A person accepts or rejects what the crew proposed. */
export async function decide(db: Db, v: V, id: string, raw: unknown) {
  const { decision, note } = (raw ?? {}) as { decision?: string; note?: string };
  if (decision !== 'accept' && decision !== 'reject') throw new InputError('decision must be accept or reject');
  const [p] = await db.select().from(agentProposals).where(and(eq(agentProposals.orgId, v.orgId), eq(agentProposals.id, id)));
  if (!p) throw new InputError('no such proposal');
  if (p.roomId && v.rooms && !v.rooms.includes(p.roomId)) throw new AuthError(403, 'That room is not one of yours.');
  if (p.status !== 'open') throw new InputError(`Already ${p.status}.`);
  if (p.needs !== 'human') throw new InputError('Nothing to decide: this one is for information.');
  if (p.kind === 'mapping' && v.role === 'gm') throw new AuthError(403, 'Account mappings are confirmed by an owner or admin.');
  const name = await who(db, v.userId);
  let outcome = '';
  if (decision === 'accept') {
    const payload = p.payload as Record<string, unknown>;
    if (p.kind === 'plan' || p.kind === 'replicate') {
      const loaded = await loadDataset(db, v.orgId);
      const roomId = p.roomId!;
      const c = deriveRoom(loaded!.ds, roomId).candidates.find((x: { id: string }) => x.id === payload.candidateId);
      if (!c) throw new InputError('That finding is no longer in this room’s data. Run the crew again for a fresh plan.');
      const appr = (payload.approval as { approvalId: string; system: string; diff: [string, string, string][] } | undefined) ?? approvalFor(c, loaded!.ds.rooms[roomId]);
      const task = await createTask(db, v, { roomId, approvalId: appr.approvalId, title: c.title, system: appr.system, diff: appr.diff });
      const test = findingTest(c);
      let started = '';
      if (test) {
        try { await startWindow(db, v, { roomId, lever: test.lever, dish: test.dish }); started = ' A 28-day test started.'; } catch (e) { started = ` No test started: ${e instanceof Error ? e.message : String(e)}`; }
      }
      outcome = `Task “${task.title ?? c.title}” created for the change.${started}`;
    } else if (p.kind === 'mapping') {
      const acts = await loadActions(db, v.orgId);
      const cur = (acts[GROUP]?.glmap ?? {}) as Record<string, { account: string; by: string; at: string }>;
      const lever = String(payload.lever);
      await saveAction(db, v, { key: 'glmap', value: { ...cur, [lever]: { account: String(payload.account ?? LEVER_ACCOUNT[lever as keyof typeof LEVER_ACCOUNT]?.account), by: name, at: new Date().toISOString() } }, summary: `${lever} savings → ${payload.account}` });
      outcome = `${lever} savings now map to ${payload.account}, confirmed by ${name}.`;
    } else {
      outcome = 'Marked done.';
    }
  }
  await db.update(agentProposals).set({ status: decision === 'accept' ? (p.kind === 'todo' ? 'done' : 'accepted') : 'rejected', decidedBy: name, decidedAt: new Date(), note: (decision === 'reject' ? String(note ?? '').slice(0, 400) : outcome) || null, updatedAt: new Date() }).where(eq(agentProposals.id, p.id));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: `agents.${decision}`, detail: { key: p.key, kind: p.kind, roomId: p.roomId, outcome } });
  return { ok: true, outcome: outcome || 'Rejected. The crew won’t propose it again for 14 days.' };
}

/** Ask a copilot. The answer is built from facts; Claude (when configured) only rephrases them. */
export async function ask(db: Db, v: V, raw: unknown, fetchImpl: typeof fetch = fetch) {
  const { who: role, question, roomId } = (raw ?? {}) as { who?: string; question?: string; roomId?: string };
  const q = String(question ?? '').trim().slice(0, 500);
  if (!q) throw new InputError('Ask a question.');
  const copilot = role === 'accountant' ? 'accountant' : 'operator';
  const facts = await dbStore(db, v.orgId).facts();
  const scoped = { ...facts, rooms: facts.rooms.filter((r) => !v.rooms || v.rooms.includes(r.id)), windows: facts.windows.filter((w) => !v.rooms || v.rooms.includes(w.roomId)) };
  const base = answer(copilot, q, scoped, { roomId: roomId && (!v.rooms || v.rooms.includes(roomId)) ? roomId : undefined });
  let text = base.text, phrased = false;
  const [org] = await db.select({ sample: orgs.sample }).from(orgs).where(eq(orgs.id, v.orgId));
  const asked = (await db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(eq(auditLog.orgId, v.orgId), inArray(auditLog.action, ['agents.ask']), gt(auditLog.at, new Date(Date.now() - 864e5)))))[0]?.n ?? 0;
  if (process.env.ANTHROPIC_API_KEY && base.topic !== 'help' && asked < (org?.sample ? 20 : 500)) {
    try {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 600,
          system: `You are Coversight's ${copilot} copilot for a restaurant group. Answer the question using ONLY the facts given. Keep every number exactly as given; add no new numbers, estimates or advice beyond the facts. Plain words, at most 120 words. If the facts don't answer it, say so.`,
          messages: [{ role: 'user', content: `Question: ${q}\n\nFacts:\n${base.text}` }],
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { content?: { type: string; text?: string }[] };
        const t = j.content?.find((c) => c.type === 'text')?.text?.trim();
        // Keep the phrasing only if it introduced no number the facts don't contain.
        const nums = (s: string) => (s.match(/\d[\d,.]*/g) || []).map((x) => x.replace(/[,.]$/, ''));
        if (t && nums(t).every((n) => base.text.includes(n))) { text = t; phrased = true; }
      }
    } catch { /* the facts answer stands */ }
  }
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'agents.ask', detail: { copilot, topic: base.topic, phrased } });
  return { copilot, topic: base.topic, text, facts: base.text, phrased, cites: base.cites };
}
