import { describe, expect, it } from 'vitest';

import { compareRooms, METRICS } from '../lib/data/compare.js';
import { deriveGroup } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';

const week = (net, labour, food = net * 0.3, covers = net / 30) => ({ net, labour, food, covers, earned: net - labour - food, excPct: 3 });

describe('comparing rooms fairly', () => {
  it('needs two rooms', () => {
    expect(compareRooms([{ id: 'a', name: 'A', history: [week(1000, 250)] }]).ok).toBe(false);
  });

  it('names a leader only when the gap beats week-to-week noise', () => {
    const steady = (lab) => Array.from({ length: 8 }, (_, i) => week(10000, lab + (i % 2 ? 50 : -50)));
    const c = compareRooms([{ id: 'a', name: 'A', history: steady(2400) }, { id: 'b', name: 'B', history: steady(2800) }]);
    const labour = c.rows.find((r) => r.k === 'labour');
    expect(labour.verdict).toBe('clear');
    expect(labour.leader).toBe('a');
    expect(c.top.k).toBeTruthy();
    const noisy = (lab) => Array.from({ length: 8 }, (_, i) => week(10000, lab + (i % 2 ? 600 : -600)));
    const n = compareRooms([{ id: 'a', name: 'A', history: noisy(2400) }, { id: 'b', name: 'B', history: noisy(2600) }]);
    expect(n.rows.find((r) => r.k === 'labour').verdict).toBe('level');
  });

  it('uses rates, so a room twice the size isn’t ahead for being bigger', () => {
    const c = compareRooms([
      { id: 'small', name: 'S', history: Array.from({ length: 8 }, () => week(10000, 2500)) },
      { id: 'big', name: 'B', history: Array.from({ length: 8 }, () => week(25000, 6250)) },
    ]);
    expect(c.rows.find((r) => r.k === 'labour').verdict).toBe('level');
    expect(c.rows.find((r) => r.k === 'net').verdict).toBe('context');
    expect(c.unlike).toBe(true);
  });

  it('on the sample group, every rate comes from the rooms’ own history', () => {
    const g = deriveGroup(SEED);
    const c = compareRooms(g.rooms.map((d) => ({ id: d.id, name: d.profile.short, history: d.room.history })), { weeks: 8 });
    expect(c.ok).toBe(true);
    expect(c.rows).toHaveLength(METRICS.length);
    const oak = g.rooms.find((d) => d.id === 'oakland').room.history.slice(-8);
    const mean = oak.reduce((s, r) => s + (r.labour / r.net) * 100, 0) / 8;
    expect(c.rows.find((r) => r.k === 'labour').per.find((p) => p.id === 'oakland').mean).toBeCloseTo(mean, 9);
  });
});
