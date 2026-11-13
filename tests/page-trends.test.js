import { describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { deriveRoom, deriveGroup, bankedStats, proofList } from '../lib/data/model.js';
import {
  CAUSES, JUDGE_WEEKS, METHOD, METRICS, MIN_BASELINE, RUN, availableMetrics, cleanNotes, describeSignal, directionOf, explainSignal,
  groupSeries, groupTrend, holidaysIn, isExplained, lastYearIndex, limitsOf, noteKey, rangesFor, signalKey, signalsOf, trendsCsv, trendsFor, windows,
} from '../lib/data/page/trends.js';

/**
 * Weekly rows from a list of net sales, everything else proportional.
 * `dated: false` leaves out dates, so no week is a holiday (the calendar
 * tests below use real dates on purpose).
 */
const rowsOf = (nets, { own = 0, dated = false, start = '2025-01-06' } = {}) => nets.map((net, i) => {
  const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 7 * 864e5);
  const iso = d.toISOString().slice(0, 10);
  return { i, iso: dated ? iso : undefined, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), net, covers: net == null ? null : Math.round(net / 30), food: net == null ? null : net * 0.3, labour: net == null ? null : net * 0.25, earned: net == null ? null : net * 0.45, wcm: 11, excPct: 3, ...(i >= nets.length - own ? { own: true } : {}) };
});
const wiggle = (n, base = 40000) => Array.from({ length: n }, (_, i) => base + [0, 900, -700, 400, -1000, 600, -300, 800][i % 8]);

describe('Trends: control limits use the right baseline', () => {
  it('judges the last 13 sample weeks against the 39 before them, never including a judged week in the baseline', () => {
    const t = trendsFor(deriveRoom(SEED, 'oakland').hist.rows);
    expect(t.w).toMatchObject({ from: 0, baseFrom: 0, baseTo: 39, judgeFrom: 39, ready: true, own: false });
    const nets = wiggle(52);
    nets[45] = 90000; // a huge judged week must not widen its own limits
    const a = trendsFor(rowsOf(nets)).metrics.net.lim, b = trendsFor(rowsOf(wiggle(52))).metrics.net.lim;
    expect(a).toEqual(b);
  });

  it('on own data, uses only the trailing own weeks, never the sample before them', () => {
    const w = windows(rowsOf(wiggle(52), { own: 13 }));
    expect(w).toMatchObject({ from: 39, trusted: 13, judgeFrom: 47 });
    expect(w.baseTo - w.baseFrom).toBe(MIN_BASELINE);
  });

  it('small samples: no limits, no signals and no direction until the baseline has enough weeks', () => {
    const t = trendsFor(rowsOf(wiggle(52), { own: 5 }));
    expect(t.w.ready).toBe(false);
    expect(t.w.needWeeks).toBe(MIN_BASELINE + 1 - 5);
    expect(t.signals).toEqual([]);
    expect(Object.values(t.metrics).every((m) => m.lim === null)).toBe(true);
    expect(directionOf(t).state).toBe('unknown');
  });

  it('a short baseline is marked limited and can never produce a "high" severity', () => {
    const nets = wiggle(20);
    nets[19] = 90000;
    const t = trendsFor(rowsOf(nets, { own: 20 }));
    expect(t.metrics.net.lim.limited).toBe(true);
    const s = t.signals.find((x) => x.metric === 'net');
    expect(s.z).toBeGreaterThan(4);
    expect(s.severity).toBe('info'); // good direction
    const low = wiggle(20); low[19] = 5000;
    expect(trendsFor(rowsOf(low, { own: 20 })).signals.find((x) => x.metric === 'net').severity).toBe('medium');
  });

  it('never claims a probability: signals carry a severity label and a size in σ, nothing else', () => {
    const t = trendsFor(deriveRoom(SEED, 'berkeley').hist.rows);
    for (const s of t.signals) {
      expect(['high', 'medium', 'low', 'info']).toContain(s.severity);
      expect(Object.keys(s).some((k) => /confidence|prob/i.test(k))).toBe(false);
    }
  });
});

