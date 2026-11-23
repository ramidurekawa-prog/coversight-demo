/**
 * The pre-shift staffing decision, pure. Today, Service, Data and the server
 * all call these, so the card on Today, the panel on Service, the readiness
 * rows on Data and the server's refusal can't disagree.
 *
 * For one room, date and service (lunch or dinner):
 *  - staffingReadiness(): what the call needs (service history by hour, a
 *    schedule for that service, a pay rate for a dollar figure, clock-ins
 *    afterwards for proof), each ready, limited, stale or missing, with the
 *    exact input that fixes it.
 *  - staffingDecision(): the one call. Demand is the forecast's need per hour
 *    (servicePlan: Covercast where it runs on the same data, else the busiest
 *    of the room's recent same weekdays), compared with the servers actually
 *    scheduled, never the usual night. At most one change: a later start, an
 *    earlier end, or one more server for a short stretch. A lower forecast
 *    alone never sends anyone home: every guardrail has to pass.
 *  - staffingOutcome(): after an approval, what happened. Decision, marked
 *    made (the manager's word), clock-ins (the record), the observed
 *    straight-time difference and its offsets, and whether it can qualify.
 *
 * Money is integer cents. Every figure carries its claim: the estimate is
 * Estimated, a clock-in difference is Observed, nothing here is Bookable.
 */
import { addDays, allServiceHours, clockLabel, dayOfDate, fencesOf, hhmm, historySource, isServer, MEALS, mealOf, MIN_CALIBRATED, servicePlan } from './service.js';

export const RULE_VERSION = 'staffing.v1';
/** Decide at least this long before the shift that changes, so the person can be told. */
export const LEAD_MIN = 60;
/** The smallest change worth a manager's call. */
export const MIN_MOVE = 30;
/** Changes are sized in steps of this many minutes. */
export const STEP_MIN = 30;
/** A schedule saved more than this many days before its date needs a second look. */
export const SCHEDULE_STALE_DAYS = 7;
/** A clock-in this close to the planned time counts as the change being made. */
export const CLOCK_TOLERANCE_MIN = 5;
/** Comparable services before and after that the labor-hours method in the spec calls for (not built yet; see qualification). */
export const METHOD_TARGET = { before: 8, after: 4 };

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '')); return m ? +m[1] * 60 + +m[2] : null; };
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
const cents = (dollars) => Math.round(dollars * 100);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DAYNAME = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };

/** "2026-11-24" → "Tue Nov 24". */
export const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
/** Minutes after midnight (may pass 24:00) → "4:30 pm". */
export const timeLabel = (min) => clockLabel(((min % 1440) + 1440) % 1440);

/** The card id for a service's staffing call. One per room, date and service. */
export const staffingCardId = (date, meal) => `staff:${date}:${meal}`;
/** Approval ids for a staffing change: `shift:<date>:<meal>:<kind>:<shift>:<to>`. */
export const isShiftFor = (approvalId, date, meal) => String(approvalId || '').startsWith(`shift:${date}:${meal}:`);
export function parseShiftId(approvalId) {
  const m = /^shift:(\d{4}-\d{2}-\d{2}):(lunch|dinner):(start|end|add):([a-z0-9-]{1,40}):(\d{4})$/.exec(String(approvalId || ''));
  if (!m) return null;
  return { date: m[1], meal: m[2], kind: m[3], shift: m[4], to: +m[5].slice(0, 2) * 60 + +m[5].slice(2) };
}
const hm = (min) => hhmm(((min % 1440) + 1440) % 1440).replace(':', '');

/** One shift, read: minutes after midnight (an end past midnight is over 1440), whether it serves tables, and who. */
function readShift(r) {
  const start = toMin(r.start);
  let end = toMin(r.end);
  if (start == null || end == null) return null;
  if (end <= start) end += 1440;
  const near = (t) => { if (t == null) return null; let v = t; if (v < start - 12 * 60) v += 1440; return v; };
  const clockIn = near(toMin(r.clock_in));
  let clockOut = near(toMin(r.clock_out));
  if (clockOut != null && clockIn != null && clockOut <= clockIn) clockOut += 1440;
  const who = r.name ? String(r.name) : null;
  return {
    key: `${slug(r.role)}${who ? `-${slug(who)}` : ''}-${hm(start)}`.slice(0, 40), date: r.date, role: String(r.role), name: who,
    start, end, rate: Number.isFinite(r.rate) && r.rate > 0 ? r.rate : null, clockIn, clockOut, server: isServer(r.role),
  };
}

/** The room's shifts on a date, in start order. */
export function shiftsOn(room, date) {
  return (room?.shifts || []).filter((r) => r.date === date).map(readShift).filter(Boolean).sort((a, b) => a.start - b.start);
}

/** Does a shift work this service? It overlaps the service's hours (with an hour either side for setup and close). */
const inMeal = (s, meal) => { const M = MEALS[meal]; return s.start < (M.to + 1) * 60 && s.end > (M.from - 1) * 60; };
/** Servers on through a half hour starting at `t` (minutes). */
const onAt = (shifts, t) => shifts.filter((s) => s.start <= t && s.end >= t + 30).length;
/** Servers on in an hour, at its thinnest half hour: a 5:30 start doesn't cover 5:00. */
const onIn = (shifts, hour) => Math.min(onAt(shifts, hour * 60), onAt(shifts, hour * 60 + 30));

