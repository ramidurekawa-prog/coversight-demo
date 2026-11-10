import { describe, expect, it, test } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import {
  controlDeltaFrom,
  findingConfidence,
  fitElasticity,
  leverReport,
  measuredFillPct,
  measuredServiceRate,
  minimumDetectableEffect,
} from '../lib/data/levers.js';

describe('the methods (ported from the platform, same answers)', () => {
  it('confidence reads against the tiers', () => {
    const base = { periods: 4, observations: 100, observationsNeeded: 100 };
    expect(findingConfidence({ ...base, periodsHeld: 4 }).confidence).toBe(100);
    expect(findingConfidence({ ...base, periodsHeld: 3 }).confidence).toBe(85);
    expect(findingConfidence({ ...base, periodsHeld: 2 }).confidence).toBe(70);
    expect(findingConfidence({ ...base, periodsHeld: 4, observations: 25 }).confidence).toBe(50);
    expect(findingConfidence({ ...base, periodsHeld: 4, estimatedShare: 1 }).confidence).toBe(60);
  });

  it('MDE follows (t95 + t80) × σ/√n', () => {
    const m = minimumDetectableEffect({ baselineSamples: [10, 12, 8, 10] });
    expect(m.mdeUnits).toBeCloseTo(((2.353 + 0.978) * Math.sqrt(8 / 3)) / 2, 6);
    expect(minimumDetectableEffect({ baselineSamples: [5] })).toBeNull();
  });

  it('controls scale to the treated baseline', () => {
    expect(controlDeltaFrom(25, 20, 16)).toBe(-5);
    expect(controlDeltaFrom(25, 0, 16)).toBeNull();
  });

  it('service rate comes from the busy hours', () => {
    const hrs = [...Array(20).fill({ covers: 20, servers: 5 }), ...Array(20).fill({ covers: 60, servers: 5 })];
    expect(measuredServiceRate(hrs).coversPerServerHour).toBe(12);
    expect(measuredServiceRate(hrs.slice(0, 19))).toBeNull();
  });

  it('elasticity is fitted from price changes, and needs two', () => {
    const pts = [2000, 2000, 1900, 1900, 2000, 2000, 1900, 2000].map((price) => ({ price, units: Math.round(200 * Math.pow(price / 2000, -1)) }));
    expect(fitElasticity(pts).e).toBeCloseTo(-1, 1);
    expect(fitElasticity(pts.map((p) => ({ ...p, price: 2000 }))).ok).toBe(false);
  });

  it('fill is the share of fast reseats, on at least 20 departures', () => {
    expect(measuredFillPct([...Array(15).fill(2), ...Array(5).fill(40), ...Array(5).fill(null)])).toBe(15 / 25);
    expect(measuredFillPct(Array(19).fill(0))).toBeNull();
  });
});

describe('the sample rooms', () => {
  const rooms = ['oakland', 'berkeley', 'walnut'];

  test('every room reports all six levers, every figure finite', () => {
    for (const id of rooms) {
      const r = leverReport(SEED.rooms[id]);
      expect(r.map((l) => l.key)).toEqual(['overtime', 'labour', 'void_comp', 'menu_margin', 'mix', 'turns']);
      for (const l of r) expect(Number.isFinite(l.weekly), `${id} ${l.key}`).toBe(true);
    }
  });

  test('no lever prices off a typed rate: labour uses each room’s own measured pace', () => {
    for (const id of rooms) {
      const lab = leverReport(SEED.rooms[id]).find((l) => l.key === 'labour');
      expect(lab.measured).toBe(true);
      expect(lab.rate).not.toBe(14);
      expect(lab.method).toMatch(/this room’s pace/);
    }
  });

  test('voids: one hot server in Oakland, the whole room in Berkeley, nothing in Walnut Creek', () => {
    const v = (id) => leverReport(SEED.rooms[id]).find((l) => l.key === 'void_comp');
    expect(v('oakland').scope).toBe('Kayla P.');
    expect(v('berkeley').scope).toBe('Whole room');
    expect(v('berkeley').controls).toBe(false);
    expect(v('walnut').grade).toBe('Clear');
  });

  test('the mix lever never claims a control (the whole menu moves together)', () => {
    for (const id of rooms) expect(leverReport(SEED.rooms[id]).find((l) => l.key === 'mix').bars.controls).toBe(false);
  });

  /* Pinned: each room's lever grades. If one moves, change it deliberately. */
  test('grades', () => {
    expect(rooms.map((id) => leverReport(SEED.rooms[id]).map((l) => l.grade).join(' '))).toMatchInlineSnapshot(`
      [
        "A A A− A B A",
        "B A A− A− Clear A",
        "A A Clear A− Clear A",
      ]
    `);
  });
});
