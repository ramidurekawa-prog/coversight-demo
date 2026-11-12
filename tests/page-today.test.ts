import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { deriveRoom } from '../lib/data/model.js';
import { applyOp, localDay, nextDay, queueHistory, queueSummary, queueView, todayCards } from '../lib/data/page/today.js';
import { SEED } from '../lib/data/seed.js';
import { readToastExports } from '../lib/data/toast.js';
import { saveAction } from '../server/actions';
import type { Db } from '../server/db/client';
import { actions, memberships, users } from '../server/db/schema';
import { commitInput, createSampleOrg } from '../server/org';
import { actOnToday, loadToday } from '../server/page/today';
import { freshDb } from './helpers/db';
import { toastFixture } from './helpers/toast-fixture.js';

const sampleRoom = Object.keys(SEED.rooms)[0]!;

describe('today’s cards (pure, shared by browser and server)', () => {
  const d = deriveRoom(SEED, sampleRoom);
  const today = '2026-10-27';
  const cards = todayCards(d, { today });

  it('fills tokens and gives every card a real action', () => {
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(`${c.title}${c.body}${c.value}`).not.toMatch(/\{\w[\w-]*\}/);
      expect(c.go || c.approval || c.start || c.task || c.log).toBeTruthy();
      expect(['decide', 'data', 'test']).toContain(c.kind);
    }
    // Every room's written cards are wired: none falls through to a button that does nothing.
    for (const id of Object.keys(SEED.rooms)) for (const c of todayCards(deriveRoom(SEED, id), { today })) expect(c.go || c.approval || c.start || c.task || c.log).toBeTruthy();
  });

  it('done, snooze, refuse and undo; refusing only suggestions; snooze lasts to the next day', () => {
    const fix = cards.find((c) => !c.refuse)!;
    const idea = cards.find((c) => c.refuse)!;
    const ctx = { cards, today, own: true, now: Date.parse('2026-10-27T18:00:00Z') };
    let s = applyOp(null, { op: 'done', cardId: fix.id }, ctx);
    expect(() => applyOp(s, { op: 'done', cardId: fix.id }, ctx)).toThrow(/already/);
    expect(() => applyOp(s, { op: 'refuse', cardId: cards.find((c) => !c.refuse && c.id !== fix.id)!.id }, ctx)).toThrow(/suggestion/);
    expect(() => applyOp(s, { op: 'done', cardId: 'nope' }, ctx)).toThrow(/isn’t in today’s queue/);
    s = applyOp(s, { op: 'refuse', cardId: idea.id }, ctx);
    const other = cards.find((c) => !c.refuse && c.id !== fix.id)!;
    s = applyOp(s, { op: 'snooze', cardId: other.id }, ctx);
    expect(s.snoozed[other.id]).toBe(nextDay(today));
    expect(queueSummary(cards, queueView(s, { today, own: true, now: ctx.now }))).toMatchObject({ cleared: 1, refused: 1, snoozed: 1, left: cards.length - 3 });
    // Tomorrow: the cleared card and the snooze are gone, the refusal holds.
    const tomorrow = queueView(s, { today: nextDay(today), own: true, now: ctx.now + 864e5 });
    expect(tomorrow).toEqual({ done: {}, refused: { [idea.id]: s.refused[idea.id] }, snoozed: {} });
    // The sample's written queue keeps its cleared cards until reset.
    expect(Object.keys(queueView(s, { today: nextDay(today), own: false, now: ctx.now + 864e5 }).done)).toEqual([fix.id]);
    s = applyOp(s, { op: 'undo', cardId: idea.id }, ctx);
    expect(s.refused).toEqual({});
    expect(applyOp(s, { op: 'reset' }, { ...ctx, own: false })).toEqual({ done: {}, refused: {}, snoozed: {} });
  });

  it('history: who did what, an undo, and a reset', () => {
    const h = queueHistory([
      { value: { done: { a: 't1' }, refused: {} }, at: 't1', by: 'u1' },
      { value: { done: { a: 't1', b: 't2' }, refused: { c: 't2' } }, at: 't2', by: 'u2' },
      { value: { done: { a: 't1', b: 't2' }, refused: {} }, at: 't3', by: 'u1' },
      { value: { done: {}, refused: {} }, at: 't4', by: 'u2' },
    ]);
    expect(h.map((e) => `${e.op}:${e.cardId}:${e.by}`)).toEqual(['done:a:u1', 'done:b:u2', 'refuse:c:u2', 'undo:c:u1', 'reset:null:u2']);
  });
});