/** The schedule for one service: its server shifts, every role's count, and when it was saved. */
export function scheduleFor(room, date, meal, entry = null) {
  const all = shiftsOn(room, date).filter((s) => inMeal(s, meal));
  if (!all.length) return null;
  const servers = all.filter((s) => s.server);
  return { date, meal, shifts: all, servers, roles: [...new Set(all.map((s) => s.role))], savedAt: entry?.at ?? null, savedLabel: entry?.date ?? null };
}

/**
 * The plan for a service with the schedule laid over it: each hour's need
 * (from the forecast, never below the room's own minimum) and the servers
 * scheduled. Without a schedule, `scheduled` is null for every hour.
 */
export function staffingPlan(room, { date, meal, fences = null, cc = null }) {
  const day = dayOfDate(date);
  // Covercast is only used on the data it reads (Toast or the sample); a typed history stands on its own.
  const src = historySource(room);
  const plan = servicePlan(room, day, fences, meal, src === 'hand' ? null : cc);
  return plan;
}

/** Hour rows for the decision and the chart: need, scheduled now, scheduled after the change. */
function hourRows(plan, servers, change) {
  const after = change ? servers.map((s) => (s.key === change.shift?.key ? { ...s, start: change.kind === 'start' ? change.to : s.start, end: change.kind === 'end' ? change.to : s.end } : s)) : servers;
  return plan.hours.map((h) => {
    const floor = h.floor ?? 0;
    const need = Math.max(h.need, floor);
    const scheduled = onIn(servers, h.hour);
    const add = change?.kind === 'add' && h.hour * 60 >= change.from && h.hour * 60 < change.to ? 1 : 0;
    // Each half hour on its own, so a 30-minute move shows on the chart.
    const halves = [0, 30].map((m) => { const t = h.hour * 60 + m; const plus = change?.kind === 'add' && t >= change.from && t < change.to ? 1 : 0; return { t, scheduled: onAt(servers, t), after: onAt(after, t) + plus }; });
    return { hour: h.hour, label: clockLabel(h.hour * 60), covers: h.covers, high: h.peak, low: h.low ?? null, demand: h.need, floor, need, byRule: floor > h.need, scheduled, after: onIn(after, h.hour) + add, usual: h.servers, halves };
  });
}

/** A start moved later, or an end moved earlier, as far as every hour it touches still covers its need. */
function bestMove(plan, servers) {
  const planned = new Set(plan.hours.map((h) => h.hour));
  const needAt = new Map(plan.hours.map((h) => [h.hour, Math.max(h.need, h.floor ?? 0)]));
  const fits = (list, from, to) => {
    for (let h = Math.floor(from / 60); h * 60 < to; h++) {
      if (!planned.has(h)) return false; // an hour with no history is never judged spare
      if (onIn(list, h) < needAt.get(h)) return false;
    }
    return true;
  };
  let best = null;
  for (const s of servers) {
    for (const kind of ['start', 'end']) {
      let to = null;
      for (let t = kind === 'start' ? s.start + STEP_MIN : s.end - STEP_MIN; kind === 'start' ? t <= s.end - 2 * 60 : t >= s.start + 2 * 60; t += kind === 'start' ? STEP_MIN : -STEP_MIN) {
        const moved = servers.map((x) => (x === s ? { ...x, [kind]: t } : x));
        const [from, until] = kind === 'start' ? [s.start, t] : [t, s.end];
        if (!fits(moved, from, until)) break;
        to = t;
      }
      if (to == null) continue;
      const minutes = kind === 'start' ? to - s.start : s.end - to;
      if (minutes < MIN_MOVE) continue;
      const deadline = s.start - LEAD_MIN;
      const cand = { kind, shift: s, from: kind === 'start' ? s.start : s.end, to, minutes, deadline };
      // The biggest change first; on a tie, a later start (the person still works the rush).
      if (!best || minutes > best.minutes || (minutes === best.minutes && kind === 'start' && best.kind === 'end')) best = cand;
    }
  }
  return best;
}

/** The first stretch of hours with fewer servers scheduled than the forecast needs. */
function shortStretch(rows) {
  const i = rows.findIndex((r) => r.scheduled < r.need);
  if (i < 0) return null;
  let j = i;
  while (j + 1 < rows.length && rows[j + 1].scheduled < rows[j + 1].need) j++;
  const gap = Math.max(...rows.slice(i, j + 1).map((r) => r.need - r.scheduled));
  return { from: rows[i].hour * 60, to: (rows[j].hour + 1) * 60, gap, deadline: rows[i].hour * 60 - 2 * LEAD_MIN };
}

/** The pay rate a change is priced at: the shift's own, else the room's usual wage, labelled by where it came from. */
function rateFor(room, shift) {
  if (shift?.rate) return { cents: cents(shift.rate), from: 'shift', label: `${shift.name || shift.role}’s rate on the schedule` };
  const w = room?.levers?.wage;
  if (Number.isFinite(w) && w > 0) return room.fromToast ? { cents: cents(w), from: 'toast', label: 'the room’s blended wage from Toast time entries' } : { cents: cents(w), from: 'sample', label: 'the sample room’s wage' };
  return null;
}

