import { beforeEach, describe, expect, it } from 'vitest';

import { HANDLED_KEY } from '../lib/data/page/portfolio.js';
import { loadActions, saveAction } from '../server/actions';
import type { Db } from '../server/db/client';
import { createSampleOrg } from '../server/org';
import { freshDb } from './helpers/db';

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});

async function org() {
  const { users } = await import('../server/db/schema');
  await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
  return (await createSampleOrg(db, { ownerId: 'u1' })).id;
}

describe('All rooms: handled items on the server', () => {
  it('saves per room, and only the viewer’s own rooms come back', async () => {
    const orgId = await org();
    const owner = { orgId, userId: 'u1', role: 'owner' as const, rooms: null };
    await saveAction(db, owner, { roomId: 'oakland', key: HANDLED_KEY, value: { 'oakland:feed:7shifts-18-hours-ago': '2026-11-12T10:00:00.000Z' }, summary: 'Oakland: 7shifts marked handled' });
    await saveAction(db, owner, { roomId: 'walnut', key: HANDLED_KEY, value: { 'walnut:alarm:bar-comps': '2026-11-12T10:00:00.000Z' } });
    const all = await loadActions(db, orgId);
    expect(all.oakland?.[HANDLED_KEY]).toEqual({ 'oakland:feed:7shifts-18-hours-ago': '2026-11-12T10:00:00.000Z' });
    const gm = await loadActions(db, orgId, ['walnut']);
    expect(Object.keys(gm).filter((k) => k)).toEqual(['walnut']);
  });

  it('a GM can mark items in their rooms, and only theirs', async () => {
    const orgId = await org();
    const gm = { orgId, userId: 'u1', role: 'gm' as const, rooms: ['berkeley'] };
    await expect(saveAction(db, gm, { roomId: 'berkeley', key: HANDLED_KEY, value: { 'berkeley:feed:kds': '2026-11-12' } })).resolves.toBeTruthy();
    await expect(saveAction(db, gm, { roomId: 'oakland', key: HANDLED_KEY, value: { 'oakland:feed:kds': '2026-11-12' } })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses malformed ids, too many items, and rooms outside the group', async () => {
    const orgId = await org();
    const owner = { orgId, userId: 'u1', role: 'owner' as const, rooms: null };
    await expect(saveAction(db, owner, { roomId: 'oakland', key: HANDLED_KEY, value: { 'no colons here': 'x' } })).rejects.toThrow(/invalid portfolio.handled/);
    await expect(saveAction(db, owner, { roomId: 'oakland', key: HANDLED_KEY, value: ['oakland:feed:a'] })).rejects.toThrow(/invalid portfolio.handled/);
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`oakland:feed:${i}`, '2026-11-12']));
    await expect(saveAction(db, owner, { roomId: 'oakland', key: HANDLED_KEY, value: many })).rejects.toThrow(/at most 50/);
    await expect(saveAction(db, owner, { roomId: 'paris', key: HANDLED_KEY, value: {} })).rejects.toThrow(/no room/);
  });
});
