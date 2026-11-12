// The Service page's backend: tonight live from Toast, and the one cut a
// manager can approve. Every number comes from lib/data/page/service.js, the
// same functions the browser runs; this file only fetches and refuses.
//
// Live pacing pulls today's orders and clock-ins so far from Toast's Standard
// API (the connection server/toast-conn.ts holds), maps them into export rows
// with mapToastDay (the same mapping the nightly sync stores), and paces them
// against the same weekday on recent weeks from pos_days. A short in-memory
// cache keeps a room's managers from hitting Toast on every refresh.
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';

import { cutApprovalId, clockLabel, DAYS, DEFAULT_TZ, hhmm, isCutFor, liveNight, localNow, servicePlan } from '../../lib/data/page/service.js';
import { mapToastDay } from '../../lib/data/toast-api.js';
import { loadDataset } from '../dataset';
import type { Db } from '../db/client';
import { actions, posDays, rooms, tasks, toastConnections } from '../db/schema';
import { notify } from '../notify';
import { InputError } from '../org';
import { SyncError, toastClient, toastLogin } from '../pos-sync';
import { AuthError, type Viewer } from '../session';
import { createTask } from '../tasks';
import { unseal } from '../toast-conn';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
type Fetch = typeof fetch;
type Rows = Record<string, string>[];
type Night = NonNullable<ReturnType<typeof liveNight>>;
export type Live =
  | { live: true; tz: string; date: string; day: string; nowMin: number; night: Night; fetchedAt: string }
  | { live: false; tz: string; date: string; day: string; nowMin: number; why: 'not-connected' | 'no-history' | 'error'; message?: string };

/** How long one pull of tonight is reused for a room. */
export const LIVE_TTL_MS = 120_000;
/** Same weekdays read for the comparable night. */
const COMPARABLE_WEEKS = 4;
const cache = new Map<string, { at: number; value: Live }>();
export function clearServiceCache() { cache.clear(); }

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

async function roomFor(db: Db, v: V, roomId: unknown) {
  if (typeof roomId !== 'string' || !roomId || roomId.length > 60) throw new InputError('roomId is required');
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const [r] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.orgId, v.orgId), eq(rooms.id, roomId)));
  if (!r) throw new InputError(`no room '${roomId}' in this org`);
  return roomId;
}

async function fencesFor(db: Db, orgId: string, roomId: string) {
  const [row] = await db.select({ value: actions.value }).from(actions)
    .where(and(eq(actions.orgId, orgId), eq(actions.roomId, roomId), eq(actions.key, 'fences'))).orderBy(desc(actions.at), desc(actions.id)).limit(1);
  return (row?.value as { f?: unknown } | undefined) ?? null;
}

/** The plan's inputs for a room: its covers per server-hour and blended wage, from the same dataset the browser reads. */
async function planFor(db: Db, orgId: string, roomId: string, day: string, fences: unknown) {
  const loaded = await loadDataset(db, orgId);
  const room = loaded?.ds.rooms[roomId];
  return room ? servicePlan(room, day, fences) : null;
}

/** Tonight for one room, live from Toast when it's connected for that room. */
export async function liveService(db: Db, v: V, roomIdRaw: unknown, { now = new Date(), fetchImpl = fetch as Fetch, fresh = false } = {}): Promise<Live> {
  const roomId = await roomFor(db, v, roomIdRaw);
  const [c] = await db.select().from(toastConnections).where(eq(toastConnections.orgId, v.orgId));
  const r = c?.restaurants.find((x) => x.roomId === roomId);
  const tz = r?.tz || DEFAULT_TZ;
  const { date, day, minutes: nowMin } = localNow(now, tz);
  const head = { tz, date, day, nowMin };
  if (!c || !r || c.status === 'disconnected') return { live: false, ...head, why: 'not-connected' };

  const key = `${v.orgId}:${roomId}`;
  const hit = cache.get(key);
  if (!fresh && hit && now.getTime() - hit.at < LIVE_TTL_MS && hit.value.date === date) return { ...hit.value, nowMin };

  // The same weekday on recent weeks, from the days the nightly sync keeps.
  const since = addDays(date, -7 * COMPARABLE_WEEKS);
  const past = await db.select({ day: posDays.day, orders: posDays.orders }).from(posDays)
    .where(and(eq(posDays.orgId, v.orgId), eq(posDays.roomId, roomId), gte(posDays.day, since), lt(posDays.day, date)));
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const comparable = past.filter((d) => new Date(`${d.day}T12:00:00Z`).getUTCDay() === dow).map((d) => ({ day: d.day, orders: d.orders as Rows }));

  let value: Live;
  try {
    const token = await toastLogin(c.host, c.clientId, unseal(c.secretSealed), fetchImpl);
    const api = toastClient(c.host, token, fetchImpl);
    const [orders, timeEntries, employees, jobs] = await Promise.all([
      api.orders(r.guid, date), api.list(`/labor/v1/timeEntries?businessDate=${date.replace(/-/g, '')}`, r.guid),
      api.list('/labor/v1/employees', r.guid), api.list('/labor/v1/jobs', r.guid),
    ]);
    const m = mapToastDay({ orders: orders as never[], timeEntries: timeEntries as never[], refs: { employees, jobs } as never, tz });
    const fences = await fencesFor(db, v.orgId, roomId);
    const plan = await planFor(db, v.orgId, roomId, day, fences);
    const night = liveNight({ today: { day: date, orders: m.orders, time: m.time }, comparable, nowMin, rate: plan?.rate ?? null, wage: plan?.wage ?? 18, fences });
    value = night ? { live: true, ...head, night, fetchedAt: now.toISOString() } : { live: false, ...head, why: 'no-history' };
  } catch (e) {
    const message = e instanceof SyncError ? e.message : 'Couldn’t reach Toast just now. The plan from your recent weeks still holds.';
    return { live: false, ...head, why: 'error', message };
  }
  cache.set(key, { at: now.getTime(), value });

  // The one message per service: when the call turns into a cut nobody has answered yet.
  if (value.live && value.night.call.mode === 'cut') {
    const call = value.night.call;
    await notify(db, {
      orgId: v.orgId, roomId, kind: 'service.cut', severity: 'info',
      title: `Tonight: one fewer server from ${clockLabel(call.at!)} looks safe`,
      body: `Covers are pacing ${Math.abs(call.pace)}% ${call.pace < 0 ? 'under' : 'over'} a comparable ${DAYS[dow]}. Even at the top of the band, ${call.serversNow! - 1} servers cover the rest of the night.`,
      link: '/service', dedupe: `service-cut:${roomId}:${date}`,
    }).catch(() => null);
  }
  return value;
}

