import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { HANDLED_KEY } from '../lib/data/page/portfolio.js';
import { saveAction } from '../server/actions';
import type { Db } from '../server/db/client';
import { notifications, orgs, testWindows, users } from '../server/db/schema';
import { createSampleOrg } from '../server/org';
import { portfolioFor, runPortfolio } from '../server/page/portfolio';
import { freshDb } from './helpers/db';

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});

const DAY = 864e5;
async function group(userId = 'u1', { real = false } = {}) {
  await db.insert(users).values({ id: userId, name: 'U', email: `${userId}@x.co` }).onConflictDoNothing();
  const org = await createSampleOrg(db, { ownerId: userId });
  if (real) await db.update(orgs).set({ sample: false }).where(eq(orgs.id, org.id));
  return org.id;
}
async function window(orgId: string, roomId: string, over: Partial<typeof testWindows.$inferInsert> = {}) {
  const [w] = await db.insert(testWindows).values({
    orgId, roomId, lever: 'overtime', metric: 'otMinutes', title: 'Friday close', direction: 'down', baseline: 100, centsPerUnitWeek: 50,
    startedAt: '2026-09-01', guard: { avgCheckBase: 30, turnBase: 50 }, status: 'reversed', bookedCents: 0, lowCents: 9000,
    closedAt: new Date(Date.now() - 20 * DAY), reversedAt: new Date(Date.now() - DAY), ...over,
  }).returning();
  return w!;
}

describe('All rooms: acknowledged and snoozed items on the server', () => {
  it('saves per room; a GM can mark only their own rooms', async () => {
    const orgId = await group();
    const owner = { orgId, userId: 'u1', role: 'owner' as const, rooms: null };
    await saveAction(db, owner, { roomId: 'oakland', key: HANDLED_KEY, value: { 'oakland:feed:7shifts': { s: 'ack', at: '2026-11-12T10:00:00.000Z' } } });
    const gm = { orgId, userId: 'u1', role: 'gm' as const, rooms: ['berkeley'] };
    await expect(saveAction(db, gm, { roomId: 'berkeley', key: HANDLED_KEY, value: { 'berkeley:feed:kds': { s: 'snooze', at: '2026-11-12', until: '2026-11-19' } } })).resolves.toBeTruthy();
    await expect(saveAction(db, gm, { roomId: 'oakland', key: HANDLED_KEY, value: {} })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses malformed ids, unknown states, too many items, and rooms outside the group', async () => {
    const orgId = await group();
    const owner = { orgId, userId: 'u1', role: 'owner' as const, rooms: null };
    const ok = { s: 'ack', at: '2026-11-12' };
    await expect(saveAction(db, owner, { roomId: 'oakland', key: HANDLED_KEY, value: { 'no colons here': ok } })).rejects.toThrow(/invalid portfolio.handled/);
    await expect(saveAction(db, owner, { roomId: 'oakland', key: HANDLED_KEY, value: { 'oakland:feed:a': { s: 'done', at: 'x' } } })).rejects.toThrow(/invalid portfolio.handled/);
    await expect(saveAction(db, owner, { roomId: 'oakland', key: HANDLED_KEY, value: { 'oakland:feed:a': '2026-11-12' } })).rejects.toThrow(/invalid portfolio.handled/);
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`oakland:feed:${i}`, ok]));
    await expect(saveAction(db, owner, { roomId: 'oakland', key: HANDLED_KEY, value: many })).rejects.toThrow(/at most 50/);
    await expect(saveAction(db, owner, { roomId: 'paris', key: HANDLED_KEY, value: {} })).rejects.toThrow(/no room/);
  });
});

describe('All rooms: the server view', () => {
  it('shows one group only: another group’s windows and decisions never appear', async () => {
    const a = await group('ua', { real: true });
    const b = await group('ub', { real: true });
    await window(b, 'oakland', { title: 'Other group’s test' });
    await saveAction(db, { orgId: b, userId: 'ub', role: 'owner', rooms: null }, { roomId: 'oakland', key: HANDLED_KEY, value: { 'oakland:sample:toast': { s: 'ack', at: new Date().toISOString() } } });
    const got = (await portfolioFor(db, { orgId: a, rooms: null }))!;
    expect(got.org.id).toBe(a);
    expect(got.view.open.some((x) => x.title.includes('Other group'))).toBe(false);
    expect(got.view.handled).toEqual([]);
    expect(got.view.open.filter((x) => x.kind === 'sample')).toHaveLength(3);
    const theirs = (await portfolioFor(db, { orgId: b, rooms: null }))!;
    expect(theirs.view.open.some((x) => x.kind === 'reversed')).toBe(true);
    expect(theirs.view.handled.map((x) => x.id)).toEqual(['oakland:sample:toast']);
  });

  it('a GM sees only their rooms', async () => {
    const orgId = await group('u1', { real: true });
    await window(orgId, 'oakland');
    const got = (await portfolioFor(db, { orgId, rooms: ['berkeley'] }))!;
    expect(got.view.rooms.map((r) => r.id)).toEqual(['berkeley']);
    expect(got.view.open.every((x) => x.roomId === 'berkeley')).toBe(true);
  });
});

describe('All rooms: the daily portfolio job', () => {
  const notes = (orgId: string) => db.select().from(notifications).where(eq(notifications.orgId, orgId));

  it('skips sample groups', async () => {
    const orgId = await group();
    expect(await runPortfolio(db, orgId)).toEqual({ skipped: 'sample' });
    expect(await notes(orgId)).toEqual([]);
  });

  it('tells the room once, escalates to the group only if it stays open, and sends one weekly summary', async () => {
    const orgId = await group('u1', { real: true });
    const w = await window(orgId, 'berkeley');
    const t0 = new Date();
    const first = await runPortfolio(db, orgId, t0);
    expect(first).toMatchObject({ urgent: 1, routed: 1, escalated: 0, summary: 1 });
    const again = await runPortfolio(db, orgId, new Date(t0.getTime() + 36e5));
    expect(again).toMatchObject({ routed: 0, escalated: 0, summary: 0 });
    const later = await runPortfolio(db, orgId, new Date(t0.getTime() + 2.5 * DAY));
    expect(later.escalated).toBe(1);
    const all = await notes(orgId);
    expect(all.find((n) => n.kind === 'portfolio.issue')).toMatchObject({ roomId: 'berkeley', dedupe: `portfolio:item:berkeley:reversed:${w.id}` });
    expect(all.find((n) => n.kind === 'portfolio.escalation')).toMatchObject({ roomId: null });
    expect(all.filter((n) => n.kind === 'portfolio.weekly').length).toBeGreaterThanOrEqual(1);
  });

  it('an acknowledged issue is not escalated', async () => {
    const orgId = await group('u1', { real: true });
    const w = await window(orgId, 'walnut');
    const t0 = new Date();
    await runPortfolio(db, orgId, t0);
    await saveAction(db, { orgId, userId: 'u1', role: 'owner', rooms: null }, { roomId: 'walnut', key: HANDLED_KEY, value: { [`walnut:reversed:${w.id}`]: { s: 'ack', at: t0.toISOString() } } });
    const later = await runPortfolio(db, orgId, new Date(t0.getTime() + 3 * DAY));
    expect(later).toMatchObject({ urgent: 0, escalated: 0 });
    expect(await db.select().from(notifications).where(and(eq(notifications.orgId, orgId), eq(notifications.kind, 'portfolio.escalation')))).toEqual([]);
  });
});
