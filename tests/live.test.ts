import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { coversBySlot, LIVE, liveTonight, slotsBy, usualNight } from '../lib/data/live.js';
import { briefing, tonight } from '../lib/data/page/today-brief.js';
import { mapToastDay } from '../lib/data/toast-api.js';
import type { Db } from '../server/db/client';
import { memberships, posDays, serviceLive, staffConnections, users } from '../server/db/schema';
import { runJob } from '../server/jobs';
import { loadLive, saveManual } from '../server/live';
import { createSampleOrg } from '../server/org';
import { checkSevenShifts, connectSevenShifts, serversBySlot, staffStatus } from '../server/sevenshifts';
import { connectToast } from '../server/toast-conn';
import { freshDb } from './helpers/db';
import { fakeToastApi, GUID, ordersFor } from './helpers/fake-toast';

const TZ = 'America/Los_Angeles';
const NOW = new Date('2026-10-28T02:30:00Z'); // Tue Oct 27, 7:30 pm Pacific
const DAY = '2026-10-27';
const rowsFor = (day: string) => mapToastDay({ orders: ordersFor(day) as never[], tz: TZ }).orders;

describe('tonight, counted the same way everywhere (pure)', () => {
  it('counts covers per 15-minute slot from 5 pm, skipping voided orders and lunch', () => {
    const { slots, orders } = coversBySlot([
      { Opened: '2026-10-27 12:10:00', '# of Guests': '4' },
      { Opened: '2026-10-27 17:05:00', '# of Guests': '2' },
      { Opened: '2026-10-27 17:14:59', '# of Guests': '3' },
      { Opened: '2026-10-27 17:15:00', '# of Guests': '1', Voided: 'true' },
      { Opened: '2026-10-27 19:31:00', '# of Guests': '5' },
    ]);
    expect(slots).toHaveLength(LIVE.slots);
    expect(slots[0]).toBe(5);
    expect(slots[1]).toBe(0);
    expect(slots[10]).toBe(5);
    expect(orders).toBe(3);
    expect(slotsBy(16 * 60 + 59)).toBe(0);
    expect(slotsBy(17 * 60)).toBe(1);
    expect(slotsBy(19 * 60 + 30)).toBe(11);
    expect(slotsBy(23 * 60)).toBe(20);
  });

  it('a usual night needs two past nights of the same weekday, and never borrows another weekday', () => {
    const days = ['2026-10-20', '2026-10-13', '2026-10-21'].map((day) => ({ day, orders: rowsFor(day) }));
    expect(usualNight(days.slice(0, 1), DAY).comp).toBeNull();
    const u = usualNight(days, DAY);
    expect(u.nights).toBe(2);
    const a = coversBySlot(rowsFor('2026-10-20')).slots, b = coversBySlot(rowsFor('2026-10-13')).slots;
    expect(u.comp![0]).toBe(Math.round(((a[0]! + b[0]!) / 2) * 10) / 10);
  });

  it('a hand count stands in while the feed is down, and the feed wins again once it is newer', () => {
    const usual = { comp: Array(LIVE.slots).fill(4), nights: 4 };
    const at = { nowMs: NOW.getTime(), nowMin: 19 * 60 + 30, connected: { toast: true, staff: false } };
    const manual = { covers: 30, servers: 3, at: new Date(NOW.getTime() - 10 * 6e4).toISOString(), by: 'Luis' };
    // Toast never answered tonight: the count is used, compared up to when it was entered (7:20 → 10 slots).
    const down = liveTonight({ day: DAY, slots: [], error: 'Toast answered 500', manual }, usual, at);
    expect(down).toMatchObject({ source: 'manual', so: 30, usual: 40, pace: -25, servers: 3, serversFrom: 'manual', enteredBy: 'Luis', feeds: { toast: 'down', staff: 'off' } });
    expect(down.actual).toBeNull(); // a total is never spread into a made-up curve
    // A pull after the entry: the feed wins.
    const slots = Array(LIVE.slots).fill(5);
    const back = liveTonight({ day: DAY, slots, pulledAt: new Date(NOW.getTime() - 60e3).toISOString(), manual }, usual, at);
    expect(back).toMatchObject({ source: 'toast', so: 55, usual: 44, pace: 25, feeds: { toast: 'ok' } });
    // No usual night: covers, no pace.
    expect(liveTonight({ day: DAY, slots, pulledAt: NOW.toISOString() }, { comp: null, nights: 1 }, at)).toMatchObject({ so: 55, pace: null });
  });

  it('the briefing paces a real room from its live feed without claiming staffing is right', () => {
    const d = { room: { fromToast: true }, feeds: [] } as never;
    const usual = { comp: Array(LIVE.slots).fill(4), nights: 4 };
    const lt = liveTonight({ day: DAY, slots: Array(LIVE.slots).fill(4), pulledAt: NOW.toISOString() }, usual, { nowMs: NOW.getTime(), nowMin: 19 * 60 + 30, connected: { toast: true, staff: false } });
    expect(tonight(d, { label: 'Tuesday, Oct 27', time: '7:30 pm' })).toBeNull();
    expect(tonight(d, { label: 'Tuesday, Oct 27', time: '7:30 pm' }, { tonight: lt })).toMatchObject({ pace: 0, mode: 'pace' });
    const b = briefing(d, { cards: [], view: { done: {}, refused: {}, snoozed: {}, assigned: {}, meta: {} }, now: { label: 'Tuesday, Oct 27', time: '7:30 pm' }, live: { tonight: lt } });
    expect(b.headline).toBe('Dinner demand is on track.');
    expect(b.line).not.toMatch(/staffing is right/);
  });
});