const SOURCE_LABEL = { hand: 'Your guests-by-hour entries', toast: 'Your Toast data', sample: 'Sample restaurant data' };

/**
 * What the staffing call needs for one service, each item ready, limited,
 * stale or missing, with the input that fixes it. The same list decides
 * whether staffingDecision() may recommend a change.
 * @param {any} room the applied room
 * @param {{ date: string, meal: 'lunch'|'dinner', today?: string, fences?: any, cc?: any, entries?: Record<string, { at?: string, date?: string }> }} p
 */
export function staffingReadiness(room, { date, meal, today = date, fences = null, cc = null, entries = {} }) {
  const M = MEALS[meal];
  const day = dayOfDate(date);
  const Day = DAYNAME[day] ?? day;
  const meals = M.label.toLowerCase();
  const plan = staffingPlan(room, { date, meal, fences, cc });
  const src = historySource(room);
  const sched = scheduleFor(room, date, meal, entries.shifts);
  const fix = (kind, label) => ({ kind, label, date, meal });
  const items = [];
  // 1. History by hour: what the forecast and the need per hour stand on.
  const weeks = plan?.weeks ?? 0;
  // History typed for this weekday, but too few busy hours overall to measure a server's pace (servicePlan needs 20).
  const typedDays = !plan ? new Set(allServiceHours(room).filter((h) => h.day === day && mealOf(h.hour) === meal && h.date).map((h) => h.date)).size : 0;
  items.push(!plan && typedDays
    ? { key: 'history', label: `Past ${Day} ${meals}s by hour`, state: 'limited', need: 'required', detail: `${plural(typedDays, `past ${Day} ${meals}`)} entered. Not enough busy hours yet to measure how many guests a server handles. Add a few more past ${meals}s, any day of the week.`, fix: fix('services', `Add more past ${meals}s`), unlocks: 'The servers each hour needs', source: src }
    : !plan
    ? { key: 'history', label: `Past ${Day} ${meals}s by hour`, state: 'missing', need: 'required', detail: `No ${Day} ${meals} with guests and servers by hour yet. ${MIN_CALIBRATED} are needed.`, fix: fix('services', `Add past ${meals}s by hour`), unlocks: `A ${meals} forecast for ${Day}s and the servers it needs each hour` }
    : weeks < MIN_CALIBRATED
      ? { key: 'history', label: `Past ${Day} ${meals}s by hour`, state: 'limited', need: 'required', detail: `${plural(weeks, `past ${Day} ${meals}`)} by hour. ${MIN_CALIBRATED} are needed before a change is suggested.`, fix: fix('services', `Add ${MIN_CALIBRATED - weeks} more ${Day} ${meals}${MIN_CALIBRATED - weeks === 1 ? '' : 's'}`), unlocks: 'Staffing changes, once the range is measured on enough services', source: src }
      : { key: 'history', label: `Past ${Day} ${meals}s by hour`, state: 'ready', need: 'required', detail: `${plural(weeks, `${Day} ${meals}`)} · ${SOURCE_LABEL[src]}`, source: src });
  // 2. The schedule for this service.
  const staleDays = sched?.savedAt ? Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.parse(sched.savedAt)) / 864e5) : null;
  items.push(!sched
    ? { key: 'schedule', label: `${shortDate(date)} ${meals} schedule`, state: 'missing', need: 'required', detail: `No shifts entered for ${meals} on ${shortDate(date)}. Without them there’s nothing to check the forecast against.`, fix: fix('shifts', `Add ${date === today ? 'today’s' : `${shortDate(date)}’s`} ${meals} schedule`), unlocks: 'The staffing check for this service' }
    : !sched.servers.length
      ? { key: 'schedule', label: `${shortDate(date)} ${meals} schedule`, state: 'missing', need: 'required', detail: `${plural(sched.shifts.length, 'shift')} entered, none for servers. Server shifts are what this check reads.`, fix: fix('shifts', 'Add the server shifts'), unlocks: 'The staffing check for this service' }
      : staleDays != null && staleDays > SCHEDULE_STALE_DAYS
        ? { key: 'schedule', label: `${shortDate(date)} ${meals} schedule`, state: 'stale', need: 'required', detail: `Saved ${staleDays} days before the service. Confirm it’s still who is working.`, fix: fix('shifts', `Refresh the ${meals} schedule`), unlocks: 'Staffing changes for this service' }
        : { key: 'schedule', label: `${shortDate(date)} ${meals} schedule`, state: 'ready', need: 'required', detail: `${plural(sched.servers.length, 'server shift')}${sched.shifts.length > sched.servers.length ? ` and ${sched.shifts.length - sched.servers.length} other` : ''}${sched.savedLabel ? ` · saved ${sched.savedLabel}` : ''}` });
  // 3. A pay rate: only the dollar figure depends on it.
  const rate = sched?.servers?.some((s) => s.rate) ? { from: 'shift' } : rateFor(room, null);
  items.push(rate
    ? { key: 'wage', label: 'Pay rate', state: rate.from === 'sample' ? 'limited' : 'ready', need: 'dollars', detail: rate.from === 'shift' ? 'From the schedule’s hourly rates' : rate.from === 'toast' ? 'The room’s blended wage from Toast' : 'Sample wage. Add hourly rates to the schedule for your own.', fix: rate.from === 'sample' ? fix('shifts', 'Add hourly rates') : null }
    : { key: 'wage', label: 'Pay rate', state: 'missing', need: 'dollars', detail: 'No hourly rates, so a change shows hours, not dollars.', fix: fix('shifts', 'Add hourly rates'), unlocks: 'The dollar estimate' });
  // 4. Clock-ins: needed after the service to show the change was made.
  const clocked = sched?.servers?.some((s) => s.clockIn != null);
  items.push({ key: 'clock', label: 'Clock-ins after the shift', state: clocked ? 'ready' : 'later', need: 'proof', detail: clocked ? 'Clock-in times are entered' : 'Add when people clocked in and out after the shift. That is what shows a change was really made.', fix: clocked ? null : fix('shifts', 'Add clock-ins') });
  const blocker = items.find((x) => x.need === 'required' && x.state !== 'ready') ?? null;
  return { date, meal, items, ready: !blocker, blocker, plan, schedule: sched, source: src };
}

