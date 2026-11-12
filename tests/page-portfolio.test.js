import { describe, expect, test } from 'vitest';

import { deriveGroup } from '../lib/data/model.js';
import { HANDLED_MAX, nextHandled, portfolioView, STALE_AFTER_DAYS } from '../lib/data/page/portfolio.js';
import { NOW, SEED } from '../lib/data/seed.js';

const G = deriveGroup(SEED);
const sampleNow = Date.parse(`${NOW.iso}T19:15:00Z`);
const day = 864e5;

/** The sample group as a real account would hold it, with some rooms on their own Toast data. */
function realGroup(own) {
  return { ...G, rows: G.rows.map((r) => (own[r.id] ? { ...r, d: { ...r.d, room: { ...r.d.room, fromToast: { end: own[r.id], weeks: 13, files: ['orders'] } } } } : r)) };
}

describe('All rooms, the sample group', () => {
  const v = portfolioView(G, { now: sampleNow });

  test('totals are the model’s own group figures', () => {
    expect(v.totals.banked).toBe(G.banked);
    expect(v.totals.paused).toBe(G.paused);
    expect(v.totals.earned).toBe(G.earned);
    expect(v.totals.counted).toBe(G.rows.length);
    expect(v.rooms.map((r) => r.id)).toEqual(Object.keys(SEED.rooms));
  });

  test('every alarm and stale feed is on the list, alarms first', () => {
    const alarms = G.rows.reduce((s, r) => s + r.alarms, 0);
    const stale = G.rows.reduce((s, r) => s + r.stale, 0);
    expect(v.open.filter((x) => x.kind === 'alarm')).toHaveLength(alarms);
    expect(v.open.filter((x) => x.kind === 'feed')).toHaveLength(stale);
    const ranks = v.open.map((x) => ({ bad: 0, warn: 1, info: 2 })[x.tone]);
    expect(ranks).toEqual([...ranks].sort());
  });

  test('the weakest room gets one focus item that isn’t a feed fix already listed', () => {
    const focus = v.open.filter((x) => x.kind === 'focus');
    expect(focus).toHaveLength(1);
    const weakest = [...G.rows].sort((a, b) => a.banked - b.banked || a.earned - b.earned)[0];
    expect(focus[0].roomId).toBe(weakest.id);
    expect(focus[0].go).not.toBe('sources');
    expect(focus[0].claim).toBeTruthy();
    expect(`${focus[0].title} ${focus[0].body} ${focus[0].value}`).not.toMatch(/\{[\w-]+\}/);
  });

  test('ids are unique, scoped to their room, and fit the saved schema', () => {
    const ids = v.open.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of v.open) {
      expect(x.id.startsWith(`${x.roomId}:`)).toBe(true);
      expect(x.id).toMatch(/^[^:\s]{1,60}:[a-z]+:\S{1,100}$/);
    }
  });

  test('handled items leave the open list and the room’s count', () => {
    const first = v.open[0];
    const h = portfolioView(G, { now: sampleNow, handled: { [first.roomId]: { [first.id]: '2026-10-27T18:00:00.000Z' } } });
    expect(h.open.map((x) => x.id)).not.toContain(first.id);
    expect(h.handled.map((x) => x.id)).toEqual([first.id]);
    expect(h.rooms.find((r) => r.id === first.roomId).open).toBe(v.rooms.find((r) => r.id === first.roomId).open - 1);
  });
});