describe('tonight on the server', () => {
  let db: Db;
  let orgId: string;
  const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
  const floor = () => ({ orgId, userId: 'u2', role: 'floor' as const, rooms: ['oakland'] });
  beforeEach(async () => {
    db = await freshDb();
    process.env.CREDENTIALS_KEY = 'k'.repeat(40);
    await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'm@x.co' }, { id: 'u2', name: 'Luis', email: 'l@x.co' }]);
    orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
    await db.insert(memberships).values({ orgId, userId: 'u2', role: 'floor', rooms: ['oakland'] });
  });
  afterEach(() => { delete process.env.CREDENTIALS_KEY; });

  it('with no feed, the page still works from a hand count, and says it was entered by hand', async () => {
    const r0 = await loadLive(db, floor(), 'oakland', { now: NOW });
    expect(r0.tonight).toMatchObject({ source: 'none', so: null, feeds: { toast: 'off', staff: 'off' }, started: true });
    expect(r0.inService).toBe(true);
    await expect(loadLive(db, floor(), 'berkeley', { now: NOW })).rejects.toThrow(/not one of yours/);
    await expect(saveManual(db, floor(), { roomId: 'oakland' }, NOW)).rejects.toThrow(/Enter covers/);
    await expect(saveManual(db, floor(), { roomId: 'oakland', covers: -3 }, NOW)).rejects.toThrow(/invalid/);
    const r1 = await saveManual(db, floor(), { roomId: 'oakland', covers: 42, servers: 4 }, NOW);
    // No usual night of its own yet, but Covercast (the forecast Service uses) has tonight, so the count is paced against it.
    expect(r1.tonight).toMatchObject({ source: 'manual', so: 42, servers: 4, serversFrom: 'manual', enteredBy: 'Luis', engine: 'Covercast' });
    expect(typeof r1.tonight.pace).toBe('number');
    const r2 = await saveManual(db, floor(), { roomId: 'oakland', clear: true }, NOW);
    expect(r2.tonight.source).toBe('none');
  });

  it('pulls Toast at most every five minutes while Today is open, and paces against the same weekday', async () => {
    const api = fakeToastApi();
    await connectToast(db, owner(), { host: 'ws-api.toasttab.com', clientId: 'client-abcdef', secret: 'super-secret-value', restaurants: [{ guid: GUID, roomId: 'oakland' }] }, api.f);
    for (const day of ['2026-10-20', '2026-10-13', '2026-10-26']) {
      await db.insert(posDays).values({ orgId, roomId: 'oakland', day, items: [], orders: rowsFor(day), time: [], payments: [] });
    }
    const bulk = () => api.calls.filter((u) => u.includes('ordersBulk')).length;
    const r = await loadLive(db, floor(), 'oakland', { now: NOW, fetchImpl: api.f });
    const slots = coversBySlot(rowsFor(DAY)).slots;
    const usual = usualNight(['2026-10-20', '2026-10-13'].map((day) => ({ day, orders: rowsFor(day) })), DAY).comp!;
    const n = slotsBy(19 * 60 + 30);
    const so = slots.slice(0, n).reduce((a, b) => a + b, 0);
    const us = usual.slice(0, n).reduce((a, b) => a + b, 0);
    expect(r.tonight).toMatchObject({ source: 'toast', so, usual: us, pace: Math.round((so / us - 1) * 100), nights: 2, feeds: { toast: 'ok' } });
    expect(r.tonight.actual).toEqual(slots.slice(0, n));
    expect(bulk()).toBe(1);
    // A second manager four minutes later reads what's stored; past five minutes, it pulls again.
    await loadLive(db, owner(), 'oakland', { now: new Date(NOW.getTime() + 4 * 6e4), fetchImpl: api.f });
    expect(bulk()).toBe(1);
    await loadLive(db, owner(), 'oakland', { now: new Date(NOW.getTime() + 6 * 6e4), fetchImpl: api.f });
    expect(bulk()).toBe(2);
    // Outside dinner it doesn't call Toast at all.
    await loadLive(db, owner(), 'oakland', { now: new Date('2026-10-27T18:00:00Z'), fetchImpl: api.f });
    expect(bulk()).toBe(2);
  });

  it('when Toast goes down, it says so and a hand count keeps tonight going', async () => {
    const ok = fakeToastApi();
    await connectToast(db, owner(), { host: 'ws-api.toasttab.com', clientId: 'client-abcdef', secret: 'super-secret-value', restaurants: [{ guid: GUID, roomId: 'oakland' }] }, ok.f);
    const r = await loadLive(db, floor(), 'oakland', { now: NOW, fetchImpl: fakeToastApi({ failOrders: 403 }).f });
    expect(r.tonight).toMatchObject({ source: 'none', feeds: { toast: 'down' }, error: expect.stringMatching(/Can’t access/) });
    const m = await saveManual(db, floor(), { roomId: 'oakland', covers: 50 }, NOW);
    expect(m.tonight).toMatchObject({ source: 'manual', so: 50, feeds: { toast: 'down' } });
    const [row] = await db.select().from(serviceLive).where(eq(serviceLive.orgId, orgId));
    expect(JSON.stringify(row)).not.toMatch(/super-secret/);
  });

  it('runs on a schedule only for groups with a feed (the job is off until Vercel Pro)', async () => {
    expect(await runJob(db, 'live', { now: NOW })).toEqual([]);
    const api = fakeToastApi();
    await connectToast(db, owner(), { host: 'ws-api.toasttab.com', clientId: 'client-abcdef', secret: 'super-secret-value', restaurants: [{ guid: GUID, roomId: 'oakland' }] }, api.f);
    const runs = await runJob(db, 'live', { now: NOW, fetchImpl: api.f });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.ok).toBe(true);
  });
});

