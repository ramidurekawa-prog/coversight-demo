import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../server/db/client';
import { toastConnections, users } from '../server/db/schema';
import { createSampleOrg } from '../server/org';
import { exportOrg } from '../server/team';
import { checkToast, connectToast, disconnectToast, recheckToast, seal, toastStatus, unseal } from '../server/toast-conn';
import { freshDb } from './helpers/db';

const GUID = '6b2f5e3a-1c4d-4e8f-9a0b-2c3d4e5f6a7b';
const creds = { host: 'ws-api.toasttab.com', clientId: 'client-abcdef', secret: 'super-secret-value', restaurants: [{ guid: GUID, roomId: 'oakland' }] };
const fakeToast = ({ auth = 200, rest = 200 } = {}) => {
  const calls: string[] = [];
  const f = (async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    calls.push(url);
    if (url.endsWith('/authentication/login')) return new Response(JSON.stringify(auth === 200 ? { token: { accessToken: 'tok' } } : {}), { status: auth });
    return new Response(JSON.stringify({ general: { locationName: 'Fixture Bistro' } }), { status: rest });
  }) as unknown as typeof fetch;
  return { f, calls };
};

let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
beforeEach(async () => {
  db = await freshDb();
  process.env.CREDENTIALS_KEY = 'k'.repeat(40);
  await db.insert(users).values({ id: 'u1', name: 'O', email: 'o@example.com' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
afterEach(() => { delete process.env.CREDENTIALS_KEY; });

describe('Toast credentials', () => {
  it('seals and unseals; a sealed value never contains the secret', () => {
    const s = seal('super-secret-value');
    expect(s).not.toContain('super-secret');
    expect(unseal(s)).toBe('super-secret-value');
    expect(seal('x')).not.toBe(seal('x'));
  });

  it('checks against Toast: auth, then each restaurant; maps errors to plain words', async () => {
    const ok = fakeToast();
    const res = await checkToast(creds, ok.f);
    expect(res.ok).toBe(true);
    expect(ok.calls).toEqual(['https://ws-api.toasttab.com/authentication/v1/authentication/login', `https://ws-api.toasttab.com/restaurants/v1/restaurants/${GUID}`]);
    expect((await checkToast(creds, fakeToast({ auth: 401 }).f)).error).toMatch(/rejected the client ID or secret/);
    const r = await checkToast(creds, fakeToast({ rest: 403 }).f);
    expect(r.ok).toBe(false);
    expect(r.restaurants![0]!.error).toMatch(/Can’t access this restaurant/);
    await expect(checkToast({ ...creds, host: 'evil.example.com' }, ok.f)).rejects.toThrow(/ends in toasttab.com/);
    await expect(checkToast({ ...creds, restaurants: [{ guid: 'nope', roomId: 'oakland' }] }, ok.f)).rejects.toThrow(/GUID/);
  });

  it('stores only after a passing check, sealed; status and export never show the secret', async () => {
    expect((await connectToast(db, owner(), creds, fakeToast({ auth: 401 }).f)).connected).toBe(false);
    expect(await toastStatus(db, orgId)).toBeNull();
    const res = await connectToast(db, owner(), creds, fakeToast().f);
    expect(res.connected).toBe(true);
    const st = await toastStatus(db, orgId);
    expect(st).toMatchObject({ host: 'ws-api.toasttab.com', clientId: 'clie…ef', status: 'connected', restaurants: [{ guid: GUID, roomId: 'oakland', name: 'Fixture Bistro' }] });
    expect(JSON.stringify(st)).not.toContain('super-secret');
    const [row] = await db.select().from(toastConnections).where(eq(toastConnections.orgId, orgId));
    expect(row!.secretSealed).not.toContain('super-secret');
    expect(JSON.stringify(await exportOrg(db, owner()))).not.toMatch(/super-secret|secretSealed|client-abcdef/);
  });

  it('re-check marks a revoked secret failing; only an owner connects or disconnects', async () => {
    await connectToast(db, owner(), creds, fakeToast().f);
    expect((await recheckToast(db, owner(), fakeToast({ auth: 401 }).f))!.status).toBe('failing');
    await expect(connectToast(db, { ...owner(), role: 'admin' }, creds, fakeToast().f)).rejects.toThrow(/Only an owner/);
    await expect(disconnectToast(db, { ...owner(), role: 'admin' })).rejects.toThrow(/Only an owner/);
    await disconnectToast(db, owner());
    expect(await toastStatus(db, orgId)).toBeNull();
  });

  it('refuses to store anything without CREDENTIALS_KEY', async () => {
    delete process.env.CREDENTIALS_KEY;
    const t = fakeToast();
    await expect(connectToast(db, owner(), creds, t.f)).rejects.toThrow(/CREDENTIALS_KEY/);
    expect(t.calls).toEqual([]);
  });
});
