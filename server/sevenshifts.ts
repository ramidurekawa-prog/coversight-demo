// 7shifts: who's scheduled tonight, so Today can say whether staffing fits the
// covers. Read-only. The owner pastes a 7shifts access token into the Connect
// page; it's checked against 7shifts, sealed with CREDENTIALS_KEY like Toast's
// secret, and never returned, logged or exported. Each 7shifts location maps
// to one room. Until a token is stored nothing here calls 7shifts, and the
// floor enters "servers on" by hand on Today instead.
//
// Built against 7shifts' public API v2 (whoami, company locations, roles,
// shifts). Not yet run against a live 7shifts account: the first real
// connection should be watched (see the PR's uncertainties).
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { LIVE } from '../lib/data/live.js';
import type { Db } from './db/client';
import { auditLog, rooms, serviceLive, staffConnections } from './db/schema';
import { InputError } from './org';
import { AuthError, type Viewer } from './session';
import { seal, unseal } from './toast-conn';

type Fetch = typeof fetch;
export const SEVEN = { base: 'https://api.7shifts.com/v2', refreshMs: 15 * 60_000 } as const;
export const SEVEN_MSG = {
  token: '7shifts didn’t accept that access token. Create a new one in 7shifts (Settings → Developer tools → Access tokens) and paste it again.',
  host: 'Couldn’t reach 7shifts. Try again in a minute.',
  company: 'That token can’t see a 7shifts company. Check it was made by a company admin.',
};

class SevenError extends Error {
  override name = 'SevenError';
}

/** One 7shifts call. Never puts the token in an error. */
async function get(token: string, path: string, fetchImpl: Fetch) {
  let res: Response;
  try {
    res = await fetchImpl(`${SEVEN.base}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  } catch {
    throw new SevenError(SEVEN_MSG.host);
  }
  if (res.status === 401 || res.status === 403) throw new SevenError(SEVEN_MSG.token);
  if (!res.ok) throw new SevenError(`7shifts answered ${res.status} for ${path.split('?')[0]}.`);
  return (await res.json().catch(() => null)) as { data?: unknown } | null;
}

const arr = (b: { data?: unknown } | null) => (Array.isArray(b?.data) ? (b!.data as Record<string, unknown>[]) : []);

const checkBody = z.object({ token: z.string().trim().min(10).max(2000), companyId: z.string().trim().regex(/^\d{1,20}$/).optional() });

/** Ask 7shifts: does this token work, which company, which locations and roles can it see? */
export async function checkSevenShifts(raw: unknown, fetchImpl: Fetch = fetch) {
  const p = checkBody.safeParse(raw);
  if (!p.success) return { ok: false as const, error: 'Paste the access token from 7shifts.' };
  try {
    let companyId = p.data.companyId;
    if (!companyId) {
      const who = (await get(p.data.token, '/whoami', fetchImpl))?.data as { company_id?: number; companies?: { id?: number }[] } | undefined;
      const id = who?.company_id ?? who?.companies?.[0]?.id;
      if (!id) return { ok: false as const, error: SEVEN_MSG.company };
      companyId = String(id);
    }
    const [locs, roles] = await Promise.all([get(p.data.token, `/company/${companyId}/locations`, fetchImpl), get(p.data.token, `/company/${companyId}/roles`, fetchImpl)]);
    return {
      ok: true as const,
      companyId,
      locations: arr(locs).map((l) => ({ id: String(l.id), name: String(l.name ?? l.id) })),
      roles: arr(roles).map((r) => ({ id: String(r.id), name: String(r.name ?? r.id) })),
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof SevenError ? e.message : SEVEN_MSG.host };
  }
}

const connectBody = checkBody.extend({
  locations: z.array(z.object({ locationId: z.string().regex(/^\d{1,20}$/), roomId: z.string().min(1).max(60) })).min(1).max(20),
  serverRoles: z.array(z.string().regex(/^\d{1,20}$/)).max(50).optional(),
});

/** Owner only: check, then store the token sealed with its location → room map. */
export async function connectSevenShifts(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'role'>, raw: unknown, fetchImpl: Fetch = fetch) {
  if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can connect 7shifts.');
  const p = connectBody.safeParse(raw);
  if (!p.success) throw new InputError(`invalid 7shifts setup: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const check = await checkSevenShifts(p.data, fetchImpl);
  if (!check.ok) return { connected: false as const, check };
  const ours = new Set((await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.orgId, v.orgId))).map((r) => r.id));
  for (const l of p.data.locations) {
    if (!ours.has(l.roomId)) throw new InputError(`no room '${l.roomId}' in this group`);
    if (!check.locations.some((x) => x.id === l.locationId)) throw new InputError('That 7shifts location isn’t visible to this token.');
  }
  const row = {
    orgId: v.orgId, provider: '7shifts', companyId: check.companyId, tokenSealed: seal(p.data.token),
    locations: p.data.locations.map((l) => ({ ...l, name: check.locations.find((x) => x.id === l.locationId)!.name })),
    serverRoles: p.data.serverRoles ?? [], status: 'connected', lastError: null, checkedAt: new Date(), createdBy: v.userId,
  };
  await db.insert(staffConnections).values(row).onConflictDoUpdate({ target: staffConnections.orgId, set: row });
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'staff.connected', detail: { provider: '7shifts', locations: row.locations.length } });
  return { connected: true as const, status: await staffStatus(db, v.orgId) };
}