/** A stand-in for 7shifts' API v2: whoami, locations, roles, shifts. */
function fakeSeven({ status = 200 }: { status?: number } = {}) {
  const calls: string[] = [];
  const json = (body: unknown, s = 200) => new Response(JSON.stringify(body), { status: s, headers: { 'content-type': 'application/json' } });
  const f = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push(url);
    if (status !== 200) return json({}, status);
    if (init?.headers?.authorization !== 'Bearer seven-token-abc') return json({}, 401);
    const p = new URL(url).pathname;
    if (p === '/v2/whoami') return json({ data: { companies: [{ id: 77 }] } });
    if (p === '/v2/company/77/locations') return json({ data: [{ id: 501, name: 'Oakland' }, { id: 502, name: 'Berkeley' }] });
    if (p === '/v2/company/77/roles') return json({ data: [{ id: 9, name: 'Server' }, { id: 10, name: 'Line cook' }] });
    if (p === '/v2/company/77/shifts') {
      return json({ data: [
        // 5–9 pm and 6–10 pm Pacific (PDT), servers; a cook 4–11; an open shift; a deleted one.
        { id: 1, role_id: 9, start: '2026-10-28T00:00:00Z', end: '2026-10-28T04:00:00Z' },
        { id: 2, role_id: 9, start: '2026-10-28T01:00:00Z', end: '2026-10-28T05:00:00Z' },
        { id: 3, role_id: 10, start: '2026-10-27T23:00:00Z', end: '2026-10-28T06:00:00Z' },
        { id: 4, role_id: 9, open: true, start: '2026-10-28T00:00:00Z', end: '2026-10-28T04:00:00Z' },
        { id: 5, role_id: 9, deleted: true, start: '2026-10-28T00:00:00Z', end: '2026-10-28T04:00:00Z' },
      ] });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('7shifts, switched on by a token', () => {
  let db: Db;
  let orgId: string;
  const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
  const gm = () => ({ orgId, userId: 'u2', role: 'gm' as const, rooms: ['oakland'] });
  beforeEach(async () => {
    db = await freshDb();
    process.env.CREDENTIALS_KEY = 'k'.repeat(40);
    await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'm@x.co' }, { id: 'u2', name: 'Jess', email: 'j@x.co' }]);
    orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  });
  afterEach(() => { delete process.env.CREDENTIALS_KEY; });

  it('counts servers on per slot from published, assigned shifts of the chosen roles', () => {
    const shifts = [
      { role_id: 9, start: '2026-10-28T00:00:00Z', end: '2026-10-28T04:00:00Z' },
      { role_id: 9, start: '2026-10-28T01:00:00Z', end: '2026-10-28T05:00:00Z' },
      { role_id: 10, start: '2026-10-27T23:00:00Z', end: '2026-10-28T06:00:00Z' },
      { role_id: 9, open: true, start: '2026-10-28T00:00:00Z', end: '2026-10-28T04:00:00Z' },
    ];
    const s = serversBySlot(shifts, DAY, TZ, ['9']);
    expect(s[0]).toBe(1); // 5:00
    expect(s[4]).toBe(2); // 6:00
    expect(s[16]).toBe(1); // 9:00, the first has ended
    expect(serversBySlot(shifts, DAY, TZ, [])[0]).toBe(2); // every role: the cook too
  });

  it('checks the token, stores it sealed (owner only), and Today reads servers on from it', async () => {
    const api = fakeSeven();
    expect(await checkSevenShifts({ token: 'wrong-token-123' }, api.f)).toMatchObject({ ok: false, error: expect.stringMatching(/didn’t accept/) });
    const c = await checkSevenShifts({ token: 'seven-token-abc' }, api.f);
    expect(c).toMatchObject({ ok: true, companyId: '77', locations: [{ id: '501', name: 'Oakland' }, { id: '502', name: 'Berkeley' }] });
    const setup = { token: 'seven-token-abc', companyId: '77', locations: [{ locationId: '501', roomId: 'oakland' }], serverRoles: ['9'] };
    await expect(connectSevenShifts(db, gm(), setup, api.f)).rejects.toThrow(/Only an owner/);
    expect((await connectSevenShifts(db, owner(), setup, api.f)).connected).toBe(true);
    const [row] = await db.select().from(staffConnections).where(eq(staffConnections.orgId, orgId));
    expect(row!.tokenSealed).not.toContain('seven-token-abc');
    expect(JSON.stringify(await staffStatus(db, orgId))).not.toContain('seven-token-abc');
    const r = await loadLive(db, owner(), 'oakland', { now: NOW, fetchImpl: api.f });
    // 7:30 pm: both servers are on.
    expect(r.tonight).toMatchObject({ servers: 2, serversFrom: '7shifts', feeds: { staff: 'ok', toast: 'off' } });
    // A hand entry after the pull wins until 7shifts is read again.
    const m = await saveManual(db, owner(), { roomId: 'oakland', servers: 3 }, new Date(NOW.getTime() + 60e3));
    expect(m.tonight).toMatchObject({ servers: 3, serversFrom: 'manual' });
  });

  it('when 7shifts refuses the token, it says so and marks the connection failing', async () => {
    const ok = fakeSeven();
    await connectSevenShifts(db, owner(), { token: 'seven-token-abc', companyId: '77', locations: [{ locationId: '501', roomId: 'oakland' }] }, ok.f);
    const r = await loadLive(db, owner(), 'oakland', { now: NOW, fetchImpl: fakeSeven({ status: 401 }).f });
    expect(r.tonight).toMatchObject({ servers: null, feeds: { staff: 'down' }, staffError: expect.stringMatching(/didn’t accept/) });
    expect((await staffStatus(db, orgId))!.status).toBe('failing');
  });
});
