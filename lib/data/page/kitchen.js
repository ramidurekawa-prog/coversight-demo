// Kitchen speed: the lever page's own model. Pure; the browser and the server
// both call it, so a figure is never computed two ways.
//
// The kitchen is read as a line that orders flow through: order in, a
// station, the pass, the table. Everything here comes from one table of the
// room's ticket times by night and hour (`nights`), so the curve, the grid,
// the trend and the trial results always agree:
//
//   - Toast: KitchenTimings.csv, summarised per night and hour by
//     lib/data/toast.js (`tickets.nights`, `tickets.byStation`, `tickets.hist`).
//   - The sample: the generated hourly year (lib/data/dense.js), re-centred
//     so Friday and Saturday dinner equal the seed's curve, which is what the
//     Lever Check card shows. Labelled as a sample.
//   - Hand entry (`kitchen.log`): nights a chef logged, used only after the
//     last night the feed has, and marked hand-entered.
//
// Industrial-engineering ideas, in plain words on the page:
//   - Rush Point: the orders an hour the line can take and stay on time
//     (a queue's breaking point, found from the room's own hours).
//   - Line Map: where late tickets wait (the bottleneck station).
//   - Line Trials: one change at a time, measured on matched nights (kaizen).
// "If it ain't broke, don't fix it": a trial is offered only when busy hours
// actually run late.

import { densify, HOURLY_WEEKS } from '../dense.js';

export const BUSY_DAYS = ['Fri', 'Sat'];
/** Dinner hours the Lever Check card reads, 5 pm to 10 pm (index 0 = 5 pm). */
export const BUSY_HOURS = [17, 18, 19, 20, 21, 22];
/** Hours shown on the day chart and the grid. */
export const OPEN_HOURS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
export const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_NAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
/** Ticket-time histograms: 2-minute buckets, the last one is 40 minutes and over. */
export const BUCKET_MIN = 2;
export const BUCKETS = 21;
/** A trial needs this many changed nights before it reports a result. */
export const TRIAL_NIGHTS = 2;
/** A trial looks back this many days for its matched "before" nights. */
export const BEFORE_DAYS = 42;
/** A change of at least this many minutes counts as better or worse. */
export const TRIAL_MIN_CHANGE = 1;

const r1 = (n) => Math.round(n * 10) / 10;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const DAY_MS = 864e5;
const at = (iso) => Date.parse(`${iso}T12:00:00Z`);
const dowOf = (iso) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(at(iso)).getUTCDay()];

/** 5 pm, 12 pm, 11 am. */
export function hourLabel(h) {
  const hr = ((h + 11) % 12) + 1;
  return `${hr} ${h >= 12 ? 'pm' : 'am'}`;
}
/** "7 to 9 pm" for the hours 19 and 20 (the range ends when the last hour does). */
export function hourRange(from, to) {
  const end = to + 1;
  const sameHalf = (from >= 12) === (end >= 12 && end < 24);
  const a = sameHalf ? String(((from + 11) % 12) + 1) : hourLabel(from);
  return `${a} to ${hourLabel(end % 24)}`;
}
const slug = (s) => String(s).normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'station';

/** Weighted mean of { n, min } cells; cells without a count weigh 1. */
function wmean(cells) {
  const xs = cells.filter((c) => c && c.min > 0);
  if (!xs.length) return null;
  const w = xs.map((c) => (c.n > 0 ? c.n : 1));
  return sum(xs.map((c, i) => c.min * w[i])) / sum(w);
}

/** The value at quantile q of a 2-minute histogram (bucket midpoints). */
export function histQuantile(h, q) {
  const n = sum(h || []);
  if (!n) return null;
  let acc = 0;
  for (let i = 0; i < h.length; i++) {
    acc += h[i];
    if (acc >= q * n) return i * BUCKET_MIN + BUCKET_MIN / 2;
  }
  return (h.length - 1) * BUCKET_MIN;
}
/** Share of a histogram's tickets over the target. Buckets straddling the target count by their midpoint. */
export function histOver(h, target) {
  const n = sum(h || []);
  if (!n) return null;
  return sum(h.filter((_, i) => i * BUCKET_MIN + BUCKET_MIN / 2 > target)) / n;
}

