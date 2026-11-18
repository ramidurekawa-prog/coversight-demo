/**
 * The Service page: tonight's staffing call, pure.
 *
 * Three ways in, one set of rules:
 *  - plan:  the room's Toast data (export or sync) for today's weekday, hour by
 *           hour, against the room's own covers per server-hour.
 *  - live:  today's orders and clock-ins so far (Toast API), paced 15 minutes at
 *           a time against the same weekday on recent weeks, with a band that
 *           narrows as service goes on.
 *  - fences: the room's saved fences (fewest servers, latest same-night cut)
 *           hold in every case, here and again on the server.
 *
 * The browser and server/page/service.ts both call these, so the screen and
 * the server's refusal can never disagree.
 */
import { measuredServiceRate } from '../levers.js';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DEFAULT_TZ = 'America/Los_Angeles';
export const SLOT_MIN = 15;
/** Dinner, unless the comparable nights say the room opens or closes later. */
export const DINNER = { start: 17 * 60, end: 22 * 60 };
/** Hours from this one on count as dinner for the "fewest servers on dinner" fence. */
export const DINNER_FROM = 17;
/**
 * The services a day splits into. Hours are [from, to); live windows stretch to
 * the comparable days' first and last order inside `reach`.
 */
export const MEALS = {
  lunch: { key: 'lunch', label: 'Lunch', from: 11, to: 15, reach: [10, 16] },
  dinner: { key: 'dinner', label: 'Dinner', from: 17, to: 22, reach: [16, 24] },
};
/** The service an hour belongs to: dinner from 4 pm, lunch before. */
export const mealOf = (hour) => (hour >= 16 ? 'dinner' : 'lunch');
/** The weekday of an ISO date (Sun…Sat). */
export const dayOfDate = (iso) => DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
/** An ISO date plus n days. */
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const FENCE_DEFAULTS = { minDinner: 4, minAny: 3, cutBy: '8:30 pm' };
/** Fewest complete slots of tonight before the call can speak (the first hour is too noisy). */
export const MIN_SLOTS = 4;
/** Same weekdays needed before tonight can be paced against them. */
export const MIN_COMPARABLE = 2;
/** Same weekdays needed before the band is trusted enough to suggest a cut. */
export const MIN_CALIBRATED = 3;
/** Minutes without a new order, while orders are expected, before live data counts as stale. */
export const STALE_MIN = 30;
/** How often the page pulls tonight from Toast while it's open. */
export const LIVE_CADENCE_MIN = 2;

const isServer = (title) => /server|waiter|waitress|captain/.test(String(title || '').toLowerCase());

