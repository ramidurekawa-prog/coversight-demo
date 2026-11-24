// The pre-shift staffing call on the server: the same decision Today and
// Service show (lib/data/page/staffing.js), read for the viewer's own room and
// re-checked here before any change is approved. Approving is createTask (one
// task per change, server/tasks.ts), which calls refuseShift below; nothing
// the browser sends about the change (its title, steps or evidence) is used.
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { addDays, DEFAULT_TZ, localNow } from '../../lib/data/page/service.js';
import { evidenceOf, parseShiftId, staffingDecision, staffingOutcome } from '../../lib/data/page/staffing.js';
import type { Db } from '../db/client';
import { actions, rooms, tasks, toastConnections, users } from '../db/schema';
import { loadDataset } from '../dataset';
import { InputError } from '../org';
import { AuthError, type Viewer } from '../session';
import { covercastFor } from './service';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
type Fetch = typeof fetch;
type Opts = { now?: Date; fetchImpl?: Fetch; covercast?: boolean };

/** Roles that may approve a change to who works when. A floor manager reviews, records what happened and enters data. */
export const STAFFING_APPROVERS = ['owner', 'admin', 'gm'];

const query = z.object({
  roomId: z.string().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  meal: z.enum(['lunch', 'dinner']).optional(),
});

/** The room's latest saved value for an action key. */
async function savedFor(db: Db, orgId: string, roomId: string, key: string) {
  const [row] = await db.select({ value: actions.value }).from(actions)
    .where(and(eq(actions.orgId, orgId), eq(actions.roomId, roomId), eq(actions.key, key))).orderBy(desc(actions.at), desc(actions.id)).limit(1);
  return row?.value ?? null;
}
const fencesFor = async (db: Db, orgId: string, roomId: string) => (await savedFor(db, orgId, roomId, 'fences')) as { f?: unknown } | null;

/** The room's own time zone: its Toast location's, else the room's, else Pacific. */
async function tzFor(db: Db, orgId: string, roomId: string, room: { tz?: string } | undefined) {
  const [c] = await db.select({ restaurants: toastConnections.restaurants }).from(toastConnections).where(eq(toastConnections.orgId, orgId));
  return c?.restaurants?.find((x: { roomId?: string }) => x.roomId === roomId)?.tz || room?.tz || DEFAULT_TZ;
}

/**
 * Everything a staffing decision needs for one room, read for this viewer:
 * the applied room (with its schedule and history), fences, Covercast where
 * the room's history is the data it reads, the room's tasks, and the local
 * date and time. `covercast: false` skips the forecast (Today's queue only
 * needs each card's id and state, which don't depend on it).
 */
export async function staffingContext(db: Db, v: V, roomId: string, { now = new Date(), fetchImpl = fetch as Fetch, covercast = true }: Opts = {}) {
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const [r] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.orgId, v.orgId), eq(rooms.id, roomId)));
  if (!r) throw new InputError(`no room '${roomId}' in this group`);
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  const room = loaded?.ds.rooms[roomId];
  if (!room) throw new InputError(`no room '${roomId}' in this group`);
  const tz = await tzFor(db, v.orgId, roomId, room);
  const clock = localNow(now, tz);
  const fences = await fencesFor(db, v.orgId, roomId);
  const roomTasks = await db.select().from(tasks).where(and(eq(tasks.orgId, v.orgId), eq(tasks.roomId, roomId)));
  const cc = covercast && !room.serviceOwn ? await covercastFor(db, v, roomId, clock.date, now, fetchImpl) : null;
  const entries = (loaded!.ds.inputs?.[roomId] ?? {}) as Record<string, { at?: string; date?: string }>;
  // The manager's own changes to the guests expected (staffing.adjust): the call is worked out on them here too.
  const adjust = await savedFor(db, v.orgId, roomId, 'staffing.adjust');
  return { room, tz, clock, fences, tasks: roomTasks, cc, entries, adjust, sample: !!loaded!.org.sample };
}

type Ctx = Awaited<ReturnType<typeof staffingContext>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const decide = (c: Ctx, date: string, meal: 'lunch' | 'dinner', choose: string | null = null): any =>
  staffingDecision(c.room, { date, meal, today: c.clock.date, nowMin: c.clock.minutes, fences: c.fences, cc: c.cc, tasks: c.tasks, entries: c.entries, adjust: c.adjust, choose });

/** Lunch and dinner on a date (today by default) for one room: decision, readiness and, once approved, the outcome. */
export async function loadStaffing(db: Db, v: V, raw: unknown, opts: Opts = {}) {
  const p = query.safeParse(raw);
  if (!p.success) throw new InputError(`invalid request: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const c = await staffingContext(db, v, p.data.roomId, opts);
  const date = p.data.date ?? c.clock.date;
  if (Math.abs(Date.parse(`${date}T12:00:00Z`) - Date.parse(`${c.clock.date}T12:00:00Z`)) > 60 * 864e5) throw new InputError('Pick a date within two months of today.');
  const meals = p.data.meal ? [p.data.meal] : (['lunch', 'dinner'] as const);
  const out: Record<string, unknown> = {};
  for (const meal of meals) {
    const d = decide(c, date, meal);
    const outcome = d.task ? staffingOutcome(d.task, c.room) : null;
    out[meal] = { ...d, outcome };
  }
  return { roomId: p.data.roomId, date, today: c.clock.date, tomorrow: addDays(c.clock.date, 1), nowMin: c.clock.minutes, tz: c.tz, ...out };
}

/**
 * Throws unless `approvalId` is the change the room's data supports right
 * now, for someone allowed to approve it: the date and service's call is
 * still `act`, it's the same change (a different one means the facts moved),
 * no other change is approved for that service, and it's not past the time
 * to decide. The manager may pick a nearer time than the one suggested (one
 * of the call's own `options`, each re-checked here); any other time is
 * refused. Returns the server's own decision and the evidence to keep.
 */
export async function refuseShift(db: Db, v: V, input: { roomId: string; approvalId: string }, opts: Opts = {}) {
  if (!STAFFING_APPROVERS.includes(v.role)) throw new AuthError(403, 'A floor manager can review this and record what happened. The GM or the owner approves a schedule change.');
  const id = parseShiftId(input.approvalId);
  if (!id) throw new InputError('That isn’t a staffing change.');
  const c = await staffingContext(db, v, input.roomId, opts);
  const d = decide(c, id.date, id.meal as 'lunch' | 'dinner', input.approvalId);
  if (d.state === 'decided') throw new InputError(`${d.label} on ${id.date} already has an approved staffing change: “${d.task?.title}”. Undo it first to approve a different one.`);
  if (d.state !== 'act') throw new InputError(`This changed since it was shown: ${d.title} ${d.why ?? ''}`.trim());
  if (d.approvalId !== input.approvalId) throw new InputError(`The numbers moved since this was shown. The call now is: ${d.title}. Look again before approving.`);
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, v.userId));
  const now = opts.now ?? new Date();
  const evidence = { ...evidenceOf(d, { at: now.toISOString(), by: v.userId, roomId: input.roomId }), approvedByName: me?.name ?? null, approvedRole: v.role };
  return { decision: d, evidence, title: d.title as string, system: d.system as string, diff: d.diff as [string, string, string][] };
}
