// Daily detail: a room's own days, hours and dishes, and the notes managers
// leave on a day. Every figure is computed by lib/data/page/daily.js, the same
// code the browser runs; this file only stores, scopes and validates.
//
// Two ways days arrive, one reader:
//  - the Toast sync's pos_days: summarised here, a day at a time, whenever a
//    day was pulled after its summary was built (late voids and clock-outs);
//  - Toast exports dropped on the page: parsed and summarised in the browser,
//    re-validated here. A synced day is never replaced by an uploaded one.
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { addDays, buildDaily, CALC_VERSION, DAY_STARTS_AT, KEEP_DAYS, MAX_CHECKS, NOTE_MAX, summarizeDays, weeklyItems } from '../../lib/data/page/daily.js';
import { daysToFiles } from '../../lib/data/toast-api.js';
import type { Db } from '../db/client';
import { auditLog, dailyDays, dailyNotes, posDays, rooms, toastConnections, users } from '../db/schema';
import { InputError } from '../org';
import { AuthError, type Viewer } from '../session';

export const DAILY = {
  /** Synced days summarised per request; the page asks again while more are waiting. */
  buildPerCall: 45,
  /** Uploaded days accepted per request (the browser sends in chunks; checks make each day bigger). */
  maxUpload: 31,
} as const;

const DEFAULT_TZ = 'America/Los_Angeles';
const iso = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'a date like 2026-10-24');
const amount = z.number().finite().min(-10_000_000).max(10_000_000);
const count = z.number().int().min(0).max(1_000_000);
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** One stored day, as summarizeDays() makes it. Bounds keep a bad upload out. */
export const daySummary = z.object({
  day: iso,
  net: amount, gross: amount, discounts: amount, refunds: opt(amount), voids: opt(amount),
  tax: opt(amount), tips: opt(amount), food: opt(amount), drink: opt(amount),
  covers: count, orders: count,
  channels: z.record(z.string().min(1).max(40), amount).refine((o) => Object.keys(o).length <= 12, 'too many channels'),
  labour: opt(amount), labourHours: opt(z.number().finite().min(0).max(100_000)),
  turnMin: opt(z.number().finite().min(0).max(720)),
  firstOrder: opt(clock), lastOrder: opt(clock),
  hours: z.array(z.object({
    h: z.number().int().min(0).max(23), covers: count, sales: amount, orders: count,
    servers: opt(z.number().int().min(0).max(500)), labourHours: opt(z.number().finite().min(0).max(10_000)), labour: opt(amount),
  }).strict()).max(24),
  dishes: z.record(z.string().min(1).max(160), z.tuple([z.number().finite().min(0).max(1_000_000), amount, amount, z.string().max(40)]))
    .refine((o) => Object.keys(o).length <= 400, 'too many dishes'),
}).strict();
export type DaySummary = z.infer<typeof daySummary>;

/** A check, for drill-down: [id, opened, paid, guests, server, table, channel, amount, discount, voided]. */
const checkRow = z.tuple([z.string().max(80), z.union([clock, z.literal('')]), z.union([clock, z.literal('')]), count, z.string().max(80), z.string().max(40), z.string().max(40), amount, amount, z.union([z.literal(0), z.literal(1)])]);
const uploadDay = z.object({ summary: daySummary, checks: z.array(checkRow).max(MAX_CHECKS), complete: z.boolean() }).strict();

/** The room must be in the viewer's group, and one of theirs. */
async function assertRoom(db: Db, v: Pick<Viewer, 'orgId' | 'rooms'>, roomId: unknown): Promise<string> {
  if (typeof roomId !== 'string' || !roomId || roomId.length > 80) throw new InputError('room is required');
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const [r] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.orgId, v.orgId), eq(rooms.id, roomId)));
  if (!r) throw new InputError(`no room '${roomId}' in this group`);
  return roomId;
}

const emptyDay = (day: string): DaySummary => ({ day, net: 0, gross: 0, discounts: 0, refunds: null, voids: null, tax: null, tips: null, food: null, drink: null, covers: 0, orders: 0, channels: {}, labour: null, labourHours: null, turnMin: null, firstOrder: null, lastOrder: null, hours: [], dishes: {} });