/** "8:30 pm" → 1230 (minutes after midnight). Anything unreadable → null. */
export function clockMinutes(s) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]m)?\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  let h = +m[1];
  const mi = +(m[2] ?? 0);
  if (m[3]) { const pm = /p/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 1230 → "20:30" (the form an approval id and the API carry). */
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** 1230 → "8:30 pm"; 1200 → "8 pm". */
export function clockLabel(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 || h === 24 ? 'am' : 'pm'}`;
}

/** The room's saved fences with the defaults filled in. */
export function fencesOf(saved) {
  const f = saved && typeof saved === 'object' ? saved.f ?? saved : {};
  return {
    minDinner: Number.isFinite(f.minDinner) ? f.minDinner : FENCE_DEFAULTS.minDinner,
    minAny: Number.isFinite(f.minAny) ? f.minAny : FENCE_DEFAULTS.minAny,
    cutBy: clockMinutes(f.cutBy) ?? 20 * 60 + 30,
  };
}

const floorFor = (hour, fences) => (hour >= DINNER_FROM ? fences.minDinner : fences.minAny);

/** Today in the restaurant's own time zone: date, weekday and minutes after midnight. */
export function localNow(now = new Date(), tz = DEFAULT_TZ) {
  let p;
  try {
    p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(now).map((x) => [x.type, x.value]));
  } catch {
    return localNow(now, DEFAULT_TZ);
  }
  return { date: `${p.year}-${p.month}-${p.day}`, day: p.weekday.slice(0, 3), minutes: (+p.hour % 24) * 60 + +p.minute };
}

/** The approval id for tonight's cut: one night, one time, so next week's is its own task. */
export const cutApprovalId = (date, atMin) => `cut:${date}:${hhmm(atMin)}`;
export const isCutFor = (approvalId, date) => String(approvalId || '').startsWith(`cut:${date}:`);

/**
 * Tonight's plan from the room's Toast data: for today's weekday, the covers and
 * servers each hour over recent weeks, against the room's measured covers per
 * server-hour. Servers needed are sized for the busiest of those weeks, not the
 * average, so a cut is only planned where even the peak week had a spare.
 * Suggests one fewer server from the first hour after which every hour to close
 * had a spare, unless a fence says no.
 */
/**
 * Every service hour the room has. A Toast upload puts lunch and dinner in
 * serviceHours; the sample keeps its lunch apart (lunchHours) so the levers,
 * which read dinner only, don't move.
 */
export const allServiceHours = (room) => [...(room?.levers?.serviceHours || []), ...(room?.levers?.lunchHours || [])];

/** @param {any} room @param {string} day @param {any} fencesSaved @param {"lunch" | "dinner" | null} [meal] */
export function servicePlan(room, day, fencesSaved, meal = null) {
  const fences = fencesOf(fencesSaved);
  const L = room?.levers || {};
  const all = allServiceHours(room);
  // Each service's own pace when it has enough busy hours (a lunch server and a dinner server don't
  // look after guests at the same rate), else the room's overall pace.
  const rate = (meal && measuredServiceRate(all.filter((h) => mealOf(h.hour) === meal))?.coversPerServerHour) || measuredServiceRate(all)?.coversPerServerHour;
  const M = meal ? MEALS[meal] : null;
  const rows = all.filter((h) => h.day === day && h.servers != null && (!M || (h.hour >= M.from - 1 && h.hour < M.to + 1 && mealOf(h.hour) === meal)));
  if (!rate || !rows.length) return null;
  const hours = [...new Set(rows.map((h) => h.hour))].sort((a, b) => a - b).map((hour) => {
    const hs = rows.filter((h) => h.hour === hour);
    const covers = hs.reduce((t, h) => t + h.covers, 0) / hs.length;
    const peak = Math.max(...hs.map((h) => h.covers));
    const servers = hs.reduce((t, h) => t + h.servers, 0) / hs.length;
    const need = Math.max(1, Math.ceil(peak / rate));
    return { hour, covers: Math.round(covers), peak, servers: Math.round(servers * 10) / 10, need, idle: Math.max(0, Math.round(servers) - need), floor: floorFor(hour, fences), weeks: hs.length };
  });
  let spareFrom = null;
  for (let i = hours.length - 1; i >= 0 && hours[i].idle >= 1; i--) spareFrom = hours[i].hour;
  let cutFrom = spareFrom, blocked = null;
  if (spareFrom != null) {
    const after = hours.filter((h) => h.hour >= spareFrom);
    const short = after.find((h) => Math.round(h.servers) - 1 < h.floor);
    if (short) { cutFrom = null; blocked = { why: 'floor', text: `Your fence keeps at least ${short.floor} servers on ${short.hour >= DINNER_FROM ? 'dinner' : 'the floor'}, and ${clockLabel(short.hour * 60)} usually has ${Math.round(short.servers)}.` }; }
    else if (spareFrom * 60 > fences.cutBy) { cutFrom = null; blocked = { why: 'late', text: `The spare starts at ${clockLabel(spareFrom * 60)}, after your latest same-night cut of ${clockLabel(fences.cutBy)}.` }; }
  }
  const weeks = Math.max(...hours.map((h) => h.weeks));
  if (cutFrom != null && weeks < MIN_CALIBRATED) { blocked = { why: 'history', text: `Only ${weeks} recent ${day} ${meal ? MEALS[meal].label.toLowerCase() : 'service'}${weeks === 1 ? '' : 's'} with servers on the floor. A plan needs ${MIN_CALIBRATED} before it suggests a cut.` }; cutFrom = null; }
  const idleHours = cutFrom == null ? 0 : hours.filter((h) => h.hour >= cutFrom).length;
  // The wage is the room's own blended rate from TimeEntries; with none, no dollar figure is shown.
  const wage = Number.isFinite(L.wage) && L.wage > 0 ? L.wage : null;
  return { meal, day, rate, hours, cutFrom, spareFrom, blocked, idleHours, wage, value: wage ? Math.round(idleHours * wage) : null, weeks, fences };
}

/** Minutes after midnight of an export-shaped stamp ("2026-10-24 18:43:12"), on that date only. */
function stampMinutes(stamp, date) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(stamp || ''));
  if (!m) return null;
  const mins = +m[2] * 60 + +m[3];
  if (m[1] === date) return mins;
  // Orders opened after midnight still belong to the business day before.
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
  return m[1] === next && mins < 4 * 60 ? 24 * 60 + mins : null;
}

/** A service's window: its default hours, stretched to the comparable days' first and last order inside its reach. */
export function serviceWindow(days = [], meal = 'dinner') {
  const M = MEALS[meal] ?? MEALS.dinner;
  let start = M.from * 60, end = M.to * 60;
  for (const d of days) {
    for (const r of d.orders || []) {
      const t = stampMinutes(r.Opened, d.day);
      if (t == null || t < M.reach[0] * 60 || t >= M.reach[1] * 60 || r.Voided === 'true') continue;
      start = Math.min(start, Math.floor(t / 60) * 60);
      end = Math.max(end, Math.min(M.reach[1] * 60, (Math.floor(t / 60) + 1) * 60));
    }
  }
  return { start, end, slots: (end - start) / SLOT_MIN };
}

/** Covers per 15 minutes of one business day, from OrderDetails-shaped rows. */
export function slotCovers(orders, date, win) {
  const out = Array(win.slots).fill(0);
  for (const r of orders || []) {
    if (r.Voided === 'true') continue;
    const t = stampMinutes(r.Opened, date);
    if (t == null || t < win.start || t >= win.end) continue;
    out[Math.floor((t - win.start) / SLOT_MIN)] += Math.max(0, Math.round(+r['# of Guests'] || 0));
  }
  return out;
}

/** The latest order opened on a business day (minutes after midnight), or null with none. */
export function lastOrderAt(orders, date) {
  let last = null;
  for (const r of orders || []) {
    if (r.Voided === 'true') continue;
    const t = stampMinutes(r.Opened, date);
    if (t != null && (last == null || t > last)) last = t;
  }
  return last;
}

/** Servers clocked in at a moment, from TimeEntries-shaped rows. */
export function serversOn(time, date, atMin) {
  const on = new Set();
  for (const r of time || []) {
    if (!isServer(r['Job Title'])) continue;
    const tin = stampMinutes(r['In Date'], date);
    const tout = r['Out Date'] ? stampMinutes(r['Out Date'], date) : null;
    if (tin == null || tin > atMin || (tout != null && tout <= atMin)) continue;
    on.add(r.Employee || `#${on.size}`);
  }
  return on.size;
}

