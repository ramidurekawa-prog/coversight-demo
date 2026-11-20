import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { addDays, holidayOn, holidaysOfYear } from '../lib/data/forecast/calendar.js';
import { backtestDays, backtestHours, buildDays, forecast, reforecast, TUNING } from '../lib/data/forecast/engine.js';
import { covercastRoom } from '../lib/data/forecast/index.js';
import { livePace, quarterCurve, servicePlanOf, shiftPulseDay } from '../lib/data/forecast/shift-pulse.js';
import { methodForecasts } from '../lib/data/forecast/methods.js';
import { seriesFromOrders, seriesFromSample, withManualDays } from '../lib/data/forecast/series.js';
import { mapToastDay } from '../lib/data/toast-api.js';
import { SEED } from '../lib/data/seed.js';
import type { Db } from '../server/db/client';
import { memberships, posDays, users } from '../server/db/schema';
import { saveAction } from '../server/actions';
import { loadForecast } from '../server/forecast';
import { clearFeedCache, eventsFeed, reservationsFeed, weatherFeed } from '../server/forecast-feeds';
import { createSampleOrg } from '../server/org';
import { freshDb } from './helpers/db';
import { ordersFor } from './helpers/fake-toast';
import { HOLIDAY_EFFECT, stressRoom } from './helpers/forecast-fixture.js';

const ds = applyInputs(SEED as never, {} as never) as any;
const ROOMS = Object.keys(ds.rooms);
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe('Covercast calendar', () => {
  it('knows the days that move demand, by the calendar alone', () => {
    const y = Object.fromEntries(holidaysOfYear(2026).map((h) => [h.key, h.iso]));
    expect(y.thanksgiving).toBe('2026-11-26');
    expect(y['black-friday']).toBe('2026-11-27');
    expect(y.easter).toBe('2026-04-05');
    expect(y.mothers).toBe('2026-05-10');
    expect(y.memorial).toBe('2026-05-25');
    expect(holidayOn('2025-02-09')?.key).toBe('super-bowl');
    expect(holidayOn('2026-10-27')).toBeNull();
  });
});

describe('Covercast methods never peek ahead', () => {
  it('a forecast made at an origin is the same whatever happens after it', () => {
    const s = stressRoom({ hours: false });
    const a = buildDays(s.days, 'covers').D;
    const b = buildDays(s.days.map((d, i) => (i > 600 ? { ...d, covers: d.covers * 3 } : d)), 'covers').D;
    for (const [o, t] of [[600, 601], [600, 607], [590, 604]] as const) expect(methodForecasts(b, o, t)).toEqual(methodForecasts(a, o, t));
  });
});

describe('Covercast accuracy on the sample group (measured, not asserted)', () => {
  for (const id of ROOMS) {
    const s = seriesFromSample(ds.rooms[id])!;
    for (const m of ['covers', 'net'] as const) {
      it(`${id} ${m}: beats the usual-night method a day and a week ahead, and on week totals`, () => {
        const b = backtestDays(s.days, m) as any;
        expect(b.days).toBe(TUNING.evalDays);
        for (const h of [1, 7] as const) {
          expect(b.horizons[h].covercast!.wape).toBeLessThan(b.horizons[h].current!.wape);
          // The 80% range holds on roughly 80% of days.
          expect(b.horizons[h].coverage!).toBeGreaterThan(70);
          expect(b.horizons[h].coverage!).toBeLessThan(90);
        }
        expect(b.week.covercast!.wape).toBeLessThan(b.week.current!.wape);
      });
      it(`${id} ${m}: beats it by service and by hour, and re-forecasts the rest of the day better at lunch`, () => {
        const h = backtestHours(s.days, s.hours, m) as any;
        expect(h.shift.covercast!.wape).toBeLessThan(h.shift.current!.wape);
        expect(h.hour.covercast!.wape).toBeLessThan(h.hour.current!.wape);
        expect(h.intraday[12].covercast!.wape).toBeLessThan(h.intraday[12].current!.wape);
        // Mid-afternoon it's close: never more than 5% worse.
        expect(h.intraday[15].covercast!.wape).toBeLessThan(h.intraday[15].current!.wape * 1.05);
      });
    }
  }
});