/** The instant a business day ends (4 am the next morning) in a time zone. */
export function businessDayEnd(day: string, tz: string = DEFAULT_TZ) {
  const wall = Date.parse(`${addDays(day, 1)}T${String(DAY_STARTS_AT).padStart(2, '0')}:00:00Z`);
  // The zone's offset at about that time; one correction step settles a DST edge.
  const offset = (ms: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - ms;
  };
  let utc = wall - offset(wall);
  utc = wall - offset(utc);
  return new Date(utc);
}

async function connection(db: Db, orgId: string, roomId: string) {
  const [c] = await db.select({ restaurants: toastConnections.restaurants, syncedAt: toastConnections.syncedAt, syncState: toastConnections.syncState }).from(toastConnections).where(eq(toastConnections.orgId, orgId));
  return { tz: c?.restaurants.find((r) => r.roomId === roomId)?.tz || DEFAULT_TZ, syncedAt: c?.syncedAt ?? null, syncState: c?.syncState ?? null };
}

/**
 * Summarise synced days whose rows were pulled after their summary was built
 * (or by an older calculation). A day pulled before it ended is partial.
 * Bounded per call; returns how many are still waiting.
 */
export async function buildFromSync(db: Db, orgId: string, roomId: string, limit: number = DAILY.buildPerCall) {
  const pulled = await db.select({ day: posDays.day, fetchedAt: posDays.fetchedAt }).from(posDays).where(and(eq(posDays.orgId, orgId), eq(posDays.roomId, roomId)));
  if (!pulled.length) return { built: 0, pending: 0 };
  const have = new Map((await db.select({ day: dailyDays.day, source: dailyDays.source, builtAt: dailyDays.builtAt, version: dailyDays.version, complete: dailyDays.complete }).from(dailyDays)
    .where(and(eq(dailyDays.orgId, orgId), eq(dailyDays.roomId, roomId)))).map((r) => [r.day, r]));
  const { tz } = await connection(db, orgId, roomId);
  // A partial day whose rows were since pulled after it ended is rebuilt too, whatever the clocks say.
  const stale = pulled.filter((p) => { const h = have.get(p.day); return !h || h.source !== 'toast-api' || h.builtAt < p.fetchedAt || h.version !== CALC_VERSION || (!h.complete && p.fetchedAt >= businessDayEnd(p.day, tz)); })
    .map((p) => p.day).sort().reverse(); // newest first: what a manager looks at
  const now = stale.slice(0, limit);
  for (let i = 0; i < now.length; i += 15) {
    const chunk = now.slice(i, i + 15);
    const rows = await db.select().from(posDays).where(and(eq(posDays.orgId, orgId), eq(posDays.roomId, roomId), inArray(posDays.day, chunk)));
    for (const r of rows) {
      const [s] = summarizeDays(daysToFiles([r]), { day: r.day }).days;
      const parsed = daySummary.safeParse(s ?? emptyDay(r.day)); // a day the POS held with no orders is a closed day, not a missing one
      if (!parsed.success) continue;
      const row = { orgId, roomId, day: r.day, source: 'toast-api', summary: parsed.data, complete: r.fetchedAt >= businessDayEnd(r.day, tz), checks: null, version: CALC_VERSION, userId: null, builtAt: new Date() };
      await db.insert(dailyDays).values(row).onConflictDoUpdate({ target: [dailyDays.orgId, dailyDays.roomId, dailyDays.day], set: row });
    }
  }
  return { built: now.length, pending: stale.length - now.length };
}

async function prune(db: Db, orgId: string, roomId: string) {
  const [newest] = await db.select({ day: sql<string>`max(${dailyDays.day})` }).from(dailyDays).where(and(eq(dailyDays.orgId, orgId), eq(dailyDays.roomId, roomId)));
  if (newest?.day) await db.delete(dailyDays).where(and(eq(dailyDays.orgId, orgId), eq(dailyDays.roomId, roomId), lt(dailyDays.day, addDays(newest.day, -KEEP_DAYS + 1))));
}

