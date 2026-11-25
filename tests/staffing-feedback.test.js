import { describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { applyInputs } from '../lib/data/apply.js';
import { guessColumns, mapColumns, parseCSV, validate } from '../lib/data/ingest.js';
import { mappingReview } from '../lib/data/page/inputs.js';
import { todayCards } from '../lib/data/page/today.js';
import { deriveRoom } from '../lib/data/model.js';
import { coveredNote, outlookChanges, staffingCards, staffingDecision, staffingOutcome, staffingSources } from '../lib/data/page/staffing.js';

/* The changes from customer feedback on comparable products, checked on one
 * dinner: Rosewood Oakland, Tuesday 2026-11-24, run by hand (three weeks of
 * dinners by hour and tonight's schedule typed on Data). */
const TUE = '2026-11-24';
const add = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const PAST = Array.from({ length: 21 }, (_, i) => add(TUE, -(i + 1)));
const HOURS = [[16, 6, 3], [17, 20, 4], [18, 36, 4], [19, 40, 4], [20, 24, 4], [21, 12, 4]];
const SERVICES = PAST.flatMap((d) => HOURS.map(([h, covers, servers]) => ({ date: d, hour: `${h}:00`, covers, servers })));
const sh = (name, start, end, extra = {}) => ({ date: TUE, role: 'Server', name, start, end, rate: 24, ...extra });
const SHIFTS = [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Carlos', '16:00', '22:00'), sh('Diana', '4:30 pm', '22:00')];
const ENTRIES = { shifts: { at: '2026-11-24T18:41:00Z', date: '2026-11-24', n: 4 }, services: { at: '2026-11-23T18:00:00Z', date: '2026-11-23', n: 126 } };
const ok = (kind, r) => { const v = validate(kind, r); expect(v.issues.filter((i) => i.level === 'error')).toEqual([]); return v.rows; };
const roomWith = ({ services = SERVICES, shifts = SHIFTS, extraServices = [] } = {}) =>
  ({ ...applyInputs(SEED, { oakland: { services: { rows: ok('services', [...services, ...extraServices]) }, shifts: { rows: ok('shifts', shifts) } } }).rooms.oakland, id: 'oakland' });
const at = (room, p = {}) => staffingDecision(room, { date: TUE, meal: 'dinner', today: TUE, nowMin: 11 * 60, entries: ENTRIES, ...p });
const task = (dec, extra = {}) => ({ approvalId: dec.approvalId, roomId: 'oakland', status: 'done', title: dec.title, createdAt: '2026-11-24T19:05:00Z',
  evidence: { change: dec.change, estimate: dec.estimate, forecast: dec.forecast, schedule: dec.schedule, approvedByName: 'Maria' }, ...extra });

describe('Check 1: the next action, its deadline and its reason, on the card itself', () => {
  it('the lead card carries the room, service, deadline, action, a short reason and the estimate', () => {
    const [card] = staffingCards(roomWith(), { today: TUE, nowMin: 11 * 60, entries: ENTRIES });
    expect(card.title).toBe('Review Diana’s 4:30 pm start before 3:30 pm');
    expect(card.due).toBe('Review before 3:30 pm');
    expect(card.staffing).toMatchObject({ room: 'Rosewood Oakland', label: 'Dinner', short: 'Diana starts at 5 pm', approvers: 'The GM or the owner' });
    expect(card.staffing.why.split('. ').length).toBeLessThanOrEqual(3);
    expect(card.value).toBe('about $12 before offsets');
    expect(card.claim).toBe('est');
  });

  it('a schedule entered for today replaces the sample’s own tonight staffing story, so there is one staffing decision, not two', () => {
    const room = roomWith();
    const d = deriveRoom(applyInputs(SEED, {}), 'oakland');
    const before = todayCards(d, { today: TUE, staffing: [] }).map((c) => c.id);
    expect(before).toContain('cut');
    const staffing = staffingCards(room, { today: TUE, nowMin: 11 * 60, entries: ENTRIES });
    const after = todayCards({ ...d, room: { ...d.room, shifts: room.shifts } }, { today: TUE, staffing }).map((c) => c.id);
    expect(after).not.toContain('cut');
    expect(after[0]).toBe(`staff:${TUE}:dinner`);
    expect(after).toContain('salmon');
  });
});

describe('Check 2: a covered shift stops warning; the rest stays', () => {
  const short = [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Carlos', '16:00', '22:00')];
  it('one more server covering the gap clears the call from the active list and keeps it as history', () => {
    const room = roomWith({ shifts: short });
    const d0 = at(room);
    expect(d0).toMatchObject({ state: 'act', kind: 'add', title: 'Add 1 server from 5 pm to 10 pm' });
    expect(staffingCards(room, { today: TUE, nowMin: 11 * 60, entries: ENTRIES }).map((c) => c.id)).toEqual([`staff:${TUE}:dinner`]);
    const seen = { title: d0.title, kind: d0.kind, version: d0.version, at: '2026-11-24T18:50:00Z' };
    // The GM covers it: Eve picks up 5 pm to 10 pm.
    const covered = roomWith({ shifts: [...short, sh('Eve', '17:00', '22:00')] });
    const d1 = at(covered);
    expect(d1.state).toBe('hold');
    expect(staffingCards(covered, { today: TUE, nowMin: 11 * 60, entries: ENTRIES })).toEqual([]);
    const note = coveredNote(seen, d1);
    expect(note).toMatchObject({ was: 'Add 1 server from 5 pm to 10 pm' });
    expect(note.text).toMatch(/now covers every hour/);
    // No warning left on the chart either: nothing short, nothing at risk from a change.
    expect(d1.window).toBeNull();
  });

  it('an unrelated open issue stays on Today after the shift is covered', () => {
    const d = deriveRoom(applyInputs(SEED, {}), 'oakland');
    const covered = roomWith({ shifts: [...short, sh('Eve', '17:00', '22:00')] });
    const cards = todayCards({ ...d, room: { ...d.room, shifts: covered.shifts } }, { today: TUE, staffing: staffingCards(covered, { today: TUE, nowMin: 11 * 60, entries: ENTRIES }) });
    expect(cards.map((c) => c.id)).not.toContain(`staff:${TUE}:dinner`);
    expect(cards.map((c) => c.id)).toEqual(expect.arrayContaining(['salmon', 'ot', 'recipes']));
  });

  it('a call that still needs a decision is never shown as covered', () => {
    const d0 = at(roomWith({ shifts: short }));
    expect(coveredNote({ title: 'x', version: 'y' }, d0)).toBeNull();
  });
});

describe('Service: one chart, one window, scheduled against needed against actual', () => {
  it('marks the one stretch at risk after the change', () => {
    const d = at(roomWith());
    expect(d.window).toMatchObject({ label: '4 pm–5 pm', why: 'No spare server if guests reach the top of the range' });
    const short = at(roomWith({ shifts: [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Carlos', '16:00', '22:00')] }), { adjust: [{ date: TUE, meal: 'dinner', hour: 19, guests: 30, reason: 'party', at: '2026-11-24T19:00:00Z' }] });
    expect(short.window.why).toMatch(/short if guests reach the top/);
  });

  it('puts who was on the clock and the guests who came beside the schedule and the need, hour by hour', () => {
    const room = roomWith({ shifts: SHIFTS.map((s) => ({ ...s, clock_in: s.name === 'Diana' ? '16:45' : s.start, clock_out: s.end })),
      extraServices: HOURS.map(([h, covers]) => ({ date: TUE, hour: `${h}:00`, covers: covers + 2, servers: 4 })) });
    const rows = at(room).hoursRows;
    expect(rows.map((r) => r.actual)).toEqual([3, 4, 4, 4, 4, 4]);
    expect(rows.map((r) => r.guests)).toEqual([8, 22, 38, 42, 26, 14]);
    expect(rows.map((r) => r.scheduled)).toEqual([3, 4, 4, 4, 4, 4]);
  });

  it('keeps the suggested time editable: nearer times are offered, each its own approval, and anything else is ignored', () => {
    const wide = [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Carlos', '16:00', '22:00'), sh('Diana', '16:00', '22:00'), sh('Eve', '16:00', '22:00')];
    const d = at(roomWith({ shifts: wide }));
    expect(d.title).toBe('Start Ana at 8 pm, not 4 pm');
    expect(d.options.map((o) => o.label)).toEqual(['8 pm', '7:30 pm', '7 pm', '6:30 pm', '6 pm']);
    const pick = d.options[2];
    const e = at(roomWith({ shifts: wide }), { choose: pick.approvalId });
    expect(e).toMatchObject({ state: 'act', title: 'Start Ana at 7 pm, not 4 pm', approvalId: pick.approvalId, edited: { from: '8 pm', to: '7 pm' } });
    expect(e.estimate.cents).toBe(7200);
    expect(at(roomWith({ shifts: wide }), { choose: 'shift:2026-11-24:dinner:start:server-ana-1600:2130' }).approvalId).toBe(d.approvalId);
  });
});

describe('Check 7: a GM forecast change keeps the original, the reason, and the actuals as they arrive', () => {
  const party = { list: [{ id: 'a1', date: TUE, meal: 'dinner', hour: 19, guests: 20, reason: 'party', note: 'Birthday, 20 people', at: '2026-11-24T19:30:00Z', by: 'Maria' }] };
  it('works the call out again on the change, and keeps the forecast it changed', () => {
    const d = at(roomWith(), { adjust: party });
    expect(d.forecast.original).toEqual({ covers: 138, high: 138 });
    expect(d.forecast.covers).toBe(158);
    expect(d.forecast.adjustments[0]).toMatchObject({ guests: 20, reason: 'party', label: 'Large party', by: 'Maria' });
    const h7 = d.hoursRows.find((r) => r.hour === 19);
    expect(h7).toMatchObject({ covers: 60, high: 60, adjusted: 20, orig: { covers: 40, peak: 40 } });
    expect(d.title).toBe('Add 1 server from 7 pm to 8 pm');
    // Another service's change doesn't touch this one.
    expect(at(roomWith(), { adjust: { list: [{ ...party.list[0], meal: 'lunch' }] } }).forecast.original).toBeNull();
  });

  it('says which data moved the outlook and when, newest first', () => {
    const d = at(roomWith(), { adjust: party });
    expect(d.changes.map((c) => c.what)).toEqual(['+20 guests at 7 pm: Large party (Birthday, 20 people)', 'Staff schedule saved', 'Guests by hour saved']);
    expect(outlookChanges({}, null, TUE, 'dinner')).toEqual([]);
  });

  it('once the guests are entered, the outcome shows the forecast, the change and what came in', () => {
    const base = at(roomWith(), { adjust: party });
    const after = roomWith({ shifts: SHIFTS, extraServices: HOURS.map(([h, covers]) => ({ date: TUE, hour: `${h}:00`, covers: h === 19 ? 55 : covers, servers: 4 })) });
    const o = staffingOutcome(task(base, { approvalId: 'shift:2026-11-24:dinner:add:1900:2000', title: base.title }), after);
    expect(o.guard.vs).toMatchObject({ forecast: 138, adjusted: 158, actual: 153 });
    expect(o.guard.vs.adjustments[0].label).toBe('Large party');
  });
});

describe('Check 8: the dollar opens its proof; offsets and a missing payroll record change what can count', () => {
  const dec = at(roomWith());
  const clocks = (extra = {}) => roomWith({ shifts: SHIFTS.map((s) => ({ ...s, clock_in: s.name === 'Diana' ? '16:45' : s.start, clock_out: s.end, ...(extra[s.name] || {}) })) });
  it('$12 estimated, $6 observed, nothing verified, and payroll is named as missing with who can add it', () => {
    const o = staffingOutcome(task(dec), clocks());
    expect(o.proof.amounts).toEqual({ estimated: 1200, observed: 600, verified: 0 });
    expect(o.proof.lines.map((l) => l.key)).toEqual(['decision', 'baseline', 'execution', 'records', 'estimate', 'calc', 'offsets', 'net']);
    expect(o.proof.lines.find((l) => l.key === 'baseline').text).toMatch(/Diana was scheduled 4:30 pm–10 pm/);
    expect(o.proof.lines.find((l) => l.key === 'calc')).toMatchObject({ text: '15 min × $24.00/hr', cents: 600, claim: 'obs' });
    expect(o.proof.payroll.state).toBe('missing');
    expect(o.proof.missing.map((m) => m.key)).toEqual(['payroll', 'guests']);
    expect(o.proof.missing[0].who).toMatch(/payroll/);
    expect(o.proof.countable).toMatchObject({ cents: 0, text: 'Nothing can count until payroll confirms the hours.' });
    expect(o.proof.verified.cents).toBe(0);
  });

  it('an offsetting cost (another server in early) comes off, and payroll lets the cautious figure count once verified', () => {
    const o = staffingOutcome(task(dec), clocks({ Ana: { clock_in: '15:50' }, Diana: { paid_hours: 5.25 } }));
    expect(o.proof.lines.find((l) => l.key === 'offsets')).toMatchObject({ text: 'Ana in 10 min early', cents: -400 });
    expect(o.proof.lines.find((l) => l.key === 'net').cents).toBe(200);
    expect(o.proof.payroll).toMatchObject({ state: 'matched', minutes: 15 });
    expect(o.proof.countable.cents).toBe(200);
    expect(o.proof.verified.cents).toBe(0);
  });

  it('payroll that paid more than the clock-ins shows the gap and counts the lower figure', () => {
    const o = staffingOutcome(task(dec), clocks({ Diana: { paid_hours: 5.5 } }));
    expect(o.proof.payroll).toMatchObject({ state: 'differs', minutes: 0 });
    expect(o.proof.countable.cents).toBe(0);
  });

  it('an added server is a cost, never a saving', () => {
    const d = at(roomWith({ shifts: [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Carlos', '16:00', '22:00')] }));
    const o = staffingOutcome(task(d), roomWith({ shifts: [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Carlos', '16:00', '22:00')] }));
    expect(o.proof.kind).toBe('cost');
    expect(o.proof.verified.cents).toBe(0);
  });
});

describe('Check 5: a pasted schedule with mismapped columns, a bad time and a real zero', () => {
  const CSV = ['Shift date,Employee Name,Position,In,Out,Paid hrs', `${TUE},Ana,Server,4:00 pm,10:00 pm,6`, `${TUE},Diana,Server,4:30 pm,25:00,0`].join('\n');
  it('suggests a column for every header and flags each guess for a yes', () => {
    const { headers } = parseCSV(CSV);
    const auto = mapColumns(headers, 'shifts').map;
    const guess = guessColumns(headers, 'shifts', auto);
    expect(auto).toEqual({ 'Shift date': 'date', Position: 'role' });
    expect(guess).toEqual({ 'Employee Name': 'name', In: 'clock_in', Out: 'clock_out', 'Paid hrs': 'paid_hours' });
    const review = mappingReview(headers, 'shifts', { ...auto, ...guess }, guess);
    expect(review.needsConfirm).toBe(true);
    expect(review.rows.find((r) => r.header === 'In')).toMatchObject({ how: 'guess' });
    expect(review.rows.find((r) => r.header === 'Position')).toMatchObject({ how: 'alias' });
  });

  it('the GM remaps In and Out to the shift times, fixes the bad time in the preview, and the zero stays a zero', () => {
    const { headers, rows } = parseCSV(CSV);
    const map = { 'Shift date': 'date', 'Employee Name': 'name', Position: 'role', In: 'start', Out: 'end', 'Paid hrs': 'paid_hours' };
    expect(headers).toEqual(Object.keys(map));
    const first = validate('shifts', rows, null, map, { now: new Date('2026-11-24T19:00:00Z') });
    expect(first.issues.filter((i) => i.level === 'error')).toEqual([expect.objectContaining({ row: 2, col: 'end' })]);
    // Fixed in the preview: the table's own cell.
    const fixed = rows.map((r, i) => (i === 1 ? { ...r, Out: '10:00 pm' } : r));
    const v = validate('shifts', fixed, null, map, { now: new Date('2026-11-24T19:00:00Z') });
    expect(v.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(v.rows[1]).toMatchObject({ name: 'Diana', start: '16:30', end: '22:00', paid_hours: 0 });
    // A blank is not a zero.
    const blank = validate('services', [{ date: PAST[0], hour: '17:00', covers: '', servers: 4 }]);
    expect(blank.issues[0].msg).toBe('Guests is blank. Type 0 if it really was none');
    expect(validate('services', [{ date: PAST[0], hour: '17:00', covers: 0, servers: 4 }]).rows[0].covers).toBe(0);
  });
});

describe('Check 6 (pure part): Data’s status rows say what saved, what failed and what it blocks', () => {
  it('a failed attempt after a good save leaves the good save named as the one in use', () => {
    const room = roomWith();
    const dec = at(room);
    const src = staffingSources(room, { date: TUE, meal: 'dinner', entries: ENTRIES, readiness: dec.readiness, attempts: { shifts: { at: '2026-11-24T19:12:00Z', ok: false, error: 'No connection', rows: 4 } } });
    const s = src.find((x) => x.kind === 'shifts');
    expect(s).toMatchObject({ title: 'Staff schedule', room: 'Rosewood Oakland', period: 'Tue, Nov 24', source: 'Entered on Data', failed: true, lastGood: { rows: 4 }, blocks: null });
    expect(s.attempt).toMatchObject({ ok: false, error: 'No connection' });
    const g = src.find((x) => x.kind === 'services');
    expect(g).toMatchObject({ failed: false, period: 'Tue, Nov 3 – Mon, Nov 23', lastGood: { rows: 126 } });
  });

  it('a missing schedule says which decision it blocks', () => {
    const room = roomWith({ shifts: [sh('Ana', '16:00', '22:00', { date: add(TUE, 1) })] });
    const dec = at(room, { entries: { services: ENTRIES.services } });
    const s = staffingSources(room, { date: TUE, meal: 'dinner', entries: { services: ENTRIES.services }, readiness: dec.readiness }).find((x) => x.kind === 'shifts');
    expect(s).toMatchObject({ state: 'missing', blocks: 'Blocks the staffing check for dinner · Tue, Nov 24', source: 'Sample data' });
    expect(s.fix).toMatchObject({ kind: 'shifts' });
  });
});
