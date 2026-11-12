import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localStamp, mapToastDay } from '../lib/data/toast-api.js';
import { summarizeToast } from '../lib/data/toast.js';
import { loadDataset } from '../server/dataset';
import type { Db } from '../server/db/client';
import { inputs, jobRuns, notifications, posDays, toastConnections, users } from '../server/db/schema';
import { runJob } from '../server/jobs';
import { createSampleOrg } from '../server/org';
import { planDays, SYNC, syncToast } from '../server/pos-sync';
import { connectToast, toastStatus } from '../server/toast-conn';
import { fakeToastApi, GUID, ordersFor, timeFor } from './helpers/fake-toast';
import { freshDb } from './helpers/db';

const creds = { host: 'ws-api.toasttab.com', clientId: 'client-abcdef', secret: 'super-secret-value', restaurants: [{ guid: GUID, roomId: 'oakland' }] };
const NOW = new Date('2026-10-26T18:00:00Z'); // Mon Oct 26, 11am Pacific
const noSleep = async () => {};

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

describe('Toast API → export rows', () => {
  it('shifts UTC into the restaurant’s wall clock', () => {
    expect(localStamp('2026-10-24T01:43:12.000+0000', 'America/Los_Angeles')).toBe('2026-10-23 18:43:12');
    expect(localStamp('2026-10-24T01:43:12.000Z', 'America/New_York')).toBe('2026-10-23 21:43:12');
  });

  it('maps a day the way the export would show it, and the export reader reads it', () => {
    const refs = { employees: [{ guid: 'e1', firstName: 'Ana', lastName: 'Ruiz' }, { guid: 'e2', firstName: 'Ben', lastName: 'Cho' }, { guid: 'e3', firstName: 'Cam', lastName: 'Diaz' }, { guid: 'e4', firstName: 'Dee', lastName: 'Park' }, { guid: 'e5', firstName: 'Eli', lastName: 'Moss' }],
      jobs: [{ guid: 'j1', title: 'Server' }, { guid: 'j2', title: 'Line Cook' }, { guid: 'j3', title: 'Bartender' }],
      diningOptions: [{ guid: 'd1', name: 'Dine In' }, { guid: 'd2', name: 'Take Out' }, { guid: 'd3', name: 'DoorDash Delivery' }], salesCategories: [{ guid: 'c1', name: 'Food' }, { guid: 'c2', name: 'Liquor' }] };
    const m = mapToastDay({ orders: ordersFor('2026-10-24'), timeEntries: timeFor('2026-10-24'), refs, tz: 'America/Los_Angeles' });
    expect(m.orders).toHaveLength(130);
    expect(m.orders[0]).toMatchObject({ Opened: '2026-10-24 17:00:00', Server: 'Ana Ruiz', 'Dining Options': 'DoorDash Delivery', '# of Guests': '1' });
    const voided = m.items.filter((r) => r['Void?'] === 'true');
    expect(voided.length).toBeGreaterThan(0);
    expect(voided.every((r) => r['Sent Date'])).toBe(true); // voided after it went to the kitchen
    expect(m.time.find((t) => t['Job Title'] === 'Line Cook')).toMatchObject({ 'Overtime Hours': '1', 'Total Pay': (21 * 7 + 21 * 1.5).toFixed(2) });
    const s: any = summarizeToast([{ kind: 'items', rows: m.items }, { kind: 'orders', rows: m.orders }, { kind: 'time', rows: m.time }, { kind: 'payments', rows: m.payments }]);
    expect(s.ok).toBe(true);
    expect(s.rows.recipes.map((r: { dish: string }) => r.dish)).toContain('Salmon');
    expect(s.rows.channels.map((c: { channel: string }) => c.channel).sort()).toEqual(['Dine-in', 'DoorDash', 'Takeout']);
  });
});