describe('All rooms, a real group', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const fresh = new Date(now - 3 * day).toISOString().slice(0, 10);
  const old = new Date(now - (STALE_AFTER_DAYS + 4) * day).toISOString().slice(0, 10);

  test('rooms on sample numbers never count toward totals', () => {
    const g = realGroup({ oakland: fresh });
    const v = portfolioView(g, { real: true, now, windows: [] });
    expect(v.totals.counted).toBe(1);
    expect(v.totals.earned).toBe(g.rows[0].earned);
    const sample = v.rooms.filter((r) => r.sample);
    expect(sample.map((r) => r.id)).toEqual(['berkeley', 'walnut']);
    for (const r of sample) {
      expect(r.earned).toBeNull();
      expect(r.status).toBe('sample');
      expect(v.open.some((x) => x.roomId === r.id && x.kind === 'sample')).toBe(true);
    }
  });

  test('no own data at all: nothing earned, nothing banked, a connect item per room', () => {
    const v = portfolioView(G, { real: true, now, windows: [] });
    expect(v.totals.earned).toBeNull();
    expect(v.totals.banked).toBe(0);
    expect(v.open.map((x) => x.kind)).toEqual(G.rows.map(() => 'sample'));
  });

  test('banked and tests come only from the group’s own test windows', () => {
    const g = realGroup({ oakland: fresh, berkeley: fresh });
    const windows = [
      { id: 'w1', roomId: 'oakland', title: 'Tuesday close', status: 'verified', bookedCents: 12345 },
      { id: 'w2', roomId: 'oakland', title: 'Prep pars', status: 'running', day: 14, bookedCents: 0 },
      { id: 'w3', roomId: 'berkeley', title: 'Friday cut', status: 'reversed', bookedCents: 0, reversedAt: new Date(now - 2 * day).toISOString() },
      { id: 'w4', roomId: 'berkeley', title: 'Old cut', status: 'reversed', bookedCents: 0, reversedAt: new Date(now - 60 * day).toISOString() },
      { id: 'w5', roomId: 'walnut', title: 'Brunch', status: 'waiting', day: 7, bookedCents: 0 },
    ];
    const v = portfolioView(g, { real: true, now, windows });
    const oak = v.rooms.find((r) => r.id === 'oakland');
    expect(oak.banked).toBe(123);
    expect(oak.tests).toBe(1);
    expect(v.totals.banked).toBe(123);
    expect(v.open.filter((x) => x.kind === 'reversed').map((x) => x.id)).toEqual(['berkeley:reversed:w3']);
    expect(v.open.find((x) => x.kind === 'waiting')?.roomId).toBe('walnut');
    expect(v.open[0].kind).toBe('reversed');
  });

  test('stale Toast data is flagged, and a handled flag comes back when the data changes', () => {
    const v = portfolioView(realGroup({ oakland: old, berkeley: fresh }), { real: true, now, windows: [] });
    const stale = v.open.find((x) => x.kind === 'stale');
    expect(stale.roomId).toBe('oakland');
    expect(v.rooms.find((r) => r.id === 'oakland').status).toBe('attention');
    const handled = { oakland: { [stale.id]: new Date(now).toISOString() } };
    expect(portfolioView(realGroup({ oakland: old, berkeley: fresh }), { real: true, now, handled }).open.some((x) => x.kind === 'stale')).toBe(false);
    const older = new Date(now - (STALE_AFTER_DAYS + 2) * day).toISOString().slice(0, 10);
    expect(portfolioView(realGroup({ oakland: older, berkeley: fresh }), { real: true, now, handled }).open.some((x) => x.kind === 'stale')).toBe(true);
  });

  test('the focus item is the weakest own-data room’s top move, with its claim strength', () => {
    const v = portfolioView(realGroup({ oakland: fresh, berkeley: fresh }), { real: true, now, windows: [] });
    const focus = v.open.find((x) => x.kind === 'focus');
    expect(focus).toBeTruthy();
    expect(['oakland', 'berkeley']).toContain(focus.roomId);
    expect(focus.go).toBe('finding');
    expect(focus.params.id).toBeTruthy();
    expect(focus.claim).toBeTruthy();
  });
});

describe('nextHandled', () => {
  test('adds, removes, drops ids no longer listed or from another room, and stays bounded', () => {
    let saved = nextHandled({}, 'oakland', 'oakland:feed:a', true, ['oakland:feed:a'], '2026-11-01T00:00:00Z');
    expect(saved).toEqual({ 'oakland:feed:a': '2026-11-01T00:00:00Z' });
    saved = nextHandled({ ...saved, 'oakland:feed:gone': 'x', 'berkeley:feed:a': 'y' }, 'oakland', 'oakland:alarm:b', true, ['oakland:feed:a', 'oakland:alarm:b'], '2026-11-02T00:00:00Z');
    expect(Object.keys(saved)).toEqual(['oakland:alarm:b', 'oakland:feed:a']);
    saved = nextHandled(saved, 'oakland', 'oakland:alarm:b', false, ['oakland:feed:a', 'oakland:alarm:b']);
    expect(Object.keys(saved)).toEqual(['oakland:feed:a']);
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`oakland:feed:${i}`, `2026-10-${String((i % 28) + 1).padStart(2, '0')}`]));
    expect(Object.keys(nextHandled(many, 'oakland', 'oakland:feed:0', true, Object.keys(many))).length).toBe(HANDLED_MAX);
  });
});
