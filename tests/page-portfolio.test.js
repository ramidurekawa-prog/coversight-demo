import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { ICON_NAMES } from '../components/kit.jsx';
import { deriveGroup } from '../lib/data/model.js';
import { HANDLED_MAX, nextHandled, OFFLINE_DAYS, portfolioView, priorityOf, readHandled, SNOOZE_DAYS, STALE_AFTER_DAYS, weeklySummary } from '../lib/data/page/portfolio.js';
import { NOW, SEED } from '../lib/data/seed.js';

const G = deriveGroup(SEED);
const sampleNow = Date.parse(`${NOW.iso}T19:15:00Z`);
const day = 864e5;
const now = Date.parse('2026-11-12T12:00:00Z');
const daysAgo = (n) => new Date(now - n * day).toISOString().slice(0, 10);

/**
 * The sample group as a real account holds it. own: { roomId: { end, files?, weeks? } } gives a room
 * its own Toast data: fromToast set, and its last `weeks` history rows marked as its own.
 */
function realGroup(own, { scale = {} } = {}) {
  return {
    ...G,
    rows: G.rows.map((r) => {
      const o = own[r.id];
      const k = scale[r.id] ?? 1;
      if (!o && k === 1) return r;
      const n = r.d.hist.rows.length, weeks = o?.weeks ?? 13;
      const rows = r.d.hist.rows.map((w, i) => ({ ...w, net: w.net * k, food: w.food * k, labour: w.labour * k, earned: w.earned * k, ...(o && i >= n - weeks ? { own: true } : {}) }));
      const plan = { ...r.d.plan, sorted: r.d.plan.sorted.map((c) => ({ ...c, value: c.value * k })) };
      return { ...r, earned: r.earned * k, d: { ...r.d, plan, hist: { ...r.d.hist, rows }, room: { ...r.d.room, ...(o ? { fromToast: { end: o.end, weeks, files: o.files ?? ['orders', 'items', 'time'] } } : {}) } } };
    }),
  };
}
const full = (end = daysAgo(3)) => ({ end, files: ['orders', 'items', 'time'] });

