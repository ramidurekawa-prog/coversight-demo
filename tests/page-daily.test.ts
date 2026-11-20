import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { densify } from '../lib/data/dense.js';
import { parseCSV } from '../lib/data/ingest.js';
import { addDays, buildDaily, businessDay, calendar, change, COMPARISONS, compareDay, csvCell, daypartError, dayparts, daysCsv, daysFromExports, DEFAULT_DAYPARTS, explainDay, fromSample, heatGrid, lastYear, months, rangeTotals, ratio, summarizeDays } from '../lib/data/page/daily.js';
import { mapToastDay } from '../lib/data/toast-api.js';
import { detectToastFile, parseToastDate, readToastExports } from '../lib/data/toast.js';
import { SEED } from '../lib/data/seed.js';
import type { Db } from '../server/db/client';
import { auditLog, dailyDays, posDays, users } from '../server/db/schema';
import { createSampleOrg } from '../server/org';
import { buildFromSync, businessDayEnd, DAILY, loadDaily, loadDay, removeUploadedDays, saveNote, saveUploadedDays } from '../server/page/daily';
import { freshDb } from './helpers/db';
import { ordersFor, timeFor } from './helpers/fake-toast';
import { toastFixture } from './helpers/toast-fixture.js';

const FILES = Object.entries(toastFixture()).map(([name, text]) => {
  const p = parseCSV(text);
  return { kind: detectToastFile(p.headers)!, name, rows: p.rows };
});
const REFS = {
  employees: [{ guid: 'e1', firstName: 'Ana', lastName: 'Ruiz' }, { guid: 'e2', firstName: 'Ben', lastName: 'Cho' }, { guid: 'e3', firstName: 'Cam', lastName: 'Diaz' }, { guid: 'e4', firstName: 'Dee', lastName: 'Park' }, { guid: 'e5', firstName: 'Eli', lastName: 'Moss' }],
  jobs: [{ guid: 'j1', title: 'Server' }, { guid: 'j2', title: 'Line Cook' }, { guid: 'j3', title: 'Bartender' }],
  diningOptions: [{ guid: 'd1', name: 'Dine In' }, { guid: 'd2', name: 'Take Out' }, { guid: 'd3', name: 'DoorDash Delivery' }],
  salesCategories: [{ guid: 'c1', name: 'Food' }, { guid: 'c2', name: 'Liquor' }],
};
const posRow = (orgId: string, day: string, fetchedAt = new Date()) => {
  const m = mapToastDay({ orders: ordersFor(day) as never[], timeEntries: timeFor(day) as never[], refs: REFS as never, tz: 'America/Los_Angeles' });
  return { orgId, roomId: 'oakland', day, source: 'toast-api', items: m.items, orders: m.orders, time: m.time, payments: m.payments, fetchedAt };
};

