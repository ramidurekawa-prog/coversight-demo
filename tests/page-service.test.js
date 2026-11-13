import { describe, expect, it } from 'vitest';

import { bandSpread, calibratedBand, clockLabel, clockMinutes, cutApprovalId, cutExecution, fencesOf, isCutFor, lastOrderAt, liveNight, localNow, pacing, serviceCall, serviceHealth, servicePlan, serversOn, serviceWindow, slotCovers } from '../lib/data/page/service.js';

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
  const band = { spread: 0.15, nights: 4, calibrated: true };
  const fences = { f: { minDinner: 3, cutBy: '9:00 pm' } };
  const call = (over) => serviceCall({ comp, win, rate: 6, wage: 20, fences, band, serversNow: 5, ...over });

  it('suggests a release only when every check passes, and values it as potential wages', () => {
    const slow = call({ actual: comp.slice(0, 10).map((c) => c * 0.6), now: 10 });
    expect(slow.mode).toBe('cut');
    expect(slow.at).toBe(19 * 60 + 45);
    expect(slow.value).toBe(Math.round(2.25 * 20));
    expect(slow.checks.filter((c) => c.ok === false)).toEqual([]);
    // Reservations and sections can't be read from Toast: always shown as the manager's to check.
    expect(slow.checks.filter((c) => c.ok === null).map((c) => c.key)).toEqual(['reservations', 'roles']);
    expect(serviceHealth(slow).text).toBe('Staffing may be above current demand.');
    expect(call({ actual: comp.slice(0, 10).map((c) => c * 0.6), now: 10, wage: null }).value).toBeNull();
  });

  it('never suggests a cut when demand is higher than expected', () => {
    const busy = call({ actual: comp.slice(0, 10).map((c) => c * 1.4), now: 10 });
    expect(busy.mode).toBe('quiet');
    expect(busy.checks.find((c) => c.key === 'demand').ok).toBe(false);
    expect(serviceHealth(busy).text).toBe('Demand is higher than expected.');
    expect(serviceHealth(call({ actual: comp.slice(0, 10), now: 10 })).text).toBe('Service is on track.');
  });

  it('holds the minimum staffing fence whatever the demand', () => {
    const r = call({ actual: comp.slice(0, 10).map(() => 0), now: 10, serversNow: 3 });
    expect(r).toMatchObject({ mode: 'quiet', why: 'floor' });
    expect(r.checks.find((c) => c.key === 'floor').ok).toBe(false);
  });

  it('pauses live suggestions on stale data, before the first hour, past the fence, without clock-ins, or on an uncalibrated band', () => {
    const slow = { actual: comp.slice(0, 10).map((c) => c * 0.6), now: 10 };
    expect(call({ ...slow, stale: true }).mode).toBe('stale');
    expect(serviceHealth(call({ ...slow, stale: true })).text).toBe('Data is too old for a live recommendation.');
    expect(call({ actual: [3, 3], now: 2 }).mode).toBe('early');
    expect(call({ actual: comp.slice(0, 18).map(() => 0), now: 18 }).mode).toBe('late');
    expect(call({ ...slow, serversNow: null }).mode).toBe('unknown');
    expect(call({ ...slow, band: { spread: 0.15, nights: 2, calibrated: false } })).toMatchObject({ mode: 'wait', why: 'history' });
  });

  it('waits while one fewer is fine at the forecast but not at the band’s top', () => {
    const r = call({ actual: comp.slice(0, 10).map((c) => c * 0.8), now: 10, band: { spread: 0.6, nights: 4, calibrated: true }, serversNow: 4, fences: { f: { minDinner: 1, cutBy: '9:00 pm' } }, rate: 10 });
    expect(r.mode).toBe('wait');
    expect(r.needTop).toBeGreaterThan(r.needMid);
  });

  it('sizes the band from how far off the forecast was on the room’s own nights', () => {
    const steady = [comp, comp, comp, comp];
    expect(calibratedBand(steady, 8)).toMatchObject({ spread: 0.05, nights: 4, calibrated: true });
    const wobbly = [comp, comp.map((c) => c * 1.3), comp.map((c, i) => (i >= 8 ? c * 0.5 : c)), comp];
    const b = calibratedBand(wobbly, 8);
    expect(b.spread).toBeGreaterThan(0.2);
    expect(calibratedBand([comp, comp], 8).calibrated).toBe(false);
    const p = pacing({ comp, actual: comp.slice(0, 8), now: 8, spread: 0.2 });
    expect(p.range[0]).toBeLessThan(p.remaining);
    expect(p.range[1]).toBeGreaterThan(p.remaining);
  });

  it('confirms a release from clock-ins, never from a ticked task, and flags a guardrail breach', () => {
    const t = (n, out) => Array.from({ length: n }, (_, i) => ({ Employee: `S${i}`, 'Job Title': 'Server', 'In Date': '2026-10-29 16:00:00', 'Out Date': i === 0 && out ? `2026-10-29 ${out}:00` : '' }));
    const cut = { at: 20 * 60, before: 5 };
    expect(cutExecution({ cut, time: t(5), date: '2026-10-29', nowMin: 19 * 60 + 30, needTop: 4 }).state).toBe('awaiting');
    expect(cutExecution({ cut, time: t(5), date: '2026-10-29', nowMin: 20 * 60 + 15, needTop: 4 }).state).toBe('not-seen');
    expect(cutExecution({ cut, time: t(5, '20:00'), date: '2026-10-29', nowMin: 20 * 60 + 15, needTop: 4 }).state).toBe('confirmed');
    expect(cutExecution({ cut, time: t(5, '20:00'), date: '2026-10-29', nowMin: 20 * 60 + 15, needTop: 5 }).state).toBe('breach');
    expect(cutExecution({ cut, time: [], date: '2026-10-29', nowMin: 20 * 60 + 15, needTop: 4 }).state).toBe('unconfirmed');
  });

  it('reads the data watermark from the latest order, not the pull time', () => {
    expect(lastOrderAt([order('2026-10-29', '18:05', 2), order('2026-10-29', '18:40', 2), order('2026-10-29', '18:50', 2, true)], '2026-10-29')).toBe(18 * 60 + 40);
    expect(lastOrderAt([], '2026-10-29')).toBeNull();
  });

  it('marks the night stale when orders stop arriving mid-service', () => {
    const past = ['2026-10-22', '2026-10-15', '2026-10-08'].map((d) => ({ day: d, orders: Array.from({ length: 40 }, (_, i) => order(d, `${17 + Math.floor(i / 10)}:${String((i % 10) * 6).padStart(2, '0')}`, 2)) }));
    const flowing = { day: '2026-10-29', orders: Array.from({ length: 20 }, (_, i) => order('2026-10-29', `${17 + Math.floor(i / 10)}:${String((i % 10) * 6).padStart(2, '0')}`, 2)), time: [] };
    expect(liveNight({ today: flowing, comparable: past, nowMin: 19 * 60, rate: 6 }).stale).toBe(false);
    const stopped = { ...flowing, orders: flowing.orders.slice(0, 5) }; // last order 17:24
    const n = liveNight({ today: stopped, comparable: past, nowMin: 19 * 60, rate: 6 });
    expect(n.stale).toBe(true);
    expect(n.call.mode).toBe('stale');
    expect(n.dataThrough).toBe(17 * 60 + 24);
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
