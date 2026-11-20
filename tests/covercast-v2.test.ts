import { describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { costPoint, pilotReport, prepPlan, staffingCost } from '../lib/data/forecast/decisions.js';
import { buildDays, dayContext, forecast, normalizeSignals } from '../lib/data/forecast/engine.js';
import { fitGBM, predictGBM } from '../lib/data/forecast/gbm.js';
import { covercastRoom } from '../lib/data/forecast/index.js';
import { arrivalsForecast, backtestArrivals, learnArrivals, MIN_LOGGED } from '../lib/data/forecast/live.js';
import { methodForecasts, V2_KEYS } from '../lib/data/forecast/methods.js';
import { choose, MARGIN, pickModels } from '../lib/data/forecast/select.js';
import { seriesFromSample } from '../lib/data/forecast/series.js';
import { SEED } from '../lib/data/seed.js';
import { stressRoom } from './helpers/forecast-fixture.js';

const ds = applyInputs(SEED as never, {} as never) as any;
const ROOMS = Object.keys(ds.rooms);

describe('Covercast gradient-boosted trees', () => {
  it('learns a bent, interacting pattern that a flat average misses, the same way every time', () => {
    const X: number[][] = [], y: number[] = [];
    for (let i = 0; i < 600; i++) { const a = (i * 37) % 100, b = (i * 11) % 7; X.push([a, b]); y.push((a > 60 ? 2 : 0) + (b >= 5 ? 1 : 0) * (a > 30 ? 1 : -1)); }
    const m = fitGBM(X, y)!;
    const err = (f: (x: number[]) => number) => X.reduce((s, x, i) => s + Math.abs(y[i]! - f(x)), 0) / X.length;
    const avg = y.reduce((s, v) => s + v, 0) / y.length;
    expect(err((x) => predictGBM(m, x)!)).toBeLessThan(err(() => avg) * 0.3);
    expect(JSON.stringify(fitGBM(X, y))).toBe(JSON.stringify(m));
  });
  it('as a day method, never reads past its origin', () => {
    const s = stressRoom({ hours: false });
    const a = buildDays(s.days, 'covers').D;
    const b = buildDays(s.days.map((d, i) => (i > 600 ? { ...d, covers: d.covers * 3 } : d)), 'covers').D;
    for (const o of [500, 580, 600]) expect((methodForecasts(a, o, o + 3, V2_KEYS) as any).gbm).toBe((methodForecasts(b, o, o + 3, V2_KEYS) as any).gbm);
  });
});

describe('Covercast picks the model by task', () => {
  const rows = (fn: (t: number) => Record<string, number>) => Array.from({ length: 200 }, (_, t) => ({ t, half: t < 100 ? 0 : 1, quarter: t < 50 ? 0 : t < 100 ? 1 : 2, actual: 100, ...fn(t) }));
  it('switches only for a challenger that wins clearly on the first half and holds up on the second', () => {
    const clear = choose(rows(() => ({ v1: 110, b: 103 })), ['v1', 'b']);
    expect(clear).toMatchObject({ pick: 'b', use: 'b', check: { heldUp: true } });
    const lucky = choose(rows((t) => ({ v1: 110, b: t < 100 ? 103 : 115 })), ['v1', 'b']);
    expect(lucky).toMatchObject({ pick: 'b', use: 'v1', check: { heldUp: false } });
    const small = choose(rows(() => ({ v1: 110, b: 110 - 10 * MARGIN * 0.5 })), ['v1', 'b']);
    expect(small.use).toBe('v1');
    const streak = choose(rows((t) => ({ v1: 110, b: t < 50 ? 112 : 100 })), ['v1', 'b']);
    expect(streak.pick).toBe('v1'); // won the first half overall, lost its first quarter
  });
  it('scores day, service, slot and prep on each sample room, and uses a challenger only where it held up', () => {
    const svc = { v1: 0, old: 0 };
    for (const id of ROOMS) {
      const p = pickModels(seriesFromSample(ds.rooms[id])!) as any;
      expect(p.ready).toBe(true);
      for (const k of ['day', 'service', 'slot', 'prep'] as const) {
        const t = (p.tasks as any)[k];
        expect(t.candidates.v1.check.wape).toBeGreaterThan(0);
        if (t.use !== 'v1') expect(t.check.heldUp).toBe(true);
      }
      expect(Object.keys(p.tasks.day.candidates)).toEqual(expect.arrayContaining(['v1', 'v2', 'gbm', 'season', 'current']));
      expect(Object.keys(p.tasks.slot.candidates)).toEqual(['v1', 'old', 'gbm']);
      // Slot and prep beat the old rule on the half that played no part in choosing; service, across the group.
      for (const k of ['slot', 'prep'] as const) expect((p.tasks as any)[k].candidates.v1.check.wape).toBeLessThan((p.tasks as any)[k].candidates.old.check.wape);
      svc.v1 += (p.tasks as any).service.candidates.v1.check.wape; svc.old += (p.tasks as any).service.candidates.old.check.wape;
    }
    expect(svc.v1).toBeLessThan(svc.old);
  });
  it('reports busy, special and ordinary nights apart, with how often the night beat the range', () => {
    const n = (pickModels(seriesFromSample(ds.rooms.oakland)!) as any).tasks.nights.v1;
    expect(n.busy.n).toBeGreaterThan(20);
    expect(n.ordinary.n).toBeGreaterThan(n.busy.n);
    expect(n.special.n).toBeGreaterThan(0);
    for (const s of [n.busy, n.ordinary]) { expect(s.coverage).toBeGreaterThan(50); expect(s.aboveRange).toBeLessThan(30); }
  });
});

describe('Covercast on sold-out nights', () => {
  it('adds turned-away guests to demand, and takes a sellout with no count as a floor, not a quiet night', () => {
    const s = stressRoom({ hours: false });
    const [a, b] = [s.days.at(-30)!.iso, s.days.at(-23)!.iso];
    const ctx = dayContext(normalizeSignals({ capacity: [{ date: a, soldOut: true, turnedAway: 25 }, { date: b, soldOut: true }] }));
    const { D } = buildDays(s.days, 'covers', ctx);
    const at = (iso: string) => D.find((d) => d.iso === iso)!;
    expect(at(a).v).toBe(s.days.at(-30)!.covers + 25);
    expect(at(b)).toMatchObject({ censored: true, skip: true });
    expect(forecast(s, 'covers', { today: '2026-10-26', signals: { capacity: [{ date: b, soldOut: true }] } }).ready).toBe(true);
  });
});

describe('Covercast live: the rest of the shift from arrivals', () => {
  it('splits the rest into booked covers still to come and walk-ins at tonight’s pace', () => {
    const f = arrivalsForecast({ planSoFar: 40, planRest: 80, planTotal: 120, seated: 50, walkIns: 20, bookedBefore: 32, bookedRest: 40 });
    expect(f.parts.booked!.onBooks).toBe(40);
    expect(f.parts.booked!.showTonight).toBe(0.94);
    expect(f.parts.walkIns.pace).toBeGreaterThan(0);
    expect(f.remaining).toBe(f.parts.booked!.rest + f.parts.walkIns.rest);
    expect(f.measured).toBe(false);
    // With no books, the whole rest rides tonight's pace.
    const nb = arrivalsForecast({ planSoFar: 40, planRest: 80, planTotal: 120, seated: 50, walkIns: 20 });
    expect(nb.parts.booked).toBeNull();
    expect(nb.remaining).toBeGreaterThan(80);
  });
  it('starts from typical rates, labelled, and learns the room’s own as services are logged', () => {
    expect(learnArrivals([]).showRate).toMatchObject({ value: 0.9, source: 'starting' });
    const logs = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, service: 'dinner', booked: 60, final: { covers: 120, walkIns: 72, bookedSeated: 48 } }));
    const l = learnArrivals(logs);
    expect(l.showRate.source).toBe('learned');
    expect(l.showRate.value).toBeLessThan(0.85);
    expect(l.walkInShare.value).toBeGreaterThan(0.5);
  });
  it('isn’t validated until enough services are logged; then it’s scored against the plan and the pace', () => {
    expect(backtestArrivals([])).toMatchObject({ validated: false, need: MIN_LOGGED });
    // Test-only services where the books tell more than the pace does (not sample data).
    const logs = Array.from({ length: 40 }, (_, i) => {
      const booked = 40 + (i % 5) * 10, walk = 50 + ((i * 7) % 3) * 5, finalC = Math.round(booked * 0.88) + walk;
      return { date: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`, service: 'dinner', booked,
        cuts: [{ at: '19:00', seated: Math.round(booked * 0.4 * 0.88) + Math.round(walk * 0.4), walkIns: Math.round(walk * 0.4), bookedBefore: Math.round(booked * 0.4), bookedRest: booked - Math.round(booked * 0.4), planSoFar: 0.4 * 105, planRest: 0.6 * 105 }],
        final: { covers: finalC, walkIns: walk, bookedSeated: Math.round(booked * 0.88) } };
    });
    const r = backtestArrivals(logs);
    expect(r.validated).toBe(true);
    expect(r.arrivals!.wape).toBeLessThan(r.plan!.wape);
  });
});

describe('Covercast optimizes for the decision', () => {
  it('sizes to the point where a short hour and an idle hour cost the same', () => {
    expect(costPoint({ shortHour: 60, idleHour: 20 })).toBe(0.75);
    expect(costPoint({ shortHour: null, idleHour: 20 })).toBeNull();
    const cc = covercastRoom(ds.rooms.oakland, { decisions: { costs: { shortHour: 60 } } }) as any;
    const st = cc.decisions.staffing.dinner;
    expect(st).toMatchObject({ claim: 'Simulated', point: 0.75 });
    expect(st.covercast.cost).toBe(st.covercast.shortHours * 60 + st.covercast.idleHours * ds.rooms.oakland.levers.wage);
    expect(staffingCost(null, { shortHour: 60, idleHour: 18 })).toBeNull();
  });
  it('preps each dish to its own margin and food cost', () => {
    const [rich, thin] = (prepPlan as any)([{ item: 'Steak', forecast: 20, price: 40, cost: 10 }, { item: 'Soup', forecast: 20, price: 8, cost: 6 }]);
    expect(rich!.point).toBeGreaterThan(thin!.point);
    expect(rich!.prep).toBeGreaterThan(thin!.prep);
    const cc = covercastRoom(ds.rooms.berkeley) as any;
    expect(cc.prep.length).toBeGreaterThan(3);
    expect(cc.prep.every((p: any) => p.prep >= 1 && p.missesFrom === 'weeks')).toBe(true);
  });
  it('the pilot compares nights that followed Covercast with usual nights, only once each side has enough', () => {
    const e = (followed: boolean, waste: number, i: number) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, kind: 'prep' as const, followed, outcome: { waste, stockouts: followed ? 1 : 0 } });
    expect(pilotReport([e(true, 40, 0)]).prep.status).toBe('collecting');
    const all = [...Array.from({ length: 10 }, (_, i) => e(true, 40, i)), ...Array.from({ length: 10 }, (_, i) => e(false, 70, i + 10))];
    const r = pilotReport(all).prep;
    expect(r).toMatchObject({ status: 'ready', claim: 'Observed', difference: { wastePerService: -30, stockoutsPerService: 1 } });
  });
});
