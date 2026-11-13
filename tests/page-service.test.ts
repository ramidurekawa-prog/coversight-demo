import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readToastExports } from '../lib/data/toast.js';
import { mapToastDay } from '../lib/data/toast-api.js';
import { saveAction } from '../server/actions';
import type { Db } from '../server/db/client';
import { notifications, posDays, tasks, users } from '../server/db/schema';
import { commitInput, createSampleOrg } from '../server/org';
import { approveCut, clearServiceCache, liveService } from '../server/page/service';
import { connectToast } from '../server/toast-conn';
import { fakeToastApi, GUID, ordersFor, timeFor } from './helpers/fake-toast';
import { freshDb } from './helpers/db';
import { toastFixture } from './helpers/toast-fixture.js';

let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
const gm = () => ({ orgId, userId: 'u1', role: 'gm' as const, rooms: ['berkeley'] });
// Thursday Oct 29, 7:10 pm Pacific.
const NOW = new Date('2026-10-30T02:10:00Z');
const FENCES = (minDinner: number, cutBy = '9:00 pm') => ({ version: 2, f: { minDinner, minAny: 2, cutBy, lockHours: 24, maxPrice: 8, priceGap: 6, maxPar: 15 }, al: { push: true, sms: true, email: false, onePerService: true, quiet: true } });

beforeEach(async () => {
  db = await freshDb();
  clearServiceCache();
  process.env.CREDENTIALS_KEY = 'k'.repeat(40);
  await db.insert(users).values({ id: 'u1', name: 'O', email: 'o@example.com' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  // The room's own Toast data (13 weeks, five servers on dinner), so the plan and the pace are its own.
  const { unknown, ...s } = readToastExports(Object.entries(toastFixture({ dinnerServers: 5, end: Date.UTC(2026, 9, 28) })).map(([name, text]) => ({ name, text })));
  void unknown;
  await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'toast', rows: [JSON.parse(JSON.stringify(s))] });
});
afterEach(() => { delete process.env.CREDENTIALS_KEY; });

const refs = { employees: [{ guid: 'e1', firstName: 'Ana', lastName: 'Ruiz' }, { guid: 'e2', firstName: 'Ben', lastName: 'Cho' }, { guid: 'e3', firstName: 'Cam', lastName: 'Diaz' }, { guid: 'e4', firstName: 'Dee', lastName: 'Park' }, { guid: 'e5', firstName: 'Eli', lastName: 'Moss' }],
  jobs: [{ guid: 'j1', title: 'Server' }, { guid: 'j2', title: 'Line Cook' }, { guid: 'j3', title: 'Bartender' }] };
async function syncedThursdays(days = ['2026-10-22', '2026-10-15', '2026-10-08']) {
  for (const day of days) {
    const m = mapToastDay({ orders: ordersFor(day) as never[], timeEntries: timeFor(day) as never[], refs: refs as never, tz: 'America/Los_Angeles' });
    await db.insert(posDays).values({ orgId, roomId: 'oakland', day, items: m.items, orders: m.orders, time: m.time, payments: m.payments });
  }
}

describe('Service: tonight live', () => {
  it('without Toast connected, says so and gives tonight’s date in the room’s zone', async () => {
    const r = await liveService(db, owner(), 'oakland', { now: NOW });
    expect(r).toMatchObject({ live: false, why: 'not-connected', date: '2026-10-29', day: 'Thu', nowMin: 19 * 60 + 10 });
  });

  it('keeps a GM to their own rooms and refuses rooms that aren’t in the group', async () => {
    await expect(liveService(db, gm(), 'oakland', { now: NOW })).rejects.toThrow(/not one of yours/);
    await expect(liveService(db, owner(), 'nowhere', { now: NOW })).rejects.toThrow(/no room/);
    await expect(liveService(db, owner(), undefined, { now: NOW })).rejects.toThrow(/roomId/);
  });

  it('paces tonight from Toast against the same weekday the sync kept, and reuses the pull for two minutes', async () => {
    const api = fakeToastApi();
    await connectToast(db, owner(), { host: 'ws-api.toasttab.com', clientId: 'client-abcdef', secret: 'super-secret-value', restaurants: [{ guid: GUID, roomId: 'oakland' }] }, api.f);
    const none = await liveService(db, owner(), 'oakland', { now: NOW, fetchImpl: api.f });
    expect(none).toMatchObject({ live: false, why: 'no-history' });
    clearServiceCache();
    await syncedThursdays();
    const r = await liveService(db, owner(), 'oakland', { now: NOW, fetchImpl: api.f });
    if (!r.live) throw new Error(`not live: ${r.why}`);
    expect(r.night.weeks).toBe(3);
    expect(r.night.win.start).toBe(17 * 60);
    expect(r.night.actual).toHaveLength(8); // 5:00–7:00 complete
    expect(r.night.call.serversNow).toBe(3); // three servers clocked in at 4 pm, not the cook or the bartender
    expect(r.night.call.rate).toBeGreaterThan(0);
    expect(['cut', 'wait', 'quiet']).toContain(r.night.call.mode);
    const calls = api.calls.length;
    await liveService(db, owner(), 'oakland', { now: new Date(NOW.getTime() + 60_000), fetchImpl: api.f });
    expect(api.calls.length).toBe(calls);
    // The client secret never reaches the page.
    expect(JSON.stringify(r)).not.toContain('super-secret-value');
  });

  it('turns a Toast failure into a message and falls back to the plan', async () => {
    const api = fakeToastApi();
    await connectToast(db, owner(), { host: 'ws-api.toasttab.com', clientId: 'client-abcdef', secret: 'super-secret-value', restaurants: [{ guid: GUID, roomId: 'oakland' }] }, api.f);
    await syncedThursdays();
    const r = await liveService(db, owner(), 'oakland', { now: NOW, fetchImpl: fakeToastApi({ auth: 401 }).f });
    expect(r).toMatchObject({ live: false, why: 'error' });
    expect((r as { message: string }).message).toMatch(/Toast/);
  });
});

