// The Today page on the server. One decision at a time, checked against the
// room's real queue for the day (same rules as the browser:
// lib/data/page/today.js), merged into the latest saved value under a
// per-room lock so two managers acting at once both stick. Approvals and
// prepared changes are the guided tasks themselves (server/tasks.ts), so an
// action approved on Service or Meeting shows as the same action here. Also:
// who did what today, and what changed since the queue was last built.
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { deriveRoom } from '../../lib/data/model.js';
import { dataEnd } from '../../lib/data/readers.js';
import { applyOp, cardState, DECLINE, DEFAULT_TZ, localDay, OPS, queueChanges, queueHistory, queueSummary, queueView, todayCards } from '../../lib/data/page/today.js';
import { saveAction } from '../actions';
import type { Db } from '../db/client';
import { actions, snapshots, tasks, testWindows, users } from '../db/schema';
import { loadDataset } from '../dataset';
import { InputError } from '../org';
import { AuthError, type Viewer } from '../session';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
type QueueValue = { done?: Record<string, string>; refused?: Record<string, string>; snoozed?: Record<string, string>; meta?: Record<string, unknown> };
type Card = { id: string; title: string; [k: string]: unknown };

const roomId = z.string().min(1).max(60);
const body = z.object({
  roomId,
  op: z.enum(OPS as [string, ...string[]]),
  cardId: z.string().min(1).max(120).regex(/^[\w:.\- ]+$/).optional(),
  reason: z.enum(Object.keys(DECLINE) as [string, ...string[]]).optional(),
});

const OP_SUMMARY: Record<string, string> = { done: 'done', refuse: 'not for us', snooze: 'snoozed until tomorrow', undo: 'back on the queue', reset: 'today’s cards shown again' };

/** Everything the queue rules need for one room, read on the server. */
async function context(db: Db, v: V, room: string, now: Date) {
  if (v.rooms && !v.rooms.includes(room)) throw new AuthError(403, 'That room is not one of yours.');
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  if (!loaded?.ds.rooms[room]) throw new InputError(`no room '${room}' in this group`);
  const d = deriveRoom(loaded.ds, room);
  const tz: string = d.room.tz || DEFAULT_TZ;
  const today = localDay(now, tz);
  const latest = async (key: string) => {
    const [r] = await db.select({ value: actions.value }).from(actions)
      .where(and(eq(actions.orgId, v.orgId), eq(actions.roomId, room), eq(actions.key, key))).orderBy(desc(actions.at), desc(actions.id)).limit(1);
    return r?.value ?? null;
  };
  const [stored, dismissed, running, roomTasks] = await Promise.all([
    latest('queue') as Promise<QueueValue | null>,
    latest('findings') as Promise<Record<string, string> | null>,
    db.select({ lever: testWindows.lever }).from(testWindows)
      .where(and(eq(testWindows.orgId, v.orgId), eq(testWindows.roomId, room), inArray(testWindows.status, ['running', 'waiting']))),
    db.select({ approvalId: tasks.approvalId, status: tasks.status, roomId: tasks.roomId }).from(tasks)
      .where(and(eq(tasks.orgId, v.orgId), eq(tasks.roomId, room))),
  ]);
  const cards: Card[] = todayCards(d, { today, testing: running.map((w) => w.lever), dismissed: dismissed ?? {}, tasks: roomTasks });
  return { own: !!d.room.fromToast, sample: !!loaded.org.sample, tz, today, through: dataEnd(d.room) as string, stored, cards };
}

/** Who did what on this room's queue since the start of its day, oldest first. */
async function history(db: Db, v: V, room: string, ctx: { today: string; tz: string; own: boolean; cards: Card[] }, now: Date) {
  // A local day starts at most 14 hours either side of UTC midnight; read a little wide and keep today's.
  const from = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - 15 * 36e5);
  const where = and(eq(actions.orgId, v.orgId), eq(actions.roomId, room), eq(actions.key, 'queue'));
  const rows = (await db.select({ value: actions.value, at: actions.at, userId: actions.userId, name: users.name, anonymous: users.isAnonymous })
    .from(actions).leftJoin(users, eq(users.id, actions.userId))
    .where(and(where, gte(actions.at, from))).orderBy(asc(actions.at), asc(actions.id)))
    .filter((r) => localDay(r.at, ctx.tz) === ctx.today);
  const first = rows[0]?.at ?? now;
  const [before] = await db.select({ value: actions.value }).from(actions).where(and(where, lt(actions.at, first))).orderBy(desc(actions.at), desc(actions.id)).limit(1);
  // Seen as of today, so yesterday's done cards and lapsed snoozes don't read as undone.
  const start = queueView(before?.value as QueueValue | null, { today: ctx.today, own: ctx.own, now: now.getTime(), tz: ctx.tz, cards: ctx.cards });
  const by = (r: (typeof rows)[number]) => ({ you: r.userId === v.userId, name: r.anonymous ? null : (r.name ?? null) });
  return queueHistory(rows.map((r) => ({ value: r.value, at: r.at.toISOString(), by: by(r) })), start);
}

