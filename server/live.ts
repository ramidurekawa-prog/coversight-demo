// Tonight, live, on Today. While someone has Today open the page asks every
// five minutes; this pulls today's Toast orders at most once per five minutes
// per room (whoever asks first) and 7shifts shifts at most once per fifteen,
// stores the result in service_live, and answers from what's stored. The
// `live` job does the same on a schedule; it isn't in vercel.json because
// Vercel Hobby refuses crons more often than daily (add
// `{ "path": "/api/cron/live", "schedule": "*/5 * * * *" }` on Vercel Pro).
//
// Every number comes from lib/data/live.js, the same code the browser runs.
// When a feed is missing or down, a manager's own entry (covers so far,
// servers on) stands in, labelled as entered by hand, and the page stays usable.
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { LIVE, coversBySlot, liveTonight, usualNight } from '../lib/data/live.js';
import { localStamp, mapToastDay } from '../lib/data/toast-api.js';
import type { Db } from './db/client';
import { auditLog, posDays, serviceLive, staffConnections, toastConnections, users } from './db/schema';
import { InputError } from './org';
import { SyncError, toastClient, toastLogin } from './pos-sync';
import { AuthError, type Viewer } from './session';
import { covercastFor } from './page/service';
import { SEVEN, pullStaff } from './sevenshifts';
import { unseal } from './toast-conn';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
type Fetch = typeof fetch;
const DEFAULT_TZ = 'America/Los_Angeles';
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const roomId = z.string().min(1).max(60);

/** The room's Toast restaurant and time zone, if Toast is connected for it. */
async function feedsFor(db: Db, orgId: string, room: string) {
  const [[t], [s]] = await Promise.all([
    db.select().from(toastConnections).where(eq(toastConnections.orgId, orgId)),
    db.select({ locations: staffConnections.locations }).from(staffConnections).where(eq(staffConnections.orgId, orgId)),
  ]);
  const r = t?.restaurants.find((x) => x.roomId === room) ?? null;
  return { toast: t && r ? { conn: t, guid: r.guid, tz: r.tz || DEFAULT_TZ } : null, staff: !!s?.locations.some((l) => l.roomId === room), tz: r?.tz || DEFAULT_TZ };
}

/** Pull today's orders for one room from Toast into service_live. Errors are stored, never thrown. */
export async function pullCovers(db: Db, orgId: string, room: string, { fetchImpl = fetch, now = new Date() }: { fetchImpl?: Fetch; now?: Date } = {}) {
  const f = await feedsFor(db, orgId, room);
  if (!f.toast) return { skipped: true as const };
  const day = localStamp(now.toISOString(), f.toast.tz).slice(0, 10);
  try {
    const token = await toastLogin(f.toast.conn.host, f.toast.conn.clientId, unseal(f.toast.conn.secretSealed), fetchImpl);
    const orders = await toastClient(f.toast.conn.host, token, fetchImpl).orders(f.toast.guid, day);
    const m = mapToastDay({ orders: orders as never[], tz: f.toast.tz });
    const { slots, orders: n } = coversBySlot(m.orders);
    await db.insert(serviceLive).values({ orgId, roomId: room, day, slots, orders: n, pulledAt: now, error: null })
      .onConflictDoUpdate({ target: [serviceLive.orgId, serviceLive.roomId, serviceLive.day], set: { slots, orders: n, pulledAt: now, error: null } });
    return { ok: true as const, orders: n };
  } catch (e) {
    const msg = e instanceof SyncError ? e.message : 'The stored Toast credentials can’t be read. Reconnect Toast.';
    await db.insert(serviceLive).values({ orgId, roomId: room, day, error: msg })
      .onConflictDoUpdate({ target: [serviceLive.orgId, serviceLive.roomId, serviceLive.day], set: { error: msg } });
    return { ok: false as const, error: msg };
  }
}