describe('Service: approving tonight’s cut', () => {
  const fences = (n: number, cutBy?: string) => saveAction(db, owner(), { roomId: 'oakland', key: 'fences', value: FENCES(n, cutBy) });

  it('checks the cut on the server, then puts the 7shifts steps on Today', async () => {
    await fences(3);
    const live = await liveService(db, owner(), 'oakland', { now: NOW });
    expect(live.live).toBe(false);
    const { servicePlan } = await import('../lib/data/page/service.js');
    const { loadDataset } = await import('../server/dataset');
    const plan = servicePlan((await loadDataset(db, orgId))!.ds.rooms.oakland, 'Thu', FENCES(3));
    expect(plan?.cutFrom).not.toBeNull();
    const at = `${String(plan!.cutFrom).padStart(2, '0')}:00`;

    await expect(approveCut(db, owner(), { roomId: 'oakland', date: '2026-10-28', at }, { now: NOW })).rejects.toThrow(/only be approved for tonight/);
    await expect(approveCut(db, owner(), { roomId: 'oakland', date: '2026-10-29', at: '23:45' }, { now: NOW })).rejects.toThrow(/moved since/);
    await expect(approveCut(db, owner(), { roomId: 'oakland', date: 'tonight', at }, { now: NOW })).rejects.toThrow(/invalid cut/);
    await expect(approveCut(db, gm(), { roomId: 'oakland', date: '2026-10-29', at }, { now: NOW })).rejects.toThrow(/not one of yours/);

    const { task, approval } = await approveCut(db, owner(), { roomId: 'oakland', date: '2026-10-29', at }, { now: NOW });
    expect(task).toMatchObject({ roomId: 'oakland', approvalId: `cut:2026-10-29:${at}`, system: '7shifts', status: 'open' });
    expect(approval.diff[0]![2]).toMatch(/servers$/);
    expect(task.steps.length).toBeGreaterThan(1);
    // Approving again returns the same task; a second, different cut tonight is refused.
    const again = await approveCut(db, owner(), { roomId: 'oakland', date: '2026-10-29', at }, { now: NOW });
    expect(again.task.id).toBe(task.id);
    await db.insert(tasks).values({ orgId, roomId: 'oakland', approvalId: 'cut:2026-10-29:21:00', title: 'x', system: '7shifts', steps: [], expect: { type: 'manual' } });
    await db.delete(tasks).where(eq(tasks.approvalId, `cut:2026-10-29:${at}`));
    await expect(approveCut(db, owner(), { roomId: 'oakland', date: '2026-10-29', at }, { now: NOW })).rejects.toThrow(/One change per service/);
  });

  it('refuses a cut the fences don’t allow, whatever the page sent', async () => {
    await fences(5);
    await expect(approveCut(db, owner(), { roomId: 'oakland', date: '2026-10-29', at: '20:00' }, { now: NOW })).rejects.toThrow(/fence|used its servers/);
    expect(await db.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.roomId, 'oakland')))).toHaveLength(0);
  });

  it('keeps tonight’s answer per night, validated like every decision', async () => {
    const ok = await saveAction(db, owner(), { roomId: 'oakland', key: 'service.night', value: { date: '2026-10-29', answer: 'no', at: '20:00' } });
    expect(ok.value).toMatchObject({ answer: 'no' });
    await expect(saveAction(db, owner(), { roomId: 'oakland', key: 'service.night', value: { date: 'Thu', answer: 'no', at: null } })).rejects.toThrow(/invalid service.night/);
    await expect(saveAction(db, owner(), { roomId: 'oakland', key: 'service.night', value: { date: '2026-10-29', answer: 'maybe', at: null } })).rejects.toThrow(/invalid/);
  });

  it('tells the room once per service when the live call turns into a cut, and approves that cut', async () => {
    const api = fakeToastApi();
    // Tonight: eight servers clocked in at 4 pm.
    let eight: Record<string, unknown>[] = Array.from({ length: 8 }, (_, i) => ({ guid: `te${i}`, employeeReference: { guid: `s${i}` }, jobReference: { guid: 'j1' }, inDate: '2026-10-29T23:00:00.000Z', regularHours: 0, hourlyWage: 18 }));
    const f = (async (url: string, init?: RequestInit) => (String(url).includes('/labor/v1/timeEntries') && String(url).includes('20261029')
      ? new Response(JSON.stringify(eight), { headers: { 'content-type': 'application/json' } })
      : api.f(url, init))) as unknown as typeof fetch;
    await connectToast(db, owner(), { host: 'ws-api.toasttab.com', clientId: 'client-abcdef', secret: 'super-secret-value', restaurants: [{ guid: GUID, roomId: 'oakland' }] }, f);
    await fences(2, '9:00 pm');
    // Busy comparable Thursdays (Saturday-sized), a quiet tonight: one fewer is safe even at the band's top.
    for (const day of ['2026-10-22', '2026-10-15', '2026-10-08']) {
      const shift = Date.parse(`${day}T12:00:00Z`) - Date.parse('2026-10-24T12:00:00Z');
      const orders = ordersFor('2026-10-24').map((o) => ({ ...o, openedDate: new Date(Date.parse(o.openedDate) + shift).toISOString() }));
      const m = mapToastDay({ orders: orders as never[], timeEntries: [], refs: refs as never, tz: 'America/Los_Angeles' });
      await db.insert(posDays).values({ orgId, roomId: 'oakland', day, items: [], orders: m.orders, time: [], payments: [] });
    }
    const r = await liveService(db, owner(), 'oakland', { now: NOW, fetchImpl: f });
    if (!r.live) throw new Error(`not live: ${r.why}`);
    expect(r.night.call).toMatchObject({ mode: 'cut', serversNow: 8, at: 19 * 60 + 15 });
    expect(r.night.call.pace).toBeLessThan(0);
    clearServiceCache();
    await liveService(db, owner(), 'oakland', { now: NOW, fetchImpl: f });
    const n = await db.select().from(notifications).where(and(eq(notifications.orgId, orgId), eq(notifications.kind, 'service.cut')));
    expect(n).toHaveLength(1);
    expect(n[0]!.link).toBe('/service');
    // Earlier than the call, or off the quarter hour, is refused; the call's own time goes through.
    await expect(approveCut(db, owner(), { roomId: 'oakland', date: '2026-10-29', at: '19:00' }, { now: NOW, fetchImpl: f })).rejects.toThrow(/moved since/);
    await expect(approveCut(db, owner(), { roomId: 'oakland', date: '2026-10-29', at: '19:20' }, { now: NOW, fetchImpl: f })).rejects.toThrow(/moved since/);
    const { task, approval } = await approveCut(db, owner(), { roomId: 'oakland', date: '2026-10-29', at: '19:15' }, { now: NOW, fetchImpl: f });
    expect(task.approvalId).toBe('cut:2026-10-29:19:15');
    expect(approval.diff[0]).toEqual(['Thu 7:15 pm to close', '8 servers', '7 servers']);
    expect(await db.select().from(tasks).where(eq(tasks.orgId, orgId))).toHaveLength(1);

    // Approval is not execution: until Toast shows a server clocked out, it's awaiting.
    const later = new Date(NOW.getTime() + 30 * 6e4); // 7:40 pm
    const before = await liveService(db, owner(), 'oakland', { now: later, fetchImpl: f, fresh: true });
    if (!before.live) throw new Error('not live');
    expect(before.night.execution?.state).toBe('not-seen');
    // A server clocks out at 7:15 pm in Toast: the release is confirmed from the source, once.
    eight = eight.map((e, i) => (i === 0 ? { ...e, outDate: '2026-10-30T02:15:00.000Z' } : e));
    const after = await liveService(db, owner(), 'oakland', { now: later, fetchImpl: f, fresh: true });
    if (!after.live) throw new Error('not live');
    expect(after.night.execution).toMatchObject({ state: 'confirmed', on: 7 });
    await liveService(db, owner(), 'oakland', { now: later, fetchImpl: f, fresh: true });
    const confirmed = await db.select().from(notifications).where(and(eq(notifications.orgId, orgId), eq(notifications.dedupe, 'service-cut-confirmed:oakland:2026-10-29')));
    expect(confirmed).toHaveLength(1);
  });
});