/** What anyone in the group may see: never the token. */
export async function staffStatus(db: Db, orgId: string) {
  const [c] = await db.select().from(staffConnections).where(eq(staffConnections.orgId, orgId));
  if (!c) return null;
  return { provider: c.provider, companyId: c.companyId, locations: c.locations, serverRoles: c.serverRoles, status: c.status, lastError: c.lastError, checkedAt: c.checkedAt };
}

export async function disconnectSevenShifts(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'role'>) {
  if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can disconnect 7shifts.');
  await db.delete(staffConnections).where(eq(staffConnections.orgId, v.orgId));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'staff.disconnected', detail: { provider: '7shifts' } });
}

/** Local wall-clock "YYYY-MM-DD HH:MM" in a zone → the UTC instant. */
function zonedToUtc(day: string, min: number, tz: string) {
  const guess = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), Math.floor(min / 60), min % 60);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!);
  return new Date(guess - (asLocal - guess));
}

/**
 * Servers on the floor per dinner slot from tonight's published shifts:
 * a shift counts in a slot when it covers the slot's start. Open (unassigned)
 * and deleted shifts don't count; with server roles chosen, only those roles.
 */
export function serversBySlot(shifts: Record<string, unknown>[], day: string, tz: string, serverRoles: string[]) {
  const starts = Array.from({ length: LIVE.slots }, (_, i) => zonedToUtc(day, LIVE.startMin + i * LIVE.slotMin, tz).getTime());
  const out = Array(LIVE.slots).fill(0);
  for (const s of shifts) {
    if (s.deleted || s.open || s.draft) continue;
    if (serverRoles.length && !serverRoles.includes(String(s.role_id))) continue;
    const a = Date.parse(String(s.start)), b = Date.parse(String(s.end));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    starts.forEach((t, i) => { if (a <= t && t < b) out[i]++; });
  }
  return out;
}

/** Pull tonight's shifts for one room into service_live.staff. Errors are stored, never thrown. */
export async function pullStaff(db: Db, orgId: string, roomId: string, day: string, tz: string, { fetchImpl = fetch, now = new Date() }: { fetchImpl?: Fetch; now?: Date } = {}) {
  const [c] = await db.select().from(staffConnections).where(eq(staffConnections.orgId, orgId));
  const loc = c?.locations.find((l) => l.roomId === roomId);
  if (!c || !loc) return { skipped: true as const };
  try {
    const from = zonedToUtc(day, LIVE.startMin - 6 * 60, tz).toISOString();
    const to = zonedToUtc(day, LIVE.startMin + LIVE.slots * LIVE.slotMin, tz).toISOString();
    const q = `location_id=${loc.locationId}&start[gte]=${encodeURIComponent(from)}&start[lte]=${encodeURIComponent(to)}&deleted=false&draft=false&limit=500`;
    const body = await get(unseal(c.tokenSealed), `/company/${c.companyId}/shifts?${q}`, fetchImpl);
    const staff = serversBySlot(arr(body), day, tz, c.serverRoles);
    await db.insert(serviceLive).values({ orgId, roomId, day, staff, staffAt: now, staffError: null })
      .onConflictDoUpdate({ target: [serviceLive.orgId, serviceLive.roomId, serviceLive.day], set: { staff, staffAt: now, staffError: null } });
    if (c.status !== 'connected') await db.update(staffConnections).set({ status: 'connected', lastError: null, checkedAt: now }).where(eq(staffConnections.orgId, orgId));
    return { ok: true as const, staff };
  } catch (e) {
    const msg = e instanceof SevenError ? e.message : 'The stored 7shifts token can’t be read. Connect 7shifts again.';
    await db.insert(serviceLive).values({ orgId, roomId, day, staffAt: now, staffError: msg })
      .onConflictDoUpdate({ target: [serviceLive.orgId, serviceLive.roomId, serviceLive.day], set: { staffAt: now, staffError: msg } });
    await db.update(staffConnections).set({ status: 'failing', lastError: msg, checkedAt: now }).where(and(eq(staffConnections.orgId, orgId)));
    return { ok: false as const, error: msg };
  }
}