const cutBody = z.object({
  roomId: z.string().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

/**
 * Throws unless a cut task for this approval id is one the rules allow tonight:
 * tonight's date in the room's zone, one cut per night, and the same cut the
 * page shows (live call, or the plan when Toast isn't live), inside the fences.
 * Exported so any other path that creates a `cut:<date>:` task can call it.
 */
export async function refuseCut(db: Db, v: V, input: { roomId: string; date: string; at: string }, opts: { now?: Date; fetchImpl?: Fetch } = {}) {
  const live = await liveService(db, v, input.roomId, opts);
  if (input.date !== live.date) throw new InputError(`A same-night cut can only be approved for tonight (${live.date}).`);
  const done = await db.select({ approvalId: tasks.approvalId }).from(tasks)
    .where(and(eq(tasks.orgId, v.orgId), eq(tasks.roomId, input.roomId), inArray(tasks.status, ['open', 'done', 'verified', 'mismatch'])));
  const tonight = done.find((t) => isCutFor(t.approvalId, live.date));
  if (tonight && tonight.approvalId !== `cut:${input.date}:${input.at}`) throw new InputError('Tonight already has an approved cut. One change per service.');

  if (live.live) {
    const call = live.night.call;
    if (call.mode !== 'cut' || hhmm(call.at!) !== input.at) throw new InputError('Tonight’s numbers moved since this was shown. Look again before approving.');
    return { live, title: `${live.day} ${live.date}: one fewer server from ${clockLabel(call.at!)} to close`, servers: call.serversNow! };
  }
  const fences = await fencesFor(db, v.orgId, input.roomId);
  const plan = await planFor(db, v.orgId, input.roomId, live.day, fences);
  if (!plan) throw new InputError(`Not enough ${live.day} dinners with servers on the floor to plan tonight.`);
  if (plan.cutFrom == null) throw new InputError(plan.blocked?.text ?? `Every hour to close has used its servers on recent ${live.day}s.`);
  if (hhmm(plan.cutFrom * 60) !== input.at) throw new InputError('Tonight’s plan moved since this was shown. Look again before approving.');
  const top = Math.round(plan.hours.find((h) => h.hour === plan.cutFrom)!.servers);
  return { live, title: `${live.day} ${live.date}: one fewer server from ${clockLabel(plan.cutFrom * 60)} to close`, servers: top };
}

/** Approve tonight's cut: checked on the server, then a guided task on Today (7shifts steps). */
export async function approveCut(db: Db, v: V, raw: unknown, opts: { now?: Date; fetchImpl?: Fetch } = {}) {
  const p = cutBody.safeParse(raw);
  if (!p.success) throw new InputError(`invalid cut: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const { roomId, date, at } = p.data;
  const ok = await refuseCut(db, v, { roomId, date, at }, opts);
  const [h, m] = at.split(':').map(Number) as [number, number];
  const approvalId = cutApprovalId(date, h * 60 + m);
  const label = `${ok.live.day} ${clockLabel(h * 60 + m)} to close`;
  const a = { roomId, approvalId, title: ok.title, system: '7shifts', diff: [[label, `${ok.servers} servers`, `${ok.servers - 1} servers`]] as [string, string, string][] };
  const task = await createTask(db, v, a);
  return { task, approval: a };
}
