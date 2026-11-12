// The Today page on the server: one card decision at a time, checked against
// the room's real queue for the day, merged into the latest saved value under
// a lock (two managers clearing different cards at once both stick), and the
// day's history of who cleared what.
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { deriveRoom } from '../../lib/data/model.js';
import { applyOp, DEFAULT_TZ, localDay, OPS, queueHistory, queueView, todayCards } from '../../lib/data/page/today.js';
import { saveAction } from '../actions';
import type { Db } from '../db/client';
import { actions, testWindows, users } from '../db/schema';
import { loadDataset } from '../dataset';
import { InputError } from '../org';
import { AuthError, type Viewer } from '../session';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
type QueueValue = { done?: Record<string, string>; refused?: Record<string, string>; snoozed?: Record<string, string> };

const roomId = z.string().min(1).max(60);
const body = z.object({
  roomId,
  op: z.enum(OPS as [string, ...string[]]),
  cardId: z.string().min(1).max(120).regex(/^[\w:.\- ]+$/).optional(),
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
  const [stored, dismissed, running] = await Promise.all([
    latest('queue') as Promise<QueueValue | null>,
    latest('findings') as Promise<Record<string, string> | null>,
    db.select({ lever: testWindows.lever }).from(testWindows)
      .where(and(eq(testWindows.orgId, v.orgId), eq(testWindows.roomId, room), inArray(testWindows.status, ['running', 'waiting']))),
  ]);
  const cards = todayCards(d, { today, testing: running.map((w) => w.lever), dismissed: dismissed ?? {} });
  return { own: !!d.room.fromToast, tz, today, stored, cards };
}

/** Who did what on this room's queue since the start of its day, oldest first. */
async function history(db: Db, v: V, room: string, ctx: { today: string; tz: string; own: boolean }, now: Date) {
  // The local day starts at most 14 hours either side of UTC midnight; read a little wide and keep today's.
  const from = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - 15 * 36e5);
  const where = and(eq(actions.orgId, v.orgId), eq(actions.roomId, room), eq(actions.key, 'queue'));
  const rows = (await db.select({ value: actions.value, at: actions.at, userId: actions.userId, name: users.name, anonymous: users.isAnonymous })
    .from(actions).leftJoin(users, eq(users.id, actions.userId))
    .where(and(where, gte(actions.at, from))).orderBy(asc(actions.at), asc(actions.id)))
    .filter((r) => localDay(r.at, ctx.tz) === ctx.today);
  const first = rows[0]?.at ?? now;
  const [before] = await db.select({ value: actions.value }).from(actions).where(and(where, lt(actions.at, first))).orderBy(desc(actions.at), desc(actions.id)).limit(1);
  // Seen as of today, so yesterday's cleared cards and lapsed snoozes don't read as undone.
  const start = queueView(before?.value as QueueValue | null, { today: ctx.today, own: ctx.own, now: now.getTime(), tz: ctx.tz });
  const by = (r: (typeof rows)[number]) => ({ you: r.userId === v.userId, name: r.anonymous ? null : (r.name ?? null) });
  return queueHistory(rows.map((r) => ({ value: r.value, at: r.at.toISOString(), by: by(r) })), start);
}

/** The room's saved queue as of today, and today's history. */
export async function loadToday(db: Db, v: V, room: unknown, now = new Date()) {
  const p = roomId.safeParse(room);
  if (!p.success) throw new InputError('room is required');
  const ctx = await context(db, v, p.data, now);
  return {
    roomId: p.data,
    today: ctx.today,
    state: queueView(ctx.stored, { today: ctx.today, own: ctx.own, now: now.getTime(), tz: ctx.tz }),
    history: await history(db, v, p.data, ctx, now),
  };
}

/** One decision on one card: checked against today's queue, merged under a per-room lock. */
export async function actOnToday(db: Db, v: V, input: unknown, now = new Date()) {
  const p = body.safeParse(input);
  if (!p.success) throw new InputError(`invalid request: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const { roomId: room, op, cardId } = p.data;
  if (op !== 'reset' && !cardId) throw new InputError('cardId is required');
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`today:${v.orgId}:${room}`}))`);
    const ctx = await context(t, v, room, now);
    let next;
    try {
      next = applyOp(ctx.stored, { op, cardId }, { cards: ctx.cards, today: ctx.today, own: ctx.own, now: now.getTime(), tz: ctx.tz });
    } catch (err) {
      throw new InputError((err as Error).message);
    }
    const title = ctx.cards.find((c: { id: string }) => c.id === cardId)?.title ?? cardId ?? '';
    await saveAction(t, v, { roomId: room, key: 'queue', value: next, summary: op === 'reset' ? `Today: ${OP_SUMMARY.reset}` : `${title}: ${OP_SUMMARY[op]}` });
  });
  return loadToday(db, v, room, now);
}
