import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AI_MODEL } from '../server/ai/claude';
import { askSous, loadSous, runSous } from '../server/ai/sous';
import type { Db } from '../server/db/client';
import { auditLog, notifications, orgs, snapshots, users } from '../server/db/schema';
import { runJob } from '../server/jobs';
import { createSampleOrg } from '../server/org';
import { freshDb } from './helpers/db';
import { fakeClaude } from './helpers/fake-claude';

const NOW = new Date('2026-10-28T03:15:00Z'); // 8:15 pm Tuesday in Oakland
let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
const gm = () => ({ orgId, userId: 'u1', role: 'gm' as const, rooms: ['berkeley'] });
const floor = () => ({ orgId, userId: 'u1', role: 'floor' as const, rooms: ['oakland'] });

beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'Maria Reyes', email: 'maria@example.com' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });

const logged = async (action: string) => (await db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, action))));

describe('Sous with the AI engine off', () => {
  it('still briefs and answers, from the room’s own figures', async () => {
    const s = await loadSous(db, owner(), 'oakland', { now: NOW });
    expect(s).toMatchObject({ roomId: 'oakland', role: 'owner', engine: 'builtin', ai: false });
    expect(s.brief.headline).toMatch(/^Oakland kept \$18,940/);
    expect(s.brief.lines.length).toBeLessThanOrEqual(3);
    expect(s.brief.action?.go).toBe('today');
    expect(s.suggest.length).toBeGreaterThan(1);
    const a = await askSous(db, owner(), { roomId: 'oakland', question: 'What have we actually saved?' }, { now: NOW });
    expect(a).toMatchObject({ engine: 'builtin', grounded: true, claim: 'book' });
    expect(a.text).toMatch(/\$97 a week/);
    expect(a.cites).toEqual([{ label: 'Proof', go: 'proof' }]);
    // No call was made and nothing was spent.
    expect(await logged('sous.brief')).toHaveLength(0);
  });

  it('answers only for rooms the viewer can see, with what their role may see', async () => {
    expect((await loadSous(db, gm(), null, { now: NOW })).roomId).toBe('berkeley');
    await expect(loadSous(db, gm(), 'oakland', { now: NOW })).rejects.toThrow(/not one of yours/);
    await expect(askSous(db, gm(), { roomId: 'oakland', question: 'How did last week go?' }, { now: NOW })).rejects.toThrow(/not one of yours/);
    const f = await askSous(db, floor(), { roomId: 'oakland', question: 'How much did we make last week in sales?' }, { now: NOW });
    expect(f.text).not.toMatch(/\$41,620|\$18,940/);
    await expect(askSous(db, owner(), { roomId: 'oakland', question: '   ' })).rejects.toThrow(/Ask Sous a question/);
  });

  it('never leads with a card that is already decided', async () => {
    const { saveAction } = await import('../server/actions');
    const before = await loadSous(db, owner(), 'oakland', { now: NOW });
    expect(before.brief.action?.title).toMatch(/cut one server/);
    await saveAction(db, owner(), { roomId: 'oakland', key: 'queue', value: { done: { cut: NOW.toISOString() }, refused: {} } });
    const after = await loadSous(db, owner(), 'oakland', { now: NOW });
    expect(after.brief.action?.title).not.toMatch(/cut one server/);
  });
});

