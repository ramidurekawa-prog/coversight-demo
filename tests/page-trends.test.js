import { describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { deriveRoom, deriveGroup } from '../lib/data/model.js';
import { CAUSES, JUDGE_WEEKS, METRICS, MIN_BASELINE, RUN, cleanNotes, describeSignal, groupSeries, isExplained, lastYearIndex, limitsOf, noteKey, signalKey, signalsOf, trendsCsv, trendsFor, windows } from '../lib/data/page/trends.js';

/** Weekly rows from a list of net sales, with everything else steady. */
const rowsOf = (nets, { own = 0 } = {}) => nets.map((net, i) => {
  const d = new Date(Date.parse('2025-01-06T00:00:00Z') + i * 7 * 864e5);
  return { i, iso: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), year: d.getUTCFullYear(), net, covers: Math.round(net / 30), food: net * 0.3, labour: net * 0.25, earned: net * 0.45, wcm: 11, excPct: 3, ...(i >= nets.length - own ? { own: true } : {}) };
});
const wiggle = (n, base = 40000) => Array.from({ length: n }, (_, i) => base + [0, 900, -700, 400, -1000, 600, -300, 800][i % 8]);

describe('Trends: windows', () => {
  it('judges the last 13 sample weeks against the 39 before them', () => {
    const w = windows(deriveRoom(SEED, 'oakland').hist.rows);
    expect(w).toMatchObject({ from: 0, baseFrom: 0, baseTo: 39, judgeFrom: 39, ready: true, own: false });
  });

  it('on own data, uses only the trailing own weeks, never the sample before them', () => {
    const w = windows(rowsOf(wiggle(52), { own: 13 }));
    expect(w.from).toBe(39);
    expect(w.trusted).toBe(13);
    expect(w.baseTo - w.baseFrom).toBe(MIN_BASELINE);
    expect(w.judgeFrom).toBe(47);
  });

  it('waits for enough own weeks before judging anything, and says how many', () => {
    const w = windows(rowsOf(wiggle(52), { own: 5 }));
    expect(w.ready).toBe(false);
    expect(w.needWeeks).toBe(MIN_BASELINE + 1 - 5);
    const t = trendsFor(rowsOf(wiggle(52), { own: 5 }));
    expect(t.signals).toEqual([]);
    expect(Object.values(t.metrics).every((m) => m.lim === null)).toBe(true);
  });

  it('keeps own weeks honest: no sample margin-per-dish, food-driven figures are Modelled', () => {
    const t = trendsFor(rowsOf(wiggle(52), { own: 30 }));
    expect(t.metrics.wcm.vals.slice(-30).every((v) => v === null)).toBe(true);
    expect(t.metrics.prime.claim).toBe('mod');
    expect(t.metrics.earned.claim).toBe('mod');
    expect(t.metrics.net.claim).toBe('obs');
  });
});

