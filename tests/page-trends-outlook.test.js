import { describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { deriveRoom } from '../lib/data/model.js';
import { covercastRoom, seriesFromSample } from '../lib/data/forecast/index.js';
import { leaksOf, trendsFor } from '../lib/data/page/trends.js';
import { driftClockOf, outlookOf, recentKeep, weekShapeOf } from '../lib/data/page/trends-outlook.js';

const room = (id) => { const d = deriveRoom(SEED, id); return { d, t: trendsFor(d.hist.rows) }; };

describe('Trends outlook: Covercast Outlook', () => {
  it('contribution ahead is Covercast sales × the recent kept share, range carried through, Modeled', () => {
    const { d, t } = room('berkeley');
    const cc = covercastRoom(d.room, { days: 28, accuracy: false });
    const O = outlookOf(t, cc);
    const k = recentKeep(t);
    expect(O.weeks).toHaveLength(cc.sales.weeks.length);
    O.weeks.forEach((w, i) => {
      const s = cc.sales.weeks[i];
      expect(w.earned.value).toBeCloseTo(s.value * k.keep, 6);
      expect(w.earned.low).toBeLessThanOrEqual(w.earned.value);
      expect(w.earned.high).toBeGreaterThanOrEqual(w.earned.value);
    });
    expect(O.weeks[0].start > t.rows.at(-1).iso).toBe(true); // only weeks after the data
    expect(O.claim).toBe('mod');
  });

  it('no Covercast, no outlook', () => {
    const { t } = room('oakland');
    expect(outlookOf(t, null)).toBeNull();
    expect(outlookOf(t, { sales: { weeks: [] } })).toBeNull();
  });
});

describe('Trends outlook: Week Shape', () => {
  it('Monday first, holidays left out, and a day is only "changed" past twice its standard error', () => {
    const { d } = room('walnut');
    const W = weekShapeOf(seriesFromSample(d.room));
    expect(W.rows.map((r) => r.short)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    for (const r of W.rows) expect(r.n[0]).toBeLessThanOrEqual(13);
    if (W.up) expect(W.up.sure && W.up.pct > 0).toBe(true);
    if (W.down) expect(W.down.sure && W.down.pct < 0).toBe(true);
  });

  it('a flat week has no changed day', () => {
    const days = Array.from({ length: 26 * 7 }, (_, i) => ({ iso: new Date(Date.UTC(2025, 0, 6) + i * 864e5).toISOString().slice(0, 10), covers: 100 + ((i * 7) % 5) }));
    const W = weekShapeOf({ days });
    expect(W.up).toBeNull();
    expect(W.down).toBeNull();
  });

  it('one weekday 30% busier shows as that day, up', () => {
    const days = Array.from({ length: 26 * 7 }, (_, i) => {
      const iso = new Date(Date.UTC(2025, 1, 3) + i * 864e5).toISOString().slice(0, 10);
      const fri = new Date(`${iso}T12:00:00Z`).getUTCDay() === 5;
      return { iso, covers: (fri && i >= 13 * 7 ? 130 : 100) + (i % 3) };
    });
    const W = weekShapeOf({ days });
    expect(W.up?.name).toBe('Friday');
  });
});

describe('Trends outlook: Drift Clock', () => {
  it('an ongoing leak costs about its weekly figure × the forecast weeks; ended changes have no clock', () => {
    const { d, t } = room('berkeley');
    const O = outlookOf(t, covercastRoom(d.room, { days: 28, accuracy: false }));
    const L = leaksOf(t, { dishes: d.menu.units });
    const wcm = L.leaks.find((e) => e.s.metric === 'wcm');
    const c = driftClockOf(wcm, O);
    expect(c.weeks).toBe(O.weeks.length);
    expect(c.value).toBeLessThan(0);
    expect(Math.abs(c.value)).toBeGreaterThan(Math.abs(wcm.$.perWeek) * O.weeks.length * 0.8);
    expect(Math.abs(c.value)).toBeLessThan(Math.abs(wcm.$.perWeek) * O.weeks.length * 1.2);
    expect(driftClockOf({ ...wcm, s: { ...wcm.s, ongoing: false } }, O)).toBeNull();
  });
});
