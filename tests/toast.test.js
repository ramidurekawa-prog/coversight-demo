import { describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { leverReport } from '../lib/data/levers.js';
import { deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';
import { channelOf, detectToastFile, jobGroup, minutes, money, parseToastDate, readToastExports } from '../lib/data/toast.js';
import { parseCSV } from '../lib/data/ingest.js';
import { toastFixture } from './helpers/toast-fixture.js';

const FILES = toastFixture();
const read = (names = Object.keys(FILES)) => readToastExports(names.map((name) => ({ name, text: FILES[name] })));

describe('Toast export values', () => {
  it('reads Toast dates, money and durations', () => {
    expect(new Date(parseToastDate('10/27/26 5:43 PM')).toISOString()).toBe('2026-10-27T17:43:00.000Z');
    expect(new Date(parseToastDate('10/27/2026 12:05 AM')).toISOString()).toBe('2026-10-27T00:05:00.000Z');
    expect(new Date(parseToastDate('2026-10-27T17:43:00')).toISOString()).toBe('2026-10-27T17:43:00.000Z');
    expect(parseToastDate('')).toBeNull();
    expect(money('$1,234.50')).toBe(1234.5);
    expect(money('($12.00)')).toBe(-12);
    expect(money('')).toBe(0);
    expect(minutes('1:05:30')).toBeCloseTo(65.5);
    expect(minutes('58 minutes')).toBe(58);
    expect(minutes('1.5 hours')).toBe(90);
  });

  it('maps dining options and job titles', () => {
    expect(channelOf('DoorDash - Delivery')).toBe('DoorDash');
    expect(channelOf('Uber Eats')).toBe('Uber Eats');
    expect(channelOf('Online Ordering - Takeout')).toBe('Takeout');
    expect(channelOf('Dine In')).toBe('Dine-in');
    expect(jobGroup('Line Cook')).toBe('boh');
    expect(jobGroup('Bartender')).toBe('bar');
    expect(jobGroup('Server')).toBe('foh');
  });

  it('detects each export by its real headers, and nothing else', () => {
    for (const [name, kind] of [['ItemSelectionDetails.csv', 'items'], ['OrderDetails.csv', 'orders'], ['TimeEntries.csv', 'time'], ['PaymentDetails.csv', 'payments'], ['KitchenTimings.csv', 'kitchen']]) {
      expect(detectToastFile(parseCSV(FILES[name]).headers)).toBe(kind);
    }
    expect(detectToastFile(['dish', 'price', 'cost'])).toBeNull();
    expect(readToastExports([{ name: 'menu.csv', text: 'dish,price\nA,1\n' }]).ok).toBe(false);
  });
});

describe('a Toast export summary', () => {
  const s = read();

  it('covers the window and every file', () => {
    expect(s.ok).toBe(true);
    expect(s.weeksCovered).toBe(13);
    expect(s.end).toBe('2026-10-24');
    expect(s.files.sort()).toEqual(['items', 'kitchen', 'orders', 'payments', 'time']);
    expect(s.unknown).toEqual([]);
  });

  it('prices every dish from what guests actually paid', () => {
    const salmon = s.rows.recipes.find((r) => r.dish === 'Grilled Salmon');
    expect(salmon.price).toBe(28);
    expect(salmon.units).toBeGreaterThan(20);
    expect(s.rows.recipes.find((r) => r.dish === 'Glass of Pinot').category).toBe('Drink');
    expect(Object.keys(s.toast.priceHistory)).toContain('Ribeye Steak');
    expect(s.toast.priceHistory['Ribeye Steak']).toHaveLength(8);
  });

  it('measures servers on the floor, covers and parties per hour', () => {
    const fri = s.toast.serviceHours.filter((h) => h.day === 'Fri' && h.hour === 19);
    expect(fri.length).toBe(4); // one per week
    expect(fri.every((h) => h.servers === 4)).toBe(true);
    const mon = s.toast.serviceHours.filter((h) => h.day === 'Mon');
    expect(mon.every((h) => h.servers === 3)).toBe(true);
    expect(s.toast.serviceHours.every((h) => h.covers >= h.parties)).toBe(true);
  });

  it('reads overtime by group, wages, voids and turns', () => {
    expect(s.toast.ot.boh.every((m) => m === 240)).toBe(true); // 2 cooks × 2 h every Saturday
    expect(s.toast.ot.foh).toEqual([0, 0, 0, 0]);
    expect(s.toast.wage).toBeGreaterThan(16.5);
    expect(s.toast.wage).toBeLessThan(24);
    expect(new Set(s.toast.voidWeeks.map((v) => v.week)).size).toBe(12);
    expect(s.toast.turns.every((t) => t.min >= 50 && t.min < 90)).toBe(true);
    expect(s.toast.reseatGaps.length).toBeGreaterThan(50);
    expect(s.toast.tickets.stations[0][0]).toBe('Grill');
    expect(s.toast.history).toHaveLength(13);
  });

  it('team and channels come out as the existing input kinds', () => {
    const ana = s.rows.exceptions.find((e) => e.employee === 'Ana P.');
    expect(ana.role).toBe('Server');
    expect(ana.rate).toBe(16.5);
    expect(ana.sales).toBeGreaterThan(0);
    expect(s.rows.exceptions.find((e) => e.employee === 'Eli M.').hours).toBeCloseTo(56, 0);
    expect(s.rows.channels.map((c) => c.channel).sort()).toEqual(['Dine-in', 'DoorDash', 'Takeout']);
  });

  it('with only some files, says what is missing instead of guessing', () => {
    const only = read(['ItemSelectionDetails.csv']);
    expect(only.ok).toBe(true);
    expect(only.toast.serviceHours).toBeUndefined();
    expect(only.notes.join(' ')).toMatch(/OrderDetails/);
  });
});

describe('applied to a room', () => {
  const s = read();
  const ds = applyInputs(SEED, { oakland: { toast: { rows: [s] } } });
  const room = ds.rooms.oakland;

  it('replaces the sample menu, team, levers and recent history with the export', () => {
    expect(room.menu.map((m) => m.name).sort()).toEqual(s.rows.recipes.map((r) => r.dish).sort());
    expect(room.menu.find((m) => m.name === 'Grilled Salmon').costEstimated).toBeUndefined(); // costed from the sample's matching dish
    expect(room.menu.find((m) => m.name === 'House Burger').costEstimated).toBe(true);
    expect(room.staff.map((p) => p.name).sort()).toEqual(['Ana P.', 'Ben K.', 'Cara L.', 'Dev S.', 'Eli M.', 'Fay R.', 'Gus T.']);
    expect(room.levers.serviceHours).toBe(s.toast.serviceHours);
    expect(room.history.slice(-13).every((h) => h.own)).toBe(true);
    expect(room.fromToast.weeks).toBe(13);
    expect(SEED.rooms.oakland.menu.length).toBe(38); // the seed is untouched
  });

  it('every figure still derives, with no NaN anywhere', () => {
    const d = deriveRoom(ds, 'oakland');
    const bad = [];
    const walk = (v, path) => {
      if (typeof v === 'number' && !Number.isFinite(v)) bad.push(path);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (path.split('.').length < 6) walk(x, `${path}.${k}`);
    };
    walk({ week: d.week, menu: d.menu, staff: d.staff, exposure: d.exposure }, 'd');
    expect(bad).toEqual([]);
    expect(d.week.net).toBeGreaterThan(0);
  });

  it('every lever grades on the restaurant’s own data', () => {
    const levers = leverReport(room, deriveRoom(ds, 'oakland'));
    expect(levers).toHaveLength(6);
    levers.forEach((l) => expect(l.grade, l.key).toBeTruthy());
  });

  it('findings on own data skip moves that only exist in the sample (spot counts on sample stock)', () => {
    const ids = deriveRoom(ds, 'oakland').candidates.map((c) => c.id);
    expect(ids).not.toContain('spotcount');
    expect(deriveRoom(SEED, 'oakland').candidates.map((c) => c.id)).toContain('spotcount');
  });

  it('a hand-entered recipe cost still wins over the estimate', () => {
    const ds2 = applyInputs(SEED, { oakland: { toast: { rows: [s] }, recipes: { rows: [{ dish: 'House Burger', price: 19, cost: 5.1 }] } } });
    expect(ds2.rooms.oakland.menu.find((m) => m.name === 'House Burger').cost).toBe(5.1);
  });
});