/* ------------------------------------------------------------------ the one ticket table */

/**
 * The room's ticket times as one table: nights × hours, plus station and
 * spread detail when the source has it.
 * @param {any} room   CV_D.room (seed-shaped)
 * @param {{ logs?: Record<string, any>|null, dense?: any }} [opts]
 * @returns {{ source: 'toast'|'sample'|'none', target: number, nights: any[], stations: any[], stationMeaning: 'late'|'all', hist: Record<string, number[]>|null, through: string|null, weeks: number, logged: number }}
 */
export function kitchenData(room, { logs = null, dense } = {}) {
  const t = room?.tickets || {};
  const target = Number.isFinite(t.target) ? t.target : 14;
  let nights = [], source = 'none', stations = [], stationMeaning = 'late', hist = null, weeks = 0;

  if (t.own && Array.isArray(t.nights) && t.nights.length) {
    source = 'toast';
    nights = t.nights.map((x) => ({ iso: x.iso, dow: dowOf(x.iso), recent: !!x.recent, hours: Object.fromEntries(Object.entries(x.hours || {}).map(([h, c]) => [h, { n: c[0], min: c[1], orders: c[2] ?? null }])) }));
    hist = t.hist || null;
    if (Array.isArray(t.byStation) && t.byStation.length) {
      const all = sum(t.byStation.map((s) => sum(s.h) * (histOver(s.h, target) ?? 0)));
      stations = t.byStation.map((s) => {
        const n = sum(s.h), late = n * (histOver(s.h, target) ?? 0);
        return { name: s.name, share: all ? Math.round((late / all) * 100) : 0, min: n ? r1(s.sum / n) : null, tickets: n };
      }).sort((a, b) => b.share - a.share || b.tickets - a.tickets);
    } else {
      stations = (t.stations || []).map(([name, share]) => ({ name, share }));
      stationMeaning = 'all';
    }
    weeks = Math.max(1, Math.ceil(new Set(nights.map((x) => x.iso)).size / 7));
  } else if (t.own) {
    // An older Toast summary: Friday and Saturday dinner averages and station shares of all tickets only.
    source = 'toast';
    stations = (t.stations || []).map(([name, share]) => ({ name, share }));
    stationMeaning = 'all';
  } else if (Array.isArray(t.sat)) {
    const d = dense === undefined ? densify(room) : dense;
    if (d?.hours?.length) {
      source = 'sample';
      const by = new Map();
      for (const h of d.hours) {
        if (!(h.ticketMin > 0)) continue;
        const nt = by.get(h.iso) || { iso: h.iso, dow: h.dow, hours: {} };
        nt.hours[h.hour] = { n: h.tickets, min: h.ticketMin, orders: h.tickets };
        by.set(h.iso, nt);
      }
      nights = [...by.values()].sort((a, b) => a.iso.localeCompare(b.iso));
      // Re-centre Friday and Saturday dinner on the seed's curve (ticket-weighted), so the page and Lever Check agree.
      for (const dow of BUSY_DAYS) {
        const curve = dow === 'Fri' ? t.fri : t.sat;
        BUSY_HOURS.forEach((hr, i) => {
          const want = curve?.[i];
          if (!(want > 0)) return;
          const cells = nights.filter((x) => x.dow === dow && x.hours[hr]).map((x) => x.hours[hr]);
          const have = wmean(cells);
          if (have == null) return;
          const shift = want - have;
          for (const c of cells) c.min = Math.max(1, c.min + shift);
        });
      }
      weeks = HOURLY_WEEKS;
    }
    stations = (t.stations || []).map(([name, share]) => ({ name, share }));
  }

  const through = nights.length ? nights[nights.length - 1].iso : null;
  // Nights a chef logged by hand, after the feed's last night (or all of them when there is no feed).
  let logged = 0;
  for (const [iso, e] of Object.entries(logs || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || (through && iso <= through)) continue;
    const hours = {};
    for (const [h, m] of Object.entries(e?.hours || {})) if (m > 0) hours[h] = { n: null, min: m, orders: null, hand: true };
    if (!Object.keys(hours).length) continue;
    nights.push({ iso, dow: dowOf(iso), hours, hand: true, slow: e.slow || null });
    logged++;
  }
  if (source === 'none' && logged) source = 'hand';
  return { source, target, nights, stations, stationMeaning, hist, through, weeks, logged };
}