describe('Sous with the AI engine on', () => {
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'sk-test-key'; });

  it('asks Opus 5.5 with the records, and shows the answer with the screens it drew on', async () => {
    const c = fakeClaude({ answer: 'You have 1 verified change saving $97 a week (verified). Next, finish the two tests that are running.', answered: true, used: ['saved', 'tests', 'nope'], follow_up: 'What is being tested?' });
    const a = await askSous(db, owner(), { roomId: 'oakland', question: 'What have we actually saved?', history: [{ q: 'hi', a: 'Hello.' }] }, { fetchImpl: c.f, now: NOW });
    expect(a).toMatchObject({ engine: 'ai', grounded: true, used: ['saved', 'tests'], claim: 'book', suggest: ['What is being tested?'] });
    expect(a.cites).toEqual([{ label: 'Proof', go: 'proof' }]);
    const body = c.calls[0]!.body;
    expect(body.model).toBe(AI_MODEL);
    expect(AI_MODEL).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    // This model takes no sampling or thinking overrides and no forced tool call.
    for (const k of ['temperature', 'top_p', 'thinking', 'tool_choice']) expect(body[k]).toBeUndefined();
    expect(JSON.stringify(body.messages[0])).toContain('[saved]');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'What have we actually saved?' });
    // The key and the question are never kept.
    const log = JSON.stringify(await logged('sous.ask'));
    expect(log).not.toContain('sk-test-key');
    expect(log).not.toContain('actually saved');
  });

  it('throws away an answer with a figure the records don’t have, and answers from the records instead', async () => {
    const c = fakeClaude({ answer: 'You have saved $5,044 a year so far.', answered: true, used: ['saved'], follow_up: '' });
    const a = await askSous(db, owner(), { roomId: 'oakland', question: 'What have we actually saved?' }, { fetchImpl: c.f, now: NOW });
    expect(a.engine).toBe('builtin');
    expect(a.text).not.toContain('5,044');
    expect(a.text).toMatch(/\$97 a week/);
  });

  it('passes on “I don’t have that” without pretending it came from the records', async () => {
    const c = fakeClaude({ answer: 'I don’t have weather in Oakland’s records yet.', answered: false, used: [], follow_up: '' });
    const a = await askSous(db, owner(), { roomId: 'oakland', question: 'Will it rain on Saturday?' }, { fetchImpl: c.f, now: NOW });
    expect(a).toMatchObject({ engine: 'ai', grounded: false, cites: [], claim: null });
    expect(a.suggest.length).toBeGreaterThan(1);
  });

  it('a provider that is down, busy or refusing the key never breaks Sous', async () => {
    for (const status of [401, 429, 500, 529]) {
      const a = await askSous(db, owner(), { roomId: 'oakland', question: 'How did last week go?' }, { fetchImpl: fakeClaude({}, status).f, now: NOW });
      expect(a, String(status)).toMatchObject({ engine: 'builtin', grounded: true });
    }
    const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect((await loadSous(db, owner(), 'oakland', { fetchImpl: down, now: NOW })).engine).toBe('builtin');
    expect((await askSous(db, owner(), { roomId: 'oakland', question: 'How did last week go?' }, { fetchImpl: fakeClaude('not json').f, now: NOW })).engine).toBe('builtin');
  });

  it('writes the brief once per change in the data, line by line through the figure check', async () => {
    const c = fakeClaude((body: Record<string, any>) => {
      const ask = String(body.messages[0].content.at(-1).text);
      const ids = [...ask.matchAll(/^Line (\S+) \(/gm)].map((m) => m[1]!);
      return { headline: 'Oakland kept $18,940 last week, a little under the week before.', lines: ids.map((id, i) => ({ id, text: i === 0 ? 'You kept $271 less than the week before, mostly on softer sales.' : i === 1 ? 'Voids could be costing you $12,345 a year.' : `Rewritten ${id}.` })) };
    });
    const s = await loadSous(db, owner(), 'oakland', { fetchImpl: c.f, now: NOW });
    expect(s.engine).toBe('ai');
    expect(s.brief.headline).toBe('Oakland kept $18,940 last week, a little under the week before.');
    expect(s.brief.lines[0]!.text).toBe('You kept $271 less than the week before, mostly on softer sales.');
    // The line with an invented figure keeps its built-in wording; labels and links never come from the model.
    expect(s.brief.lines[1]!.text).not.toContain('12,345');
    expect(s.brief.lines.map((l) => l.label)).toEqual(['What changed', 'Sous noticed', 'Biggest opportunity']);
    expect(s.brief.action?.title).toMatch(/cut one server/);
    // Opening Sous again reuses the written brief: no second call.
    const again = await loadSous(db, owner(), 'oakland', { fetchImpl: c.f, now: NOW });
    expect(again.brief.headline).toBe(s.brief.headline);
    expect(c.calls).toHaveLength(1);
    expect(await db.select().from(snapshots).where(and(eq(snapshots.orgId, orgId), eq(snapshots.kind, 'sous:owner')))).toHaveLength(1);
  });

  it('a sample group has a daily allowance; past it Sous answers from the records', async () => {
    const c = fakeClaude({ answer: 'Delivery is 8.4% of sales.', answered: true, used: ['delivery'], follow_up: '' });
    for (let i = 0; i < 20; i++) expect((await askSous(db, owner(), { roomId: 'oakland', question: 'Is delivery worth it?' }, { fetchImpl: c.f, now: NOW })).engine).toBe('ai');
    const over = await askSous(db, owner(), { roomId: 'oakland', question: 'Is delivery worth it?' }, { fetchImpl: c.f, now: NOW });
    expect(over).toMatchObject({ engine: 'builtin', grounded: true });
    expect(c.calls).toHaveLength(20);
  }, 60_000);
});

describe('the nightly watch', () => {
  it('tells each room what Sous noticed once per week of data, for real groups only', async () => {
    expect(await runJob(db, 'sous', { now: NOW })).toEqual([]);
    await db.update(orgs).set({ sample: false }).where(eq(orgs.id, orgId));
    const [r] = await runJob(db, 'sous', { now: NOW });
    expect(r).toMatchObject({ ok: true, detail: { rooms: 3 } });
    const notes = (await db.select().from(notifications).where(eq(notifications.orgId, orgId))).filter((n) => n.kind === 'sous.noticed');
    expect(notes.length).toBeGreaterThanOrEqual(3);
    expect(notes.length).toBeLessThanOrEqual(6);
    for (const n of notes) { expect(n.title).toMatch(/^Sous noticed: /); expect(n.link).toMatch(/^\/[a-z]+$/); }
    await runJob(db, 'sous', { now: NOW });
    expect((await db.select().from(notifications).where(eq(notifications.orgId, orgId))).filter((n) => n.kind === 'sous.noticed')).toHaveLength(notes.length);
  }, 60_000);

  it('writes the morning briefs ahead of time when the engine is on', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const c = fakeClaude({ headline: 'A good, steady week.', lines: [] });
    const r = await runSous(db, orgId, { fetchImpl: c.f, now: NOW });
    expect(Object.values(r.byRoom!).every((x) => x.briefs === 2)).toBe(true);
    expect(c.calls).toHaveLength(6);
  }, 60_000);
});
