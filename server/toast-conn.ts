// Toast Standard API credentials: check them against Toast for real, store
// them sealed, show their status. The secret is encrypted with CREDENTIALS_KEY
// and never leaves the server. The automatic sync that would use them is not
// switched on yet; until then a group uploads its Toast data exports.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from './db/client';
import { auditLog, rooms, toastConnections } from './db/schema';
import { InputError } from './org';
import { AuthError, type Viewer } from './session';

const keyBytes = () => {
  const k = process.env.CREDENTIALS_KEY;
  if (!k || k.length < 32) throw new InputError('CREDENTIALS_KEY isn’t set on the server (32+ characters), so credentials can’t be stored safely.');
  return createHash('sha256').update(k).digest();
};

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}
export function unseal(sealed: string) {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('bad sealed value');
  const d = createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const input = z.object({
  host: z.string().trim().toLowerCase().max(100).refine((h) => /^[a-z0-9.-]+\.toasttab\.com$/.test(h), 'Use the API hostname from the Toast credentials page (it ends in toasttab.com).'),
  clientId: z.string().trim().min(4).max(200),
  secret: z.string().min(8).max(500),
  restaurants: z.array(z.object({ guid: z.string().trim().regex(GUID, 'That isn’t a restaurant GUID.'), roomId: z.string().min(1).max(60) })).min(1).max(20),
});

export const TOAST_MSG = {
  secret: 'Toast rejected the client ID or secret. Re-copy the secret (Toast shows it once) or create new credentials.',
  host: 'Couldn’t reach that API host. Use the hostname shown on the Toast credentials page.',
  guid: 'Can’t access this restaurant: these credentials don’t cover it, or the restaurants scope is missing.',
};

/** Ask Toast: do these credentials authenticate, and can they read each restaurant? */
export async function checkToast(raw: unknown, fetchImpl: typeof fetch = fetch) {
  const p = input.safeParse(raw);
  if (!p.success) throw new InputError(p.error.issues[0]?.message ?? 'invalid credentials');
  const { host, clientId, secret, restaurants: list } = p.data;
  let token: string | undefined;
  try {
    const res = await fetchImpl(`https://${host}/authentication/v1/authentication/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret: secret, userAccessType: 'TOAST_MACHINE_CLIENT' }) });
    if (res.status === 401 || res.status === 403 || res.status === 400) return { ok: false as const, error: TOAST_MSG.secret, data: p.data };
    if (!res.ok) return { ok: false as const, error: `Toast answered ${res.status}. Try again in a minute.`, data: p.data };
    token = ((await res.json()) as { token?: { accessToken?: string } }).token?.accessToken;
    if (!token) return { ok: false as const, error: TOAST_MSG.secret, data: p.data };
  } catch {
    return { ok: false as const, error: TOAST_MSG.host, data: p.data };
  }
  const checked: { guid: string; roomId: string; ok: boolean; name?: string; error?: string }[] = [];
  for (const r of list) {
    try {
      const res = await fetchImpl(`https://${host}/restaurants/v1/restaurants/${r.guid}`, { headers: { authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': r.guid } });
      const b = (await res.json().catch(() => ({}))) as { general?: { name?: string; locationName?: string } };
      checked.push(res.ok ? { ...r, ok: true, name: b.general?.locationName || b.general?.name || r.guid } : { ...r, ok: false, error: TOAST_MSG.guid });
    } catch {
      checked.push({ ...r, ok: false, error: TOAST_MSG.host });
    }
  }
  return { ok: checked.every((c) => c.ok), restaurants: checked, data: p.data };
}

export async function connectToast(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'role'>, raw: unknown, fetchImpl: typeof fetch = fetch) {
  if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can connect Toast.');
  keyBytes(); // refuse before calling Toast if we can't store the result
  const res = await checkToast(raw, fetchImpl);
  if (!res.ok || !('restaurants' in res)) return { connected: false, check: res };
  const have = (await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.orgId, v.orgId))).map((r) => r.id);
  const bad = res.restaurants!.find((r) => !have.includes(r.roomId) || r.roomId === 'all');
  if (bad) throw new InputError(`no room '${bad.roomId}' in this group`);
  const row = {
    orgId: v.orgId, host: res.data.host, clientId: res.data.clientId, secretSealed: seal(res.data.secret),
    restaurants: res.restaurants!.map(({ guid, roomId, name }) => ({ guid, roomId, name: name ?? guid })), status: 'connected', lastError: null, checkedAt: new Date(), createdBy: v.userId,
  };
  await db.insert(toastConnections).values(row).onConflictDoUpdate({ target: toastConnections.orgId, set: { ...row } });
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'toast.connected', detail: { host: row.host, restaurants: row.restaurants.length } });
  return { connected: true, status: await toastStatus(db, v.orgId) };
}

/** What anyone in the group may see: never the secret, the client id masked. */
export async function toastStatus(db: Db, orgId: string) {
  const [c] = await db.select().from(toastConnections).where(eq(toastConnections.orgId, orgId));
  if (!c) return null;
  return { host: c.host, clientId: `${c.clientId.slice(0, 4)}…${c.clientId.slice(-2)}`, restaurants: c.restaurants, status: c.status, lastError: c.lastError, checkedAt: c.checkedAt };
}

/** Re-check stored credentials against Toast (owner/admin). */
export async function recheckToast(db: Db, v: Pick<Viewer, 'orgId' | 'role'>, fetchImpl: typeof fetch = fetch) {
  if (v.role === 'gm') throw new AuthError(403, 'Only an owner or admin can re-check the connection.');
  const [c] = await db.select().from(toastConnections).where(eq(toastConnections.orgId, v.orgId));
  if (!c) throw new InputError('Toast isn’t connected.');
  const res = await checkToast({ host: c.host, clientId: c.clientId, secret: unseal(c.secretSealed), restaurants: c.restaurants.map(({ guid, roomId }) => ({ guid, roomId })) }, fetchImpl);
  await db.update(toastConnections).set({ status: res.ok ? 'connected' : 'failing', lastError: res.ok ? null : ('error' in res ? res.error : 'A restaurant can’t be read.'), checkedAt: new Date() }).where(eq(toastConnections.orgId, v.orgId));
  return toastStatus(db, v.orgId);
}

export async function disconnectToast(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'role'>) {
  if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can disconnect Toast.');
  await db.delete(toastConnections).where(eq(toastConnections.orgId, v.orgId));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'toast.disconnected', detail: {} });
}
