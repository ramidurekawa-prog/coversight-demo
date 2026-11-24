import { describe, expect, it } from 'vitest';

import { fiscalWeek, periodOf, periodPnl, pnlCsv } from '../lib/data/periods.js';

const week = (iso, net = 1000) => ({ iso, label: iso, net, food: net * 0.3, labour: net * 0.28, earned: net * 0.42, covers: 40 });

describe('accounting periods', () => {
  it('numbers weeks from the week that holds January 1', () => {
    expect(fiscalWeek('2025-12-29')).toEqual({ year: 2026, week: 1 });
    expect(fiscalWeek('2026-10-19')).toEqual({ year: 2026, week: 43 });
    expect(fiscalWeek('2026-12-28')).toEqual({ year: 2027, week: 1 });
    expect(fiscalWeek('2023-12-25')).toEqual({ year: 2023, week: 53 });
  });

  it('groups weeks 4-4-5, 4-5-4 and 5-4-4, and puts a 53rd week in period 12', () => {
    const at = (w) => new Date(Date.parse('2025-12-29T00:00:00Z') + (w - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
    expect([4, 5, 8, 9, 13, 14].map((w) => periodOf(at(w), '445').n)).toEqual([1, 2, 2, 3, 3, 4]);
    expect([4, 5, 9, 10, 13].map((w) => periodOf(at(w), '454').n)).toEqual([1, 2, 2, 3, 3]);
    expect([5, 6, 9, 10, 13].map((w) => periodOf(at(w), '544').n)).toEqual([1, 2, 2, 3, 3]);
    expect(periodOf('2023-12-25', '445').id).toBe('2023-P12');
    expect(periodOf('2026-09-28').id).toBe('2026-10'); // a week belongs to the month it ends in
  });

  it('sums the rows it is given and nothing else', () => {
    const rows = ['2025-12-29', '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((d, i) => week(d, 1000 + i * 100));
    const p = periodPnl(rows, '445');
    expect(p.map((x) => [x.id, x.weeks.length, x.complete])).toEqual([['2026-P01', 4, true], ['2026-P02', 1, false]]);
    expect(p[0].net).toBe(1000 + 1100 + 1200 + 1300);
    expect(p[0].prime).toBeCloseTo(0.58, 10);
    expect(p.reduce((t, x) => t + x.net, 0)).toBe(rows.reduce((t, r) => t + r.net, 0));
    const csv = pnlCsv(p, { room: 'Rosewood, Oakland' }).split('\n');
    expect(csv).toHaveLength(1 + 5 + 2);
    expect(csv[1].startsWith('"Rosewood, Oakland","Period 1, 2026",2025-12-29,1000,300,280,580,30.0,28.0,58.0,420')).toBe(true);
  });
});
