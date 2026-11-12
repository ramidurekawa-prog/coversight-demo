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
export const FENCE_DEFAULTS = { minDinner: 4, minAny: 3, cutBy: '8:30 pm' };
/** Fewest complete slots of tonight before the call can speak (the first hour is too noisy). */
export const MIN_SLOTS = 4;
/** Same weekdays needed before tonight can be paced against them. */
export const MIN_COMPARABLE = 2;

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
    cutBy: clockMinutes(f.cutBy) ?? clockMinutes(FENCE_DEFAULTS.cutBy),
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
 * Tonight's plan from the room's Toast data: for today's weekday, the typical
 * covers and servers each hour over recent weeks, against the room's measured
 * covers per server-hour. Suggests one fewer server from the first hour after
 * which every hour to close had a spare, unless a fence says no.
 */
export function servicePlan(room, day, fencesSaved) {
  const fences = fencesOf(fencesSaved);
  const L = room?.levers || {};
  const rate = measuredServiceRate(L.serviceHours || [])?.coversPerServerHour;
  const rows = (L.serviceHours || []).filter((h) => h.day === day && h.servers != null);
  if (!rate || !rows.length) return null;
  const hours = [...new Set(rows.map((h) => h.hour))].sort((a, b) => a - b).map((hour) => {
    const hs = rows.filter((h) => h.hour === hour);
    const covers = hs.reduce((t, h) => t + h.covers, 0) / hs.length;
    const servers = hs.reduce((t, h) => t + h.servers, 0) / hs.length;
    const need = Math.max(1, Math.ceil(covers / rate));
    return { hour, covers: Math.round(covers), servers: Math.round(servers * 10) / 10, need, idle: Math.max(0, Math.round(servers) - need), floor: floorFor(hour, fences), weeks: hs.length };
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
  const idleHours = cutFrom == null ? 0 : hours.filter((h) => h.hour >= cutFrom).length;
  const weeks = Math.max(...hours.map((h) => h.weeks));
  return { rate, hours, cutFrom, spareFrom, blocked, idleHours, wage: L.wage ?? 18, weeks, fences };
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

/** The dinner window: the default, stretched to the comparable nights' first and last dine hour. */
export function serviceWindow(days = []) {
  let start = DINNER.start, end = DINNER.end;
  for (const d of days) {
    for (const r of d.orders || []) {
      const t = stampMinutes(r.Opened, d.day);
      if (t == null || t < 16 * 60 || r.Voided === 'true') continue;
      start = Math.min(start, Math.floor(t / 60) * 60);
      end = Math.max(end, Math.min(24 * 60, (Math.floor(t / 60) + 1) * 60));
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

/** The band's half-width as a share of the forecast: wide early, narrow late. */
export const bandSpread = (done, total) => Math.round((0.1 + 0.3 * (1 - done / Math.max(1, total)) ** 2) * 1000) / 1000;

/**
 * Tonight against the comparable nights, 15 minutes at a time.
 * @param {{ comp: number[], actual: number[], now: number }} p  now = complete slots so far
 */
export function pacing({ comp, actual, now }) {
  const k = Math.max(0, Math.min(now, comp.length, actual.length));
  const so = actual.slice(0, k).reduce((a, b) => a + b, 0);
  const cmp = comp.slice(0, k).reduce((a, b) => a + b, 0);
  const factor = cmp > 0 ? so / cmp : 1;
  const spread = bandSpread(k, comp.length);
  return { so, cmp, now: k, factor, pace: Math.round((factor - 1) * 100), spread };
}

/**
 * Tonight's one call, from the pace, the servers on now and the fences.
 * mode: early (too soon) · late (past the latest cut) · cut (one fewer server is
 * safe even at the band's top) · wait (safe at the forecast, not at the top) ·
 * quiet (everyone on is needed) · unknown (no clock-ins to count).
 */
export function serviceCall({ comp, actual, now, win, serversNow, rate, wage = 18, fences: fencesSaved }) {
  const fences = fencesOf(fencesSaved);
  const p = pacing({ comp, actual, now });
  const nowMin = win.start + p.now * SLOT_MIN;
  /** @type {{ at: number | null, needTop: number | null, needMid: number | null, floor: number | null, value: number, why: string | null, checkAt: number | null }} */
  const blank = { at: null, needTop: null, needMid: null, floor: null, value: 0, why: null, checkAt: null };
  const base = { ...p, ...blank, nowMin, serversNow, rate, fences };
  if (p.now < MIN_SLOTS) return { ...base, mode: 'early', checkAt: win.start + MIN_SLOTS * SLOT_MIN };
  if (serversNow == null || !rate) return { ...base, mode: 'unknown' };
  const at = nowMin + SLOT_MIN; // a cut lands at the next quarter hour
  if (at > fences.cutBy || at >= win.end) return { ...base, mode: 'late', at };
  const left = serversNow - 1;
  let needTop = 0, needMid = 0, floor = 0;
  for (let h = Math.floor(at / 60) * 60; h < win.end; h += 60) {
    let mid = 0;
    for (let s = 0; s < 60 / SLOT_MIN; s++) {
      const i = (h - win.start) / SLOT_MIN + s;
      if (i >= 0 && i < comp.length) mid += comp[i] * p.factor;
    }
    needMid = Math.max(needMid, Math.ceil(mid / rate));
    needTop = Math.max(needTop, Math.ceil((mid * (1 + p.spread)) / rate));
    floor = Math.max(floor, floorFor(h / 60, fences));
  }
  const hoursLeft = (win.end - at) / 60;
  const out = { ...base, at, needTop, needMid, floor, value: Math.round(hoursLeft * wage) };
  if (left < floor) return { ...out, mode: 'quiet', why: 'floor' };
  if (left >= needTop) return { ...out, mode: 'cut' };
  if (left >= needMid) return { ...out, mode: 'wait', checkAt: nowMin + 2 * SLOT_MIN };
  return { ...out, mode: 'quiet' };
}

/**
 * Tonight live, from export-shaped rows: today's so far, the same weekday on
 * recent weeks, and the plan's rate. Returns null when there's too little to
 * compare against.
 */
export function liveNight({ today, comparable, nowMin, rate, wage, fences }) {
  const days = comparable.filter((d) => (d.orders || []).some((r) => r.Voided !== 'true'));
  if (days.length < MIN_COMPARABLE) return null;
  const win = serviceWindow(days);
  const curves = days.map((d) => slotCovers(d.orders, d.day, win));
  const comp = Array.from({ length: win.slots }, (_, i) => Math.round((curves.reduce((t, c) => t + c[i], 0) / curves.length) * 10) / 10);
  const now = Math.max(0, Math.min(win.slots, Math.floor((nowMin - win.start) / SLOT_MIN)));
  const actual = slotCovers(today.orders, today.day, win).slice(0, now);
  const serversNow = today.time?.length ? serversOn(today.time, today.day, nowMin) : null;
  const call = serviceCall({ comp, actual, now, win, serversNow, rate, wage, fences });
  return { date: today.day, win, comp, actual, weeks: days.length, call };
}