describe('Covercast on a room with growth, a step change and real holiday effects', () => {
  const s = stressRoom();
  it('learns the room’s holidays and closes most of the gap on them', () => {
    const b = backtestDays(s.days, 'covers', { evalDays: 365 }) as any;
    expect(b.horizons[1].covercast!.wape).toBeLessThan(b.horizons[1].current!.wape);
    expect(b.horizons[1].specialDays.covercast!.wape).toBeLessThan(b.horizons[1].specialDays.current!.wape * 0.7);
    expect(b.horizons[1].normalDays.covercast!.wape).toBeLessThan(b.horizons[1].normalDays.current!.wape);
  });
  it('forecasts Thanksgiving well under a normal Thursday', () => {
    const f = forecast(s, 'covers', { today: '2026-11-19', days: 9 });
    const tg = f.days.find((d) => d.iso === '2026-11-26')!;
    const thu = f.days.find((d) => d.iso === '2026-11-19')!;
    expect(tg.value / thu.value).toBeLessThan(0.6);
    expect(tg.value / thu.value).toBeGreaterThan(HOLIDAY_EFFECT.thanksgiving * 0.8);
    expect(tg.adjustments[0]).toMatchObject({ kind: 'holiday', source: 'learned', seen: 2 });
  });
});

describe('Covercast forecast shape', () => {
  const r = covercastRoom(ds.rooms.oakland, { accuracy: false }) as any;
  it('every level adds up to the day', () => {
    const d = r.covers.days[0];
    expect(Math.abs(sum(d.hours.map((h: any) => h.value)) - d.value)).toBeLessThanOrEqual(6); // rounding, 12 hours
    expect(Math.abs(d.shifts.lunch.value + d.shifts.dinner.value - d.value)).toBeLessThanOrEqual(1);
    expect(Math.abs(sum(d.quarters.map((q: any) => q.value)) - d.value)).toBeLessThan(1);
    expect(d.quartersFrom).toBe('hours');
    expect(d.low).toBeLessThan(d.value);
    expect(d.high).toBeGreaterThan(d.value);
    expect(sum(Object.values(d.weights) as number[])).toBeCloseTo(1, 2);
    expect(r.covers.weeks[0].value).toBe(sum(r.covers.days.filter((x: any) => x.iso >= r.covers.weeks[0].start).slice(0, 7).map((x: any) => x.value)));
  });
  it('says how many servers each hour needs, at the forecast and at the top of the range', () => {
    const h = r.covers.days[0].hours.find((x: any) => x.hour === 19);
    expect(r.rate).toBeGreaterThan(0);
    expect(h.servers).toBe(Math.max(1, Math.ceil(h.value / r.rate)) );
    expect(h.serversHigh).toBeGreaterThanOrEqual(h.servers);
  });
  it('sales come out in dollars, with the same days', () => {
    expect(r.sales.days.map((d: any) => d.iso)).toEqual(r.covers.days.map((d: any) => d.iso));
    expect(r.sales.days[0].value).toBeGreaterThan(r.covers.days[0].value * 20);
  });
});