/** The sample's fixed band, by how far through service it is. Only the sample uses it. */
export const bandSpread = (done, total) => Math.round((0.1 + 0.3 * (1 - done / Math.max(1, total)) ** 2) * 1000) / 1000;

const sum = (a, from = 0, to = a.length) => a.slice(from, to).reduce((t, x) => t + x, 0);

/**
 * The forecast band, calibrated on the room's own nights: for each comparable
 * night, forecast the rest of it from the others scaled by its own pace so far,
 * and see how far off that was (leave-one-out). The band is the worst miss, no
 * narrower than 5%. With fewer than three nights it can't be calibrated, and is
 * reported as such (no cut is suggested on it).
 */
export function calibratedBand(curves, now) {
  const nights = curves.length;
  const misses = [];
  for (let j = 0; j < nights; j++) {
    const others = curves.filter((_, k) => k !== j);
    if (!others.length) continue;
    const mean = curves[0].map((_, i) => others.reduce((t, c) => t + c[i], 0) / others.length);
    const sofar = sum(mean, 0, now);
    const f = sofar > 0 ? sum(curves[j], 0, now) / sofar : 1;
    const forecast = f * sum(mean, now);
    const actual = sum(curves[j], now);
    if (forecast > 0) misses.push(Math.abs(actual / forecast - 1));
    else if (actual > 0) misses.push(1);
  }
  const worst = misses.length ? Math.max(...misses) : 0.5;
  const spread = Math.round(Math.min(0.8, Math.max(0.05, worst)) * 1000) / 1000;
  return { spread, nights, calibrated: nights >= MIN_CALIBRATED, misses: misses.map((m) => Math.round(m * 1000) / 1000) };
}