/**
 * Everything the page needs for one room: the built view (null when the room
 * has no days of its own), notes, and provenance: when the sync last ran is
 * not the same as the day the data is complete through.
 */
export async function loadDaily(db: Db, v: Pick<Viewer, 'orgId' | 'rooms'>, roomIdIn: unknown) {
  const roomId = await assertRoom(db, v, roomIdIn);
  const { pending } = await buildFromSync(db, v.orgId, roomId);
  const stored = await db.select({ day: dailyDays.day, source: dailyDays.source, summary: dailyDays.summary, complete: dailyDays.complete, builtAt: dailyDays.builtAt }).from(dailyDays)
    .where(and(eq(dailyDays.orgId, v.orgId), eq(dailyDays.roomId, roomId))).orderBy(asc(dailyDays.day));
  const full = stored.map((r) => ({ ...(r.summary as DaySummary), source: r.source, complete: r.complete }));
  // Dishes stay on the server: weekly item totals go down, a day's dishes come with the day.
  const view = buildDaily(full.map((x) => ({ ...x, dishes: {} })), { items: weeklyItems(full) });
  const uploaded = stored.filter((r) => r.source === 'toast-export');
  const conn = await connection(db, v.orgId, roomId);
  const complete = stored.filter((r) => r.complete);
  return {
    roomId, view, pending, notes: await listNotes(db, v.orgId, roomId),
    provenance: {
      synced: stored.length - uploaded.length, uploaded: uploaded.length,
      uploadedAt: uploaded.reduce<Date | null>((a, r) => (!a || r.builtAt > a ? r.builtAt : a), null)?.toISOString() ?? null,
      first: stored[0]?.day ?? null, last: stored.at(-1)?.day ?? null,
      dataThrough: complete.at(-1)?.day ?? null,
      partial: stored.filter((r) => !r.complete).map((r) => r.day),
      lastSyncAt: conn.syncedAt?.toISOString() ?? null, syncState: conn.syncState, tz: conn.tz, calc: CALC_VERSION,
    },
  };
}

/** One day in full: its dishes and its checks (from the sync's rows, or the upload's). */
export async function loadDay(db: Db, v: Pick<Viewer, 'orgId' | 'rooms'>, roomIdIn: unknown, dayIn: unknown) {
  const roomId = await assertRoom(db, v, roomIdIn);
  const day = iso.safeParse(dayIn);
  if (!day.success) throw new InputError('day must be a date like 2026-10-24');
  const [row] = await db.select().from(dailyDays).where(and(eq(dailyDays.orgId, v.orgId), eq(dailyDays.roomId, roomId), eq(dailyDays.day, day.data)));
  if (!row) return { day: day.data, held: false as const };
  let checks = (row.checks as unknown[] | null) ?? null;
  if (row.source === 'toast-api') {
    const [p] = await db.select().from(posDays).where(and(eq(posDays.orgId, v.orgId), eq(posDays.roomId, roomId), eq(posDays.day, day.data)));
    checks = p ? summarizeDays(daysToFiles([p]), { day: day.data }).checks[day.data] ?? [] : null;
  }
  const s = row.summary as DaySummary;
  return { day: day.data, held: true as const, source: row.source, complete: row.complete, dishes: s.dishes, checks, checksKept: checks != null };
}

