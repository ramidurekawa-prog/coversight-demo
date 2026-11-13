import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { deriveRoom } from '../lib/data/model.js';
import {
  applyOp, cardState, DECLINE, hoursToMinutes, localDay, nextDay, queueChanges, queueHistory, queueSummary, queueView, RANK_POLICY, todayCards, unlocksOf, upNextOrder, worthOf,
} from '../lib/data/page/today.js';
import { SEED } from '../lib/data/seed.js';
import { readToastExports } from '../lib/data/toast.js';
import { saveAction } from '../server/actions';
import type { Db } from '../server/db/client';
import { actions, memberships, tasks, users } from '../server/db/schema';
import { commitInput, createSampleOrg } from '../server/org';
import { actOnToday, loadToday } from '../server/page/today';
import { createTask, updateTask } from '../server/tasks';
import { freshDb } from './helpers/db';
import { toastFixture } from './helpers/toast-fixture.js';

type C = ReturnType<typeof todayCards>[number];
const ROOMS = Object.keys(SEED.rooms);
const today = '2026-10-27';
const at = Date.parse('2026-10-27T18:00:00Z');
const { unknown: _u, ...toastSummary } = readToastExports(Object.entries(toastFixture()).map(([name, text]) => ({ name, text })));

describe('today’s cards (pure, shared by browser and server)', () => {
  const d = deriveRoom(SEED, 'oakland');
  const cards = todayCards(d, { today });
  const ctx = { cards, today, own: true, now: at };

  it('every card has a stable id, a real action, effort, a category and a source', () => {
    for (const id of ROOMS) {
      const a = todayCards(deriveRoom(SEED, id), { today });
      const b = todayCards(deriveRoom(SEED, id), { today });
      expect(a.map((c: C) => c.id)).toEqual(b.map((c: C) => c.id));
      expect(new Set(a.map((c: C) => c.id)).size).toBe(a.length);
      for (const c of a) {
        expect(`${c.title}${c.body}${c.value}`).not.toMatch(/\{\w[\w-]*\}/);
        expect(c.go || c.approval || c.start || c.task || c.log).toBeTruthy();
        expect(c.effort.manager).toBeGreaterThan(0);
        expect(RANK_POLICY.map(([k]) => k)).toContain(c.category);
        expect(c.source).toEqual({ kind: 'sample', through: expect.any(String) });
      }
    }
  });

  it('ranks by policy: due today first, the data repair that unblocks a decision next, blocked cards last', () => {
    expect(cards[0].id).toBe('cut');
    expect(cards[0].category).toBe('urgent');
    const salmon = cards.find((c: C) => c.id === 'salmon');
    expect(salmon.blocked).toMatch(/recipe costs/);
    expect(salmon.blockedBy).toBe('recipes');
    expect(cards.at(-1).id).toBe('salmon'); // never ranked as ready
    const recipes = cards.find((c: C) => c.id === 'recipes');
    expect(recipes.unblocks).toBe(1);
    expect(recipes.category).toBe('problem');
    expect(cards.indexOf(recipes)).toBe(1);
    expect(cardState(salmon, queueView(null, ctx))).toBe('blocked');
  });

  it('hours convert to manager minutes, and a test’s background days are not manager time', () => {
    expect(hoursToMinutes(0.25)).toBe(15);
    expect(hoursToMinutes(0.5)).toBe(30);
    expect(hoursToMinutes(1)).toBe(60);
    const ds = applyInputs(SEED, { oakland: { toast: { rows: [toastSummary] } } });
    const own = deriveRoom(ds, 'oakland');
    const q = todayCards(own, { today });
    for (const c of q.filter((x: C) => x.id.startsWith('find:'))) {
      const f = own.candidates.find((x: { id: string }) => x.id === c.id.slice(5));
      expect(c.effort.manager).toBe(hoursToMinutes(f.hours ?? 0.25));
    }
    const test = q.find((c: C) => c.start);
    expect(test.effort).toEqual({ manager: test.mins, waitDays: 28 });
    const sum = queueSummary(q, queueView(null, { today, own: true }));
    expect(sum.minsLeft).toBe(q.filter((c: C) => !c.blocked).reduce((m: number, c: C) => m + c.effort.manager, 0));
  });

  it('stale evidence blocks every recommendation built on it, and the upload card unblocks them', () => {
    const ds = applyInputs(SEED, { oakland: { toast: { rows: [toastSummary] } } });
    const q = todayCards(deriveRoom(ds, 'oakland'), { today: '2026-11-20' });
    const stale = q.find((c: C) => c.id.startsWith('stale:'));
    expect(stale).toBeTruthy();
    for (const c of q.filter((x: C) => x.id.startsWith('find:') || x.start)) {
      expect(c.blocked).toBeTruthy();
      expect(() => applyOp(null, { op: 'done', cardId: c.id }, { cards: q, today: '2026-11-20', own: true })).toThrow();
    }
    expect(stale.unblocks).toBeGreaterThan(0);
    expect(q[0].id).toBe(stale.id);
  });

  it('snoozed is not done; it keeps the card and brings it back on its resume day', () => {
    const fix = cards.find((c: C) => c.id === '7shifts');
    const s = applyOp(null, { op: 'snooze', cardId: fix.id }, ctx);
    expect(s.done).toEqual({});
    expect(s.snoozed[fix.id]).toBe(nextDay(today));
    const v = queueView(s, ctx);
    expect(cardState(fix, v)).toBe('snoozed');
    expect(queueSummary(cards, v).cleared).toBe(0);
    expect(cardState(fix, queueView(s, { ...ctx, today: nextDay(today) }))).toBe('ready');
    // Due today can't be pushed to tomorrow.
    expect(() => applyOp(null, { op: 'snooze', cardId: 'cut' }, ctx)).toThrow(/due today/);
  });

  it('approved is not done: an approval card can’t be ticked off, and an open task keeps it pending execution', () => {
    expect(() => applyOp(null, { op: 'done', cardId: 'cut' }, ctx)).toThrow(/approve it/);
    const withTask = todayCards(d, { today, tasks: [{ approvalId: 'tue-cut', status: 'open', roomId: 'oakland' }] });
    const cut = withTask.find((c: C) => c.id === 'cut');
    const v = queueView(null, ctx);
    expect(cardState(cut, v)).toBe('approved');
    expect(queueSummary(withTask, v).left).toBe(cards.length - 1);
    const made = todayCards(d, { today, tasks: [{ approvalId: 'tue-cut', status: 'done', roomId: 'oakland' }] });
    expect(cardState(made.find((c: C) => c.id === 'cut'), v)).toBe('executed');
    // A cancelled task puts the card back.
    const cancelled = todayCards(d, { today, tasks: [{ approvalId: 'tue-cut', status: 'cancelled', roomId: 'oakland' }] });
    expect(cardState(cancelled.find((c: C) => c.id === 'cut'), v)).toBe('needs_review');
    // One action can't be taken twice.
    const done = applyOp(null, { op: 'done', cardId: 'count' }, ctx);
    expect(() => applyOp(done, { op: 'done', cardId: 'count' }, ctx)).toThrow(/already off/);
  });

  it('declining needs a reason, keeps it in history, suppresses by reason, and lets a grown opportunity back', () => {
    const ds = applyInputs(SEED, { oakland: { toast: { rows: [toastSummary] } } });
    const q = todayCards(deriveRoom(ds, 'oakland'), { today });
    const idea = q.find((c: C) => c.refuse && c.worth);
    const c2 = { cards: q, today, own: true, now: at };
    expect(() => applyOp(null, { op: 'refuse', cardId: idea.id }, c2)).toThrow(/Say why/);
    expect(() => applyOp(null, { op: 'refuse', cardId: q.find((c: C) => !c.refuse).id, reason: 'handled' }, c2)).toThrow(/suggestion/);
    const s = applyOp(null, { op: 'refuse', cardId: idea.id, reason: 'handled' }, c2);
    expect(s.meta[idea.id]).toEqual({ reason: 'handled', worth: idea.worth });
    expect(cardState(idea, queueView(s, c2))).toBe('declined');
    // 'handled' keeps it away 30 days, not 90.
    expect(cardState(idea, queueView(s, { ...c2, now: at + (DECLINE.handled.days + 1) * 864e5 }))).not.toBe('declined');
    // Worth half as much again: it comes back for reconsideration.
    const grown = q.map((c: C) => (c.id === idea.id ? { ...c, worth: idea.worth * 2 } : c));
    expect(cardState(idea, queueView(s, { ...c2, cards: grown }))).not.toBe('declined');
    expect(cardState(idea, queueView(s, c2))).toBe('declined');
    const h = queueHistory([{ value: s, at: 't1', by: 'u1' }]);
    expect(h).toEqual([{ cardId: idea.id, op: 'refuse', at: 't1', by: 'u1', reason: 'handled' }]);
    // A critical card can't be turned down.
    const crit = q.map((c: C) => (c.id === idea.id ? { ...c, critical: true } : c));
    expect(() => applyOp(null, { op: 'refuse', cardId: idea.id, reason: 'not_relevant' }, { ...c2, cards: crit })).toThrow(/critical/);
  });

  it('history and changes: who did what, an undo, a reset; new and gone cards', () => {
    const h = queueHistory([
      { value: { done: { a: 't1' }, refused: {} }, at: 't1', by: 'u1' },
      { value: { done: { a: 't1', b: 't2' }, refused: { c: 't2' } }, at: 't2', by: 'u2' },
      { value: { done: { a: 't1', b: 't2' }, refused: {} }, at: 't3', by: 'u1' },
      { value: { done: {}, refused: {} }, at: 't4', by: 'u2' },
    ]);
    expect(h.map((e) => `${e.op}:${e.cardId}:${e.by}`)).toEqual(['done:a:u1', 'done:b:u2', 'refuse:c:u2', 'undo:c:u1', 'reset:null:u2']);
    const v = queueView(null, ctx);
    expect(queueChanges(['cut', 'gone-card'], cards, v)).toEqual({ added: cards.filter((c: C) => c.id !== 'cut').map((c: C) => c.id), gone: ['gone-card'] });
  });

  it('queue days use the restaurant’s time zone', () => {
    // 3 am UTC on Oct 28 is still Oct 27 in California, and already Oct 28 in New York.
    expect(localDay('2026-10-28T03:00:00Z', 'America/Los_Angeles')).toBe('2026-10-27');
    expect(localDay('2026-10-28T05:00:00Z', 'America/New_York')).toBe('2026-10-28');
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
    expect(t0.state).toEqual({ done: {}, refused: {}, snoozed: {}, meta: {} });
    expect(t0.cards[0]).toMatchObject({ id: 'cut', state: 'needs_review', rank: 1 });
    expect(t0.sample).toBe(true);
    await actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: 'count' }, now);
    // A second person, working from a stale page, snoozes another card: both stick.
    await actOnToday(db, { ...owner(), userId: 'u2' }, { roomId: 'oakland', op: 'snooze', cardId: '7shifts' }, now);
    const t1 = await actOnToday(db, owner(), { roomId: 'oakland', op: 'refuse', cardId: 'salmon', reason: 'not_relevant' }, now);
    expect(Object.keys(t1.state.done)).toEqual(['count']);
    expect(t1.state.snoozed).toEqual({ '7shifts': nextDay(localDay(now)) });
    expect(t1.state.meta).toEqual({ salmon: { reason: 'not_relevant', worth: expect.any(Number) } });
    expect(t1.history.map((h: { op: string; cardId: string | null; by: { you: boolean; name: string | null } }) => `${h.op}:${h.cardId}:${h.by.you ? 'you' : h.by.name}`))
      .toEqual(['done:count:you', 'snooze:7shifts:Jess', 'refuse:salmon:you']);
    expect(t1.summary).toMatchObject({ cleared: 1, snoozed: 1, refused: 1 });
    // Completed items stay auditable: every write is a row with its author and a summary.
    const rows = await db.select().from(actions).where(and(eq(actions.orgId, orgId), eq(actions.key, 'queue'))).orderBy(actions.at);
    expect(rows.map((r) => r.userId)).toEqual(['u1', 'u2', 'u1']);
    expect(rows[2]!.summary).toMatch(/not for us \(doesn’t apply here\)/);
  });

  it('an approval made anywhere is the same action here, pending execution until it’s made', async () => {
    const approval = { roomId: 'oakland', approvalId: 'tue-cut', title: 'Cut one server at 8:00 tonight', system: '7shifts', diff: [['Jess M.', '5:00 – 10:00 pm', '5:00 – 8:00 pm']] };
    // The approval sheet and Today ask at once: one task, not two.
    const [a, b] = await Promise.all([createTask(db, owner(), approval), createTask(db, owner(), approval)]);
    expect(a.id).toBe(b.id);
    expect((await db.select().from(tasks).where(eq(tasks.approvalId, 'tue-cut'))).length).toBe(1);
    let t = await loadToday(db, owner(), 'oakland', now);
    expect(t.cards.find((c: { id: string }) => c.id === 'cut')!.state).toBe('approved');
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: 'cut' }, now)).rejects.toThrow(/already off/);
    await updateTask(db, owner(), a.id, 'done');
    t = await loadToday(db, owner(), 'oakland', now);
    expect(t.cards.find((c: { id: string }) => c.id === 'cut')!.state).toBe('executed');
    await updateTask(db, owner(), a.id, 'reopen');
    await updateTask(db, owner(), a.id, 'cancel');
    t = await loadToday(db, owner(), 'oakland', now);
    expect(t.cards.find((c: { id: string }) => c.id === 'cut')!.state).toBe('needs_review');
  });

  it('refuses bad input and other rooms on the server', async () => {
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: 'made-up' }, now)).rejects.toThrow(/isn’t in today’s queue/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'refuse', cardId: 'cut', reason: 'handled' }, now)).rejects.toThrow(/suggestion/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'refuse', cardId: 'salmon' }, now)).rejects.toThrow(/Say why/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'refuse', cardId: 'salmon', reason: 'because' }, now)).rejects.toThrow(/invalid/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'snooze', cardId: 'cut' }, now)).rejects.toThrow(/due today/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: 'salmon' }, now)).rejects.toThrow(/Not yet/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'explode', cardId: 'cut' }, now)).rejects.toThrow(/invalid/);
    await expect(actOnToday(db, owner(), { roomId: 'oakland', op: 'undo', cardId: 'cut' }, now)).rejects.toThrow(/isn’t done/);
    await expect(actOnToday(db, owner(), { roomId: 'nowhere', op: 'done', cardId: 'cut' }, now)).rejects.toThrow(/no room/);
    await expect(actOnToday(db, gm(), { roomId: 'oakland', op: 'done', cardId: 'count' }, now)).rejects.toThrow(/not one of yours/);
    await expect(loadToday(db, gm(), 'oakland', now)).rejects.toThrow(/not one of yours/);
    await expect(loadToday(db, gm(), 'berkeley', now)).resolves.toMatchObject({ roomId: 'berkeley' });
    // A direct write past the API is still bounded by the schema.
    await expect(saveAction(db, owner(), { roomId: 'oakland', key: 'queue', value: { done: Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`c${i}`, 'x'])), refused: {} } })).rejects.toThrow(/too many/);
  });

  it('a room on its own data: yesterday’s done cards come back, and new or gone cards are reported', async () => {
    await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'toast', rows: [JSON.parse(JSON.stringify(toastSummary))] });
    const t0 = await loadToday(db, owner(), 'oakland', now);
    expect(t0.sample).toBe(true);
    expect(t0.changes).toMatchObject({ added: [], gone: [] });
    const costs = t0.cards.find((c: { id: string }) => c.id.startsWith('costs:'))!;
    await actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: costs.id }, now);
    const next = new Date(now.getTime() + 864e5);
    const t = await loadToday(db, owner(), 'oakland', next);
    expect(t.state.done).toEqual({});
    expect(t.history).toEqual([]);
    const again = await actOnToday(db, owner(), { roomId: 'oakland', op: 'done', cardId: costs.id }, next);
    expect(Object.keys(again.state.done)).toEqual([costs.id]);
    // Three weeks on with no new data: the upload card appears and is reported as new.
    const later = new Date(now.getTime() + 21 * 864e5);
    await loadToday(db, owner(), 'oakland', new Date(later.getTime() - 36e5 * 2));
    const t3 = await loadToday(db, owner(), 'oakland', later);
    expect(t3.cards[0].id).toMatch(/^stale:/);
  });
});