/**
 * Tonight against the comparable nights, 15 minutes at a time.
 * @param {{ comp: number[], actual: number[], now: number, spread?: number }} p  now = complete slots so far
 */
export function pacing({ comp, actual, now, spread }) {
  const k = Math.max(0, Math.min(now, comp.length, actual.length));
  const so = sum(actual, 0, k);
  const cmp = sum(comp, 0, k);
  const factor = cmp > 0 ? so / cmp : 1;
  const sp = spread ?? bandSpread(k, comp.length);
  const remaining = Math.round(factor * sum(comp, k));
  return { so, cmp, now: k, factor, pace: Math.round((factor - 1) * 100), spread: sp, remaining, range: [Math.round(remaining * (1 - sp)), Math.round(remaining * (1 + sp))] };
}

/** Servers needed each hour from a moment to close: at the forecast and at the band's top. */
function needsFrom({ comp, factor, spread, fromMin, win, rate }) {
  let needTop = 0, needMid = 0;
  for (let h = Math.floor(fromMin / 60) * 60; h < win.end; h += 60) {
    let mid = 0;
    for (let s = 0; s < 60 / SLOT_MIN; s++) {
      const i = (h - win.start) / SLOT_MIN + s;
      if (i >= 0 && i < comp.length) mid += comp[i] * factor;
    }
    needMid = Math.max(needMid, Math.ceil(mid / rate));
    needTop = Math.max(needTop, Math.ceil((mid * (1 + spread)) / rate));
  }
  return { needTop, needMid };
}

/**
 * Tonight's one call, from the pace, the servers on now and the fences.
 * mode: early (too soon) · stale (Toast data stopped arriving) · unknown (no
 * clock-ins) · late (past the latest cut) · cut (every check passes) · wait
 * (safe at the forecast, not at the band's top, or too few nights to trust the
 * band) · quiet (everyone on is needed, or a fence holds).
 * Every check is listed with its result; a check with ok null can't be run
 * from the data there is, and is shown to the manager as theirs to make.
 */