describe('Covercast signals', () => {
  const room = ds.rooms.oakland;
  const base = covercastRoom(room, { accuracy: false }) as any;
  const [d0, , , d3, , d5, d6] = base.covers.days;
  it('a closure is zero, an event takes the manager’s estimate (labelled), bookings above the forecast raise it', () => {
    const r = covercastRoom(room, { accuracy: false, signals: {
      closures: [d6.iso],
      events: [{ date: d5.iso, name: 'Street fair', lift: 20 }],
      reservations: [{ date: d0.iso, covers: d0.value + 40, asOf: addDays(d0.iso, -1) }],
    } }) as any;
    const by = Object.fromEntries(r.covers.days.map((d: any) => [d.iso, d]));
    expect(by[d6.iso]).toMatchObject({ value: 0, low: 0, high: 0 });
    expect(by[d5.iso].adjustments[0]).toMatchObject({ kind: 'event', source: 'manual' });
    expect(by[d5.iso].calibrated).toBe(false);
    expect(by[d0.iso].value).toBe(d0.value + 40);
  });
  it('says what is moving each day, biggest first, and what is not on file', () => {
    expect(d0.drivers.usual).toBe(d0.methods.current);
    expect(d0.drivers.items.map((x: any) => x.key)).toEqual(expect.arrayContaining(['trend', 'event', 'weather', 'reservations']));
    expect(d0.drivers.items.find((x: any) => x.key === 'weather')).toMatchObject({ pct: null, source: 'none' });
    const r = covercastRoom(room, { accuracy: false, signals: { closures: [d6.iso] } }) as any;
    const top = r.covers.days.find((x: any) => x.iso === d6.iso).drivers.items[0];
    expect(top).toMatchObject({ key: 'closed', pct: -100 });
  });
  it('an event with no estimate and no history is flagged, not guessed', () => {
    expect(d3.adjustments).toEqual([]);
    const r = covercastRoom(room, { accuracy: false, signals: { events: [{ date: d3.iso, name: 'Concert' }] } }) as any;
    const d = r.covers.days.find((x: any) => x.iso === d3.iso);
    expect(d.adjustments[0]).toMatchObject({ source: 'none', mult: 1 });
    expect(d.value).toBe(d3.value);
    expect(d.high - d.low).toBeGreaterThan(d3.high - d3.low);
  });
  it('learns what rain is worth only once enough rainy days are on file', () => {
    const s = stressRoom({ hours: false });
    const days = s.days.slice(-200);
    const rainy = new Set(days.filter((_, i) => i % 9 === 4).map((d) => d.iso));
    const wet = { ...s, days: s.days.map((d) => (rainy.has(d.iso) ? { ...d, covers: Math.round(d.covers * 0.8) } : d)) };
    const weather = days.map((d) => ({ date: d.iso, rainIn: rainy.has(d.iso) ? 0.5 : 0 }));
    const next = addDays(s.days.at(-1)!.iso, 1);
    const f = forecast(wet, 'covers', { today: next, days: 2, signals: { weather: [...weather, { date: next, rainIn: 0.6 }] } }) as any;
    expect(f.learned.rain!.mult).toBeLessThan(0.9);
    expect(f.days[0].adjustments[0]).toMatchObject({ kind: 'weather', source: 'learned' });
    const few = forecast(wet, 'covers', { today: next, days: 2, signals: { weather: [...weather.slice(-30), { date: next, rainIn: 0.6 }] } }) as any;
    expect(few.learned.rain).toBeNull();
    expect(few.days[0].adjustments[0]).toMatchObject({ kind: 'weather', source: 'none' });
  });
  it('learns how bookings turn into covers from past booked days', () => {
    const s = stressRoom({ hours: false });
    const last = s.days.slice(-40);
    const reservations = last.map((d) => ({ date: d.iso, covers: Math.round(d.covers / 2), asOf: addDays(d.iso, -1) }));
    const next = addDays(s.days.at(-1)!.iso, 1);
    const f = forecast(s, 'covers', { today: next, days: 1, signals: { reservations: [...reservations, { date: next, covers: 50, asOf: s.days.at(-1)!.iso }] } }) as any;
    expect(f.learned.pickupPairs).toBe(40);
    expect(f.days[0].adjustments[0]).toMatchObject({ kind: 'reservations', source: 'learned' });
  });
});

describe('Covercast with little or hand-entered history', () => {
  it('says what it needs before it has enough days', () => {
    const s = stressRoom({ hours: false });
    const f = forecast({ ...s, days: s.days.slice(-10) }, 'covers', { today: addDays(s.days.at(-1)!.iso, 1) });
    expect(f).toMatchObject({ ready: false, need: TUNING.minHistory, have: 10 });
    expect(forecast({ days: [], hours: [], quarters: [] }, 'covers', { today: '2026-11-18' }).ready).toBe(false);
  });
  it('forecasts from five weeks, with a range marked as not yet calibrated', () => {
    const s = stressRoom({ hours: false });
    const f = forecast({ ...s, days: s.days.slice(-35) }, 'covers', { today: addDays(s.days.at(-1)!.iso, 1), days: 3 });
    expect(f.ready).toBe(true);
    expect(f.days[0].calibrated).toBe(false);
  });
  it('days typed in by hand fill gaps; a feed day always wins', () => {
    const s = withManualDays({ days: [{ iso: '2026-11-01', covers: 100, net: 5000, source: 'pos' }], hours: [], quarters: [] }, [{ date: '2026-11-01', covers: 1 }, { date: '2026-11-02', covers: 90 }]);
    expect(s.days).toEqual([{ iso: '2026-11-01', covers: 100, net: 5000, source: 'pos' }, { iso: '2026-11-02', covers: 90, net: null, source: 'manual' }]);
  });
});