/** Tonight for one room: refreshed if it's due, then read from what's stored. */
export async function loadLive(db: Db, v: V, room: unknown, { now = new Date(), fetchImpl = fetch, refresh = true }: { now?: Date; fetchImpl?: Fetch; refresh?: boolean } = {}) {
  const p = roomId.safeParse(room);
  if (!p.success) throw new InputError('room is required');
  if (v.rooms && !v.rooms.includes(p.data)) throw new AuthError(403, 'That room is not one of yours.');
  const f = await feedsFor(db, v.orgId, p.data);
  const stamp = localStamp(now.toISOString(), f.tz);
  const day = stamp.slice(0, 10);
  const nowMin = +stamp.slice(11, 13) * 60 + +stamp.slice(14, 16);
  const read = async () => (await db.select().from(serviceLive).where(and(eq(serviceLive.orgId, v.orgId), eq(serviceLive.roomId, p.data), eq(serviceLive.day, day))))[0];
  let row = await read();
  // Pull from dinner minus an hour until it ends; the rest of the day there's nothing to pace.
  const inService = nowMin >= LIVE.startMin - 60 && nowMin <= LIVE.startMin + LIVE.slots * LIVE.slotMin;
  if (refresh && inService) {
    const due = (at: Date | null | undefined, ms: number) => !at || now.getTime() - at.getTime() >= ms;
    const work = [];
    if (f.toast && due(row?.pulledAt, LIVE.refreshMs)) work.push(pullCovers(db, v.orgId, p.data, { fetchImpl, now }));
    if (f.staff && due(row?.staffAt, SEVEN.refreshMs)) work.push(pullStaff(db, v.orgId, p.data, day, f.tz, { fetchImpl, now }));
    if (work.length) { await Promise.all(work); row = await read(); }
  }
  // The usual night: the same weekday over the last eight weeks of stored Toast days.
  const same = Array.from({ length: LIVE.comparableWeeks }, (_, i) => addDays(day, -7 * (i + 1)));
  const days = await db.select({ day: posDays.day, orders: posDays.orders }).from(posDays).where(and(eq(posDays.orgId, v.orgId), eq(posDays.roomId, p.data), inArray(posDays.day, same)));
  const usual = usualNight(days, day);
  // Covercast, the same forecast (and cache) the Service page paces from, so the two pages agree.
  const cc = inService ? await covercastFor(db, v, p.data, day, now, fetchImpl) : null;
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const tonight = liveTonight({
    day, slots: row?.slots ?? null, orders: row?.orders ?? 0, pulledAt: iso(row?.pulledAt), error: row?.error ?? null,
    manual: row?.manual ?? null, staff: row?.staff ?? null, staffAt: iso(row?.staffAt), staffError: row?.staffError ?? null,
  }, usual, { nowMs: now.getTime(), nowMin, connected: { toast: !!f.toast, staff: f.staff }, cc });
  return { roomId: p.data, day, tz: f.tz, time: stamp.slice(11, 16), inService, refreshMs: LIVE.refreshMs, tonight };
}

const manualBody = z.object({
  roomId,
  covers: z.number().int().min(0).max(5000).nullable().optional(),
  servers: z.number().int().min(0).max(200).nullable().optional(),
  clear: z.boolean().optional(),
});

/** A manager's own count for tonight, used while a feed is missing or down. Anyone who can see the room. */
export async function saveManual(db: Db, v: V, input: unknown, now = new Date()) {
  const p = manualBody.safeParse(input);
  if (!p.success) throw new InputError(`invalid entry: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const { roomId: room, covers, servers, clear } = p.data;
  if (v.rooms && !v.rooms.includes(room)) throw new AuthError(403, 'That room is not one of yours.');
  if (!clear && covers == null && servers == null) throw new InputError('Enter covers so far, servers on, or both.');
  const f = await feedsFor(db, v.orgId, room);
  const day = localStamp(now.toISOString(), f.tz).slice(0, 10);
  const [me] = await db.select({ name: users.name, anonymous: users.isAnonymous }).from(users).where(eq(users.id, v.userId));
  const manual = clear ? null : { ...(covers != null ? { covers } : {}), ...(servers != null ? { servers } : {}), at: now.toISOString(), ...(me && !me.anonymous && me.name ? { by: me.name.slice(0, 80) } : {}) };
  await db.insert(serviceLive).values({ orgId: v.orgId, roomId: room, day, manual })
    .onConflictDoUpdate({ target: [serviceLive.orgId, serviceLive.roomId, serviceLive.day], set: { manual } });
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: clear ? 'live.manual.cleared' : 'live.manual', detail: { roomId: room, day, covers: covers ?? null, servers: servers ?? null } });
  return loadLive(db, v, room, { now, refresh: false });
}

/** The scheduled pull (off until Vercel Pro): every connected room that's in service. */
export async function runLive(db: Db, orgId: string, { now = new Date(), fetchImpl = fetch }: { now?: Date; fetchImpl?: Fetch } = {}) {
  const [t] = await db.select({ restaurants: toastConnections.restaurants }).from(toastConnections).where(eq(toastConnections.orgId, orgId));
  const [s] = await db.select({ locations: staffConnections.locations }).from(staffConnections).where(eq(staffConnections.orgId, orgId));
  const roomIds = [...new Set([...(t?.restaurants ?? []).map((r) => r.roomId), ...(s?.locations ?? []).map((l) => l.roomId)])];
  const out: Record<string, { source: string; so: number | null; error: string | null }> = {};
  for (const room of roomIds) {
    const r = await loadLive(db, { orgId, userId: 'system', role: 'owner', rooms: null }, room, { now, fetchImpl });
    out[room] = { source: r.tonight.source, so: r.tonight.so, error: r.tonight.error };
  }
  return { ok: true, rooms: out };
}