export function serviceCall({ comp, actual, now, win, serversNow, rate, wage = null, fences: fencesSaved, band = null, stale = false }) {
  const fences = fencesOf(fencesSaved);
  const p = pacing({ comp, actual, now, spread: band?.spread });
  const nowMin = win.start + p.now * SLOT_MIN;
  /** @type {{ at: number | null, needTop: number | null, needMid: number | null, floor: number | null, value: number | null, why: string | null, checkAt: number | null }} */
  const blank = { at: null, needTop: null, needMid: null, floor: null, value: null, why: null, checkAt: null };
  const at = nowMin + SLOT_MIN; // a cut lands at the next quarter hour
  const known = serversNow != null && !!rate;
  const needs = known ? needsFrom({ comp, factor: p.factor, spread: p.spread, fromMin: at, win, rate }) : { needTop: null, needMid: null };
  let floor = 0;
  for (let h = Math.floor(at / 60) * 60; h < win.end; h += 60) floor = Math.max(floor, floorFor(h / 60, fences));
  const left = known ? serversNow - 1 : null;
  const checks = [
    { key: 'fresh', label: 'Toast data is current', ok: !stale },
    { key: 'started', label: 'Enough of tonight to judge the pace', ok: p.now >= MIN_SLOTS },
    { key: 'history', label: `At least ${MIN_CALIBRATED} comparable nights to size the band`, ok: band ? band.calibrated : false },
    { key: 'clockins', label: 'Servers on the floor are known from clock-ins', ok: serversNow != null },
    { key: 'demand', label: 'One fewer server covers the band’s top to close', ok: known ? left >= needs.needTop : null },
    { key: 'floor', label: `At least ${fences.minDinner} servers stay on dinner`, ok: known ? left >= floor : null },
    { key: 'cutBy', label: `Before your latest same-night cut (${clockLabel(fences.cutBy)})`, ok: at <= fences.cutBy && at < win.end },
    { key: 'reservations', label: 'Reservations for the rest of the night', ok: null, note: 'No reservation feed is connected. Check the book first.' },
    { key: 'roles', label: 'Sections and roles stay covered', ok: null, note: 'Toast doesn’t say who covers which section. Check sections first.' },
  ];
  const base = { ...p, ...blank, ...needs, floor, at, nowMin, serversNow, rate, fences, band, checks, value: wage ? Math.round(((win.end - at) / 60) * wage) : null };
  if (p.now < MIN_SLOTS) return { ...base, mode: 'early', checkAt: win.start + MIN_SLOTS * SLOT_MIN };
  if (stale) return { ...base, mode: 'stale' };
  if (!known) return { ...base, mode: 'unknown' };
  if (at > fences.cutBy || at >= win.end) return { ...base, mode: 'late' };
  if (left < floor) return { ...base, mode: 'quiet', why: 'floor' };
  if (left >= needs.needTop) return band?.calibrated ? { ...base, mode: 'cut' } : { ...base, mode: 'wait', why: 'history', checkAt: null };
  if (left >= needs.needMid) return { ...base, mode: 'wait', checkAt: nowMin + 2 * SLOT_MIN };
  return { ...base, mode: 'quiet' };
}

/**
 * The one-line conclusion for the top of the page. Kitchen and seating aren't
 * judged: no source for them is connected in this lane.
 */
export function serviceHealth(call) {
  if (call.mode === 'stale') return { tone: 'warn', text: 'Data is too old for a live recommendation.' };
  if (call.mode === 'early') return { tone: 'neutral', text: 'Too early in service to judge the pace.' };
  const hi = call.cmp * (1 + call.spread), lo = call.cmp * (1 - call.spread);
  if (call.so > hi) return { tone: 'warn', text: 'Demand is higher than expected.' };
  if (call.mode === 'cut') return { tone: 'accent', text: 'Staffing may be above current demand.' };
  if (call.so < lo) return { tone: 'neutral', text: 'Demand is lower than expected, but everyone on is still needed.' };
  return { tone: 'good', text: 'Service is on track.' };
}

/**
 * What became of tonight's approved cut, read from Toast clock-ins (never from
 * a ticked task alone): awaiting (not yet time, or not yet seen), confirmed
 * (one fewer server clocked in since the cut), and a guardrail breach when
 * covers since then need the server back at the band's top.
 */
/** @param {{ cut: { at: number, before: number } | null, time: any[], date: string, nowMin: number, needTop: number | null }} p */
export function cutExecution({ cut, time, date, nowMin, needTop }) {
  if (!cut) return null;
  if (nowMin < cut.at) return { state: 'awaiting', text: `Due at ${clockLabel(cut.at)}.` };
  const on = time?.length ? serversOn(time, date, nowMin) : null;
  if (on == null) return { state: 'unconfirmed', text: 'Toast shows no clock-ins, so the release can’t be confirmed from the data.' };
  const confirmed = on <= cut.before - 1;
  const breach = confirmed && needTop != null && on < needTop;
  if (breach) return { state: 'breach', on, text: `Covers since the release need ${needTop} servers at the band’s top and ${on} are on. Consider calling the server back.` };
  if (confirmed) return { state: 'confirmed', on, text: `Toast shows ${on} servers clocked in since ${clockLabel(cut.at)}.` };
  return { state: 'not-seen', on, text: `Toast still shows ${on} servers clocked in. The release hasn’t happened yet.` };
}