describe('today’s counts and money labels', () => {
  it('every count on the page adds up: total = to decide + waiting on data + handled', () => {
    for (const room of ROOMS) {
      const cards = todayCards(deriveRoom(SEED, room), { today });
      let stored: any = null;
      const ctx = { cards, today, own: true, now: at };
      for (const op of [null, 'done', 'snooze']) {
        const ready = cards.filter((c) => isActiveCard(c, stored, ctx) && !c.approval && !c.task && !c.start && c.deadline !== 'today');
        if (op && ready[0]) stored = applyOp(stored, { op, cardId: ready[0].id }, ctx);
        const sum = queueSummary(cards, queueView(stored, ctx));
        expect(sum.ready + sum.blocked + sum.handled).toBe(sum.total);
        expect(sum.left).toBe(sum.ready + sum.blocked);
      }
    }
  });

  it('every dollar figure on a card says what the money is', () => {
    for (const room of ROOMS) {
      for (const c of todayCards(deriveRoom(SEED, room), { today })) {
        const w = worthOf(c);
        if (/^(about\s+)?[−-]?\$/.test(c.value)) {
          expect(w.figure, `${room}/${c.id}`).toBeTruthy();
          expect(w.means, `${room}/${c.id}`).toBeTruthy();
        } else {
          expect(w.figure).toBeNull();
          expect(w.note).toBe(c.value);
        }
      }
    }
    expect(worthOf({ value: '$37 tonight' }).figure).toBeNull(); // no meaning written down: not a headline figure
    expect(worthOf({ value: 'about $146/wk', means: 'Extra profit a week' })).toMatchObject({ figure: '$146', about: true });
  });
});

function isActiveCard(c: C, stored: unknown, ctx: { cards: C[]; today: string; own: boolean; now: number }) {
  const st = cardState(c, queueView(stored as never, ctx));
  return st === 'ready' || st === 'needs_review';
}

describe('up next, by the money at stake', () => {
  const cards = todayCards(deriveRoom(SEED, 'oakland'), { today });
  it('the recipe upload shows the salmon price it unlocks', () => {
    const recipes = cards.find((c) => c.id === 'recipes')!;
    expect(unlocksOf(recipes, cards)).toMatchObject({ figure: '$146', unit: '/wk', claim: 'mod' });
  });
  it('orders by money times urgency, then the least time', () => {
    const [, ...rest] = cards.filter((c) => !c.blocked);
    const ids = upNextOrder(rest, cards).map((c) => c.id);
    expect(ids.slice(0, 2)).toEqual(['recipes', 'ot']);
    expect(ids.indexOf('7shifts')).toBeLessThan(ids.indexOf('count')); // no dollars: 1 min before 15 min
  });
});
