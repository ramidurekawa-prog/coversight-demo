import { describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { applyInputs } from '../lib/data/apply.js';
import { parseClock, validate } from '../lib/data/ingest.js';
import { mergeRows } from '../lib/data/page/inputs.js';
import { todayCards } from '../lib/data/page/today.js';
import { deriveRoom } from '../lib/data/model.js';
import { linkRows, parseShiftId, shiftCheck, staffingCards, staffingDecision, staffingOutcome, staffingReadiness } from '../lib/data/page/staffing.js';
import { expectFor } from '../lib/data/writebacks.js';

/* The pre-shift staffing call on a room run by hand: three weeks of dinners
 * typed by hour on Data and tonight's schedule. Tuesday 2026-11-24. */
const TUE = '2026-11-24';
const add = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const PAST = Array.from({ length: 21 }, (_, i) => add(TUE, -(i + 1)));
const HOURS = [[16, 6, 3], [17, 20, 4], [18, 36, 4], [19, 40, 4], [20, 24, 4], [21, 12, 4]];
const SERVICES = PAST.flatMap((d) => HOURS.map(([h, covers, servers]) => ({ date: d, hour: `${h}:00`, covers, servers })));
const sh = (name, start, end, extra = {}) => ({ date: TUE, role: 'Server', name, start, end, rate: 24, ...extra });
const SHIFTS = [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Cy', '16:00', '22:00'), sh('Di', '4:30 pm', '22:00')];
const ENTRIES = { shifts: { at: '2026-11-23T18:00:00Z', date: '2026-11-23' }, services: { at: '2026-11-23T18:00:00Z', date: '2026-11-23' } };

const rows = (kind, r) => { const v = validate(kind, r); expect(v.errors ?? v.issues.filter((i) => i.level === 'error').length).toBeFalsy(); return v.rows; };
const roomWith = ({ services = SERVICES, shifts = SHIFTS } = {}) => {
  const kinds = {};
  if (services) kinds.services = { rows: rows('services', services) };
  if (shifts) kinds.shifts = { rows: rows('shifts', shifts) };
  return { ...applyInputs(SEED, { oakland: kinds }).rooms.oakland, id: 'oakland' };
};
const at = (room, p = {}) => staffingDecision(room, { date: TUE, meal: 'dinner', today: TUE, nowMin: 12 * 60, entries: ENTRIES, ...p });

describe('Staffing: times typed by hand', () => {
  it('reads the ways people write a shift time', () => {
    expect(parseClock('4:30 pm')).toBe(16 * 60 + 30);
    expect(parseClock('4:30p')).toBe(16 * 60 + 30);
    expect(parseClock('4pm')).toBe(16 * 60);
    expect(parseClock('16:30')).toBe(16 * 60 + 30);
    expect(parseClock('1630')).toBe(16 * 60 + 30);
    expect(parseClock('12 am')).toBe(0);
    expect(parseClock('12:15 pm')).toBe(12 * 60 + 15);
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('soon')).toBeNull();
  });

  it('warns when a time without am or pm reads as the small hours, and refuses a shift that ends before it starts', () => {
    const v = validate('shifts', [sh('Ana', '4:30', '10:00')]);
    expect(v.issues.some((i) => i.level === 'warn' && /4:30 am/.test(i.msg ?? i.message ?? ''))).toBe(true);
    const bad = validate('shifts', [sh('Ana', '18:00', '17:00')]);
    expect(bad.issues.some((i) => i.level === 'error' && /before it starts/.test(i.msg ?? i.message ?? ''))).toBe(true);
    const overnight = validate('shifts', [sh('Ana', '18:00', '1:00')]);
    expect(overnight.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('keeps zero apart from blank: zero servers with guests is a warning, a blank count is an error', () => {
    const zero = validate('services', [{ date: PAST[0], hour: '17:00', covers: 12, servers: 0 }]);
    expect(zero.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(zero.issues.some((i) => i.level === 'warn')).toBe(true);
    const blank = validate('services', [{ date: PAST[0], hour: '17:00', covers: 12, servers: '' }]);
    expect(blank.issues.some((i) => i.level === 'error')).toBe(true);
    const free = validate('shifts', [sh('Ana', '16:00', '22:00', { rate: 0 })]);
    expect(free.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('a schedule saved twice for the same date replaces that date, never doubles it', () => {
    const first = rows('shifts', SHIFTS);
    const other = rows('shifts', [{ ...SHIFTS[0], date: add(TUE, 1) }]);
    const again = mergeRows('shifts', [...first, ...other], rows('shifts', SHIFTS.slice(0, 2)));
    expect(again.rows.filter((r) => r.date === TUE)).toHaveLength(2);
    expect(again.rows.filter((r) => r.date === add(TUE, 1))).toHaveLength(1);
    const services = rows('services', SERVICES.slice(0, 6));
    expect(mergeRows('services', services, services).rows).toHaveLength(6);
  });
});

describe('Staffing: the call before the shift', () => {
  it('waits for the data it needs, naming the input that fixes it', () => {
    const none = at(roomWith({ services: null, shifts: [sh('Ana', '16:00', '22:00')] }));
    // The sample's own dinners stand in for history; the schedule is what's checked.
    expect(['act', 'hold', 'blocked']).toContain(none.state);
    const noSchedule = at(roomWith({ shifts: null }), { entries: {} });
    expect(noSchedule.state).toBe('blocked');
    expect(noSchedule.blocker.key).toBe('schedule');
    expect(noSchedule.blocker.fix).toMatchObject({ kind: 'shifts', date: TUE, meal: 'dinner' });
    const thin = at(roomWith({ services: SERVICES.filter((r) => r.date >= PAST[6]) }));
    expect(thin.state).toBe('blocked');
    expect(thin.blocker.key).toBe('history');
    expect(thin.blocker.fix.kind).toBe('services');
  });

  it('a stale schedule holds the call; clock-ins are only needed after the shift', () => {
    const r = staffingReadiness(roomWith(), { date: TUE, meal: 'dinner', today: TUE, entries: { shifts: { at: '2026-11-10T18:00:00Z' } } });
    expect(r.items.find((i) => i.key === 'schedule').state).toBe('stale');
    expect(r.ready).toBe(false);
    const ok = staffingReadiness(roomWith(), { date: TUE, meal: 'dinner', today: TUE, entries: ENTRIES });
    expect(ok.ready).toBe(true);
    expect(ok.items.find((i) => i.key === 'clock')).toMatchObject({ state: 'later', need: 'proof' });
  });

  it('recommends the one change every hour still covers: 30 minutes at $24 is a $12 estimate', () => {
    const d = at(roomWith());
    expect(d.state).toBe('act');
    expect(d.kind).toBe('start');
    expect(d.title).toBe('Start Di at 5 pm, not 4:30 pm');
    expect(d.estimate).toMatchObject({ minutes: 30, rateCents: 2400, cents: 1200, claim: 'est', rateFrom: 'shift' });
    expect(d.approvalId).toBe('shift:2026-11-24:dinner:start:server-di-1630:1700');
    expect(parseShiftId(d.approvalId)).toMatchObject({ date: TUE, meal: 'dinner', kind: 'start' });
    expect(expectFor(d.approvalId)).toEqual({ type: 'shift', date: TUE, meal: 'dinner', kind: 'start' });
    expect(d.hoursRows.every((h) => h.after >= h.need)).toBe(true);
    expect(d.guardrails.filter((g) => g.ok === false)).toEqual([]);
    // Sections and reservations aren't in the data: always the manager's call, never ticked.
    expect(d.guardrails.filter((g) => g.ok === null).map((g) => g.key)).toEqual(['sections', 'reservations']);
  });

  it('adds a server before it cuts one when an hour is short', () => {
    const d = at(roomWith({ shifts: [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Cy', '16:00', '22:00')] }));
    expect(d.state).toBe('act');
    expect(d.kind).toBe('add');
    expect(d.estimate.cost).toBe(true);
    expect(d.approvalId).toMatch(/^shift:2026-11-24:dinner:add:\d{4}:\d{4}$/);
  });

  it('holds when the schedule already fits', () => {
    const d = at(roomWith({ shifts: [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Cy', '16:00', '22:00'), sh('Di', '17:00', '22:00')] }));
    expect(d.state).toBe('hold');
    expect(d.approvalId).toBeUndefined();
  });

  it('respects your minimum on the floor', () => {
    const d = at(roomWith(), { fences: { version: 2, f: { minDinner: 5, minAny: 3, cutBy: '8:30 pm' } } });
    expect(d.state === 'act' ? d.kind : d.state).not.toBe('start');
  });

  it('says it’s too late after the deadline, and steps aside once service starts or ends', () => {
    expect(at(roomWith(), { nowMin: 15 * 60 + 31 }).state).toBe('late');
    expect(at(roomWith(), { nowMin: 15 * 60 + 31 }).approvalId).toBeNull();
    expect(at(roomWith(), { nowMin: 16 * 60 + 45 }).state).toBe('live');
    expect(at(roomWith(), { nowMin: 22 * 60 + 5 }).state).toBe('over');
    expect(at(roomWith(), { meal: 'lunch' }).state).toBe('closed');
  });

  it('a change already approved for the service is the call, until it’s undone', () => {
    const d = at(roomWith(), { tasks: [{ roomId: 'oakland', approvalId: 'shift:2026-11-24:dinner:start:server-di-1630:1700', status: 'open', title: 'Start Di at 5 pm, not 4:30 pm' }] });
    expect(d.state).toBe('decided');
    expect(at(roomWith(), { tasks: [{ roomId: 'berkeley', approvalId: 'shift:2026-11-24:dinner:start:server-di-1630:1700', status: 'open' }] }).state).toBe('act');
    expect(at(roomWith(), { tasks: [{ roomId: 'oakland', approvalId: 'shift:2026-11-24:dinner:start:server-di-1630:1700', status: 'cancelled' }] }).state).toBe('act');
  });

  it('one card per service on Today, with one data card at a time', () => {
    const room = roomWith();
    const cards = staffingCards(room, { today: TUE, nowMin: 12 * 60, entries: ENTRIES });
    expect(cards.map((c) => c.id)).toEqual(['staff:2026-11-24:dinner']);
    expect(cards[0]).toMatchObject({ area: 'labor', claim: 'est', value: 'about $12 before offsets', approval: 'shift:2026-11-24:dinner:start:server-di-1630:1700', refuse: true });
    const d = deriveRoom(applyInputs(SEED, { oakland: { services: { rows: rows('services', SERVICES) }, shifts: { rows: rows('shifts', SHIFTS) } } }), 'oakland');
    const today = todayCards(d, { today: TUE, staffing: cards });
    expect(today.filter((c) => c.id.startsWith('staff:'))).toHaveLength(1);
    const blocked = staffingCards(roomWith({ shifts: [{ ...SHIFTS[0], date: add(TUE, 2) }] }), { today: TUE, nowMin: 12 * 60, entries: {} });
    expect(blocked.filter((c) => c.staffing.state === 'blocked')).toHaveLength(1);
    // A sample room shows nothing until a schedule is entered.
    expect(staffingCards({ ...SEED.rooms.oakland, id: 'oakland' }, { today: TUE, nowMin: 12 * 60 })).toEqual([]);
  });

  it('opens Data on just that service’s rows', () => {
    const room = roomWith();
    expect(linkRows('shifts', room, { date: TUE, meal: 'dinner', today: TUE })).toHaveLength(SHIFTS.length);
    expect(linkRows('shifts', room, { date: add(TUE, 1), meal: 'dinner', today: TUE })).toEqual([{ date: add(TUE, 1), role: 'Server', start: '', end: '', name: '', rate: '', clock_in: '', clock_out: '' }]);
    const fresh = linkRows('services', roomWith({ services: null }), { date: TUE, meal: 'dinner', today: TUE });
    expect(new Set(fresh.map((r) => r.date))).toEqual(new Set(['2026-11-17', '2026-11-10', '2026-11-03']));
    expect(fresh.every((r) => r.covers === '' && r.servers === '')).toBe(true);
  });
});

describe('Staffing: what happened after', () => {
  const approved = () => {
    const d = at(roomWith());
    return { roomId: 'oakland', approvalId: d.approvalId, status: 'done', createdAt: '2026-11-24T20:00:00Z', doneAt: '2026-11-24T23:00:00Z',
      evidence: { change: d.change, estimate: d.estimate, forecast: d.forecast, schedule: d.schedule, approvedByName: 'Marcus' } };
  };
  it('waits for clock-ins, and never counts a single service as savings', () => {
    const o = staffingOutcome(approved(), roomWith());
    expect(o.result).toBe('pending-evidence');
    expect(o.stages.map((s) => s.key)).toEqual(['opportunity', 'decision', 'execution', 'clock', 'qualified']);
    expect(o.stages.find((s) => s.key === 'execution').text).toMatch(/manager’s word/);
    expect(o.qualified.state).toBe('not-eligible');
    expect(shiftCheck(approved(), roomWith())).toBeNull();
  });

  it('a 15-minute-late start at $24 is $6 observed, and the check says it fell short', () => {
    const shifts = SHIFTS.map((s) => (s.name === 'Di' ? { ...s, clock_in: '16:45', clock_out: '22:00' } : { ...s, clock_in: s.start, clock_out: s.end }));
    const o = staffingOutcome(approved(), roomWith({ shifts }));
    expect(o.observed).toMatchObject({ minutes: 15, rateCents: 2400, cents: 600, claim: 'obs', offsetMinutes: 0 });
    expect(o.clock.state).toBe('partial');
    expect(o.result).toBe('observed');
    expect(shiftCheck(approved(), roomWith({ shifts }))).toMatchObject({ ok: false });
  });

  it('the full 30 minutes matches the plan; another server clocking in early is an offset', () => {
    const shifts = SHIFTS.map((s) => (s.name === 'Di' ? { ...s, clock_in: '17:00', clock_out: '22:00' } : s.name === 'Ana' ? { ...s, clock_in: '15:45', clock_out: '22:00' } : { ...s, clock_in: s.start, clock_out: s.end }));
    const o = staffingOutcome(approved(), roomWith({ shifts }));
    expect(o.clock.state).toBe('matched');
    expect(o.observed).toMatchObject({ minutes: 30, cents: 1200, offsetMinutes: 15, offsetCents: 600, netCents: 600 });
    expect(shiftCheck(approved(), roomWith({ shifts }))).toMatchObject({ ok: true });
  });

  it('flags a night busier than the range it was sized for', () => {
    const shifts = SHIFTS.map((s) => ({ ...s, clock_in: s.name === 'Di' ? '17:00' : s.start, clock_out: s.end }));
    const busy = [...SERVICES, ...HOURS.map(([h]) => ({ date: TUE, hour: `${h}:00`, covers: 60, servers: 4 }))];
    const o = staffingOutcome(approved(), roomWith({ shifts, services: busy }));
    expect(o.guard.state).toBe('failed');
    expect(o.result).toBe('adverse');
  });
});