/**
 * Tonight live, from export-shaped rows: today's so far, the same weekday on
 * recent weeks, and the plan's rate. Returns null when there's too little to
 * compare against. `cut` is tonight's approved cut ({ at, before }), if any.
 */
export function liveNight({ today, comparable, nowMin, rate, wage = null, fences, cut = /** @type {{ at: number, before: number } | null} */ (null), meal = 'dinner' }) {
  const days = comparable.filter((d) => (d.orders || []).some((r) => r.Voided !== 'true'));
  if (days.length < MIN_COMPARABLE) return null;
  const win = serviceWindow(days, meal);
  const curves = days.map((d) => slotCovers(d.orders, d.day, win));
  const comp = Array.from({ length: win.slots }, (_, i) => Math.round((curves.reduce((t, c) => t + c[i], 0) / curves.length) * 10) / 10);
  const now = Math.max(0, Math.min(win.slots, Math.floor((nowMin - win.start) / SLOT_MIN)));
  const actual = slotCovers(today.orders, today.day, win).slice(0, now);
  const serversNow = today.time?.length ? serversOn(today.time, today.day, nowMin) : null;
  const band = calibratedBand(curves, now);
  // Stale: in service, orders were expected in the last half hour, and none arrived.
  const dataThrough = lastOrderAt(today.orders, today.day);
  const expected = sum(comp, Math.max(0, now - STALE_MIN / SLOT_MIN), now);
  const stale = now > STALE_MIN / SLOT_MIN && nowMin < win.end && expected >= 2 && (dataThrough == null || nowMin - dataThrough > STALE_MIN);
  const call = serviceCall({ comp, actual, now, win, serversNow, rate, wage, fences, band, stale });
  const execution = cutExecution({ cut, time: today.time, date: today.day, nowMin, needTop: call.needTop });
  return { date: today.day, meal, win, comp, actual, weeks: days.length, dataThrough, stale, call, health: serviceHealth(call), execution };
}

/**
 * Tonight from a manager's own count, for when no live feed is connected or
 * it's down: covers so far and servers on the floor, entered by hand. Read
 * against the plan's own hours (typical and busiest recent week by this time),
 * never spread into a made-up 15-minute curve, and never used to suggest a
 * release: the plan's call stands, this only says how tonight compares.
 * @param {{ plan: ReturnType<typeof servicePlan>, covers: number, servers: number | null, atMin: number }} p
 */
export function manualNight({ plan, covers, servers, atMin }) {
  if (!plan || !Number.isFinite(covers) || covers < 0) return null;
  let typical = 0, busiest = 0;
  for (const h of plan.hours) {
    const share = Math.max(0, Math.min(1, (atMin - h.hour * 60) / 60));
    typical += h.covers * share;
    busiest += h.peak * share;
  }
  typical = Math.round(typical); busiest = Math.round(busiest);
  const hour = plan.hours.find((h) => h.hour === Math.floor(atMin / 60)) ?? null;
  const need = hour?.need ?? null;
  const tone = typical === 0 ? 'neutral' : covers > busiest ? 'warn' : covers < typical * 0.8 ? 'neutral' : 'good';
  const label = typical === 0 ? 'Before service' : covers > busiest ? 'Busier than any recent week' : covers < typical * 0.8 ? 'Quieter than usual' : 'On track';
  const staff = servers == null || need == null ? null : servers < need ? 'short' : servers > need ? 'spare' : 'right';
  return { covers, servers, typical, busiest, need, tone, label, staff, pace: typical ? Math.round((covers / typical - 1) * 100) : null };
}