/** A short fingerprint of what a decision rests on, so "the facts changed" can be told apart from a retry. */
function versionOf(x) {
  const s = JSON.stringify(x);
  let a = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return a.toString(16).padStart(8, '0');
}

/**
 * The staffing call for one service.
 * state: act (a change passes every guardrail) · hold (coverage fits, or a
 * guardrail says no) · blocked (data missing or stale) · late (past the time
 * to decide) · live (the service has started: Service's live call takes over)
 * · over · closed (no history and no schedule for this service) · decided (a
 * change is already approved; `task` is it).
 * @param {any} room
 * @param {{ date: string, meal: 'lunch'|'dinner', today: string, nowMin: number, fences?: any, cc?: any, tasks?: any[], entries?: any }} p
 */
export function staffingDecision(room, { date, meal, today, nowMin, fences = null, cc = null, tasks = [], entries = {} }) {
  const M = MEALS[meal];
  const day = dayOfDate(date);
  const Day = DAYNAME[day] ?? day;
  const meals = M.label.toLowerCase();
  const f = fencesOf(fences);
  const r = staffingReadiness(room, { date, meal, today, fences, cc, entries });
  const { plan, schedule: sched } = r;
  const base = { id: staffingCardId(date, meal), date, meal, day, label: M.label, readiness: r, rule: RULE_VERSION, fences: f };
  const task = (tasks || []).find((t) => (!t.roomId || !room?.id || t.roomId === room.id) && isShiftFor(t.approvalId, date, meal) && ['open', 'done', 'verified', 'mismatch'].includes(t.status)) ?? null;
  const isToday = date === today;
  const started = isToday && nowMin >= M.from * 60 - 30;
  const over = isToday && nowMin >= M.to * 60;
  if (!plan && !sched) return { ...base, state: 'closed', title: `No ${meals} on ${Day}s in your data`, why: `If you open for ${meals}, add its schedule and past ${meals}s by hour.`, task };
  if (task) return { ...base, state: 'decided', task, approvalId: task.approvalId, title: task.title, why: 'A change for this service is already approved.' };
  if (over) return { ...base, state: 'over', title: `${M.label} is over`, why: 'Add clock-ins to see what happened.' };
  if (started) return { ...base, state: 'live', title: `${M.label} is under way`, why: 'Service’s live call takes over once guests are in.' };
  if (r.blocker) return { ...base, state: 'blocked', title: r.blocker.fix?.label ?? r.blocker.label, why: r.blocker.detail, blocker: r.blocker };

  const servers = sched.servers;
  const fc = plan.engine ? { covers: plan.hours.reduce((t, h) => t + h.covers, 0), low: plan.engine.low != null && plan.engine.covers ? Math.round((plan.hours.reduce((t, h) => t + h.covers, 0) * plan.engine.low) / plan.engine.covers) : null, high: plan.engine.high != null && plan.engine.covers ? Math.round((plan.hours.reduce((t, h) => t + h.covers, 0) * plan.engine.high) / plan.engine.covers) : null, engine: 'Covercast' }
    : { covers: plan.hours.reduce((t, h) => t + h.covers, 0), low: null, high: plan.hours.reduce((t, h) => t + h.peak, 0), engine: null };
  const forecast = { ...fc, weeks: plan.weeks, source: r.source, rate: Math.round(plan.rate * 10) / 10, hours: `${clockLabel(plan.hours[0].hour * 60)}–${clockLabel((plan.hours[plan.hours.length - 1].hour + 1) * 60)}` };
  const scheduleInfo = { n: sched.shifts.length, servers: servers.length, savedAt: sched.savedAt, savedLabel: sched.savedLabel, source: entries.shifts ? 'hand' : 'sample' };

  // One more server first: a short floor costs sales and guests, so it outranks a saving.
  const rows0 = hourRows(plan, servers, null);
  const short = shortStretch(rows0);
  const move = short ? null : bestMove(plan, servers);
  const change = short ? { kind: 'add', from: short.from, to: short.to, gap: short.gap, minutes: short.to - short.from, deadline: short.deadline }
    : move ? { kind: move.kind, shift: move.shift, from: move.from, to: move.to, minutes: move.minutes, deadline: move.deadline } : null;
  const hours = hourRows(plan, servers, change);
  const evidence = { forecast, schedule: scheduleInfo, hours: hours.map(({ hour, covers, high, need, demand, floor, scheduled, after }) => ({ hour, covers, high, need, demand, floor, scheduled, after })) };
  const version = versionOf({ change: change && { kind: change.kind, from: change.from, to: change.to, shift: change.shift?.key }, hours: evidence.hours, f });

  if (!change) {
    return { ...base, ...evidence, hoursRows: hours, version, state: 'hold', title: 'No change recommended. Coverage meets the current plan.',
      why: `${forecast.engine ? 'Covercast expects' : `A usual ${Day} ${meals} has`} ${forecast.covers} guests${forecast.high ? `, up to ${forecast.high}` : ''}, and every hour has the servers it needs at the top of that range, no more.` };
  }
  const who = change.shift ? (change.shift.name || `the ${change.shift.role.toLowerCase()}`) : null;
  const whoCap = who ? who.charAt(0).toUpperCase() + who.slice(1) : null;
  const deadlineOk = !isToday || nowMin <= change.deadline;
  const rate = change.kind === 'add' ? rateFor(room, servers.find((s) => s.rate) ?? null) : rateFor(room, change.shift);
  const estimate = rate ? { minutes: change.minutes, rateCents: rate.cents, rateFrom: rate.from, rateLabel: rate.label, cents: Math.round((change.minutes / 60) * rate.cents), claim: 'est', cost: change.kind === 'add' } : null;
  const touched = hours.filter((h) => h.hour * 60 >= Math.min(change.from, change.to) - 59 && h.hour * 60 < Math.max(change.from, change.to));
  const guardrails = [
    { key: 'history', label: `Forecast measured on ${plural(plan.weeks, `past ${Day} ${meals}`)}`, ok: plan.weeks >= MIN_CALIBRATED },
    { key: 'schedule', label: `Checked against the ${shortDate(date)} schedule, not a usual night`, ok: true },
    { key: 'demand', label: change.kind === 'add' ? 'The added server covers every short hour at the top of the range' : 'Every hour it touches still covers the top of the likely range', ok: true },
    { key: 'floor', label: `At least ${meal === 'dinner' ? f.minDinner : f.minAny} servers stay on ${meal === 'dinner' ? 'dinner' : 'the floor'} (your minimum)`, ok: hours.every((h) => h.after >= h.floor) },
    { key: 'time', label: `Decided by ${timeLabel(change.deadline)}, ${LEAD_MIN} minutes before the shift${isToday ? '' : ` on ${shortDate(date)}`}`, ok: deadlineOk },
    { key: 'sections', label: 'Sections and other roles stay covered', ok: null, note: 'Your call: the schedule doesn’t say who covers which section.' },
    { key: 'reservations', label: 'Large parties or events booked for this service', ok: null, note: 'No reservation feed is connected. Check the book first.' },
  ];
  const head = change.kind === 'add'
    ? { title: `Add 1 server from ${timeLabel(change.from)} to ${timeLabel(change.to)}`, card: `Review ${meals} coverage from ${timeLabel(change.from)} before ${timeLabel(change.deadline)}`, short: `Add 1 server ${timeLabel(change.from)}–${timeLabel(change.to)}` }
    : change.kind === 'start'
      ? { title: `Start ${who} at ${timeLabel(change.to)}, not ${timeLabel(change.from)}`, card: `Review ${who}’s ${timeLabel(change.from)} start before ${timeLabel(change.deadline)}`, short: `${whoCap} starts at ${timeLabel(change.to)}` }
      : { title: `End ${who}’s shift at ${timeLabel(change.to)}, not ${timeLabel(change.from)}`, card: `Review ${who}’s ${timeLabel(change.from)} finish before ${timeLabel(change.deadline)}`, short: `${whoCap} ends at ${timeLabel(change.to)}` };
  // The hour that makes the case: the shortest one for an added server, the busiest one a move still covers.
  const t0 = [...touched].sort((a, b) => (change.kind === 'add' ? (b.need - b.scheduled) - (a.need - a.scheduled) : b.high - a.high) || a.hour - b.hour)[0];
  const why = change.kind === 'add'
    ? `${forecast.engine ? 'Covercast expects' : 'The busiest recent'} ${t0 ? `${t0.high} guests at ${t0.label}` : 'a rush'}${forecast.engine ? ' at the top of its range' : ` ${Day}`}. That needs ${t0?.need ?? '—'} servers and ${t0?.scheduled ?? '—'} are scheduled.`
    : `${forecast.engine ? 'Covercast expects' : `The busiest recent ${Day} had`} up to ${t0 ? t0.high : '—'} guests${t0 ? ` at ${t0.label}` : ''}, and ${t0 ? t0.need : '—'} server${t0?.need === 1 ? '' : 's'} cover that. ${whoCap}’s ${timeLabel(Math.min(change.from, change.to))}–${timeLabel(Math.max(change.from, change.to))} isn’t needed for it.`;
  const risk = change.kind === 'add'
    ? 'If guests come in at the low end, the extra server is idle for part of the stretch.'
    : `If guests run above the range, ${t0 ? t0.after : '—'} servers are on from ${timeLabel(Math.min(change.from, change.to))}. Your minimum still holds.`;
  const approvalId = change.kind === 'add'
    ? `shift:${date}:${meal}:add:${hm(change.from)}:${hm(change.to)}`
    : `shift:${date}:${meal}:${change.kind}:${change.shift.key}:${hm(change.to)}`;
  const diff = change.kind === 'add'
    ? [[`Servers ${timeLabel(change.from)}–${timeLabel(change.to)}`, String(t0?.scheduled ?? ''), String((t0?.scheduled ?? 0) + 1)]]
    : [[`${whoCap} ${change.kind === 'start' ? 'start' : 'end'}, ${shortDate(date)}`, timeLabel(change.from), timeLabel(change.to)]];
  const failed = guardrails.find((g) => g.ok === false);
  const state = !deadlineOk ? 'late' : failed ? 'hold' : 'act';
  return {
    ...base, ...evidence, hoursRows: hours, version, state, kind: change.kind, change: { ...change, shift: change.shift ? { key: change.shift.key, role: change.shift.role, name: change.shift.name, start: change.shift.start, end: change.shift.end, rate: change.shift.rate } : null },
    approvalId: state === 'act' ? approvalId : null, proposedId: approvalId, title: state === 'late' ? `Too late to change the ${timeLabel(change.kind === 'add' ? change.from : change.shift.start)} shift` : head.title,
    cardTitle: head.card, short: head.short, why: state === 'late' ? `${head.title} would have fit, but it’s past ${timeLabel(change.deadline)}. Keep the schedule and let Service’s live call watch it.` : why,
    risk, estimate, guardrails, deadline: { min: change.deadline, label: timeLabel(change.deadline) }, diff,
    task: null, system: 'Your schedule',
  };
}