describe('the Today API', () => {
  let db: Db;
  let orgId: string;
  const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
  const gm = () => ({ orgId, userId: 'u2', role: 'gm' as const, rooms: ['berkeley'] });
  const now = new Date('2026-10-27T18:00:00Z');
  beforeEach(async () => {
    db = await freshDb();
    await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'm@x.co' }, { id: 'u2', name: 'Jess', email: 'j@x.co' }]);
    orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
    await db.insert(memberships).values({ orgId, userId: 'u2', role: 'gm', rooms: ['berkeley'] });
  });

  it('checks each card against the room’s queue, merges two people’s decisions, and says who did what', async () => {
    // Rows are stamped by the database clock, so this one runs on the real day.
    const now = new Date();
    const t0 = await loadToday(db, owner(), 'oakland', now);
    expect(t0.state).toEqual({ done: {}, refused: {}, snoozed: {} });
    await actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: 'cut' }, now);
    // A second person, working from a stale page, clears another card: both stick.
    await actOnToday(db, { ...owner(), userId: 'u2' }, { roomId: 'oakland', op: 'snooze', cardId: 'recipes' }, now);
    const t1 = await actOnToday(db, owner(), { roomId: 'oakland', op: 'refuse', cardId: 'salmon' }, now);
    expect(Object.keys(t1.state.done)).toEqual(['cut']);
    expect(t1.state.snoozed).toEqual({ recipes: nextDay(localDay(now)) });
    expect(Object.keys(t1.state.refused)).toEqual(['salmon']);
    expect(t1.history.map((h: { op: string; cardId: string | null; by: { you: boolean; name: string | null } }) => `${h.op}:${h.cardId}:${h.by.you ? 'you' : h.by.name}`))
      .toEqual(['done:cut:you', 'snooze:recipes:Jess', 'refuse:salmon:you']);
    const [row] = await db.select().from(actions).where(eq(actions.key, 'queue')).orderBy(actions.at);
    expect(row!.userId).toBe('u1');
  });

  it('refuses bad input on the server', async () => {
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: 'made-up' }, now)).rejects.toThrow(/isn’t in today’s queue/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'refuse', cardId: 'cut' }, now)).rejects.toThrow(/suggestion/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'explode', cardId: 'cut' }, now)).rejects.toThrow(/invalid/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'undo', cardId: 'cut' }, now)).rejects.toThrow(/isn’t cleared/);
    await expect(actOnToday(db, owner(), { roomId: 'nowhere', op: 'done', cardId: 'cut' }, now)).rejects.toThrow(/no room/);
    await expect(actOnToday(db, gm(), { roomId: 'oakland', op: 'done', cardId: 'cut' }, now)).rejects.toThrow(/not one of yours/);
    await expect(loadToday(db, gm(), 'oakland', now)).rejects.toThrow(/not one of yours/);
    // A direct write past the API is still bounded by the schema.
    await expect(saveAction(db, owner(), { roomId: 'oakland', key: 'queue', value: { done: Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`c${i}`, 'x'])), refused: {} } })).rejects.toThrow(/too many/);
  });

  it('a room on its own data: yesterday’s cleared cards come back, and the saved value is pruned', async () => {
    const { unknown, ...s } = readToastExports(Object.entries(toastFixture()).map(([name, text]) => ({ name, text })));
    void unknown;
    await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'toast', rows: [JSON.parse(JSON.stringify(s))] });
    const ds = applyInputs(SEED, { oakland: { toast: { rows: [s] } } });
    const first = todayCards(deriveRoom(ds, 'oakland'), { today: '2026-10-27' })[0]!;
    await actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: first.id }, now);
    const next = new Date(now.getTime() + 864e5);
    const t = await loadToday(db, owner(), 'oakland', next);
    expect(t.state.done).toEqual({});
    expect(t.history).toEqual([]);
    const again = await actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: first.id }, next);
    expect(Object.keys(again.state.done)).toEqual([first.id]);
  });
});