describe('the live sync', () => {
  it('plans today and the refresh window first, then the newest missing days', () => {
    const p = planDays('2026-10-26', new Set(), 10);
    expect(p.days.slice(0, 4)).toEqual(['2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23']);
    expect(p.days).toHaveLength(10);
    expect(p.missingAfter).toBe(SYNC.backfillDays - 3 - 7);
    const all = new Set(Array.from({ length: 91 }, (_, i) => new Date(Date.parse('2026-10-26T12:00:00Z') - i * 864e5).toISOString().slice(0, 10)));
    expect(planDays('2026-10-26', all).days).toEqual(['2026-10-26', '2026-10-25', '2026-10-24']);
  });

  it('backfills 13 weeks over a few runs, then keeps one live input per room that every figure reads', async () => {
    const api = fakeToastApi();
    await connectToast(db, owner(), creds, api.f);
    expect((await toastStatus(db, orgId))!.sync.state).toBe('off');

    const r1 = await syncToast(db, orgId, { fetchImpl: api.f, now: NOW, sleep: noSleep });
    expect(r1).toMatchObject({ ok: true, state: 'backfilling' });
    expect(await db.select().from(posDays).where(eq(posDays.orgId, orgId))).toHaveLength(SYNC.maxDaysPerRun);
    // Saturday needs two pages of orders; employees come in two token pages.
    expect(api.calls.some((u) => u.includes('businessDate=20261024') && u.includes('page=2'))).toBe(true);
    expect(api.calls.some((u) => u.includes('pageToken=p2'))).toBe(true);

    await syncToast(db, orgId, { fetchImpl: api.f, now: NOW, sleep: noSleep });
    const r3 = await syncToast(db, orgId, { fetchImpl: api.f, now: NOW, sleep: noSleep });
    expect(r3).toMatchObject({ ok: true, state: 'live' });
    expect(await db.select().from(posDays).where(eq(posDays.orgId, orgId))).toHaveLength(SYNC.backfillDays);

    const st = await toastStatus(db, orgId);
    expect(st!.sync).toMatchObject({ state: 'live', rooms: { oakland: { days: 91, missing: 0, newest: '2026-10-26' } } });
    expect(JSON.stringify(st)).not.toMatch(/super-secret|tok-123/);

    // One sync input for the room, updated in place.
    const rows = await db.select().from(inputs).where(and(eq(inputs.orgId, orgId), eq(inputs.roomId, 'oakland'), eq(inputs.kind, 'toast')));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toMatch(/^Toast sync · 91 days to 2026-10-26/);
    expect(rows[0]!.userId).toBeNull();

    // The dataset now reads Oakland from its own Toast data.
    const loaded = await loadDataset(db, orgId);
    expect(loaded!.ds.rooms.oakland.fromToast).toBeTruthy();
    expect(loaded!.ds.rooms.oakland.fromToast.weeks).toBe(13);

    const notes = await db.select().from(notifications).where(eq(notifications.orgId, orgId));
    expect(notes.map((n) => n.title)).toEqual(expect.arrayContaining(['Toast sync started', 'Toast history is in']));

    // A steady-state run pulls only today plus the refresh window.
    const before = api.calls.length;
    await syncToast(db, orgId, { fetchImpl: api.f, now: NOW, sleep: noSleep });
    const orderCalls = api.calls.slice(before).filter((u) => u.includes('ordersBulk')).map((u) => new URL(u).searchParams.get('businessDate'));
    expect([...new Set(orderCalls)]).toEqual(['20261026', '20261025', '20261024']);
  }, 90_000);

  it('waits out a 429 and carries on', async () => {
    const api = fakeToastApi({ throttleOnce: true });
    await connectToast(db, owner(), creds, api.f);
    const waits: number[] = [];
    const r = await syncToast(db, orgId, { fetchImpl: api.f, now: NOW, sleep: async (ms) => { waits.push(ms); }, maxDays: 3 });
    expect(r).toMatchObject({ ok: true });
    expect(waits).toEqual([1000]);
  });

  it('a revoked secret marks the connection failing, tells the owner once, and keeps the last data', async () => {
    const ok = fakeToastApi();
    await connectToast(db, owner(), creds, ok.f);
    await syncToast(db, orgId, { fetchImpl: ok.f, now: NOW, sleep: noSleep, maxDays: 5 });
    const bad = fakeToastApi({ auth: 401 });
    const r = await syncToast(db, orgId, { fetchImpl: bad.f, now: NOW, sleep: noSleep });
    expect(r).toMatchObject({ ok: false });
    await syncToast(db, orgId, { fetchImpl: bad.f, now: NOW, sleep: noSleep });
    const [c] = await db.select().from(toastConnections).where(eq(toastConnections.orgId, orgId));
    expect(c!.syncState).toBe('failing');
    expect(c!.lastError).toMatch(/rejected the client ID or secret/);
    expect(c!.lastError).not.toMatch(/super-secret|tok-/);
    const stopped = (await db.select().from(notifications).where(eq(notifications.orgId, orgId))).filter((n) => n.title === 'Toast sync stopped');
    expect(stopped).toHaveLength(1);
    expect(await db.select().from(posDays).where(eq(posDays.orgId, orgId))).toHaveLength(5);
  });

  it('a restaurant the credentials no longer cover fails in plain words', async () => {
    const ok = fakeToastApi();
    await connectToast(db, owner(), creds, ok.f);
    const r = await syncToast(db, orgId, { fetchImpl: fakeToastApi({ failOrders: 403 }).f, now: NOW, sleep: noSleep, maxDays: 3 });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/Can’t access this restaurant/);
  });

  it('the hourly job runs only for connected groups, and records a refusal as a failed run', async () => {
    const other = (await createSampleOrg(db, { ownerId: 'u1' })).id;
    const res = await runJob(db, 'sync', { now: NOW });
    expect(res).toEqual([]); // nobody connected yet
    await connectToast(db, owner(), creds, fakeToastApi().f);
    const runs = await runJob(db, 'sync', { now: NOW, fetchImpl: fakeToastApi({ auth: 401 }).f });
    expect(runs.map((r) => r.orgId)).toEqual([orgId]);
    expect(runs.map((r) => r.orgId)).not.toContain(other);
    const [run] = await db.select().from(jobRuns).where(eq(jobRuns.job, 'sync'));
    expect(run!.ok).toBe(false);
  });
});