describe('Trends: signals', () => {
  it('flags a week outside the limits as one episode, in the right direction', () => {
    const nets = wiggle(52);
    nets[50] = 20000;
    const t = trendsFor(rowsOf(nets));
    const s = t.signals.filter((x) => x.metric === 'net');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'limit', dir: 'down', from: 50, to: 50, good: false, ongoing: false });
    const d = describeSignal(s[0], t.rows, t.metrics.net.lim);
    expect(d.title).toBe('Net sales low');
    expect(d.body).toContain('$20,000');
  });

  it(`flags ${RUN} weeks in a row above the mean as a shift, and keeps its first week as it grows`, () => {
    const nets = wiggle(52);
    nets[43] = 39000;
    for (let i = 44; i < 52; i++) nets[i] = 41500;
    const t = trendsFor(rowsOf(nets));
    const s = t.signals.find((x) => x.metric === 'net');
    expect(s).toMatchObject({ kind: 'shift', dir: 'up', from: 44, to: 51, weeks: 8, ongoing: true, good: true });
    const longer = trendsFor(rowsOf([...nets, 41500]).slice(1));
    const s2 = longer.signals.find((x) => x.metric === 'net');
    expect(longer.rows[s2.from].iso).toBe(t.rows[s.from].iso);
    expect(signalKey(s2, longer.rows)).toBe(signalKey(s, t.rows));
  });

  it('ignores a run that ended before the judged weeks', () => {
    const nets = wiggle(52);
    for (let i = 10; i < 20; i++) nets[i] = 41500;
    expect(signalsOf('net', trendsFor(rowsOf(nets)).metrics.net.vals, limitsOf(nets.slice(0, 39)), windows(rowsOf(nets)))).toEqual([]);
  });

  it('reads the sample the way its story says: Berkeley’s margin per dish slides, below its limit now', () => {
    const t = trendsFor(deriveRoom(SEED, 'berkeley').hist.rows);
    const wcm = t.signals.find((x) => x.metric === 'wcm');
    expect(wcm).toMatchObject({ kind: 'limit', dir: 'down', ongoing: true, good: false });
  });

  it('a note explains a signal unless it says "still looking"', () => {
    expect(isExplained({ cause: 'change', text: '', at: '' })).toBe(true);
    expect(isExplained({ cause: 'looking', text: '', at: '' })).toBe(false);
    expect(isExplained(undefined)).toBe(false);
  });
});

describe('Trends: comparisons and export', () => {
  it('finds the nearest week a year back, within a week', () => {
    const rows = rowsOf(wiggle(60));
    expect(lastYearIndex(rows, 59)).toBe(7);
    expect(lastYearIndex(rows, 40)).toBe(null);
  });

  it('compares rooms per seat, for any rooms in the group', () => {
    const g = groupSeries(deriveGroup(SEED).rooms ?? Object.keys(SEED.rooms).map((id) => deriveRoom(SEED, id)));
    expect(g.map((r) => r.id)).toEqual(Object.keys(SEED.rooms));
    g.forEach((r) => {
      expect(r.perSeat).toHaveLength(52);
      expect(r.latest).toBeCloseTo(deriveRoom(SEED, r.id).hist.rows.at(-1).earned / r.seats, 6);
    });
  });

  it('exports every week with its window, signals and notes, CSV-safe', () => {
    const rows = deriveRoom(SEED, 'berkeley').hist.rows;
    const t = trendsFor(rows);
    const wcm = t.signals.find((x) => x.metric === 'wcm');
    const csv = trendsCsv(t, { [signalKey(wcm, rows)]: { cause: 'change', text: 'New menu, "lighter" mains', at: '2026-10-20' } }, 'Rosewood Berkeley');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(53);
    expect(lines[0]).toBe(`room,week_start,week,source,window,${METRICS.map((m) => `${m.key}${m.unit.startsWith('pct') ? '_pct' : ''}`).join(',')},signals,notes`);
    expect(lines[1]).toContain(',baseline,');
    expect(lines[52]).toContain(',judged,');
    expect(lines[52]).toContain('wcm:limit-down');
    expect(csv).toContain('"change: New menu, ""lighter"" mains"');
    expect(trendsCsv(t, {}, 'x', { header: false }).split('\n')[0]).not.toContain('week_start');
  });

  it('drops malformed notes from browser storage', () => {
    const ok = { cause: CAUSES[0].value, text: 'Private party', at: '2026-10-20T00:00:00Z' };
    expect(cleanNotes({ [noteKey('2026-10-19', 'net')]: ok, 'bad-key': ok, [noteKey('2026-10-19', 'covers')]: { cause: 'nope' } })).toEqual({ [noteKey('2026-10-19', 'net')]: ok });
    expect(cleanNotes(null)).toEqual({});
    expect(cleanNotes([])).toEqual({});
  });

  it('judges no more than 13 weeks', () => {
    expect(JUDGE_WEEKS).toBe(13);
  });
});