describe('the sample group', () => {
  const v = portfolioView(G, { now: sampleNow });

  test('group totals equal the eligible rooms’ totals, and the model’s own figure', () => {
    expect(v.totals.contribution.value).toBeCloseTo(v.rooms.reduce((s, r) => s + r.money.contribution.value, 0), 6);
    expect(v.totals.contribution.value).toBeCloseTo(G.earned, 0); // the history row is the week, rounded to the dollar
    expect(v.totals.counted).toBe(G.rows.length);
    expect(v.totals.savings.runRate).toBe(G.banked);
    expect(v.totals.savings.suspended).toBe(G.paused);
    expect(v.rooms.map((r) => r.id)).toEqual(Object.keys(SEED.rooms));
  });

  test('rates come from group numerators and denominators, not an average of rooms', () => {
    const food = v.rooms.reduce((s, r) => s + r.money.food.value, 0), rev = v.rooms.reduce((s, r) => s + r.money.revenue.value, 0);
    expect(v.totals.foodPct).toBeCloseTo(food / rev, 10);
    const lab = v.rooms.reduce((s, r) => s + r.money.labour.value, 0);
    expect(v.totals.labourPct).toBeCloseTo(lab / rev, 10);
    /* With rooms of very different size the two differ; the group figure follows the sales. */
    const skew = portfolioView(realGroup({}, { scale: { oakland: 10 } }), { now: sampleNow });
    const mean = skew.rooms.reduce((s, r) => s + r.money.foodPct, 0) / skew.rooms.length;
    const weighted = skew.rooms.reduce((s, r) => s + r.money.food.value, 0) / skew.rooms.reduce((s, r) => s + r.money.revenue.value, 0);
    expect(skew.totals.foodPct).toBeCloseTo(weighted, 10);
    expect(Math.abs(skew.totals.foodPct - mean)).toBeGreaterThan(1e-4);
  });

  test('every alarm and stale feed is on the list, urgent first, with ids that fit the saved schema', () => {
    expect(v.open.filter((x) => x.kind === 'alarm')).toHaveLength(G.rows.reduce((s, r) => s + r.alarms, 0));
    expect(v.open.filter((x) => x.kind === 'feed')).toHaveLength(G.rows.reduce((s, r) => s + r.stale, 0));
    const ranks = v.open.map((x) => ({ bad: 0, warn: 1, info: 2 })[x.tone]);
    expect(ranks).toEqual([...ranks].sort());
    const ids = v.open.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of v.open) expect(x.id).toMatch(new RegExp(`^${x.roomId}:[a-z]+:\\S{1,100}$`));
    for (const x of v.open) expect(`${x.title} ${x.body}`).not.toMatch(/\{[\w-]+\}/);
  });

  test('the room with an alarm ranks first, and each score is the sum of its stated parts', () => {
    expect(v.ranked[0].critical).toBeGreaterThan(0);
    expect(v.ranked[0].priority.tier).toBe('urgent');
    for (const r of v.rooms) {
      expect(r.priority.score).toBe(r.priority.parts.reduce((s, p) => s + p.points, 0));
      for (const p of r.priority.parts) expect(p.why).toBeTruthy();
    }
    expect(v.ranked.map((r) => r.rank)).toEqual(v.rooms.map((_, i) => i + 1));
  });

  test('a four-week period sums four weeks and compares against the 8 before it', () => {
    const w4 = portfolioView(G, { now: sampleNow, period: '4w' });
    const oak = G.rows.find((r) => r.id === 'oakland');
    const rows = oak.d.hist.rows.slice(-4);
    expect(w4.rooms[0].money.revenue.value).toBeCloseTo(rows.reduce((s, w) => s + w.net, 0), 6);
    expect(w4.rooms[0].money.change.weeks).toBe(8);
  });

  test('comparisons the data can’t support say so instead of inventing a number', () => {
    for (const comparison of ['ly', 'budget']) {
      const x = portfolioView(G, { now: sampleNow, comparison });
      for (const r of x.rooms) expect(r.money.change.unavailable).toBeTruthy();
    }
  });

  test('every icon the view hands the page exists in the icon map', () => {
    const src = readFileSync('lib/data/page/portfolio.js', 'utf8');
    const used = [...src.matchAll(/icon: '([A-Z][A-Za-z0-9]+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter((n) => !ICON_NAMES.includes(n))).toEqual([]);
  });
});

describe('a real group', () => {
  test('demo and real are never combined: rooms on sample numbers count for nothing', () => {
    const v = portfolioView(G, { real: true, now, windows: [] });
    expect(v.totals.contribution.value).toBeNull();
    expect(v.totals.contribution.status).toBe('unavailable');
    expect(v.totals.revenue).toBeNull();
    expect(v.totals.savings.runRate).toBe(0);
    expect(v.rooms.every((r) => r.state === 'sample' && !r.counted)).toBe(true);
    expect(v.open.map((x) => x.kind)).toEqual(G.rows.map(() => 'sample'));
  });

  test('a missing room is left out and flagged, never counted as zero', () => {
    const g = realGroup({ oakland: full() });
    const v = portfolioView(g, { real: true, now, windows: [] });
    const oak = v.rooms.find((r) => r.id === 'oakland');
    expect(v.totals.counted).toBe(1);
    expect(v.totals.contribution.value).toBeCloseTo(oak.money.contribution.value, 6);
    expect(v.totals.contribution.coverage).toEqual({ rooms: 1, of: 3 });
    expect(v.totals.contribution.limitations.join(' ')).toMatch(/2 of 3 rooms left out/);
    expect(v.totals.coverage.sample).toBe(2);
    for (const r of v.rooms.filter((x) => x.id !== 'oakland')) {
      expect(r.money.revenue.value).toBeNull();
      expect(r.money.contribution.status).toBe('unavailable');
    }
  });

  test('weeks a room’s own data doesn’t cover are never filled with sample numbers', () => {
    const v = portfolioView(realGroup({ oakland: { ...full(), weeks: 2 } }), { real: true, now, windows: [], period: '4w' });
    const oak = v.rooms.find((r) => r.id === 'oakland');
    expect(oak.money.complete).toBe(false);
    expect(oak.money.revenue.value).toBeNull();
    expect(v.open.some((x) => x.roomId === 'oakland' && x.kind === 'incomplete')).toBe(true);
    expect(portfolioView(realGroup({ oakland: { ...full(), weeks: 2 } }), { real: true, now, windows: [], period: 'week' }).rooms[0].money.revenue.value).not.toBeNull();
  });

  test('missing payroll: revenue shows, contribution is unavailable, and it says what to add', () => {
    const v = portfolioView(realGroup({ oakland: { end: daysAgo(3), files: ['orders', 'items'] } }), { real: true, now, windows: [] });
    const oak = v.rooms.find((r) => r.id === 'oakland');
    expect(oak.money.revenue.status).toBe('observed');
    expect(oak.money.labour.status).toBe('unavailable');
    expect(oak.money.contribution.value).toBeNull();
    expect(v.open.some((x) => x.kind === 'payroll' && x.roomId === 'oakland')).toBe(true);
  });

  test('missing cost data: food cost is an estimate, and so is the contribution', () => {
    const v = portfolioView(realGroup({ oakland: full() }), { real: true, now, windows: [] });
    const oak = v.rooms.find((r) => r.id === 'oakland');
    expect(oak.money.food.status).toBe('estimated');
    expect(oak.money.contribution.status).toBe('estimated');
    expect(v.totals.contribution.status).toBe('estimated');
    expect(v.open.some((x) => x.kind === 'costs' && x.roomId === 'oakland')).toBe(true);
  });

  test('a newly opened room has no baseline yet and isn’t penalised for it', () => {
    const v = portfolioView(realGroup({ oakland: { ...full(), weeks: 3 } }), { real: true, now, windows: [] });
    const oak = v.rooms.find((r) => r.id === 'oakland');
    expect(oak.money.change.unavailable).toMatch(/Not enough history/);
    expect(oak.priority.parts.some((p) => p.k === 'drop')).toBe(false);
  });

  test('source staleness: stale past 8 days, offline past 28 and out of every total', () => {
    const v = portfolioView(realGroup({ oakland: full(daysAgo(STALE_AFTER_DAYS + 4)), berkeley: full(daysAgo(OFFLINE_DAYS + 5)), walnut: full() }), { real: true, now, windows: [] });
    const [oak, brk] = ['oakland', 'berkeley'].map((id) => v.rooms.find((r) => r.id === id));
    expect(oak.state).toBe('stale');
    expect(v.open.some((x) => x.roomId === 'oakland' && x.kind === 'stale')).toBe(true);
    expect(brk.state).toBe('offline');
    expect(brk.counted).toBe(false);
    expect(brk.money.revenue.value).toBeNull();
    expect(v.open.find((x) => x.roomId === 'berkeley' && x.kind === 'offline')?.tone).toBe('bad');
    expect(v.totals.coverage).toMatchObject({ stale: 1, offline: 1 });
    /* The stale room's latest week isn't the group's latest week, so it's out of the totals too. */
    expect(oak.counted).toBe(false);
    expect(v.totals.counted).toBe(1);
  });

  test('a reversed saving leaves the run-rate and stops accruing, and is listed', () => {
    const g = realGroup({ oakland: full() });
    const closedAt = new Date(now - 20 * day).toISOString();
    const verified = [{ id: 'w1', roomId: 'oakland', title: 'Tuesday close', status: 'verified', bookedCents: 7000, lowCents: 7000, closedAt }];
    const a = portfolioView(g, { real: true, now, windows: verified });
    expect(a.totals.savings.runRate).toBe(70);
    expect(a.totals.savings.accrued).toBeCloseTo(70, 0);
    const reversedAt = new Date(now - 3 * day).toISOString();
    const b = portfolioView(g, { real: true, now, windows: [{ ...verified[0], status: 'reversed', bookedCents: 0, reversedAt }] });
    expect(b.totals.savings.runRate).toBe(0);
    expect(b.totals.savings.reversed.map((x) => x.id)).toEqual(['w1']);
    expect(b.totals.savings.accrued).toBeCloseTo(30, 0); // 3 of the last 7 days, before the reversal
    expect(b.totals.savings.toDate).toBeLessThan(a.totals.savings.toDate);
    expect(b.open[0]).toMatchObject({ kind: 'reversed', tone: 'bad' });
  });

  test('rank changes when real risk changes', () => {
    const g = realGroup({ oakland: full(), berkeley: full(), walnut: full() });
    const before = portfolioView(g, { real: true, now, windows: [] });
    const last = before.ranked.at(-1).id;
    const after = portfolioView(g, { real: true, now, windows: [{ id: 'w9', roomId: last, title: 'Brunch cut', status: 'reversed', bookedCents: 0, reversedAt: new Date(now - day).toISOString() }] });
    expect(after.ranked[0].id).toBe(last);
    expect(after.ranked[0].priority.tier).toBe('urgent');
  });

  test('a small room isn’t ranked weak for being small', () => {
    const g = realGroup({ oakland: full(), berkeley: full(), walnut: full() });
    const small = realGroup({ oakland: full(), berkeley: full(), walnut: full() }, { scale: { berkeley: 0.25 } });
    const a = portfolioView(g, { real: true, now, windows: [] }), b = portfolioView(small, { real: true, now, windows: [] });
    const score = (v) => v.rooms.find((r) => r.id === 'berkeley').priority.score;
    expect(score(b)).toBe(score(a));
    expect(b.ranked.map((r) => r.id)).toEqual(a.ranked.map((r) => r.id));
  });

  test('a margin drop against the room’s own normal raises it, with the reason in words', () => {
    const p = priorityOf({ open: [], change: { weeks: 8, marginPts: -4, z: -3 }, state: 'live', opportunity: null, moneyStatus: 'calculated' });
    expect(p.tier).toBe('watch');
    expect(p.parts.map((x) => x.k)).toEqual(['drop', 'unusual']);
    expect(p.parts[0].why).toMatch(/own last 8 weeks/);
    const urgent = priorityOf({ open: [{ tone: 'bad', title: 'Alarm', kind: 'alarm' }], change: null, state: 'live', opportunity: { title: 'x', share: 0.5, p: 1 }, moneyStatus: 'calculated' });
    expect(urgent.tier).toBe('urgent');
  });

  test('the weekly summary names the room that needs the owner most', () => {
    const v = portfolioView(realGroup({ oakland: full() }), { real: true, now, windows: [{ id: 'w3', roomId: 'oakland', title: 'Friday cut', status: 'reversed', bookedCents: 0, reversedAt: new Date(now - day).toISOString() }] });
    const s = weeklySummary(v, 'Hill Street');
    expect(s.title).toBe('Hill Street: Oakland needs you most');
    expect(s.body).toMatch(/Rosewood Oakland needs you most: Friday cut reversed/);
    expect(s.body).toMatch(/from 1 of 3 rooms/);
  });
});

describe('acknowledged and snoozed', () => {
  test('acknowledged items leave the open list; a snooze ends on its date', () => {
    const v = portfolioView(G, { now: sampleNow });
    const first = v.open[0];
    const ack = nextHandled({}, first.roomId, first.id, 'ack', [first.id], new Date(sampleNow).toISOString());
    const h = portfolioView(G, { now: sampleNow, handled: { [first.roomId]: ack } });
    expect(h.open.map((x) => x.id)).not.toContain(first.id);
    expect(h.handled[0]).toMatchObject({ id: first.id, handled: { state: 'acknowledged' } });
    const snz = nextHandled({}, first.roomId, first.id, 'snooze', [first.id], new Date(sampleNow).toISOString());
    expect(portfolioView(G, { now: sampleNow, handled: { [first.roomId]: snz } }).handled[0].handled.state).toBe('snoozed');
    expect(portfolioView(G, { now: sampleNow + (SNOOZE_DAYS + 1) * day, handled: { [first.roomId]: snz } }).open.map((x) => x.id)).toContain(first.id);
    expect(readHandled('2026-11-01', sampleNow)).toBeNull();
  });

  test('the saved value drops ids no longer listed or from another room, and stays bounded', () => {
    let saved = nextHandled({}, 'oakland', 'oakland:feed:a', 'ack', ['oakland:feed:a'], '2026-11-01T00:00:00Z');
    saved = nextHandled({ ...saved, 'oakland:feed:gone': { s: 'ack', at: 'x' }, 'berkeley:feed:a': { s: 'ack', at: 'y' } }, 'oakland', 'oakland:alarm:b', 'ack', ['oakland:feed:a', 'oakland:alarm:b'], '2026-11-02T00:00:00Z');
    expect(Object.keys(saved)).toEqual(['oakland:alarm:b', 'oakland:feed:a']);
    saved = nextHandled(saved, 'oakland', 'oakland:alarm:b', 'clear', ['oakland:feed:a', 'oakland:alarm:b']);
    expect(Object.keys(saved)).toEqual(['oakland:feed:a']);
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`oakland:feed:${i}`, { s: 'ack', at: `2026-10-${String((i % 28) + 1).padStart(2, '0')}` }]));
    expect(Object.keys(nextHandled(many, 'oakland', 'oakland:feed:0', 'ack', Object.keys(many))).length).toBe(HANDLED_MAX);
  });
});