/**
 * A day's services from the plans: each service's usual and busiest covers,
 * and the day's total. Only services with history count; a missing one is
 * null (no data), never zero.
 * @param {{ lunch: any, dinner: any }} plans
 */
export function dayOutlook(plans) {
  const one = (p) => (p ? { usual: p.hours.reduce((t, h) => t + h.covers, 0), busiest: p.hours.reduce((t, h) => t + h.peak, 0), weeks: p.weeks } : null);
  const lunch = one(plans.lunch), dinner = one(plans.dinner);
  const have = [lunch, dinner].filter(Boolean);
  return { lunch, dinner, usual: have.length ? have.reduce((t, x) => t + x.usual, 0) : null, busiest: have.length ? have.reduce((t, x) => t + x.busiest, 0) : null, services: have.length };
}

/** One row per hour of a plan, for the hour table and the CSV. Covers per server-hour is the room's rate, measured. */
export function hourRows(plan) {
  if (!plan) return [];
  return plan.hours.map((h) => ({
    hour: h.hour, label: clockLabel(h.hour * 60), usual: h.covers, busiest: h.peak, servers: h.servers, need: h.need,
    spare: Math.max(0, Math.round(h.servers) - h.need), short: Math.max(0, h.need - Math.round(h.servers)),
    perServer: h.servers > 0 ? Math.round((h.covers / h.servers) * 10) / 10 : null, weeks: h.weeks,
  }));
}

/** One row per 15 minutes of a live service: usual, tonight so far, and the likely range ahead. */
export function slotRows({ comp, actual, now, factor, spread, start }) {
  return comp.map((c, i) => {
    const done = i < now && actual[i] != null;
    const mid = c * factor;
    return { at: start + i * SLOT_MIN, label: clockLabel(start + i * SLOT_MIN), usual: Math.round(c * 10) / 10, served: done ? actual[i] : null,
      expected: done ? null : Math.round(mid), low: done ? null : Math.round(mid * (1 - spread)), high: done ? null : Math.round(mid * (1 + spread)) };
  });
}

/** Rows to CSV text: a header from the first row's keys, values quoted when needed. */
export function toCsv(rows, cols) {
  const keys = cols ?? Object.keys(rows[0] ?? {});
  const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [keys.join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\n');
}

/**
 * A finished service, looked back on: guests each hour against the plan's
 * usual, the servers that were on, what that hour needed at the room's own
 * pace, and the idle server-hours (and their cost at the room's wage) that
 * resulted. Built only from the counts given; a missing wage gives no cost.
 * @param {{ plan: any, slots: number[], start: number, servers: number|null, wage?: number|null }} a
 */
export function serviceRecap({ plan, slots, start, servers, wage = null }) {
  if (!plan || !Array.isArray(slots) || !slots.length) return null;
  const per = 60 / SLOT_MIN;
  const hours = plan.hours.map((h) => {
    const i = (h.hour * 60 - start) / SLOT_MIN;
    const covers = i >= 0 ? slots.slice(i, i + per).reduce((a, b) => a + b, 0) : 0;
    const need = Math.max(1, Math.ceil(covers / plan.rate));
    const on = servers ?? Math.round(h.servers);
    return { hour: h.hour, covers, usual: h.covers, on, need, idle: Math.max(0, on - need), short: Math.max(0, need - on) };
  });
  const guests = hours.reduce((t, h) => t + h.covers, 0);
  const usual = hours.reduce((t, h) => t + h.usual, 0);
  const idleHours = hours.reduce((t, h) => t + h.idle, 0);
  const busiest = hours.reduce((a, b) => (b.covers > a.covers ? b : a));
  return {
    guests, usual, pace: usual ? Math.round((guests / usual - 1) * 100) : null, idleHours, shortHours: hours.reduce((t, h) => t + h.short, 0),
    idleCost: wage ? Math.round(idleHours * wage) : null, peakNeed: Math.max(...hours.map((h) => h.need)), busiest: busiest.hour, hours,
  };
}