describe('Covercast from Toast orders, and during service', () => {
  it('reads days, hours and 15-minute slots from stored order rows', () => {
    const rows = mapToastDay({ orders: ordersFor('2026-10-27') as never[], tz: 'America/Los_Angeles' }).orders;
    const s = seriesFromOrders([{ day: '2026-10-27', orders: rows }, { day: '2026-10-28', orders: [] }]);
    expect(s.days).toHaveLength(1);
    const live = rows.filter((o: any) => String(o.Voided).toLowerCase() !== 'true');
    expect(s.days[0]!.covers).toBe(sum(live.map((o: any) => Math.round(+o['# of Guests'] || 0))));
    expect(sum(s.hours.map((h) => h.covers))).toBe(s.days[0]!.covers);
    expect(sum(s.quarters.map((q) => q.covers))).toBe(s.days[0]!.covers);
  });
  it('re-forecasts the rest of the day from the pace, trusting it more as the day goes on', () => {
    const day = { value: 200, low: 180, high: 220, hours: [{ hour: 11, value: 20 }, { hour: 12, value: 40 }, { hour: 18, value: 80 }, { hour: 19, value: 60 }] };
    const early = reforecast(day, { 11: 30 }, { nowHour: 12, kappa: 0.2 })!;
    const late = reforecast(day, { 11: 30, 12: 60 }, { nowHour: 18, kappa: 0.2 })!;
    expect(early.pace).toBe(50);
    expect(late.trust).toBeGreaterThan(early.trust);
    expect(late.restTotal).toBeGreaterThan(140);
    expect(late.total).toBe(90 + late.restTotal);
    // A manager's count since 5 pm works the same way.
    expect(reforecast(day, 40, { nowHour: 19, fromHour: 17, kappa: 0.2 })!.soFar).toBe(40);
  });
});

describe('Covercast runs the Service page', () => {
  const ccs = Object.fromEntries(ROOMS.map((id) => [id, covercastRoom(ds.rooms[id], { days: 7 }) as any]));
  it('beats the page’s old rules on every room: hours a day ahead, and the rest of service from every cut', () => {
    for (const id of ROOMS) {
      const r = ccs[id].shiftPulse;
      expect(r.days).toBeGreaterThan(60);
      for (const s of ['lunch', 'dinner']) {
        expect(r.plan[s].covercast.wape).toBeLessThan(r.plan[s].old.wape);
        for (const cut of Object.keys(r.liveScore[s])) expect(r.liveScore[s][cut].covercast.wape).toBeLessThan(r.liveScore[s][cut].old.wape);
      }
    }
  });
  it('plans fewer idle server-hours across the group, with no more short hours', () => {
    const all = ROOMS.flatMap((id) => ['lunch', 'dinner'].map((s) => ccs[id].shiftPulse.staffing[s]));
    const tot = (k: 'covercast' | 'old', f: 'shortHours' | 'spareServerHours') => sum(all.map((x: any) => x[k][f]));
    expect(tot('covercast', 'shortHours')).toBeLessThanOrEqual(tot('old', 'shortHours'));
    expect(tot('covercast', 'spareServerHours')).toBeLessThan(tot('old', 'spareServerHours') * 0.9);
  });
  it('splits a day into lunch and dinner by hour, with servers at the forecast, the plan and the range top', () => {
    const cc = ccs.oakland;
    const d = shiftPulseDay(cc, cc.covers.days[0].iso) as any;
    for (const s of ['lunch', 'dinner'] as const) {
      const p = d[s]!;
      expect(p.rangeFrom).toBe('service');
      expect(p.hours.every((h: any) => (s === 'lunch' ? h.hour < 16 : h.hour >= 16))).toBe(true);
      for (const h of p.hours as any[]) {
        expect(h.low).toBeLessThanOrEqual(h.covers);
        expect(h.high).toBeGreaterThanOrEqual(h.covers);
        expect(h.serversPlan).toBeGreaterThanOrEqual(h.servers!);
        expect(h.serversHigh).toBeGreaterThanOrEqual(h.servers!);
      }
    }
    expect(Math.abs(d.lunch!.covers + d.dinner!.covers - d.value)).toBeLessThanOrEqual(2);
    // Without the record, the day's range is used, and it says so.
    expect(servicePlanOf(cc.covers.days[0], 'dinner', { rate: cc.rate })!.rangeFrom).toBe('day');
  });
  it('gives a 15-minute curve for a service window that adds up to its hours', () => {
    const day = ccs.berkeley.covers.days[0];
    const curve = quarterCurve(day, { start: 17 * 60, end: 22 * 60 });
    expect(curve).toHaveLength(20);
    const hours = sum(day.hours.filter((h: any) => h.hour >= 17 && h.hour < 22).map((h: any) => h.value));
    expect(Math.abs(sum(curve) - hours)).toBeLessThan(2);
  });
  it('trusts tonight’s pace more as service fills in, within the measured range', () => {
    const curve = Array(20).fill(5);
    const hot = curve.map((c) => c * 1.3);
    const early = livePace({ curve, actual: hot, now: 2, service: 'dinner', start: 17 * 60, tuned: { kappa: 0.4, q: [0.9, 1.1] } });
    const late = livePace({ curve, actual: hot, now: 14, service: 'dinner', start: 17 * 60, tuned: { kappa: 0.4, q: [0.9, 1.1] } });
    expect(early.rawPace).toBe(30);
    expect(early.pace).toBeLessThan(late.pace);
    expect(late.pace).toBeLessThanOrEqual(30);
    expect(late.range[0]).toBeLessThan(late.remaining);
    expect(late.range[1]).toBeGreaterThan(late.remaining);
    expect(late.measured).toBe(true);
    const flat = livePace({ curve, actual: curve, now: 8, service: 'dinner', start: 17 * 60 });
    expect(flat.pace).toBe(0);
    expect(flat.measured).toBe(false);
  });
});