describe('daily reader (pure)', () => {
  const read = () => daysFromExports(FILES, { now: new Date('2027-01-01T12:00:00Z') }) as any;
  const view = () => buildDaily(read().days.map((d: any) => ({ ...d.summary, complete: d.complete })))!;

  it('splits an export into business days that add back to the weekly summary', () => {
    const r = read();
    expect(r.ok).toBe(true);
    expect(r.days).toHaveLength(91);
    const s = readToastExports(Object.entries(toastFixture()).map(([name, text]) => ({ name, text }))) as any;
    // Week 0 of the summary is the latest 7 days; the days must agree to the dollar, cover and labour dollar.
    const last7 = r.days.slice(-7).map((d: any) => d.summary);
    const sum = (f: (d: any) => number) => last7.reduce((a: number, d: any) => a + f(d), 0);
    const wk = s.toast.history.at(-1);
    expect(Math.round(sum((d) => d.net))).toBe(wk.net);
    expect(sum((d) => d.covers)).toBe(wk.covers);
    expect(Math.round(sum((d) => d.labour))).toBe(wk.labour);
  });

  it('reconciles hours, channels, day parts and checks to the day', () => {
    for (const { summary: d, checks } of read().days as any[]) {
      const hs = (f: string) => d.hours.reduce((a: number, h: any) => a + h[f], 0);
      expect(hs('covers')).toBe(d.covers);
      expect(hs('orders')).toBe(d.orders);
      expect(Math.round(hs('sales') * 100)).toBe(Math.round(d.net * 100));
      expect(Math.round(hs('labour'))).toBe(Math.round(d.labour));
      expect(Math.round((Object.values(d.channels) as number[]).reduce((a, v) => a + v, 0))).toBe(Math.round(d.net));
      const v = { ...d, hours: d.hours };
      const parts = dayparts(v, DEFAULT_DAYPARTS)!;
      expect(Math.round(parts.reduce((a, p) => a + p.sales, 0) * 100)).toBe(Math.round(d.net * 100));
      const live = checks.filter((c: any) => c[9] === 0);
      expect(live).toHaveLength(d.orders);
      expect(Math.round(live.reduce((a: number, c: any) => a + c[7], 0))).toBe(Math.round(d.net));
    }
  });

  it('reconciles days to weeks and months (rates from totals, not averages)', () => {
    const v = view();
    const m = months(v.days);
    expect(Math.round(m.reduce((a, x) => a + x.net, 0))).toBe(Math.round(v.days.reduce((a, d) => a + d.net, 0)));
    const t = rangeTotals(v.days, 7);
    expect(t.check).toBeCloseTo(t.net / t.covers, 6);
  });

  it('puts a 1 am tab on the night before', () => {
    expect(businessDay(parseToastDate('10/25/26 1:15 AM')!)).toBe('2026-10-24');
    expect(businessDay(parseToastDate('10/25/26 11:15 AM')!)).toBe('2026-10-25');
  });

  const order = (opened: string, amount: number, guests = 2, extra: Record<string, string> = {}) =>
    ({ 'Order Id': `o${opened}`, Opened: opened, Amount: `$${amount.toFixed(2)}`, '# of Guests': String(guests), 'Dining Options': 'Dine In', Voided: 'false', ...extra });

  it('keeps cross-midnight orders on the service date, and the dates whole across DST', () => {
    // US clocks fall back at 2 am on Nov 1 2026 and spring forward at 2 am on Mar 14 2027:
    // Toast stamps are wall clock, so the two 1:30 am tabs are both Saturday night's.
    const rows = [
      order('10/31/26 9:00 PM', 100), order('11/1/26 1:30 AM', 40), order('11/1/26 1:30 AM', 60), order('11/1/26 6:00 PM', 80),
      order('3/13/27 11:30 PM', 50), order('3/14/27 3:30 AM', 30), order('3/14/27 7:00 PM', 70),
    ];
    const { days } = summarizeDays([{ kind: 'orders', rows }]);
    expect(days.map((d) => [d.day, d.net, d.orders])).toEqual([
      ['2026-10-31', 200, 3], ['2026-11-01', 80, 1], ['2027-03-13', 80, 2], ['2027-03-14', 70, 1],
    ]);
    const sat = days[0]!;
    expect(sat.hours.map((h) => h.h)).toEqual([21, 1]); // service order: 9 pm, then 1 am
    expect(dayparts({ hours: sat.hours }, DEFAULT_DAYPARTS)!.find((p) => p.name === 'Late night')!.sales).toBe(100);
  });

  it('marks a day still trading at export time as partial', () => {
    const rows = [order('11/12/26 7:00 PM', 50), order('11/13/26 12:30 PM', 20)];
    const r = daysFromExports([{ kind: 'orders', rows }], { now: new Date(Date.UTC(2026, 10, 13, 20, 0) + new Date().getTimezoneOffset() * 6e4) }) as any;
    expect(r.days.map((d: any) => [d.summary.day, d.complete])).toEqual([['2026-11-12', true], ['2026-11-13', false]]);
    const v = buildDaily(r.days.map((d: any) => ({ ...d.summary, complete: d.complete })))!;
    expect(v.days.at(-1)!.complete).toBe(false);
    expect(daysCsv(v)).toContain('2026-11-13,Fri,partial');
  });

  it('says unavailable, never 0%, when a denominator is zero or a cost is missing', () => {
    expect(ratio(10, 0)).toBeNull();
    expect(ratio(null, 5)).toBeNull();
    expect(change(5, 0)).toBeNull();
    const { days } = summarizeDays([{ kind: 'orders', rows: [order('10/24/26 7:00 PM', 0, 0)] }]);
    const v = buildDaily(days)!;
    expect(v.days[0]!.check).toBeNull();
    expect(v.days[0]!.labour).toBeNull(); // no TimeEntries: unknown, not $0
    expect(v.has.labour).toBe(false);
    expect(months(v.days)[0]!.labour).toBeNull();
  });

  it('leaves missing days out instead of counting them as zero', () => {
    const v = view();
    const gap = v.days.filter((_, i) => i % 7 !== 3); // drop one weekday every week
    const t = rangeTotals(gap, 28);
    expect(t.missing).toBe(4);
    expect(t.days).toBe(24);
    const m = months(gap);
    expect(m.every((x) => x.days <= x.inMonth)).toBe(true);
    const iso = gap.at(-1)!.iso;
    const byIso = new Map(gap.map((d) => [d.iso, d]));
    const missing = v.days.find((d) => !byIso.has(d.iso))!.iso;
    expect(compareDay(gap, addDays(missing, 7), 'prev')).toBeNull(); // no day held, no comparison: not a fall to zero
    expect(compareDay(gap, iso, 'recent')!.n).toBeLessThanOrEqual(4);
    const csv = daysCsv({ ...v, days: gap });
    expect(csv).not.toContain(`\n${missing},`);
  });

  it('compares only days held in both years, and labels each comparison', () => {
    const v = view();
    expect(rangeTotals(v.days, 28).vs).toBeNull(); // 13 weeks: no year before
    const oak = (SEED as any).rooms.oakland;
    const sample = fromSample(densify(oak), oak.channels)!;
    const y = rangeTotals(sample.days, 364);
    expect(y.vs?.days).toBe(364);
    expect(compareDay(sample.days, sample.days.at(-1)!.iso, 'ly')!.isos).toEqual([lastYear(sample.days.at(-1)!.iso)]);
    expect(COMPARISONS.ly.desc).toMatch(/364 days/);
    expect(compareDay(v.days, v.days.at(-1)!.iso, 'recent')!.n).toBe(4);
  });

  it('explains a day in observational words, with covers and check effects that add up', () => {
    const v = view();
    const d = v.days.at(-1)!;
    const base = compareDay(v.days, d.iso, 'prev')!;
    const e = explainDay(d, base, { label: 'last Saturday' })!;
    expect(e.coversEffect! + e.checkEffect!).toBeCloseTo(d.covers * d.check! - base.covers! * base.check!, 0);
    expect(e.headline).not.toMatch(/because|caused|profit/i);
    if (!e.flat) expect(e.headline).toMatch(/largest arithmetic contributor/);
  });

  it('refuses day parts that overlap or leave the business day', () => {
    expect(daypartError(DEFAULT_DAYPARTS)).toBeNull();
    expect(daypartError([{ name: 'A', from: 11, to: 16 }, { name: 'B', from: 15, to: 20 }])).toMatch(/overlap/);
    expect(daypartError([{ name: 'A', from: 2, to: 6 }])).toMatch(/inside the business day/);
  });

  it('refuses files it cannot read instead of inventing days', () => {
    expect(daysFromExports([{ kind: 'kitchen', rows: [] }])).toMatchObject({ ok: false });
  });

  it('builds the heat grid over the hours the room trades, missing apart from zero', () => {
    const v = view();
    const g = heatGrid(v.hours, 'covers');
    expect(g.hours[0]).toBe(17);
    expect(g.hours.at(-1)).toBe(21);
    const cps = heatGrid(v.hours, 'cps');
    expect(cps.rows.find((r) => r.dow === 'Fri')!.cells.every((c) => c.v != null && c.v > 0)).toBe(true);
    // A weekday the data never holds is missing (null), not zero.
    const noMon = heatGrid(v.hours.filter((h) => h.dow !== 'Mon'), 'covers');
    expect(noMon.rows.find((r) => r.dow === 'Mon')!.cells.every((c) => c.v == null)).toBe(true);
  });

  it('keeps dish sales at the prices guests paid then', () => {
    const r = read();
    const v = view();
    const salmon = v.items.find((it: any) => it.name === 'Grilled Salmon')!;
    const units = salmon.units.reduce((a: number, b: number) => a + b, 0);
    const net = salmon.net!.reduce((a: number, b: number) => a + b, 0);
    const fromDays = r.days.reduce((a: number, d: any) => a + (d.summary.dishes['Grilled Salmon']?.[1] ?? 0), 0);
    expect(Math.round(net)).toBe(Math.round(fromDays));
    expect(net / units).toBeGreaterThan(0);
  });

  it('lays a month out Monday first', () => {
    const c = calendar('2026-11');
    expect(c.length % 7).toBe(0);
    expect(c.slice(0, 6)).toEqual([null, null, null, null, null, null]); // Nov 1 2026 is a Sunday
    expect(c[6]).toBe('2026-11-01');
  });

  it('writes a CSV with definitions, the period, time zone and source, safe from formula injection', () => {
    const v = view();
    const csv = daysCsv(v, { room: '=HYPERLINK("x")', from: v.days.at(-7)!.iso, to: v.days.at(-1)!.iso, tz: 'America/Los_Angeles', generated: new Date('2026-11-13T00:00:00Z') });
    const lines = csv.split('\n');
    expect(lines).toContain(`# Room,"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('America/Los_Angeles');
    expect(csv).toContain('# Generated,2026-11-13T00:00:00.000Z');
    expect(csv).toContain('Your Toast data');
    expect(csv).toContain('# net_sales_usd,');
    const head = lines.find((l) => l.startsWith('business_date'))!;
    expect(head).toContain('labour_usd');
    expect(head).not.toContain('food_cost');
    expect(head).not.toContain('contribution');
    expect(lines.length - lines.indexOf(head) - 1).toBe(7);
    expect(csvCell('-2+3')).toBe("\"'-2+3\"");
    expect(csvCell('@SUM(A1)')).toBe("\"'@SUM(A1)\"");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(-12.5)).toBe('-12.5');
    const sampleCsv = daysCsv(fromSample(densify((SEED as any).rooms.oakland), [])!);
    expect(sampleCsv).toContain('SAMPLE DATA');
  });
});

let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
const gm = () => ({ orgId, userId: 'u2', role: 'gm' as const, rooms: ['berkeley'] });
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values([{ id: 'u1', name: 'Maria Reyes', email: 'm@x.co' }, { id: 'u2', name: 'G', email: 'g@x.co' }]);
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});

describe('daily backend', () => {
  it('has no days of its own on a fresh sample group', async () => {
    const r = await loadDaily(db, owner(), 'oakland');
    expect(r.view).toBeNull();
    expect(r.notes).toEqual({});
  });

  it('summarises synced days, and rebuilds a day when it is pulled again', async () => {
    const days = ['2026-10-22', '2026-10-23', '2026-10-24'];
    const old = new Date('2026-10-25T10:00:00Z');
    await db.insert(posDays).values(days.map((d) => posRow(orgId, d, old)));
    const r = await loadDaily(db, owner(), 'oakland');
    expect(r.view!.days.map((d: any) => d.iso)).toEqual(days);
    const sat = r.view!.days.at(-1)!;
    expect(sat.orders).toBe(130);
    expect(sat.covers).toBe(ordersFor('2026-10-24').reduce((a, o) => a + o.numberOfGuests, 0));
    expect(sat.labour).toBeGreaterThan(0);
    expect(r.provenance).toMatchObject({ synced: 3, uploaded: 0 });
    // Nothing new: nothing rebuilt.
    expect((await buildFromSync(db, orgId, 'oakland')).built).toBe(0);
    // The sync pulls Saturday again (a late void): it is rebuilt from the new rows.
    const again = posRow(orgId, '2026-10-24', new Date());
    again.orders = again.orders.slice(0, 100);
    await db.insert(posDays).values(again).onConflictDoUpdate({ target: [posDays.orgId, posDays.roomId, posDays.day], set: again });
    const r2 = await loadDaily(db, owner(), 'oakland');
    expect(r2.view!.days.at(-1)!.orders).toBe(100);
  });

  it('builds a long backfill a bounded number of days at a time', async () => {
    const days = Array.from({ length: DAILY.buildPerCall + 5 }, (_, i) => new Date(Date.UTC(2026, 7, 1) + i * 864e5).toISOString().slice(0, 10));
    await db.insert(posDays).values(days.map((d) => ({ ...posRow(orgId, d), items: [], payments: [], time: [] })));
    const first = await loadDaily(db, owner(), 'oakland');
    expect(first.pending).toBe(5);
    expect(first.view!.days.at(-1)!.iso).toBe(days.at(-1)); // newest first
    const second = await loadDaily(db, owner(), 'oakland');
    expect(second.pending).toBe(0);
    expect(second.view!.days).toHaveLength(days.length);
  });

  it('keeps uploaded days, never over a synced one, and can remove them', async () => {
    await db.insert(posDays).values(posRow(orgId, '2026-10-24'));
    await loadDaily(db, owner(), 'oakland');
    const up = (daysFromExports(FILES) as any).days; // 2026-07-26 … 2026-10-24
    for (let i = 0; i < up.length; i += DAILY.maxUpload) {
      await saveUploadedDays(db, owner(), { roomId: 'oakland', days: up.slice(i, i + DAILY.maxUpload) });
    }
    const r = await loadDaily(db, owner(), 'oakland');
    expect(r.provenance).toMatchObject({ synced: 1, uploaded: 90, first: '2026-07-26', last: '2026-10-24' });
    expect(r.view!.days.at(-1)!.orders).toBe(130); // the synced Saturday, not the upload's
    const audits = (await db.select().from(auditLog).where(eq(auditLog.action, 'daily.uploaded'))).map((a) => a.detail as { roomId: string; days: number; kept: number });
    expect(audits.every((a) => a.roomId === 'oakland')).toBe(true);
    expect(audits.reduce((a, x) => a + x.days, 0)).toBe(90);
    expect(audits.reduce((a, x) => a + x.kept, 0)).toBe(1);
    expect(await removeUploadedDays(db, owner(), 'oakland')).toEqual({ removed: 90 });
    expect((await loadDaily(db, owner(), 'oakland')).view!.days).toHaveLength(1);
  });

  it('refuses bad uploads on the server', async () => {
    const day = (daysFromExports(FILES) as any).days[0];
    const bad = (summary: any) => ({ ...day, summary: { ...day.summary, ...summary } });
    await expect(saveUploadedDays(db, owner(), { roomId: 'oakland', days: [] })).rejects.toThrow(/days are required/);
    await expect(saveUploadedDays(db, owner(), { roomId: 'oakland', days: [bad({ day: '2026-13-01' })] })).rejects.toThrow(/day/);
    await expect(saveUploadedDays(db, owner(), { roomId: 'oakland', days: [bad({ net: 1e12 })] })).rejects.toThrow(/net/);
    await expect(saveUploadedDays(db, owner(), { roomId: 'oakland', days: [bad({ extra: 1 })] })).rejects.toThrow();
    await expect(saveUploadedDays(db, owner(), { roomId: 'oakland', days: [{ ...day, checks: [['x']] }] })).rejects.toThrow(/checks/);
    await expect(saveUploadedDays(db, owner(), { roomId: 'oakland', days: [day, day] })).rejects.toThrow(/twice/);
    await expect(saveUploadedDays(db, owner(), { roomId: 'nowhere', days: [day] })).rejects.toThrow(/no room/);
    await expect(saveUploadedDays(db, owner(), { roomId: 'oakland', days: Array(DAILY.maxUpload + 1).fill(day) })).rejects.toThrow(/at most/);
  });

  it('opens a day with its checks and dishes, from the sync or the upload', async () => {
    await db.insert(posDays).values(posRow(orgId, '2026-10-24'));
    await loadDaily(db, owner(), 'oakland');
    const synced = await loadDay(db, owner(), 'oakland', '2026-10-24');
    expect(synced).toMatchObject({ held: true, source: 'toast-api', checksKept: true });
    expect((synced as any).checks.filter((c: any) => c[9] === 0)).toHaveLength(130);
    const up = (daysFromExports(FILES) as any).days.slice(0, 2);
    await saveUploadedDays(db, owner(), { roomId: 'oakland', days: up });
    const fromUpload = await loadDay(db, owner(), 'oakland', up[0].summary.day) as any;
    expect(fromUpload.source).toBe('toast-export');
    expect(fromUpload.checks).toHaveLength(up[0].checks.length);
    expect(Object.keys(fromUpload.dishes).length).toBeGreaterThan(0);
    expect(await loadDay(db, owner(), 'oakland', '2020-01-01')).toEqual({ day: '2020-01-01', held: false });
    await expect(loadDay(db, owner(), 'oakland', 'today')).rejects.toThrow(/date/);
    await expect(loadDay(db, gm(), 'oakland', '2026-10-24')).rejects.toThrow(/not one of yours/);
  });

  it('marks a synced day pulled before it ended as partial, and final once pulled after', async () => {
    // Saturday 2026-10-24 ends 4 am Sunday Pacific (11:00 UTC, daylight time).
    expect(businessDayEnd('2026-10-24').toISOString()).toBe('2026-10-25T11:00:00.000Z');
    // After clocks fall back on Nov 1 the same wall time is 12:00 UTC.
    expect(businessDayEnd('2026-11-01').toISOString()).toBe('2026-11-02T12:00:00.000Z');
    await db.insert(posDays).values(posRow(orgId, '2026-10-24', new Date('2026-10-25T05:00:00Z')));
    let r = await loadDaily(db, owner(), 'oakland');
    expect(r.view!.days[0]!.complete).toBe(false);
    expect(r.provenance).toMatchObject({ partial: ['2026-10-24'], dataThrough: null });
    const again = posRow(orgId, '2026-10-24', new Date('2026-10-25T12:00:00Z'));
    await db.insert(posDays).values(again).onConflictDoUpdate({ target: [posDays.orgId, posDays.roomId, posDays.day], set: again });
    r = await loadDaily(db, owner(), 'oakland');
    expect(r.view!.days[0]!.complete).toBe(true);
    expect(r.provenance).toMatchObject({ partial: [], dataThrough: '2026-10-24' });
  });

  it('never shows sample figures for a real room: a room without its own days has no view', async () => {
    await db.insert(posDays).values(posRow(orgId, '2026-10-24'));
    expect((await loadDaily(db, owner(), 'oakland')).view!.own).toBe(true);
    expect((await loadDaily(db, owner(), 'berkeley')).view).toBeNull();
  });

  it('keeps a GM to their own rooms and another group out', async () => {
    const day = (daysFromExports(FILES) as any).days[0];
    await expect(loadDaily(db, gm(), 'oakland')).rejects.toThrow(/not one of yours/);
    await expect(saveUploadedDays(db, gm(), { roomId: 'oakland', days: [day] })).rejects.toThrow(/not one of yours/);
    await expect(saveNote(db, gm(), { roomId: 'oakland', day: '2026-10-24', text: 'x' })).rejects.toThrow(/not one of yours/);
    await expect(saveUploadedDays(db, gm(), { roomId: 'berkeley', days: [day] })).resolves.toMatchObject({ saved: 1 });
    const other = (await createSampleOrg(db, { ownerId: 'u2' })).id;
    const rows = await db.select().from(dailyDays).where(and(eq(dailyDays.orgId, other)));
    expect(rows).toHaveLength(0);
    expect((await loadDaily(db, { orgId: other, rooms: null }, 'berkeley')).view).toBeNull();
  });

  it('saves, edits and removes a note on a day, with who wrote it', async () => {
    const r = await saveNote(db, owner(), { roomId: 'oakland', day: '2026-10-24', text: '  Rain all evening;\n patio closed ' });
    expect(r.notes['2026-10-24']).toMatchObject({ text: 'Rain all evening; patio closed', by: 'Maria Reyes' });
    await saveNote(db, owner(), { roomId: 'oakland', day: '2026-10-24', text: 'Rain, patio closed at 6' });
    expect((await loadDaily(db, owner(), 'oakland')).notes['2026-10-24'].text).toBe('Rain, patio closed at 6');
    await expect(saveNote(db, owner(), { roomId: 'oakland', day: '2026-10-24', text: 'x'.repeat(300) })).rejects.toThrow(/at most 280/);
    await expect(saveNote(db, owner(), { roomId: 'oakland', day: 'yesterday', text: 'x' })).rejects.toThrow(/invalid note/);
    expect((await saveNote(db, owner(), { roomId: 'oakland', day: '2026-10-24', text: '' })).notes).toEqual({});
  });
});