describe('Trends: gaps, closures and holidays', () => {
  it('a missing or zero-sales week is a gap, never a zero and never a failure', () => {
    const nets = wiggle(52);
    nets[48] = 0;
    nets[49] = null;
    const t = trendsFor(rowsOf(nets));
    expect(t.metrics.net.vals[48]).toBe(null);
    expect(t.metrics.net.vals[49]).toBe(null);
    expect(t.metrics.prime.vals[48]).toBe(null);
    expect(t.closed[48]).toBe(true);
    expect(t.signals.filter((s) => s.from <= 49 && s.to >= 48)).toEqual([]);
  });

  it('labels a holiday only from the calendar', () => {
    expect(holidaysIn('2025-11-24')).toEqual(['Thanksgiving']);
    expect(holidaysIn('2025-12-22')).toEqual(['Christmas Eve', 'Christmas Day']);
    expect(holidaysIn('2025-12-29')).toEqual(['New Year’s Eve', 'New Year’s Day']);
    expect(holidaysIn('2025-10-13')).toEqual([]);
    expect(holidaysIn(undefined)).toEqual([]);
  });

  it('a holiday week is left out of the baseline and never flagged on its own', () => {
    // 52 weeks ending the week of Dec 22 2025: a Christmas spike in the judged weeks.
    const nets = wiggle(52);
    nets[51] = 70000;
    const t = trendsFor(rowsOf(nets, { dated: true, start: '2024-12-30' }));
    expect(t.rows[51].iso).toBe('2025-12-22');
    expect(t.holidays[51].length).toBeGreaterThan(0);
    expect(t.signals.filter((s) => s.metric === 'net')).toEqual([]);
    // the same spike on an ordinary week is flagged
    const plain = trendsFor(rowsOf(nets));
    expect(plain.signals.filter((s) => s.metric === 'net')).toHaveLength(1);
    // and a holiday week in the baseline doesn't move the limits
    const withSpike = wiggle(52); withSpike[0] = 90000; // Dec 30 2024: New Year
    expect(trendsFor(rowsOf(withSpike, { dated: true, start: '2024-12-30' })).metrics.net.lim).toEqual(trendsFor(rowsOf(wiggle(52), { dated: true, start: '2024-12-30' })).metrics.net.lim);
  });
});

describe('Trends: signals', () => {
  it('flags a week outside the limits as one episode, with its range, size, sample and severity', () => {
    const nets = wiggle(52);
    nets[50] = 20000;
    const t = trendsFor(rowsOf(nets));
    const s = t.signals.filter((x) => x.metric === 'net');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'limit', dir: 'down', from: 50, to: 50, good: false, ongoing: false, n: 39, severity: 'high' });
    expect(s[0].expected.lcl).toBeLessThan(s[0].expected.mean);
    const d = describeSignal(s[0], t.rows, t.metrics.net.lim);
    expect(d.title).toBe('Net sales low');
    expect(d.body).toContain('$20,000');
    expect(d.body).toContain('from 39 baseline weeks');
  });

  it(`flags ${RUN} weeks in a row above the mean as a shift, and keeps its first week as it grows`, () => {
    const nets = wiggle(52);
    nets[43] = 39000;
    for (let i = 44; i < 52; i++) nets[i] = 41500;
    const t = trendsFor(rowsOf(nets, { dated: true, start: '2024-04-22' }));
    expect(t.holidays.slice(43).every((h) => h.length === 0)).toBe(true);
    const s = t.signals.find((x) => x.metric === 'net');
    expect(s).toMatchObject({ kind: 'shift', dir: 'up', from: 44, to: 51, ongoing: true, good: true });
    const longer = trendsFor(rowsOf([...nets, 41500], { dated: true, start: '2024-04-22' }).slice(1));
    const s2 = longer.signals.find((x) => x.metric === 'net');
    expect(signalKey(s2, longer.rows)).toBe(signalKey(s, t.rows));
  });

  it('ignores a run that ended before the judged weeks', () => {
    const nets = wiggle(52);
    for (let i = 10; i < 20; i++) nets[i] = 41500;
    const rows = rowsOf(nets);
    expect(signalsOf('net', trendsFor(rows).metrics.net.vals, limitsOf(nets.slice(0, 39)), windows(rows))).toEqual([]);
  });

  it('reads the sample the way its story says: Berkeley’s margin per dish slides below its range, high severity', () => {
    const t = trendsFor(deriveRoom(SEED, 'berkeley').hist.rows);
    expect(t.signals[0]).toMatchObject({ metric: 'wcm', kind: 'limit', dir: 'down', ongoing: true, good: false, severity: 'high' });
  });

  it('says "within its usual range" rather than manufacture an alert', () => {
    const t = trendsFor(rowsOf(wiggle(52)));
    expect(t.signals).toEqual([]);
    expect(directionOf(t).state).toBe('steady');
  });

  it('a note explains a signal unless it says "still looking"', () => {
    expect(isExplained({ cause: 'change', text: '', at: '' })).toBe(true);
    expect(isExplained({ cause: 'looking', text: '', at: '' })).toBe(false);
    expect(isExplained(undefined)).toBe(false);
  });
});