describe('Covercast feeds switch on with a key and stay usable without', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; clearFeedCache(); });
  it('is off without keys, and asks for a location before calling out', async () => {
    delete process.env.OPENWEATHER_API_KEY; delete process.env.TICKETMASTER_API_KEY; delete process.env.OPENTABLE_API_KEY; delete process.env.RESY_API_KEY;
    expect((await weatherFeed({ lat: 37.8, lon: -122.27 })).status.status).toBe('off');
    expect((await eventsFeed({ lat: 37.8, lon: -122.27 }, '2026-11-18', '2026-12-01')).status.status).toBe('off');
    expect(reservationsFeed().status.status).toBe('off');
    process.env.OPENWEATHER_API_KEY = 'k';
    expect((await weatherFeed(null)).status.status).toBe('needs-location');
  });
  it('reads OpenWeather days into rain in inches, and reports a failure as down', async () => {
    process.env.OPENWEATHER_API_KEY = 'k';
    const ok = (async () => new Response(JSON.stringify({ timezone_offset: -28800, daily: [{ dt: 1795464000, rain: 12.7, temp: { max: 61.4 } }, { dt: 1795550400, temp: { max: 64 } }] }))) as unknown as typeof fetch;
    const w = await weatherFeed({ lat: 37.8, lon: -122.27 }, { fetchImpl: ok });
    expect(w.status.status).toBe('ok');
    expect(w.days[0]).toMatchObject({ rainIn: 0.5, tempF: 61, source: 'openweather' });
    expect(w.days[1]!.rainIn).toBe(0);
    clearFeedCache();
    const bad = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    expect((await weatherFeed({ lat: 37.8, lon: -122.27 }, { fetchImpl: bad })).status.status).toBe('down');
  });
  it('reads Ticketmaster events near the room', async () => {
    process.env.TICKETMASTER_API_KEY = 'k';
    const ok = (async () => new Response(JSON.stringify({ _embedded: { events: [{ name: 'Warriors vs Lakers', dates: { start: { localDate: '2026-11-20' } } }] } }))) as unknown as typeof fetch;
    const e = await eventsFeed({ lat: 37.8, lon: -122.27 }, '2026-11-18', '2026-12-01', { fetchImpl: ok });
    expect(e.events).toEqual([{ date: '2026-11-20', name: 'Warriors vs Lakers', lift: null, by: 'Ticketmaster' }]);
  });
});