/**
 * The evidence kept with an approved change, so it can be traced after new data arrives.
 * @param {any} dec
 * @param {{ at: string, by?: string|null, roomId?: string }} p
 */
export function evidenceOf(dec, { at, by = null, roomId }) {
  return {
    v: 1, rule: dec.rule, roomId, date: dec.date, meal: dec.meal, card: dec.id, approvalId: dec.approvalId, version: dec.version, approvedAt: at, approvedBy: by,
    change: dec.change, estimate: dec.estimate, forecast: dec.forecast, schedule: dec.schedule, hours: dec.hours, guardrails: dec.guardrails, fences: dec.fences,
    sources: dec.readiness.items.map((x) => ({ key: x.key, state: x.state, detail: x.detail })),
  };
}

/**
 * Today's staffing cards: one per service still ahead today, or tomorrow's
 * once today's are over. Only calls that need the manager become cards (a
 * change to review, data to add); "no change" and services under way don't.
 * A sample room shows one only once a schedule has been entered for it.
 * @param {any} room
 * @param {{ today: string, nowMin: number, fences?: any, cc?: any, tasks?: any[], entries?: any }} p
 * @returns {any[]}
 */
export function staffingCards(room, { today, nowMin, fences = null, cc = null, tasks = [], entries = {} }) {
  const own = !!(room?.fromToast || room?.serviceOwn);
  if (!own && !(room?.shifts || []).length) return [];
  const dates = [today];
  const tdy = ['lunch', 'dinner'].map((meal) => staffingDecision(room, { date: today, meal, today, nowMin, fences, cc, tasks, entries }));
  if (tdy.every((d) => ['over', 'live', 'closed', 'decided'].includes(d.state) || d.state === 'late')) dates.push(addDays(today, 1));
  const decisions = [...tdy, ...(dates.length > 1 ? ['lunch', 'dinner'].map((meal) => staffingDecision(room, { date: dates[1], meal, today, nowMin, fences, cc, tasks, entries })) : [])];
  // One "add this data" card at a time (the next service's), so a room without a schedule isn't told twice a day.
  const firstBlocked = decisions.find((d) => d.state === 'blocked');
  return decisions.filter((d) => ['act', 'decided'].includes(d.state) || d === firstBlocked).map((d) => cardOf(d, today));
}