describe('Trends: explanations never claim a cause', () => {
  it('splits arithmetic from possibilities, and says the cause is unknown', () => {
    for (const id of Object.keys(SEED.rooms)) {
      const d = deriveRoom(SEED, id);
      const t = trendsFor(d.hist.rows);
      for (const s of t.signals) {
        const e = explainSignal(s, t, { proofs: d.proofs, candidates: d.candidates });
        expect(e.known).toBe(false);
        for (const line of e.arithmetic) expect(line).not.toMatch(/because|caused|due to|driven by|led to/i);
        for (const line of e.possible) expect(line).toMatch(/^Possible:|can’t come from|Bring in/);
      }
    }
  });

  it('decomposes prime cost into food and labour points that add up', () => {
    const nets = wiggle(52);
    const rows = rowsOf(nets);
    rows.forEach((r, i) => { r.labour = r.net * (0.25 + ((i % 5) - 2) * 0.002); });
    for (let i = 44; i < 52; i++) rows[i].labour = rows[i].net * 0.3;
    const t = trendsFor(rows);
    const s = t.signals.find((x) => x.metric === 'prime');
    const e = explainSignal(s, t);
    expect(e.arithmetic[0]).toMatch(/food accounts for \+0\.0 pts and labour \+\d\.\d pts/);
  });

  it('links an existing finding on the same lever instead of creating one', () => {
    const d = deriveRoom(SEED, 'berkeley');
    const t = trendsFor(d.hist.rows);
    const e = explainSignal(t.signals[0], t, { proofs: d.proofs, candidates: d.candidates });
    expect(e.finding?.id).toBe('bk-mix');
    expect(d.candidates.map((c) => c.id)).toContain(e.finding.id);
  });

  it('leaves verified savings to the proof rules: reading trends changes no proof or banked figure', () => {
    const before = JSON.stringify(bankedStats(proofList(SEED)));
    for (const id of Object.keys(SEED.rooms)) { const d = deriveRoom(SEED, id); const t = trendsFor(d.hist.rows); t.signals.forEach((s) => explainSignal(s, t, { proofs: d.proofs, candidates: d.candidates })); }
    expect(JSON.stringify(bankedStats(proofList(SEED)))).toBe(before);
  });
});

describe('Trends: metrics and ranges follow the data', () => {
  it('offers only measures with data, and ranges no longer than the history', () => {
    const t = trendsFor(deriveRoom(SEED, 'oakland').hist.rows);
    expect(availableMetrics(t).map((m) => m.key)).not.toContain('ot');
    expect(availableMetrics(t).map((m) => m.key)).not.toContain('turn');
    expect(rangesFor(t).map((r) => r.v)).toEqual([4, 13, 26, 52]);
    const own = trendsFor(rowsOf(wiggle(52), { own: 10 }));
    expect(rangesFor(own).map((r) => r.v)).toEqual([4, 10]);
    expect(availableMetrics(own).map((m) => m.key)).not.toContain('wcm');
  });

  it('on own data, never reads the live week’s model food as a food-cost jump', () => {
    const rows = rowsOf(wiggle(30), { own: 30 });
    rows[29] = { ...rows[29], food: rows[29].net * 0.4, earned: rows[29].net * 0.35 };
    const t = trendsFor(rows);
    expect(t.metrics.food.available).toBe(false);
    expect(t.signals.filter((s) => s.metric === 'food' || s.metric === 'prime' || s.metric === 'earned')).toEqual([]);
    expect(t.metrics.prime.vals[29]).toBeCloseTo(55, 6);
    expect(rows[29].food).toBeCloseTo(rows[29].net * 0.4, 6); // the input rows are untouched
  });

  it('keeps own weeks honest: no sample margin-per-dish, food-driven figures are Modelled', () => {
    const t = trendsFor(rowsOf(wiggle(52), { own: 30 }));
    expect(t.metrics.wcm.vals.slice(-30).every((v) => v === null)).toBe(true);
    expect(t.metrics.prime.claim).toBe('mod');
    expect(t.metrics.earned.claim).toBe('mod');
    expect(t.metrics.net.claim).toBe('obs');
  });

});