describe('Covercast on the server', () => {
  let db: Db;
  let orgId: string;
  const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
  const gm = () => ({ orgId, userId: 'u2', role: 'gm' as const, rooms: ['oakland'] });
  beforeAll(async () => {
    db = await freshDb();
    await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'm@x.co' }, { id: 'u2', name: 'Luis', email: 'l@x.co' }]);
    orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
    await db.insert(memberships).values({ orgId, userId: 'u2', role: 'gm', rooms: ['oakland'] });
  });
  it('forecasts a sample room from its own days, with its accuracy and feeds off', async () => {
    const r = await loadForecast(db, owner(), 'berkeley');
    expect(r).toMatchObject({ roomId: 'berkeley', source: 'sample', sample: true, today: '2026-10-26' });
    expect(r.forecast.covers!.days).toHaveLength(14);
    expect(r.forecast.accuracy!.covers.days!.horizons[1].covercast!.wape).toBeLessThan(r.forecast.accuracy!.covers.days!.horizons[1].current!.wape);
    expect(r.feeds.map((f) => f.status)).toEqual(['off', 'off', 'off', 'off']);
    // The per-task pick runs on the server, and the sample keeps V1 wherever a challenger didn't hold up.
    expect((r.forecast.models as any).ready).toBe(true);
    expect(r.forecast.covers!.model).toBe((r.forecast.models as any).uses.day);
  });
  it('keeps a GM to their own rooms', async () => {
    await expect(loadForecast(db, gm(), 'berkeley')).rejects.toThrow(/not one of yours/);
  });
  it('uses the manager’s saved signals', async () => {
    const first = (await loadForecast(db, gm(), 'oakland')).forecast.covers!.days[2]!;
    await saveAction(db, gm(), { roomId: 'oakland', key: 'forecast.signals', value: { closures: [first.iso], events: [] } });
    const after = (await loadForecast(db, gm(), 'oakland')).forecast.covers!.days[2]!;
    expect(after).toMatchObject({ iso: first.iso, value: 0 });
    await expect(saveAction(db, gm(), { roomId: 'oakland', key: 'forecast.signals', value: { closures: ['tomorrow'] } })).rejects.toThrow();
  }, 20_000); // two full Covercast runs: over 5 s when the whole suite runs in parallel
  it('switches to the room’s own Toast days once they are stored', async () => {
    const days = Array.from({ length: 42 }, (_, i) => addDays('2026-10-06', i));
    for (const day of days) await db.insert(posDays).values({ orgId, roomId: 'walnut', day, items: [], orders: mapToastDay({ orders: ordersFor(day) as never[], tz: 'America/Los_Angeles' }).orders, time: [], payments: [] });
    const r = await loadForecast(db, owner(), 'walnut', { now: new Date('2026-11-17T20:00:00Z') });
    expect(r).toMatchObject({ source: 'toast', today: '2026-11-17' });
    expect(r.forecast.covers!.ready).toBe(true);
    expect(r.forecast.covers!.history!.sources).toEqual(['pos']);
  });
  it('forecasts the rest of tonight from the host’s counts once a check is logged, and sizes by the room’s costs', async () => {
    const plan = { planSoFar: 40, planRest: 80 };
    await saveAction(db, owner(), { roomId: 'walnut', key: 'forecast.live', value: { services: [{ date: '2026-11-17', service: 'dinner', booked: 70, cuts: [{ at: '19:00', seated: 50, walkIns: 20, bookedBefore: 32, bookedRest: 40, ...plan }] }] } });
    await saveAction(db, owner(), { roomId: 'walnut', key: 'forecast.decisions', value: { costs: { shortHour: 60 }, entries: [] } });
    const r = await loadForecast(db, owner(), 'walnut', { now: new Date('2026-11-18T03:00:00Z') });
    expect(r.today).toBe('2026-11-17');
    expect(r.arrivals).toMatchObject({ from: 'arrivals', service: 'dinner', at: '19:00', soFar: 50 });
    expect(r.arrivals!.parts.booked!.onBooks).toBe(40);
    expect(r.forecast.live!.validation.validated).toBe(false);
    expect(r.forecast.decisions!.costs).toMatchObject({ shortHour: 60 });
    expect(r.feeds.find((f) => f.key === 'arrivals')!.status).toBe('off');
    await expect(saveAction(db, owner(), { roomId: 'walnut', key: 'forecast.live', value: { services: [{ date: 'tonight', service: 'dinner', booked: 1, cuts: [] }] } })).rejects.toThrow();
  });
});