function cardOf(d, today) {
  const when = d.date === today ? (d.meal === 'lunch' ? 'today’s lunch' : 'tonight') : `${shortDate(d.date)} ${d.label.toLowerCase()}`;
  const common = { id: d.id, area: 'labor', staffing: d, when: `staffing:${d.date}:${d.meal}`, deadline: d.date === today ? 'today' : shortDate(d.date) };
  if (d.state === 'decided') return { ...common, tone: 'accent', icon: 'CalendarClock', title: d.task.title, body: d.why, claim: 'est', value: 'Approved', primary: 'Review', approval: d.task.approvalId };
  if (d.state === 'blocked') {
    const fx = d.blocker.fix;
    return { ...common, tone: 'warn', icon: fx?.kind === 'services' ? 'Clock' : 'CalendarClock', title: fx?.label ?? d.title, body: `${d.blocker.detail} It’s what the staffing check for ${when} needs.`, claim: 'none', value: `Unlocks the staffing check for ${when}`, primary: fx?.label ?? 'Add data', go: 'inputs', input: fx?.kind ?? 'shifts', affects: `Staffing check for ${when}` };
  }
  const e = d.estimate;
  const money = e && !e.cost ? `about $${(e.cents / 100).toFixed(2).replace(/\.00$/, '')}` : null;
  return {
    ...common, tone: d.kind === 'add' ? 'warn' : 'accent', icon: d.kind === 'add' ? 'UserPlus' : 'UserMinus', title: d.cardTitle, body: `${d.short}. ${d.why}`, claim: 'est',
    value: money ? `${money} before offsets` : d.kind === 'add' ? 'Covers the rush' : `${d.change.minutes} minutes of labor`, means: money ? 'Estimated labor cost for this shift, before offsets' : undefined, unit: money ? 'this shift' : undefined,
    primary: 'Review', approval: d.approvalId, refuse: true, due: `Review before ${d.deadline.label}${d.date === today ? '' : ` on ${shortDate(d.date)}`}`,
  };
}