describe('Trends: group', () => {
  const rooms = () => deriveGroup(SEED).rooms ?? Object.keys(SEED.rooms).map((id) => deriveRoom(SEED, id));

  it('adds sums and weights shares by sales (never averages them)', () => {
    const rs = rooms();
    const net = groupTrend(rs, 'net');
    const prime = groupTrend(rs, 'prime');
    const last = rs.map((d) => d.hist.rows.at(-1));
    expect(net.total.at(-1)).toBeCloseTo(last.reduce((s, r) => s + r.net, 0), 6);
    const weighted = (last.reduce((s, r) => s + r.food + r.labour, 0) / last.reduce((s, r) => s + r.net, 0)) * 100;
    const averaged = last.reduce((s, r) => s + ((r.food + r.labour) / r.net) * 100, 0) / last.length;
    expect(prime.total.at(-1)).toBeCloseTo(weighted, 9);
    expect(prime.total.at(-1)).not.toBeCloseTo(averaged, 9);
    expect(prime.weighted).toBe(true);
  });

  it('never adds sample rooms to real rooms, and leaves a week out when a room is missing it', () => {
    const rs = rooms();
    const realRows = rs[0].hist.rows.map((r, i) => (i >= 40 ? { ...r, own: true } : r));
    realRows[45] = { ...realRows[45], net: 0 };
    const mixed = [{ ...rs[0], hist: { rows: realRows } }, ...rs.slice(1)];
    const g = groupTrend(mixed, 'net');
    expect(g.inTotal).toEqual([rs[0].id]);
    expect(g.excluded.map((e) => e.id)).toEqual(rs.slice(1).map((d) => d.id));
    expect(g.isos).toHaveLength(12);
    expect(g.total[5]).toBe(null);
  });

  it('compares rooms per seat, for any rooms in the group', () => {
    const g = groupSeries(rooms());
    expect(g.map((r) => r.id)).toEqual(Object.keys(SEED.rooms));
    g.forEach((r) => expect(r.latest).toBeCloseTo(deriveRoom(SEED, r.id).hist.rows.at(-1).earned / r.seats, 6));
  });
});

describe('Trends: export and notes', () => {
  it('exports every week with window, holidays, signals, notes and method, CSV-safe', () => {
    const rows = deriveRoom(SEED, 'berkeley').hist.rows;
    const t = trendsFor(rows);
    const wcm = t.signals.find((x) => x.metric === 'wcm');
    const csv = trendsCsv(t, { [signalKey(wcm, rows)]: { cause: 'change', text: 'New menu, "lighter" mains', at: '2026-10-20' } }, 'Rosewood Berkeley');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(53);
    expect(lines[0].split(',').slice(0, 6)).toEqual(['room', 'week_start', 'week', 'source', 'window', 'holiday']);
    expect(lines[0]).toContain(METRICS.map((m) => m.key)[0]);
    expect(lines[1]).toContain(',baseline,');
    expect(lines[52]).toContain(',judged,');
    expect(lines[52]).toContain('wcm:limit-down');
    expect(lines[52].endsWith(METHOD)).toBe(true);
    expect(csv).toContain('Thanksgiving');
    expect(csv).toContain('"change: New menu, ""lighter"" mains"');
    expect(trendsCsv(t, {}, 'x', { header: false }).split('\n')[0]).not.toContain('week_start');
  });

  it('exports only a real restaurant’s own weeks', () => {
    const t = trendsFor(rowsOf(wiggle(52), { own: 20 }));
    expect(trendsCsv(t).trim().split('\n')).toHaveLength(21);
  });

  it('drops malformed notes from browser storage', () => {
    const ok = { cause: CAUSES[0].value, text: 'Private party', at: '2026-10-20T00:00:00Z' };
    expect(cleanNotes({ [noteKey('2026-10-19', 'net')]: ok, 'bad-key': ok, [noteKey('2026-10-19', 'covers')]: { cause: 'nope' } })).toEqual({ [noteKey('2026-10-19', 'net')]: ok });
    expect(cleanNotes(null)).toEqual({});
    expect(cleanNotes([])).toEqual({});
  });

  it('finds the nearest week a year back, within a week', () => {
    const rows = rowsOf(wiggle(60), { dated: true });
    expect(lastYearIndex(rows, 59)).toBe(7);
    expect(lastYearIndex(rows, 40)).toBe(null);
    expect(JUDGE_WEEKS).toBe(13);
  });
});