/**
 * Average per weekday and hour over the feed's nights (hand-logged nights carry
 * no order counts and are left out). A Toast room averages its last 4 weeks,
 * the same tickets as the Friday and Saturday curve Lever Check reads.
 */
export function cellsOf(K) {
  const m = new Map();
  const recentOnly = K.source === 'toast' && K.nights.some((x) => x.recent);
  for (const x of K.nights) {
    if (x.hand || (recentOnly && !x.recent)) continue;
    for (const [h, c] of Object.entries(x.hours)) {
      const k = `${x.dow}|${h}`;
      const v = m.get(k) || { dow: x.dow, hour: +h, nights: 0, n: 0, wsum: 0, orders: 0, ordersNights: 0 };
      const w = c.n > 0 ? c.n : 1;
      v.nights++; v.n += w; v.wsum += c.min * w;
      if (c.orders != null) { v.orders += c.orders; v.ordersNights++; }
      m.set(k, v);
    }
  }
  return [...m.values()].map((v) => ({ dow: v.dow, hour: v.hour, min: r1(v.wsum / v.n), orders: v.ordersNights ? r1(v.orders / v.ordersNights) : null, nights: v.nights }));
}

/* ------------------------------------------------------------------ the Rush Point */

/**
 * The orders an hour the line can take and stay on time: the split of the
 * room's own hours (average orders, on time or late) that gets the most of
 * them right. Needs late and on-time hours, each with an order count.
 * @returns null | { limit, right, of, held } held = true when no hour ran late (the busiest hour so far is shown instead).
 */
export function rushPoint(cells, target) {
  const pts = cells.filter((c) => c.orders > 0 && c.min > 0).map((c) => ({ o: c.orders, late: c.min > target }));
  if (pts.length < 6) return null;
  const late = pts.filter((p) => p.late).length;
  if (!late) return { limit: Math.max(...pts.map((p) => p.o)), right: pts.length, of: pts.length, held: true };
  if (late === pts.length) return null;
  const cands = [...new Set(pts.map((p) => p.o))].sort((a, b) => a - b);
  let best = null;
  for (const L of cands) {
    const right = pts.filter((p) => (p.o > L) === p.late).length;
    if (!best || right > best.right || (right === best.right && L > best.limit)) best = { limit: L, right };
  }
  return { limit: Math.floor(best.limit), right: best.right, of: pts.length, held: false };
}

/* ------------------------------------------------------------------ trials */

/** Average ticket time over a trial's days and hours, on the given nights. */
function trialMinutes(nights, tr) {
  const cells = [];
  for (const x of nights) for (let h = tr.from; h <= tr.to; h++) if (x.hours[h]) cells.push(x.hours[h]);
  return wmean(cells);
}

/**
 * Where a trial stands, measured on matched nights: the same weekdays and
 * hours in the six weeks before it started, against the nights since.
 * @returns {{ state: 'measuring'|'better'|'same'|'worse'|'stopped', before: number|null, after: number|null, nightsIn: number, change: number|null }}
 */
export function trialResult(K, tr) {
  const days = new Set(tr.days);
  const startMs = at(tr.start);
  const match = K.nights.filter((x) => days.has(x.dow));
  const before = match.filter((x) => at(x.iso) < startMs && at(x.iso) >= startMs - BEFORE_DAYS * DAY_MS);
  const after = match.filter((x) => at(x.iso) >= startMs && (!tr.end || x.iso <= tr.end));
  const b = trialMinutes(before, tr), a = after.length ? trialMinutes(after, tr) : null;
  const nightsIn = after.filter((x) => trialMinutes([x], tr) != null).length;
  if (tr.status === 'stopped' && nightsIn < TRIAL_NIGHTS) return { state: 'stopped', before: b && r1(b), after: a && r1(a), nightsIn, change: null };
  if (nightsIn < TRIAL_NIGHTS || b == null || a == null) return { state: 'measuring', before: b && r1(b), after: a && r1(a), nightsIn, change: null };
  const change = r1(a - b);
  return { state: change <= -TRIAL_MIN_CHANGE ? 'better' : change >= TRIAL_MIN_CHANGE ? 'worse' : 'same', before: r1(b), after: r1(a), nightsIn, change };
}

