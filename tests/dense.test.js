import { describe, expect, it } from 'vitest';

import { byMonth, densify, heat, HOURLY_WEEKS, pointCount, split } from '../lib/data/dense.js';
import { applyInputs } from '../lib/data/apply.js';
import { SEED } from '../lib/data/seed.js';

const close = (a, b) => expect(Math.abs(a - b)).toBeLessThan(0.011);

describe('split', () => {
  it('always adds back to the total', () => {
    expect(split(100, [1, 1, 1]).reduce((s, x) => s + x, 0)).toBe(100);
    close(split(1234.57, [3, 1, 7, 2], 0.01).reduce((s, x) => s + x, 0), 1234.57);
  });
});

describe('dense sample detail', () => {
  for (const id of Object.keys(SEED.rooms)) {
    const room = SEED.rooms[id];
    const d = densify(room);

    it(`${id}: thousands of points, two years of days, 13 weeks of hours`, () => {
      expect(d.days).toHaveLength(52 * 7 * 2);
      expect(d.hours).toHaveLength(HOURLY_WEEKS * 7 * 12);
      expect(d.items).toHaveLength(room.menu.length);
      expect(pointCount(d)).toBeGreaterThan(10_000);
    });

    it(`${id}: every week's days add up exactly to its history row`, () => {
      for (const w of room.history) {
        const days = d.days.filter((x) => !x.prior && x.week === w.iso);
        expect(days).toHaveLength(7);
        close(days.reduce((s, x) => s + x.net, 0), w.net);
        close(days.reduce((s, x) => s + x.food, 0), w.food);
        close(days.reduce((s, x) => s + x.labour, 0), w.labour);
        expect(days.reduce((s, x) => s + x.covers, 0)).toBe(w.covers);
      }
    });

    it(`${id}: every day's hours add up exactly to the day`, () => {
      const lastDays = d.days.slice(-HOURLY_WEEKS * 7);
      for (const day of lastDays) {
        const hrs = d.hours.filter((h) => h.iso === day.iso);
        expect(hrs.reduce((s, h) => s + h.covers, 0)).toBe(day.covers);
        close(hrs.reduce((s, h) => s + h.sales, 0), day.net);
      }
    });

    it(`${id}: channels add up to each day's sales`, () => {
      for (const day of d.days.slice(0, 50)) close(Object.values(day.channels).reduce((s, x) => s + x, 0), day.net);
    });
  }

  it('is the same every time (seeded), and different per room', () => {
    const a = densify({ ...SEED.rooms.oakland });
    const b = densify({ ...SEED.rooms.oakland });
    expect(a.days[100]).toEqual(b.days[100]);
    expect(densify(SEED.rooms.berkeley).days[100].net).not.toBe(a.days[100].net);
  });

  it('months roll up from days; the heat grid covers every weekday and hour', () => {
    const d = densify(SEED.rooms.walnut);
    const months = byMonth(d.days);
    close(months.reduce((s, m) => s + m.net, 0), d.days.reduce((s, x) => s + x.net, 0));
    expect(months.length).toBeGreaterThanOrEqual(24);
    const h = heat(d.hours);
    expect(h).toHaveLength(7);
    expect(h.every((r) => r.cells.length === 12)).toBe(true);
  });

  it('invents nothing for a room on its own Toast data', () => {
    const ds = applyInputs(SEED, {});
    expect(densify({ ...ds.rooms.oakland, fromToast: { end: '2026-10-24', weeks: 13 } })).toBeNull();
  });
});