/** Days parsed from dropped Toast exports. Synced days are kept; the rest are added or replaced. */
export async function saveUploadedDays(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'rooms'>, body: unknown) {
  const b = (body ?? {}) as { roomId?: unknown; days?: unknown };
  const roomId = await assertRoom(db, v, b.roomId);
  if (!Array.isArray(b.days) || !b.days.length) throw new InputError('days are required');
  if (b.days.length > DAILY.maxUpload) throw new InputError(`at most ${DAILY.maxUpload} days per request`);
  const days: z.infer<typeof uploadDay>[] = [];
  for (const [i, d] of b.days.entries()) {
    const p = uploadDay.safeParse(d);
    if (!p.success) throw new InputError(`day ${i + 1}: ${p.error.issues[0]?.path.join('.') || 'value'} ${p.error.issues[0]?.message ?? 'is not valid'}`);
    days.push(p.data);
  }
  const dup = days.find((d, i) => days.findIndex((x) => x.summary.day === d.summary.day) !== i);
  if (dup) throw new InputError(`${dup.summary.day} is in this upload twice`);
  const synced = new Set((await db.select({ day: dailyDays.day }).from(dailyDays)
    .where(and(eq(dailyDays.orgId, v.orgId), eq(dailyDays.roomId, roomId), eq(dailyDays.source, 'toast-api'), inArray(dailyDays.day, days.map((d) => d.summary.day))))).map((r) => r.day));
  const take = days.filter((d) => !synced.has(d.summary.day));
  for (const d of take) {
    const row = { orgId: v.orgId, roomId, day: d.summary.day, source: 'toast-export', summary: d.summary, complete: d.complete, checks: d.checks, version: CALC_VERSION, userId: v.userId, builtAt: new Date() };
    await db.insert(dailyDays).values(row).onConflictDoUpdate({ target: [dailyDays.orgId, dailyDays.roomId, dailyDays.day], set: row, setWhere: sql`${dailyDays.source} <> 'toast-api'` });
  }
  await prune(db, v.orgId, roomId);
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'daily.uploaded', detail: { roomId, days: take.length, kept: synced.size, first: days[0]!.summary.day, last: days.at(-1)!.summary.day } });
  return { saved: take.length, keptSynced: synced.size };
}

/** Remove the days that came from dropped exports (synced days stay). */
export async function removeUploadedDays(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'rooms'>, roomIdIn: unknown) {
  const roomId = await assertRoom(db, v, roomIdIn);
  const gone = await db.delete(dailyDays).where(and(eq(dailyDays.orgId, v.orgId), eq(dailyDays.roomId, roomId), eq(dailyDays.source, 'toast-export'))).returning({ day: dailyDays.day });
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'daily.removed', detail: { roomId, days: gone.length } });
  return { removed: gone.length };
}

/* ------------------------------------------------------------------ notes */

export async function listNotes(db: Db, orgId: string, roomId: string) {
  const rows = await db.select({ day: dailyNotes.day, text: dailyNotes.text, author: dailyNotes.author, at: dailyNotes.updatedAt }).from(dailyNotes)
    .where(and(eq(dailyNotes.orgId, orgId), eq(dailyNotes.roomId, roomId))).orderBy(asc(dailyNotes.day));
  return Object.fromEntries(rows.map((r) => [r.day, { text: r.text, by: r.author, at: r.at.toISOString() }]));
}

const noteBody = z.object({ roomId: z.string(), day: iso, text: z.string().max(NOTE_MAX * 2) });

/** Write, change or (with empty text) remove the note on one day. */
export async function saveNote(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'rooms'>, body: unknown) {
  const p = noteBody.safeParse(body);
  if (!p.success) throw new InputError(`invalid note: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const roomId = await assertRoom(db, v, p.data.roomId);
  const text = p.data.text.replace(/\s+/g, ' ').trim();
  if (text.length > NOTE_MAX) throw new InputError(`a note is at most ${NOTE_MAX} characters`);
  const where = and(eq(dailyNotes.orgId, v.orgId), eq(dailyNotes.roomId, roomId), eq(dailyNotes.day, p.data.day));
  if (!text) {
    await db.delete(dailyNotes).where(where);
  } else {
    const [u] = await db.select({ name: users.name, anon: users.isAnonymous }).from(users).where(eq(users.id, v.userId));
    const author = u?.anon ? 'Guest' : (u?.name ?? '').slice(0, 80);
    const row = { orgId: v.orgId, roomId, day: p.data.day, text, userId: v.userId, author, updatedAt: new Date() };
    await db.insert(dailyNotes).values(row).onConflictDoUpdate({ target: [dailyNotes.orgId, dailyNotes.roomId, dailyNotes.day], set: row });
  }
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: text ? 'daily.note' : 'daily.note.removed', detail: { roomId, day: p.data.day } });
  return { notes: await listNotes(db, v.orgId, roomId) };
}