/* ------------------------------------------------------------------ the page */

/**
 * Everything the Kitchen page shows, from the room and its saved decisions.
 * @param {any} room    CV_D.room
 * @param {{ logs?: any, trials?: any[], proofs?: any[], feed?: any, dense?: any, roomId?: string }} [opts]
 */
export function kitchenPage(room, { logs = null, trials = [], proofs = [], feed = null, dense, roomId = 'room' } = {}) {
  const t = room?.tickets || {};
  const K = kitchenData(room, { logs, dense });
  const target = K.target;
  const fri = (t.fri || []).map((v) => (v > 0 ? v : null));
  const sat = (t.sat || []).map((v) => (v > 0 ? v : null));
  const busy = [...fri.map((v, i) => ({ dow: 'Fri', hour: BUSY_HOURS[i], min: v })), ...sat.map((v, i) => ({ dow: 'Sat', hour: BUSY_HOURS[i], min: v }))].filter((c) => c.min != null);
  const onTime = busy.filter((c) => c.min <= target).length;
  const satVals = sat.filter((v) => v != null);
  // Lever Check's figure: Saturday's slowest dinner hour.
  const peak = satVals.length ? Math.max(...satVals) : null;
  const peakHour = peak != null ? BUSY_HOURS[sat.indexOf(peak)] : null;
  const status = peak == null ? 'none' : peak > target + 3 ? 'watch' : 'good';
  const late = busy.filter((c) => c.min > target).sort((a, b) => b.min - a.min);
  // "If it ain't broke, don't fix it": only a room Lever Check marks as drifting gets a trial.
  const broken = status === 'watch';

  const cells = cellsOf(K);
  const rush = rushPoint(cells, target);
  const cellAt = (dow, hour) => cells.find((c) => c.dow === dow && c.hour === hour) || null;
  const day = (dow) => OPEN_HOURS.map((h) => {
    const c = cellAt(dow, h);
    const busyIdx = BUSY_HOURS.indexOf(h);
    const curve = dow === 'Fri' ? fri : dow === 'Sat' ? sat : null;
    const min = curve && busyIdx >= 0 && curve[busyIdx] != null ? curve[busyIdx] : c?.min ?? null;
    return { hour: h, label: hourLabel(h), min, orders: c?.orders ?? null, late: min != null && min > target, overRush: !!(rush && !rush.held && c?.orders > rush.limit) };
  });
  const days = Object.fromEntries(DOWS.map((d) => [d, day(d)]));
  const worstDay = late.length ? late[0].dow : 'Sat';

  // The line: where late tickets wait.
  const stations = K.stations.filter((s) => s.name);
  const jam = broken && stations.length ? stations[0] : null;

  // Spread: 1 in 10 busy-hour tickets waits longer than this (needs ticket-level detail).
  let spread = null;
  if (K.hist) {
    const h = Array(BUCKETS).fill(0);
    for (const dow of BUSY_DAYS) for (const hr of BUSY_HOURS) (K.hist[`${dow}|${hr}`] || []).forEach((v, i) => { h[i] += v; });
    if (sum(h) >= 20) spread = { p90: histQuantile(h, 0.9), over: Math.round((histOver(h, target) ?? 0) * 100), tickets: sum(h) };
  }

  // Trend: busy-hour ticket time by week, oldest first.
  const busyNights = K.nights.filter((x) => BUSY_DAYS.includes(x.dow));
  const weekly = [];
  if (busyNights.length) {
    const end = at(K.nights[K.nights.length - 1].iso);
    const m = new Map();
    for (const x of busyNights) {
      const w = Math.floor((end - at(x.iso)) / (7 * DAY_MS));
      const cs = BUSY_HOURS.map((h) => x.hours[h]).filter(Boolean);
      const v = m.get(w) || { w, cells: [], hand: false };
      v.cells.push(...cs); v.hand = v.hand || !!x.hand;
      m.set(w, v);
    }
    for (const v of [...m.values()].sort((a, b) => b.w - a.w)) {
      const min = wmean(v.cells);
      if (min != null) weekly.push({ ago: v.w, min: r1(min), hand: v.hand });
    }
  }
  let trend = null;
  if (weekly.length >= 6) {
    const recent = weekly.slice(-4), prior = weekly.slice(0, -4);
    const a = sum(recent.map((w) => w.min)) / recent.length, b = sum(prior.map((w) => w.min)) / prior.length;
    const change = r1(a - b);
    trend = { change, dir: change <= -0.5 ? 'better' : change >= 0.5 ? 'worse' : 'steady' };
  }

  // This weekend's trial: only when something is late.
  let move = null;
  if (broken) {
    const lateDays = BUSY_DAYS.filter((d) => (late.some((c) => c.min > target + 3) ? late.filter((c) => c.min > target + 3) : late).some((c) => c.dow === d));
    // The trial aims at the hours well over goal (the ones that make the card amber), else every late hour.
    const worst = late.filter((c) => c.min > target + 3);
    const lateHours = (worst.length ? worst : late).map((c) => c.hour);
    const from = Math.min(...lateHours), to = Math.max(...lateHours);
    const where = jam ? `the ${jam.name.toLowerCase()}` : 'the slowest station';
    const dayWords = lateDays.map((d) => DAY_NAME[d]).join(' and ');
    const title = `Take load off ${where}, ${dayWords} ${hourRange(from, to)}`;
    const how = !t.own && t.fix ? t.fix : `Move one dish that lands on ${where} to a station with room, or prep its sides before ${hourLabel(from)}.`;
    const id = `kitchen:${slug(roomId)}:${slug(jam?.name || 'line')}:${lateDays.join('').toLowerCase()}:${from}-${to}`;
    move = {
      id, title, how, station: jam?.name || null, days: lateDays, from, to,
      aims: `${late.length} of ${busy.length} busy hours run late, the worst at ${r1(late[0].min)} min.`,
      task: { system: 'Kitchen display', title, diff: [[`${dayWords} ${hourRange(from, to)}`, jam ? `${jam.name} holds ${jam.share}% of late tickets` : 'Tickets run late', 'Move one dish or its prep off that station']] },
    };
  }

  // Trials: the room's own, then earlier tests on this lever from the proof record.
  const own = (Array.isArray(trials) ? trials : []).map((tr) => ({ ...tr, result: trialResult(K, tr) }));
  const past = (proofs || []).filter((p) => p.lever === 'Kitchen').map((p) => ({ id: p.id, title: p.title, since: p.since, state: p.outcome === 'verified' ? 'better' : p.outcome === 'reversed' ? 'worse' : p.outcome === 'data' ? 'paused' : 'measuring', reason: p.reason || null, owner: p.owner || null }));
  const active = own.find((tr) => tr.status === 'running' && tr.result.state === 'measuring') || null;
  const wins = own.filter((tr) => tr.result.state === 'better');

  // Words for the head.
  const peakWords = peak != null ? `${DAY_NAME.Sat} ${hourLabel(peakHour)}` : null;
  const headline = peak == null ? 'No kitchen times yet'
    : broken ? `${peakWords} is your slowest hour` : late.length ? 'The kitchen is keeping up' : 'Food is on time at the rush';

  return {
    source: K.source, target, through: K.through, weeks: K.weeks, logged: K.logged,
    peak, peakHour, peakWords, status, onTime, busyHours: busy.length, late, broken, headline,
    toGo: busy.length - onTime,
    days, worstDay, rush, stations, stationMeaning: K.stationMeaning, jam, spread, weekly, trend,
    move, trials: own, past, active, wins,
    feed: feed ? { state: feed.state, last: feed.last ?? null, note: feed.note ?? null } : null,
    logs: Object.entries(logs || {}).sort(([a], [b]) => b.localeCompare(a)).slice(0, 8).map(([iso, e]) => ({ iso, dow: dowOf(iso), hours: e.hours || {}, slow: e.slow || null, note: e.note || null, used: !K.through || iso > K.through })),
  };
}
