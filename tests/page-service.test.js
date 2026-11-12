import { describe, expect, it } from 'vitest';

import { bandSpread, clockLabel, clockMinutes, cutApprovalId, fencesOf, isCutFor, liveNight, localNow, pacing, serviceCall, servicePlan, serversOn, serviceWindow, slotCovers } from '../lib/data/page/service.js';

const hours = (day, rows) => rows.flatMap(([hour, covers, servers]) => [0, 1, 2, 3].map((week) => ({ week, day, hour, covers, servers })));
// 24+ busy hours so the room's pace can be measured; Thursday has a spare server from 8 pm.
const room = (thu) => ({ levers: { wage: 20, serviceHours: [...hours('Fri', [[17, 20, 4], [18, 24, 4], [19, 24, 4], [20, 20, 4], [21, 16, 4], [22, 12, 4]]), ...hours('Thu', thu)] } });
const THU = [[17, 12, 4], [18, 20, 4], [19, 20, 4], [20, 8, 4], [21, 6, 4]];

describe('Service: clocks and fences', () => {
  it('reads the fence clock the Fences page saves', () => {
    expect(clockMinutes('8:30 pm')).toBe(20 * 60 + 30);
    expect(clockMinutes('12:00 am')).toBe(0);
    expect(clockMinutes('9 pm')).toBe(21 * 60);
    expect(clockMinutes('nonsense')).toBeNull();
    expect(clockLabel(20 * 60)).toBe('8 pm');
    expect(clockLabel(19 * 60 + 45)).toBe('7:45 pm');
    expect(fencesOf(null)).toEqual({ minDinner: 4, minAny: 3, cutBy: 20 * 60 + 30 });
    expect(fencesOf({ version: 2, f: { minDinner: 3, minAny: 2, cutBy: '9:00 pm' } })).toEqual({ minDinner: 3, minAny: 2, cutBy: 21 * 60 });
  });

  it('knows tonight in the restaurant’s own zone', () => {
    const at = new Date('2026-10-30T02:10:00Z');
    expect(localNow(at, 'America/Los_Angeles')).toEqual({ date: '2026-10-29', day: 'Thu', minutes: 19 * 60 + 10 });
    expect(localNow(at, 'America/New_York')).toEqual({ date: '2026-10-29', day: 'Thu', minutes: 22 * 60 + 10 });
    expect(localNow(at, 'Not/AZone').date).toBe('2026-10-29');
  });

  it('gives each night its own approval, so next week isn’t last week’s task', () => {
    expect(cutApprovalId('2026-10-29', 20 * 60)).toBe('cut:2026-10-29:20:00');
    expect(isCutFor('cut:2026-10-29:20:00', '2026-10-29')).toBe(true);
    expect(isCutFor('cut:Thu:20', '2026-10-29')).toBe(false);
  });
});

describe('Service: tonight’s plan', () => {
  it('suggests one fewer server from the first hour every later hour had a spare', () => {
    const p = servicePlan(room(THU), 'Thu', { f: { minDinner: 3, cutBy: '9:00 pm' } });
    expect(p.rate).toBeGreaterThan(0);
    expect(p.cutFrom).toBe(20);
    expect(p.blocked).toBeNull();
    expect(p.idleHours).toBe(2);
  });

  it('holds when a fence says no: fewest servers on dinner, or past the latest cut', () => {
    const floor = servicePlan(room(THU), 'Thu', { f: { minDinner: 4, cutBy: '9:00 pm' } });
    expect(floor.cutFrom).toBeNull();
    expect(floor.blocked.why).toBe('floor');
    expect(floor.spareFrom).toBe(20);
    const late = servicePlan(room(THU), 'Thu', { f: { minDinner: 3, cutBy: '7:30 pm' } });
    expect(late.cutFrom).toBeNull();
    expect(late.blocked.why).toBe('late');
  });

  it('says nothing without servers or a measured pace', () => {
    expect(servicePlan(room(THU), 'Mon', null)).toBeNull();
    expect(servicePlan({ levers: {} }, 'Thu', null)).toBeNull();
  });
});

const order = (day, hhmm, guests, voided = false) => ({ Opened: `${day} ${hhmm}:00`, '# of Guests': String(guests), Voided: voided ? 'true' : 'false' });

