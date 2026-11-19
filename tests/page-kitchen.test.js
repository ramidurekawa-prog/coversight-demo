import { describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';
import { readToastExports } from '../lib/data/toast.js';
import {
  BUSY_HOURS, cellsOf, hourLabel, hourRange, histOver, histQuantile, kitchenData, kitchenPage, rushPoint, trialResult, TRIAL_NIGHTS,
} from '../lib/data/page/kitchen.js';
import { kitchenSchemas } from '../server/page/kitchen';
import { toastSummary } from '../server/toast-schema';
import { toastFixture } from './helpers/toast-fixture.js';

const page = (id, opts = {}) => {
  const d = deriveRoom(SEED, id);
  return { d, p: kitchenPage(d.room, { proofs: d.proofs, roomId: id, feed: d.feeds.find((f) => f.name === 'Kitchen display'), ...opts }) };
};

/** Lever Check's Kitchen speed card (lib/data/page/summary.js, PR 78), restated: the page must say the same. */
function leverCard(t) {
  const hours = [...t.fri, ...t.sat].filter((v) => v != null);
  const peak = Math.max(...t.sat.filter((v) => v != null));
  return { peak, onTime: hours.filter((v) => v <= t.target).length, of: hours.length, status: peak > t.target + 3 ? 'watch' : 'good', station: t.stations[0]?.[0] };
}

describe('Kitchen speed on the sample', () => {
  it('leads with the Lever Check card’s figure and status, in every room', () => {
    for (const id of ['oakland', 'berkeley', 'walnut']) {
      const { d, p } = page(id);
      const card = leverCard(d.room.tickets);
      expect(p.peak, id).toBe(card.peak);
      expect(p.onTime, id).toBe(card.onTime);
      expect(p.busyHours, id).toBe(card.of);
      expect(p.status, id).toBe(card.status);
      if (p.broken) expect(p.jam.name, id).toBe(card.station);
    }
  });

  it('Oakland: Saturday 8 pm at 19.6 minutes, the grill, and one trial', () => {
    const { p } = page('oakland');
    expect(p.headline).toBe('Saturday 8 pm is your slowest hour');
    expect(p.peak).toBe(19.6);
    expect(p.onTime).toBe(7);
    expect(p.jam).toMatchObject({ name: 'Grill', share: 58 });
    expect(p.move.title).toBe('Take load off the grill, Friday and Saturday 7 to 9 pm');
    expect(p.move.aims).toBe('5 of 12 busy hours run late, the worst at 19.6 min.');
    expect(p.move.id).toMatch(/^[\w:.-]+$/);
    expect(p.move.task.system).toBe('Kitchen display');
  });

  it('if it ain’t broke: a room Lever Check marks good gets no trial', () => {
    const { p } = page('walnut');
    expect(p.status).toBe('good');
    expect(p.broken).toBe(false);
    expect(p.move).toBeNull();
    expect(p.headline).toBe('The kitchen is keeping up');
  });

  it('the chart, the grid and the card read one table: Friday and Saturday dinner equal the seed’s curve', () => {
    for (const id of ['oakland', 'berkeley', 'walnut']) {
      const d = deriveRoom(SEED, id);
      const K = kitchenData(d.room);
      expect(K.source).toBe('sample');
      const cells = cellsOf(K);
      BUSY_HOURS.forEach((h, i) => {
        expect(cells.find((c) => c.dow === 'Fri' && c.hour === h).min, `${id} Fri ${h}`).toBeCloseTo(d.room.tickets.fri[i], 1);
        expect(cells.find((c) => c.dow === 'Sat' && c.hour === h).min, `${id} Sat ${h}`).toBeCloseTo(d.room.tickets.sat[i], 1);
      });
      const p = kitchenPage(d.room, { roomId: id });
      expect(p.days.Sat.filter((h) => BUSY_HOURS.includes(h.hour)).map((h) => h.min)).toEqual(d.room.tickets.sat);
    }
  });

  it('finds a Rush Point from the room’s own hours and says how often it holds', () => {
    const { p } = page('oakland');
    expect(p.rush).not.toBeNull();
    expect(p.rush.held).toBe(false);
    expect(p.rush.right / p.rush.of).toBeGreaterThan(0.8);
  });

  it('shows Berkeley’s paused kitchen test from the proof record', () => {
    const { p } = page('berkeley');
    expect(p.past).toEqual([expect.objectContaining({ id: 'bk-tickets', state: 'paused' })]);
    expect(p.feed.state).toBe('stale');
  });
});

describe('Rush Point', () => {
  const cell = (orders, min) => ({ dow: 'Sat', hour: 0, orders, min, nights: 1 });
  it('splits at the busiest on-time load', () => {
    const cells = [cell(4, 10), cell(6, 11), cell(8, 12), cell(10, 13), cell(12, 16), cell(14, 18), cell(16, 20)];
    expect(rushPoint(cells, 14)).toEqual({ limit: 10, right: 7, of: 7, held: false });
  });
  it('says the line held when nothing ran late, and needs enough hours', () => {
    expect(rushPoint([cell(4, 10), cell(6, 11), cell(8, 12), cell(10, 13), cell(12, 13), cell(14, 13)], 14)).toMatchObject({ limit: 14, held: true });
    expect(rushPoint([cell(4, 10), cell(16, 20)], 14)).toBeNull();
  });
});

describe('Line Trials', () => {
  const night = (iso, min) => ({ iso, dow: new Date(`${iso}T12:00:00Z`).getUTCDay() === 6 ? 'Sat' : 'Fri', hours: { 19: { n: 30, min }, 20: { n: 30, min } } });
  const K = { nights: [night('2026-10-02', 19), night('2026-10-03', 20), night('2026-10-09', 19), night('2026-10-10', 20), night('2026-10-16', 16), night('2026-10-17', 16)] };
  const tr = { id: 't', days: ['Fri', 'Sat'], from: 19, to: 20, start: '2026-10-16', status: 'running' };

  it('compares the nights since the start with the same nights and hours before', () => {
    expect(trialResult(K, tr)).toEqual({ state: 'better', before: 19.5, after: 16, nightsIn: 2, change: -3.5 });
  });
  it('keeps measuring until enough nights are in', () => {
    const r = trialResult({ nights: K.nights.slice(0, 5) }, tr);
    expect(r.state).toBe('measuring');
    expect(r.nightsIn).toBe(1);
    expect(TRIAL_NIGHTS).toBe(2);
  });
  it('a trial started on the page is measured on the page', () => {
    const { p } = page('oakland', { trials: [{ id: 'x', title: 'Try', station: 'Grill', days: ['Fri', 'Sat'], from: 19, to: 20, start: '2030-01-04', status: 'running', at: '' }] });
    expect(p.active.id).toBe('x');
    expect(p.active.result.state).toBe('measuring');
  });
});

describe('Hand entry', () => {
  it('nights logged after the feed’s last night join the table, marked hand-entered', () => {
    const d = deriveRoom(SEED, 'oakland');
    const base = kitchenData(d.room);
    const logs = { '2030-01-05': { hours: { 19: 15, 20: 16 }, slow: 'Grill', at: '' }, '2026-01-03': { hours: { 19: 30 }, at: '' } };
    const K = kitchenData(d.room, { logs });
    expect(K.logged).toBe(1);
    expect(K.nights.at(-1)).toMatchObject({ iso: '2030-01-05', dow: 'Sat', hand: true });
    expect(K.nights).toHaveLength(base.nights.length + 1);
    // Logged nights have no order counts, so the hour averages and the Rush Point don't move.
    expect(cellsOf(K)).toEqual(cellsOf(base));
  });

  it('the server keeps a log and a trial in bounds', () => {
    expect(kitchenSchemas.log.safeParse({ '2026-11-14': { hours: { 19: 18.5 }, slow: 'Grill', at: 'x' } }).success).toBe(true);
    expect(kitchenSchemas.log.safeParse({ '2026-11-14': { hours: {}, at: 'x' } }).success).toBe(false);
    expect(kitchenSchemas.log.safeParse({ '2026-11-14': { hours: { 19: 500 }, at: 'x' } }).success).toBe(false);
    const trial = { id: 'kitchen:oakland:grill:frisat:19-20', title: 'T', station: 'Grill', days: ['Fri', 'Sat'], from: 19, to: 20, start: '2026-11-20', status: 'running', at: 'x' };
    expect(kitchenSchemas.trials.safeParse([trial]).success).toBe(true);
    expect(kitchenSchemas.trials.safeParse([{ ...trial, from: 21 }]).success).toBe(false);
    expect(kitchenSchemas.trials.safeParse([{ ...trial, days: ['Funday'] }]).success).toBe(false);
  });
});

describe('Kitchen speed from a Toast export', () => {
  const { unknown: _u, ...summary } = readToastExports(Object.entries(toastFixture()).map(([name, text]) => ({ name, text })));

  it('keeps ticket times by night and hour, and histograms by station, inside the server’s bounds', () => {
    const t = summary.toast.tickets;
    expect(t.nights.length).toBeGreaterThan(20);
    expect(t.byStation.map((x) => x.name)).toContain('Grill');
    expect(Object.keys(t.hist).length).toBeGreaterThan(0);
    expect(toastSummary.safeParse(summary).success).toBe(true);
    expect(toastSummary.parse(summary).toast.tickets.nights).toHaveLength(t.nights.length);
  });

  it('the page reads the Toast room: late-ticket shares by station, the spread, and the card’s figure', () => {
    const ds = applyInputs(SEED, { oakland: { toast: { rows: [summary] } } });
    const d = deriveRoom(ds, 'oakland');
    const p = kitchenPage(d.room, { roomId: 'oakland' });
    expect(p.source).toBe('toast');
    expect(p.stationMeaning).toBe('late');
    expect(p.stations.reduce((a, s) => a + s.share, 0)).toBeGreaterThanOrEqual(98);
    expect(p.spread?.p90).toBeGreaterThan(0);
    expect(p.peak).toBe(leverCard(d.room.tickets).peak);
    // Hour averages from the nights equal Toast's own Friday and Saturday dinner averages.
    const cells = cellsOf(kitchenData(d.room));
    BUSY_HOURS.forEach((h, i) => {
      const want = d.room.tickets.sat[i];
      const c = cells.find((x) => x.dow === 'Sat' && x.hour === h);
      if (want != null) expect(c?.min, `Sat ${h}`).toBeCloseTo(want, 1);
    });
  });
});

describe('helpers', () => {
  it('words hours and spreads', () => {
    expect(hourLabel(19)).toBe('7 pm');
    expect(hourLabel(11)).toBe('11 am');
    expect(hourRange(19, 20)).toBe('7 to 9 pm');
    expect(hourRange(11, 12)).toBe('11 am to 1 pm');
    const h = [0, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(histQuantile(h, 0.9)).toBe(15);
    expect(histOver(h, 14)).toBe(0.5);
  });
});
