// Today and Service show one dinner pace: Covercast's (covercastPace), never two methods.
import { describe, expect, it } from 'vitest';

import { covercastPace, covercastRoom, livePace, liveTuning, quarterCurve } from '../lib/data/forecast/index.js';
import { LIVE, liveTonight, slotsBy } from '../lib/data/live.js';
import { deriveRoom } from '../lib/data/model.js';
import { briefing, tonight } from '../lib/data/page/today-brief.js';
import { NOW, SEED } from '../lib/data/seed.js';

const start = 17 * 60;

describe('Today paces dinner from Covercast, like Service', () => {
  const room = SEED.rooms.oakland;
  const cc = covercastRoom(room, { accuracy: false });
  const d = deriveRoom(SEED, 'oakland');
  const sv = room.service;

  it('gives the sample the same pace as Service’s Covercast read, not the 4-week average', () => {
    expect(cc.ready).toBe(true);
    const day = cc.covers.days.find((x) => x.iso === NOW.iso);
    const curve = quarterCurve(day, { start, end: start + sv.comp.length * 15 });
    const want = livePace({ curve, actual: sv.actual, now: sv.now, service: 'dinner', start, tuned: liveTuning(cc.shiftPulse, 'dinner', start + sv.now * 15) });
    const got = tonight(d, NOW, { covercast: cc });
    expect(got.engine).toBe('Covercast');
    expect([got.so, got.usual, got.pace]).toEqual([want.so, want.cmp, want.pace]);
    // Without Covercast it falls back to the sample's usual night (the old -22%).
    expect(tonight(d, NOW, null).pace).toBe(-22);
  });

  it('says how covers are running in the headline from that same pace', () => {
    const got = tonight(d, NOW, { covercast: cc });
    const b = briefing(d, { cards: [], view: {}, now: NOW, live: { covercast: cc } });
    expect(b.line).toContain(`${Math.abs(got.pace)}%`);
    if (got.pace > -15) expect(b.headline).not.toMatch(/quieter than usual/);
  });

  it('paces a room’s own Toast night from Covercast when it has one, and falls back without', () => {
    const row = { day: NOW.iso, slots: [...sv.actual, ...Array(LIVE.slots - sv.actual.length).fill(0)], orders: 1, pulledAt: '2026-10-27T19:14:00Z', manual: null, staff: null, staffAt: null };
    const at = { nowMs: Date.parse('2026-10-27T19:15:00Z'), nowMin: 19 * 60 + 15, connected: { toast: true, staff: false } };
    const usual = { comp: Array(LIVE.slots).fill(4), nights: 3 };
    const n = slotsBy(at.nowMin);
    const want = covercastPace(cc, NOW.iso, { actual: row.slots, now: n, start: LIVE.startMin, slots: LIVE.slots, atMin: at.nowMin });
    const got = liveTonight(row, usual, { ...at, cc });
    expect(got.engine).toBe('Covercast');
    expect([got.usual, got.pace]).toEqual([want.cmp, want.pace]);
    const old = liveTonight(row, usual, at);
    expect(old.engine).toBe(null);
    expect(old.usual).toBe(4 * n);
  });
});