/**
 * What changed since the queue was last built for this room: kept as a
 * snapshot of today's card ids, replaced when the cards change. Decisions
 * are never touched by a rebuild; this only explains it.
 */
async function changes(db: Db, orgId: string, room: string, ctx: { today: string; cards: Card[] }, view: ReturnType<typeof queueView>, now: Date) {
  const [snap] = await db.select().from(snapshots).where(and(eq(snapshots.orgId, orgId), eq(snapshots.roomId, room), eq(snapshots.kind, 'today')));
  const prev = snap?.data as { day: string; ids: string[]; since: string; changed?: { added: string[]; gone: string[] } } | undefined;
  const ids = ctx.cards.map((c) => c.id);
  const same = prev && prev.day === ctx.today && prev.ids.length === ids.length && prev.ids.every((x, i) => x === ids[i]);
  if (same) return { builtAt: prev.since, ...(prev.changed ?? { added: [], gone: [] }) };
  const diff = prev && prev.day === ctx.today ? queueChanges(prev.ids, ctx.cards, view) : { added: [], gone: [] };
  const data = { day: ctx.today, ids, since: now.toISOString(), changed: diff };
  await db.insert(snapshots).values({ orgId, roomId: room, kind: 'today', data })
    .onConflictDoUpdate({ target: [snapshots.orgId, snapshots.roomId, snapshots.kind], set: { data, at: now } });
  return { builtAt: data.since, ...diff };
}

/** The room's queue as of today: decisions, card states, totals, history and what changed. */
export async function loadToday(db: Db, v: V, room: unknown, now = new Date()) {
  const p = roomId.safeParse(room);
  if (!p.success) throw new InputError('room is required');
  const ctx = await context(db, v, p.data, now);
  const state = queueView(ctx.stored, { today: ctx.today, own: ctx.own, now: now.getTime(), tz: ctx.tz, cards: ctx.cards });
  return {
    roomId: p.data,
    today: ctx.today,
    tz: ctx.tz,
    dataThrough: ctx.through,
    sample: ctx.sample,
    state,
    cards: ctx.cards.map((c) => ({ id: c.id, state: cardState(c, state), rank: c.rank, category: c.category, blocked: c.blocked ?? null })),
    summary: queueSummary(ctx.cards, state),
    history: await history(db, v, p.data, ctx, now),
    changes: await changes(db, v.orgId, p.data, ctx, state, now),
  };
}

/** One decision on one card: checked against today's queue, merged under a per-room lock. */
export async function actOnToday(db: Db, v: V, input: unknown, now = new Date()) {
  const p = body.safeParse(input);
  if (!p.success) throw new InputError(`invalid request: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const { roomId: room, op, cardId, reason } = p.data;
  if (op !== 'reset' && !cardId) throw new InputError('cardId is required');
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`today:${v.orgId}:${room}`}))`);
    const ctx = await context(t, v, room, now);
    let next;
    try {
      next = applyOp(ctx.stored, { op, cardId, reason }, { cards: ctx.cards, today: ctx.today, own: ctx.own, now: now.getTime(), tz: ctx.tz });
    } catch (err) {
      throw new InputError((err as Error).message);
    }
    const title = ctx.cards.find((c) => c.id === cardId)?.title ?? cardId ?? '';
    const why = op === 'refuse' && reason ? ` (${DECLINE[reason as keyof typeof DECLINE].label.toLowerCase()})` : '';
    await saveAction(t, v, { roomId: room, key: 'queue', value: next, summary: op === 'reset' ? `Today: ${OP_SUMMARY.reset}` : `${title}: ${OP_SUMMARY[op]}${why}` });
  });
  return loadToday(db, v, room, now);
}