describe('Service: live pacing', () => {
  it('counts covers per 15 minutes, skipping voids and other days', () => {
    const win = { start: 17 * 60, end: 18 * 60, slots: 4 };
    const rows = [order('2026-10-29', '17:05', 2), order('2026-10-29', '17:14', 3), order('2026-10-29', '17:20', 4, true), order('2026-10-29', '17:50', 1), order('2026-10-28', '17:05', 9)];
    expect(slotCovers(rows, '2026-10-29', win)).toEqual([5, 0, 0, 1]);
  });

  it('stretches the window to the room’s own late hours', () => {
    const w = serviceWindow([{ day: '2026-10-22', orders: [order('2026-10-22', '22:40', 2)] }]);
    expect(w).toEqual({ start: 17 * 60, end: 23 * 60, slots: 24 });
  });

  it('counts servers clocked in now, not cooks and not those who left', () => {
    const t = (job, inAt, out) => ({ Employee: `${job}${inAt}`, 'Job Title': job, 'In Date': `2026-10-29 ${inAt}:00`, 'Out Date': out ? `2026-10-29 ${out}:00` : '' });
    expect(serversOn([t('Server', '16:00'), t('Server', '16:30', '19:00'), t('Line Cook', '16:00'), t('Captain', '17:00')], '2026-10-29', 19 * 60 + 15)).toBe(2);
  });

  it('narrows the band as service goes on', () => {
    expect(bandSpread(0, 20)).toBeCloseTo(0.4);
    expect(bandSpread(20, 20)).toBeCloseTo(0.1);
    expect(bandSpread(10, 20)).toBeLessThan(bandSpread(4, 20));
    expect(pacing({ comp: [4, 4, 4, 4], actual: [3, 3], now: 2 })).toMatchObject({ so: 6, cmp: 8, pace: -25 });
  });

  const win = { start: 17 * 60, end: 22 * 60, slots: 20 };
  const comp = [3, 4, 5, 6, 7, 8, 8, 9, 9, 8, 7, 6, 5, 4, 4, 3, 2, 2, 1, 1];
  it('speaks only when one fewer is safe at the top of the band', () => {
    const slow = serviceCall({ comp, actual: comp.slice(0, 10).map((c) => c * 0.6), now: 10, win, serversNow: 5, rate: 6, wage: 20, fences: { f: { minDinner: 3, cutBy: '9:00 pm' } } });
    expect(slow.mode).toBe('cut');
    expect(slow.at).toBe(19 * 60 + 45);
    expect(slow.value).toBe(Math.round(2.25 * 20));
    const busy = serviceCall({ comp, actual: comp.slice(0, 10), now: 10, win, serversNow: 5, rate: 6, fences: { f: { minDinner: 3, cutBy: '9:00 pm' } } });
    expect(busy.mode).toBe('quiet');
  });

  it('waits while the band is wide, and stays quiet before the first hour, past the fence, or under the floor', () => {
    const base = { comp, win, rate: 6, fences: { f: { minDinner: 3, cutBy: '9:00 pm' } } };
    const wide = serviceCall({ ...base, actual: comp.slice(0, 5).map((c) => c * 0.8), now: 5, serversNow: 6 });
    expect(['wait', 'cut']).toContain(wide.mode);
    expect(serviceCall({ ...base, actual: [3, 3], now: 2, serversNow: 5 }).mode).toBe('early');
    expect(serviceCall({ ...base, actual: comp.slice(0, 18).map(() => 0), now: 18, serversNow: 5 }).mode).toBe('late');
    expect(serviceCall({ ...base, actual: comp.slice(0, 10).map(() => 1), now: 10, serversNow: 3 })).toMatchObject({ mode: 'quiet', why: 'floor' });
    expect(serviceCall({ ...base, actual: comp.slice(0, 10), now: 10, serversNow: null }).mode).toBe('unknown');
  });

  it('needs two comparable nights before pacing live', () => {
    const today = { day: '2026-10-29', orders: [order('2026-10-29', '17:10', 4)], time: [] };
    const one = [{ day: '2026-10-22', orders: [order('2026-10-22', '17:10', 4)] }];
    expect(liveNight({ today, comparable: one, nowMin: 18 * 60, rate: 6 })).toBeNull();
    const two = [...one, { day: '2026-10-15', orders: [order('2026-10-15', '17:10', 2)] }];
    const n = liveNight({ today, comparable: two, nowMin: 18 * 60, rate: 6 });
    expect(n.comp[0]).toBe(3);
    expect(n.actual).toHaveLength(4);
    expect(n.call.serversNow).toBeNull();
  });
});