/**
 * What became of an approved staffing change, stage by stage, from the task
 * and the room's schedule as it is now. Nothing here is bookable: a single
 * service has no verification method in this build (see `qualified`).
 * @param {any} task a task whose approvalId is a shift id, with its evidence
 * @param {any} room the applied room
 */
export function staffingOutcome(task, room) {
  const id = parseShiftId(task?.approvalId);
  if (!id) return null;
  const ev = task.evidence || null;
  const change = ev?.change ?? null;
  const stages = [];
  stages.push({ key: 'opportunity', label: 'Recommended', state: 'done', text: ev ? `${ev.change?.kind === 'add' ? 'One more server' : `${ev.change?.minutes} minutes`} · forecast ${ev.forecast?.covers ?? '—'} guests${ev.forecast?.high ? `, up to ${ev.forecast.high}` : ''}` : 'Recommended (no evidence kept: approved before this was recorded)', claim: 'est' });
  stages.push({ key: 'decision', label: 'Approved', state: 'done', text: `${task.createdAt ? new Date(task.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}${ev?.approvedByName ? ` by ${ev.approvedByName}` : ''}`.trim() || 'Approved' });
  const made = task.status === 'done' || task.status === 'verified' || task.status === 'mismatch';
  stages.push({ key: 'execution', label: 'Marked made', state: made ? 'done' : 'waiting', text: made ? `Reported by the manager${task.doneAt ? `, ${new Date(task.doneAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}. A manager’s word, not a record.` : 'Waiting for someone to make the change and mark it made.' });

  // Clock evidence: the same person's shift that day, if clock-ins are in.
  const shifts = shiftsOn(room, id.date);
  const orig = change?.shift ?? null;
  let clock = { state: 'waiting', text: 'No clock-ins entered for this shift yet. Add them on Data after the shift.' };
  let observed = null;
  if (id.kind !== 'add' && orig) {
    const same = shifts.filter((s) => s.role === orig.role && (orig.name ? s.name === orig.name : true) && s.clockIn != null);
    const hit = orig.name ? same[0] : same.find((s) => s.start >= Math.min(orig.start, change.to) - 60 && s.start <= Math.max(orig.start, change.to) + 60);
    if (hit) {
      const rateCents = ev?.estimate?.rateCents ?? (hit.rate ? cents(hit.rate) : null);
      const moved = id.kind === 'start' ? hit.clockIn - orig.start : hit.clockOut != null ? orig.end - hit.clockOut : null;
      if (moved == null) clock = { state: 'partial', text: `Clocked in at ${timeLabel(hit.clockIn)}; no clock-out yet.` };
      else {
        const planned = change.minutes;
        const matched = moved >= planned - CLOCK_TOLERANCE_MIN;
        clock = { state: matched ? 'matched' : moved > 0 ? 'partial' : 'not-made', text: id.kind === 'start'
          ? `${hit.name || hit.role} clocked in at ${timeLabel(hit.clockIn)}: ${moved > 0 ? `${moved} minutes later than the original ${timeLabel(orig.start)}` : `no later than the original ${timeLabel(orig.start)}`}${matched ? ', as planned' : `, against ${planned} planned`}.`
          : `${hit.name || hit.role} clocked out at ${timeLabel(hit.clockOut)}: ${moved > 0 ? `${moved} minutes before the original ${timeLabel(orig.end)}` : `not before the original ${timeLabel(orig.end)}`}.` };
        // Offsets: any other server that clocked in earlier than scheduled or out later, that day and service.
        const others = shifts.filter((s) => s.server && s !== hit && inMeal(s, id.meal) && s.clockIn != null);
        const extra = others.reduce((t, s) => t + Math.max(0, s.start - s.clockIn) + (s.clockOut != null ? Math.max(0, s.clockOut - s.end) : 0), 0);
        const unplanned = ev?.schedule ? Math.max(0, shifts.filter((s) => s.server && inMeal(s, id.meal)).length - ev.schedule.servers) : 0;
        const grossMin = Math.max(0, moved);
        observed = {
          minutes: grossMin, offsetMinutes: extra, unplannedShifts: unplanned, netMinutes: Math.max(0, grossMin - extra),
          rateCents, cents: rateCents != null ? Math.round((grossMin / 60) * rateCents) : null, offsetCents: rateCents != null ? Math.round((extra / 60) * rateCents) : null,
          netCents: rateCents != null ? Math.round((Math.max(0, grossMin - extra) / 60) * rateCents) : null,
          claim: 'obs', basis: 'clock-ins entered on Data, at the rate used for the estimate (straight time; payroll not checked)',
        };
      }
    }
  } else if (id.kind === 'add') {
    const servers = shifts.filter((s) => s.server && inMeal(s, id.meal) && s.clockIn != null);
    if (servers.length) {
      const covered = servers.filter((s) => s.clockIn <= id.to && (s.clockOut == null || s.clockOut >= (change?.from ?? id.to))).length;
      clock = { state: covered > (ev?.schedule?.servers ?? 0) ? 'matched' : 'not-made', text: `${covered} servers clocked in over the stretch, against ${ev?.schedule?.servers ?? '—'} scheduled before.` };
    }
  }
  stages.push({ key: 'clock', label: 'Clock-ins', state: clock.state === 'matched' ? 'done' : clock.state === 'waiting' ? 'waiting' : 'warn', text: clock.text, claim: 'obs' });

  // Guardrail: guests that service against the range the decision assumed.
  const served = (room?.serviceOwn?.hours || []).filter((h) => h.date === id.date && mealOf(h.hour) === id.meal);
  const guests = served.length ? served.reduce((t, h) => t + h.covers, 0) : null;
  const high = ev?.forecast?.high ?? null;
  const guard = guests == null ? { state: 'unknown', text: 'Guests for this service aren’t entered yet, so service can’t be checked against the range.' }
    : high != null && guests > high ? { state: 'failed', text: `${guests} guests came in, above the ${high} the call was sized for. Check the floor wasn’t short.` }
      : { state: 'ok', text: `${guests} guests came in${high != null ? `, inside the ${high} the call was sized for` : ''}.` };
  if (observed) stages.push({ key: 'observed', label: 'Labor not paid', state: guard.state === 'failed' ? 'warn' : 'done', text: observed.cents != null ? `$${(observed.netCents / 100).toFixed(2)} of straight-time labor${observed.offsetCents ? ` after $${(observed.offsetCents / 100).toFixed(2)} of offsets` : ''}` : `${observed.netMinutes} minutes of labor`, claim: 'obs' });
  const result = !observed && clock.state === 'waiting' ? 'pending-evidence'
    : clock.state === 'not-made' ? 'not-made'
      : guard.state === 'failed' ? 'adverse'
        : observed || clock.state === 'matched' ? 'observed' : 'inconclusive';
  const qualified = {
    state: 'not-eligible',
    text: `Not counted as savings. A single service’s staffing change has no verification method in this build: the spec’s labor-hours method needs ${METHOD_TARGET.before} comparable services before and ${METHOD_TARGET.after} after, with service checks, and isn’t built yet. It stays Observed.`,
  };
  stages.push({ key: 'qualified', label: 'Counted as savings', state: 'no', text: qualified.text, claim: 'none' });
  return { approvalId: task.approvalId, kind: id.kind, date: id.date, meal: id.meal, stages, clock, observed, guard, result, qualified };
}

/** The task status the clock evidence supports, or null to leave it as it is (server: verifyTasks). */
export function shiftCheck(task, room) {
  const o = staffingOutcome(task, room);
  if (!o) return null;
  if (o.clock.state === 'matched') return { ok: true, note: o.clock.text };
  if (o.clock.state === 'partial' || o.clock.state === 'not-made') return { ok: false, note: o.clock.text };
  return null;
}

/**
 * The rows Data's editor opens with when a staffing link names a service:
 * that date's shifts (or one blank server shift on it), or for the history
 * the most recent past same-weekday services not entered yet, hour by hour,
 * with guests and servers left blank for the manager to fill in. Saving
 * these rows only adds or replaces those dates (page/inputs.js mergeRows).
 * @param {'shifts'|'services'} kind
 * @param {any} room
 * @param {{ date: string, meal: 'lunch'|'dinner', today: string }} p
 * @returns {Record<string, string>[] | null}
 */
export function linkRows(kind, room, { date, meal, today }) {
  const M = MEALS[meal];
  if (!M || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const str = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)]));
  if (kind === 'shifts') {
    const have = (room?.shifts || []).filter((r) => r.date === date);
    if (have.length) return have.map((r) => str({ date: r.date, role: r.role, start: r.start, end: r.end, name: r.name ?? '', rate: r.rate ?? '', clock_in: r.clock_in ?? '', clock_out: r.clock_out ?? '' }));
    return [str({ date, role: 'Server', start: '', end: '', name: '', rate: '', clock_in: '', clock_out: '' })];
  }
  if (kind === 'services') {
    const day = dayOfDate(date);
    const entered = new Set((room?.serviceOwn?.rows || []).map((r) => r.date));
    const have = [...entered].filter((d) => dayOfDate(d) === day).length;
    const want = Math.min(4, Math.max(1, MIN_CALIBRATED - have));
    const out = [];
    for (let d = addDays(today, -1), n = 0; n < want && d > addDays(today, -120); d = addDays(d, -1)) {
      if (dayOfDate(d) !== day || entered.has(d)) continue;
      for (let h = M.from; h < M.to; h++) out.push(str({ date: d, hour: `${String(h).padStart(2, '0')}:00`, covers: '', servers: '' }));
      n++;
    }
    return out;
  }
  return null;
}
