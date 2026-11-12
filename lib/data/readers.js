/**
 * Weekly metric readers: what the daily proof loop records at each
 * checkpoint. Every lever has one metric, read as a weekly series from the
 * room's own data (the Toast export summary when loaded, else the sample), so
 * a test started on a lever can be measured week by week as new data lands.
 *
 * A series is [{ weekEnd: 'YYYY-MM-DD', value }], oldest first. weekEnd is the
 * last day of that week in the room's data, not the wall clock: a window is
 * measured in weeks of data, so a late upload never shortens it.
 *
 * Pure JS: the jobs on the server and the screens both call it.
 */

import { measuredServiceRate } from './levers.js';

const MS_DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const at = (d) => Date.parse(`${d}T00:00:00Z`);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const r2 = (n) => Math.round(n * 100) / 100;

/** The last day of the room's data. */
export function dataEnd(room, seedNow = '2026-10-27') {
  if (room.fromToast?.end) return room.fromToast.end;
  // Sample: the last full week ends the Sunday before "now".
  const now = at(seedNow);
  const dow = new Date(now).getUTCDay();
  return iso(now - (dow === 0 ? 7 : dow) * MS_DAY);
}

/** weekEnd for the i-th of n weekly values ending at `end` (oldest first). */
const weekEndOf = (end, i, n) => iso(at(end) - 7 * (n - 1 - i) * MS_DAY);

/** The lever each test measures, and the metric that reads it. */
export const LEVER_METRIC = {
  overtime: { metric: 'otMinutes', direction: 'down', unit: 'overtime min/wk', label: 'Overtime minutes a week' },
  labour: { metric: 'idleServerHours', direction: 'down', unit: 'server-h/wk', label: 'Server-hours above what covers needed' },
  void_comp: { metric: 'exceptionDollars', direction: 'down', unit: '$/wk', label: 'Voids, comps and discounts a week' },
  menu_margin: { metric: 'dishMargin', direction: 'up', unit: '$/wk', label: 'Weekly margin on the repriced dish' },
  mix: { metric: 'menuMargin', direction: 'up', unit: '$/wk', label: 'Weekly menu margin' },
  turns: { metric: 'turnMinutes', direction: 'down', unit: 'min/turn', label: 'Average dine-in turn' },
};

/**
 * @param {object} room an applied room (applyInputs(...).rooms[id])
 * @param {string} metric one of LEVER_METRIC's metrics, or net | covers | labour | avgCheck
 * @param {{ dish?: string, seedNow?: string }} [opts] dish key for dishMargin
 * @returns {{ weekEnd: string, value: number }[]}
 */
export function weeklySeries(room, metric, { dish, seedNow } = {}) {
  const end = dataEnd(room, seedNow);
  const L = room.levers || {};
  const fromHistory = (pick) => {
    const rows = room.history.filter((h) => pick(h) != null && Number.isFinite(pick(h)));
    return rows.map((h) => ({ weekEnd: iso(at(h.iso) + 6 * MS_DAY), value: r2(pick(h)) }));
  };
  switch (metric) {
    case 'net': return fromHistory((h) => h.net);
    case 'covers': return fromHistory((h) => h.covers);
    case 'labour': return fromHistory((h) => h.labour);
    case 'avgCheck': return fromHistory((h) => (h.covers ? h.net / h.covers : null));
    case 'turnMinutes': {
      const own = fromHistory((h) => h.turn);
      if (own.length) return own;
      // Sample: the four weeks of turns, as one reading per week.
      const t = L.turns || [];
      if (!t.length) return [];
      const per = Math.ceil(t.length / 4);
      return [0, 1, 2, 3].map((w) => t.slice(w * per, (w + 1) * per)).filter((c) => c.length).map((c, i, all) => ({ weekEnd: weekEndOf(end, i, all.length), value: r2(sum(c.map((x) => x.min)) / c.length) }));
    }
    case 'otMinutes': {
      const own = fromHistory((h) => h.otMin);
      if (own.length) return own;
      const g = Object.values(L.ot || {});
      if (!g.length) return [];
      return g[0].map((_, i) => ({ weekEnd: weekEndOf(end, i, g[0].length), value: sum(g.map((arr) => arr[i] || 0)) }));
    }
    case 'idleServerHours': {
      const hours = L.serviceHours || [];
      const rate = measuredServiceRate(hours)?.coversPerServerHour;
      if (!rate) return [];
      const weeks = [...new Set(hours.map((h) => h.week))].sort((a, b) => a - b);
      return weeks.map((w, i) => ({
        weekEnd: weekEndOf(end, i, weeks.length),
        value: r2(sum(hours.filter((h) => h.week === w && h.servers != null).map((h) => Math.max(0, h.servers - Math.max(1, Math.ceil(h.covers / rate)))))),
      }));
    }
    case 'exceptionDollars': {
      const v = L.voidWeeks || [];
      const weeks = [...new Set(v.map((r) => r.week))].sort((a, b) => a - b);
      return weeks.map((w, i) => ({ weekEnd: weekEndOf(end, i, weeks.length), value: r2(sum(v.filter((r) => r.week === w).map((r) => r.exceptions))) }));
    }
    case 'dishMargin': {
      const m = room.menu.find((x) => x.key === dish);
      const ph = m && L.priceHistory?.[dish];
      if (!ph) return [];
      return ph.map((p, i) => ({ weekEnd: weekEndOf(end, i, ph.length), value: r2((p.price - m.cost) * p.units) }));
    }
    case 'menuMargin': {
      const items = room.menu.filter((m) => L.priceHistory?.[m.key]);
      if (!items.length) return [];
      const n = Math.min(...items.map((m) => L.priceHistory[m.key].length));
      return Array.from({ length: n }, (_, i) => ({
        weekEnd: weekEndOf(end, i, n),
        value: r2(sum(items.map((m) => { const p = L.priceHistory[m.key][L.priceHistory[m.key].length - n + i]; return (p.price - m.cost) * p.units; }))),
      }));
    }
    default: return [];
  }
}

/** Mean of the `n` weeks ending on or before `weekEnd`: a test's frozen baseline.
 * @param {{ weekEnd: string, value: number }[]} series @param {string} weekEnd @param {number} [n] */
export function baselineOf(series, weekEnd, n = 4) {
  const prior = series.filter((p) => p.weekEnd <= weekEnd).slice(-n);
  return prior.length ? r2(sum(prior.map((p) => p.value)) / prior.length) : null;
}

/**
 * Checkpoints due for a test started at `startedAt` (a weekEnd): day 7k reads
 * the week ending startedAt + 7k days, when the data has it.
 */
export function dueCheckpoints(series, startedAt, windowDays = 28, every = 7) {
  const out = [];
  for (let day = every; day <= windowDays; day += every) {
    const want = iso(at(startedAt) + day * MS_DAY);
    const p = series.find((x) => x.weekEnd === want);
    if (p) out.push({ day, weekEnd: want, observed: p.value });
  }
  return out;
}

/** Days of data since a test started (what the window has watched). */
export function dataDay(room, startedAt, seedNow) {
  return Math.max(0, Math.round((at(dataEnd(room, seedNow)) - at(startedAt)) / MS_DAY));
}
