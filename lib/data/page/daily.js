/**
 * Daily detail: what happened on one restaurant day, hour by hour, from its
 * own Toast rows (either lane) or, on the sample group, from lib/data/dense.js.
 *
 * Pure, so the browser and the server compute the same thing:
 *
 *   summarizeDays(files)   Toast export-shaped rows (OrderDetails,
 *                          ItemSelectionDetails, TimeEntries, PaymentDetails,
 *                          as an upload or the sync's pos_days hold them) →
 *                          one summary per business day, plus that day's
 *                          checks for drill-down. This is what is stored.
 *   buildDaily(summaries)  stored summaries → what the page shows.
 *   compareDay / explainDay / dayparts …  readings of one day.
 *
 * Definitions (every lane, every screen):
 *   net sales   OrderDetails "Amount" on orders that weren't voided (after
 *               discounts, before tax and tips): the figure Trends adds by week.
 *   gross       net + order discounts.
 *   checks      orders that weren't voided. covers: "# of Guests".
 *   labour      TimeEntries "Total Pay" by the business day the shift started;
 *               by hour, each shift's pay is spread over the clock hours it
 *               overlaps.
 *   hour        the clock hour an order was opened in, so a check is counted
 *               once, in one hour and one day part.
 *   business day  4 am to 4 am on the restaurant's wall clock (Toast stamps
 *               in exports, and the sync's, are already local), so an order at
 *               1 am belongs to the night before, and a DST change never
 *               duplicates or drops a date.
 * Nothing is filled in: a day the data doesn't hold is missing (not zero), and
 * a figure the files don't carry is null (not zero).
 */

import { channelOf, minutes, money, parseToastDate } from '../toast.js';
import { DOW, HOURLY_WEEKS } from '../dense.js';

const MS_DAY = 864e5;
/** A business day runs from 4 am to 4 am: a 1 am bar tab belongs to the night before. */
export const DAY_STARTS_AT = 4;
/** Days kept per room (two years, so a day has a year-before to compare). */
export const KEEP_DAYS = 731;
/** Dishes kept per day, by net sales. */
const MAX_DISHES = 400;
/** Checks kept per day for drill-down. */
export const MAX_CHECKS = 3000;
export const NOTE_MAX = 280;
export const CALC_VERSION = 'daily-2';

const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const yes = (s) => /^(true|yes|y|1)$/i.test(String(s || '').trim());
const isServer = (title) => /server|waiter|waitress|captain/i.test(String(title || ''));
const isDrink = (cat) => /bev|drink|wine|beer|liquor|cocktail|spirit|bar\b|n\/?a bev/i.test(String(cat || ''));
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const hhmm = (ms) => (ms == null ? '' : new Date(ms).toISOString().slice(11, 16));
export const addDays = (iso, n) => isoOf(Date.parse(`${iso}T12:00:00Z`) + n * MS_DAY);
/** Mon-first weekday name of an ISO date. */
export const dowOf = (iso) => DOW[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7];
/** The business day a local wall-clock stamp (ms, as parseToastDate returns it) belongs to. */
export const businessDay = (ms) => isoOf(ms - DAY_STARTS_AT * 36e5);
/** Hour of the business day, 4…27 (1 am is 25), so day parts that cross midnight sort and compare simply. */
export const serviceHour = (h) => (h < DAY_STARTS_AT ? h + 24 : h);
const has = (rows, col) => rows.some((r) => r[col] != null && String(r[col]).trim() !== '');

/**
 * @typedef {{ h: number, covers: number, sales: number, orders: number, servers: number | null, labourHours: number | null, labour: number | null }} HourRow
 * @typedef {{
 *   day: string, net: number, gross: number, discounts: number, refunds: number | null, voids: number | null,
 *   tax: number | null, tips: number | null, food: number | null, drink: number | null,
 *   covers: number, orders: number, channels: Record<string, number>,
 *   labour: number | null, labourHours: number | null, turnMin: number | null,
 *   firstOrder: string | null, lastOrder: string | null,
 *   hours: HourRow[], dishes: Record<string, [number, number, number, string]>,
 * }} DaySummary
 * @typedef {[string, string, string, number, string, string, string, number, number, number]} CheckRow
 *   [id, opened HH:MM, paid HH:MM, guests, server, table, channel, amount, discount, voided 0/1]
 */

/**
 * Toast rows → one summary per business day, and each day's checks.
 * @param {{ kind: string, rows: Record<string, string>[] }[]} files
 * @param {{ day?: string }} [opts] `day`: every row belongs to this business
 *   day (the sync stores rows per business day, so it already knows).
 * @returns {{ days: DaySummary[], checks: Record<string, CheckRow[]> }}
 */
export function summarizeDays(files, { day: fixed } = {}) {
  const by = (k) => files.filter((f) => f.kind === k).flatMap((f) => f.rows || []);
  const items = by('items'), orders = by('orders'), time = by('time'), payments = by('payments');
  const hasTax = has(orders, 'Tax'), hasTips = has(orders, 'Tip') || has(orders, 'Gratuity');
  const days = new Map();
  const checks = {};
  const D = (iso) => {
    if (!days.has(iso)) {
      days.set(iso, {
        day: iso, net: 0, gross: 0, discounts: 0, refunds: payments.length ? 0 : null, voids: items.length ? 0 : null,
        tax: hasTax ? 0 : null, tips: hasTips ? 0 : null, food: items.length ? 0 : null, drink: items.length ? 0 : null,
        covers: 0, orders: 0, channels: {}, labour: time.length ? 0 : null, labourHours: time.length ? 0 : null,
        _turn: [0, 0], _hours: new Map(), _floor: new Map(), _first: null, _last: null, dishes: {},
      });
    }
    return days.get(iso);
  };
  const dayOf = (ms) => fixed ?? businessDay(ms);
  const H = (d, h) => {
    if (!d._hours.has(h)) d._hours.set(h, { h, covers: 0, sales: 0, orders: 0, labourHours: time.length ? 0 : null, labour: time.length ? 0 : null });
    return d._hours.get(h);
  };

  // Orders: sales, checks, covers, channels, discounts, tax and tips, turns, by hour; and the checks themselves.
  for (const r of orders) {
    const t = parseToastDate(r.Opened);
    if (t == null) continue;
    const iso = dayOf(t);
    const voided = yes(r.Voided);
    const amount = money(r.Amount), disc = Math.abs(money(r['Discount Amount']));
    const guests = Math.max(0, Math.round(money(r['# of Guests'])));
    const ch = channelOf(r['Dining Options']);
    const paid = parseToastDate(r.Paid) ?? parseToastDate(r.Closed);
    (checks[iso] ??= []).push([String(r['Order Id'] || r['Order #'] || ''), hhmm(t), hhmm(paid), guests, String(r.Server || '').trim(), String(r.Table || '').trim(), ch, r2(amount), r2(disc), voided ? 1 : 0]);
    if (voided) continue;
    const d = D(iso);
    const hour = new Date(t).getUTCHours();
    d.net += amount; d.gross += amount + disc; d.discounts += disc; d.covers += guests; d.orders += 1;
    if (d.tax != null) d.tax += money(r.Tax);
    if (d.tips != null) d.tips += money(r.Tip) + money(r.Gratuity);
    d.channels[ch] = (d.channels[ch] || 0) + amount;
    const c = H(d, hour); c.covers += guests; c.sales += amount; c.orders += 1;
    if (d._first == null || t < d._first) d._first = t;
    if (d._last == null || t > d._last) d._last = t;
    if (ch === 'Dine-in') {
      const dur = minutes(r['Duration (Opened to Paid)']) ?? (paid != null ? (paid - t) / 6e4 : null);
      if (dur != null && dur > 5 && dur < 360) { d._turn[0] += dur; d._turn[1] += 1; }
    }
  }

  // Items: dishes (units, net, gross, category), food vs drink, voids after the kitchen saw them.
  // Sales come from items only when there is no OrderDetails file.
  for (const r of items) {
    const t = parseToastDate(r['Order Date'] || r['Sent Date']);
    if (t == null) continue;
    const d = D(dayOf(t));
    const net = money(r['Net Price']), gross = money(r['Gross Price']) || net;
    if (yes(r['Void?'])) {
      if (String(r['Sent Date'] || '').trim()) d.voids += Math.abs(gross);
      continue;
    }
    const cat = String(r['Sales Category'] || r['Menu Group'] || '').trim();
    if (isDrink(cat)) d.drink += net; else d.food += net;
    const name = String(r['Menu Item'] || '').trim();
    if (name) {
      const x = (d.dishes[name] ??= [0, 0, 0, cat.slice(0, 40)]);
      x[0] += money(r.Qty) || 1; x[1] += net; x[2] += gross;
    }
    if (!orders.length) {
      const hour = new Date(t).getUTCHours();
      d.net += net; d.gross += gross; d.discounts += Math.max(0, gross - net);
      const ch = channelOf(r['Dining Option']);
      d.channels[ch] = (d.channels[ch] || 0) + net;
      H(d, hour).sales += net;
    }
  }

  // Time entries: labour by the day the shift started; spread over clock hours; servers on the floor.
  for (const r of time) {
    const tin = parseToastDate(r['In Date']);
    if (tin == null) continue;
    const tout = parseToastDate(r['Out Date']);
    const d = D(dayOf(tin));
    const hours = money(r['Payable Hours']) || money(r['Total Hours']) || (tout != null && tout > tin ? (tout - tin) / 36e5 : 0);
    const pay = money(r['Total Pay']) || money(r.Wage) * hours;
    d.labour += pay; d.labourHours += hours;
    if (tout == null || tout <= tin) continue;
    const span = Math.min(tout - tin, 18 * 36e5);
    for (let h = Math.floor(tin / 36e5); h * 36e5 < tin + span; h++) {
      const ms = h * 36e5;
      const overlap = Math.min(tin + span, ms + 36e5) - Math.max(tin, ms);
      if (overlap <= 0) continue;
      const hr = new Date(ms).getUTCHours();
      const c = H(d, hr);
      c.labourHours += (overlap / span) * hours; c.labour += (overlap / span) * pay;
      if (isServer(r['Job Title']) && overlap >= 18e5) { // on the floor for at least half the hour
        if (!d._floor.has(hr)) d._floor.set(hr, new Set());
        d._floor.get(hr).add(String(r.Employee || r['Employee Id'] || '').trim());
      }
    }
  }

  // Payments: refunds, on the day they were refunded.
  for (const r of payments) {
    const ref = Math.abs(money(r['Refund Amount']));
    if (!ref) continue;
    const t = parseToastDate(r['Refund Date'] || r['Paid Date']);
    if (t == null) continue;
    D(dayOf(t)).refunds += ref;
  }

  const hasTime = time.length > 0;
  const out = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map((d) => {
    const dishes = Object.entries(d.dishes).sort((a, b) => b[1][1] - a[1][1]).slice(0, MAX_DISHES);
    const n = (v) => (v == null ? null : r2(v));
    return {
      day: d.day, net: r2(d.net), gross: r2(d.gross), discounts: r2(d.discounts), refunds: n(d.refunds), voids: n(d.voids),
      tax: n(d.tax), tips: n(d.tips), food: n(d.food), drink: n(d.drink),
      covers: d.covers, orders: d.orders,
      channels: Object.fromEntries(Object.entries(d.channels).map(([k, v]) => [k, r2(v)])),
      labour: n(d.labour), labourHours: n(d.labourHours),
      turnMin: d._turn[1] ? r1(d._turn[0] / d._turn[1]) : null,
      firstOrder: d._first == null ? null : hhmm(d._first), lastOrder: d._last == null ? null : hhmm(d._last),
      hours: [...d._hours.values()].sort((a, b) => serviceHour(a.h) - serviceHour(b.h)).map((c) => ({
        h: c.h, covers: c.covers, sales: r2(c.sales), orders: c.orders,
        servers: hasTime ? d._floor.get(c.h)?.size ?? 0 : null, labourHours: n(c.labourHours), labour: n(c.labour),
      })),
      dishes: Object.fromEntries(dishes.map(([k, v]) => [k, [r2(v[0]), r2(v[1]), r2(v[2]), v[3]]])),
    };
  });
  for (const k of Object.keys(checks)) checks[k] = checks[k].sort((a, b) => serviceHour(+a[1].slice(0, 2)) * 60 + +a[1].slice(3) - (serviceHour(+b[1].slice(0, 2)) * 60 + +b[1].slice(3))).slice(0, MAX_CHECKS);
  return { days: out, checks };
}

/**
 * Parsed Toast files (an upload of several weeks) → day summaries.
 * @param {{ kind: string, rows: Record<string,string>[] }[]} files
 * @param {{ now?: Date }} [opts] `now`: the uploader's clock; a day that hasn't ended yet is partial.
 */
export function daysFromExports(files, { now = new Date() } = {}) {
  const known = files.filter((f) => ['items', 'orders', 'time', 'payments'].includes(f.kind));
  if (!known.length) return { ok: false, error: 'None of these are Toast exports Daily detail reads. Drop OrderDetails.csv (sales, checks and covers), with ItemSelectionDetails.csv, TimeEntries.csv and PaymentDetails.csv if you have them.' };
  const { days: all, checks } = summarizeDays(known);
  const days = all.filter((d) => d.orders > 0 || d.net !== 0 || (d.labour ?? 0) > 0).slice(-KEEP_DAYS);
  if (!days.length) return { ok: false, error: 'These files have no dated rows.' };
  // The upload's clock, as a wall-clock stamp: the business day still running then is partial.
  const local = now.getTime() - now.getTimezoneOffset() * 6e4;
  const running = businessDay(local);
  const kinds = [...new Set(known.map((f) => f.kind))];
  return {
    ok: true, kinds, first: days[0].day, last: days.at(-1).day,
    days: days.map((d) => ({ summary: d, checks: checks[d.day] ?? [], complete: d.day < running })),
  };
}

/* --------------------------------------------------------------- the view */

/**
 * What the page shows, from stored day summaries (with or without dishes).
 * @param {(DaySummary & { source?: string, complete?: boolean })[]} summaries
 * @param {{ items?: any[] }} [opts] pre-built weekly items (the server builds them from dishes it doesn't send)
 */
export function buildDaily(summaries, { items } = {}) {
  const list = [...summaries].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-KEEP_DAYS);
  if (!list.length) return null;
  const days = list.map((s) => ({
    iso: s.day, dow: dowOf(s.day), source: s.source ?? null, complete: s.complete !== false,
    net: s.net, gross: s.gross ?? null, discounts: s.discounts, refunds: s.refunds ?? null, voids: s.voids ?? null,
    tax: s.tax ?? null, tips: s.tips ?? null, foodSales: s.food ?? null, drinkSales: s.drink ?? null,
    covers: s.covers, orders: s.orders, check: s.covers ? r2(s.net / s.covers) : null,
    channels: s.channels || {}, labour: s.labour ?? null, labourHours: s.labourHours ?? null, turnMin: s.turnMin ?? null,
    firstOrder: s.firstOrder ?? null, lastOrder: s.lastOrder ?? null,
    hours: s.hours || [],
    food: null, earned: null, ticketMin: null, comps: null,
  }));
  const last = list.at(-1).day;
  const from = addDays(last, -HOURLY_WEEKS * 7 + 1);
  const hours = days.filter((d) => d.iso >= from).flatMap((d) => d.hours.map((h) => ({ iso: d.iso, dow: d.dow, hour: h.h, ...h })));
  const channels = [...new Set(days.flatMap((d) => Object.keys(d.channels)))];
  const sources = {};
  for (const s of list) sources[s.source ?? 'toast'] = (sources[s.source ?? 'toast'] || 0) + 1;
  const weeksHeld = Math.min(52, Math.floor((Date.parse(`${last}T12:00:00Z`) - Date.parse(`${list[0].day}T12:00:00Z`)) / (7 * MS_DAY)) + 1);
  const its = items ?? weeklyItems(list);
  return {
    own: true, days, hours, items: its, weeksHeld, channels, sources,
    has: {
      labour: days.some((d) => d.labour != null), voids: days.some((d) => d.voids != null), refunds: days.some((d) => d.refunds != null),
      tax: days.some((d) => d.tax != null), tips: days.some((d) => d.tips != null), mix: days.some((d) => d.foodSales != null),
      turn: days.some((d) => d.turnMin != null), servers: hours.some((h) => h.servers != null && h.servers > 0),
      labourHours: hours.some((h) => (h.labourHours ?? 0) > 0),
      food: false, earned: false, ticket: false, seatUse: false, dishes: its.length > 0, itemSales: true,
    },
  };
}

/** Dish units and net sales by week, the 52 weeks to the last day (index 51 is the latest week). Top 60 by net. */
export function weeklyItems(list) {
  if (!list.length) return [];
  const last = list.at(-1).day;
  const weekOf = (iso) => 51 - Math.floor((Date.parse(`${last}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / (7 * MS_DAY));
  const dish = new Map();
  for (const s of list) {
    const w = weekOf(s.day);
    if (w < 0) continue;
    for (const [name, v] of Object.entries(s.dishes || {})) {
      const [u, net, gross, cat] = Array.isArray(v) ? v : [v, 0, 0, ''];
      if (!dish.has(name)) dish.set(name, { key: name, name, cat, units: Array(52).fill(0), net: Array(52).fill(0), gross: Array(52).fill(0) });
      const x = dish.get(name);
      x.units[w] += u; x.net[w] += net; x.gross[w] += gross;
    }
  }
  return [...dish.values()].sort((a, b) => sum(b.net) - sum(a.net)).slice(0, 60)
    .map((x) => ({ ...x, units: x.units.map(r2), net: x.net.map(r2), gross: x.gross.map(r2) }));
}
const sum = (a) => a.reduce((s, x) => s + x, 0);

/** The sample's dense detail in the same shape. Clearly sample: never shown as a real restaurant's. */
export function fromSample(dense, roomChannels = []) {
  if (!dense) return null;
  const name = Object.fromEntries(roomChannels.map((c) => [c.k, c.name]));
  const byIso = new Map();
  for (const h of dense.hours) (byIso.get(h.iso) ?? byIso.set(h.iso, []).get(h.iso)).push({ h: h.hour, covers: h.covers, sales: h.sales, orders: h.tickets, servers: h.servers, labourHours: null, labour: null, ticketMin: h.ticketMin, seatUse: h.seatUse });
  const days = dense.days.map((d) => ({
    ...d, source: 'sample', complete: true, orders: null, refunds: null, labourHours: null, gross: r2(d.net + d.discounts), tax: null, tips: null,
    foodSales: null, drinkSales: null, firstOrder: null, lastOrder: null,
    channels: Object.fromEntries(Object.entries(d.channels).map(([k, v]) => [name[k] ?? k, v])),
    hours: byIso.get(d.iso) ?? [],
  }));
  const items = dense.items.map((it) => ({ key: it.key, name: it.name, cat: it.cat, units: it.units, net: null, gross: null }));
  return {
    own: false, days, hours: dense.hours.map((h) => ({ ...h, orders: h.tickets })), items, weeksHeld: 52, priorGrowth: dense.priorGrowth,
    channels: [...new Set(days.flatMap((d) => Object.keys(d.channels)))], sources: { sample: days.length },
    has: { labour: true, voids: true, refunds: false, tax: false, tips: false, mix: false, turn: true, servers: true, labourHours: false, food: true, earned: true, ticket: true, seatUse: true, dishes: true, itemSales: false },
  };
}

/* ------------------------------------------------------------- readings */

/** The ISO date 364 days earlier: the same weekday about a year before (not the same calendar date). */
export const lastYear = (iso) => addDays(iso, -364);

const sumOf = (arr, f) => arr.reduce((s, x) => s + (f(x) ?? 0), 0);
/** Fractional change, or null when there's nothing to compare against. */
export function change(a, b) {
  return a != null && b != null && b !== 0 ? (a - b) / Math.abs(b) : null;
}
/** a / b, or null (never a misleading 0) when b is 0 or either is unknown. */
export const ratio = (a, b) => (a != null && b != null && b !== 0 ? a / b : null);

/**
 * Totals for the last `n` days to `end` (default: the newest day), and for the
 * same weekdays a year before. The comparison counts only days held in both
 * years, so a half-loaded year never reads as a fall.
 */
export function rangeTotals(days, n, end = days.at(-1)?.iso) {
  const byIso = new Map(days.map((d) => [d.iso, d]));
  const start = addDays(end, -n + 1);
  const win = days.filter((d) => d.iso >= start && d.iso <= end);
  const paired = win.filter((d) => byIso.has(lastYear(d.iso)));
  const ly = paired.map((d) => byIso.get(lastYear(d.iso)));
  const tot = (arr) => ({ net: sumOf(arr, (d) => d.net), covers: sumOf(arr, (d) => d.covers), labour: arr.length && arr.every((d) => d.labour != null) ? sumOf(arr, (d) => d.labour) : null });
  const cur = tot(win), now = tot(paired), before = tot(ly);
  const lab = (t) => (t.labour != null ? ratio(t.labour, t.net) : null);
  return {
    days: win.length, span: n, missing: n - win.length, from: win[0]?.iso ?? null, to: win.at(-1)?.iso ?? null,
    net: cur.net, covers: cur.covers, check: ratio(cur.net, cur.covers), labourPct: lab(cur) == null ? null : lab(cur) * 100,
    vs: paired.length >= Math.min(7, win.length) && paired.length ? {
      days: paired.length, net: change(now.net, before.net), covers: change(now.covers, before.covers),
      check: change(ratio(now.net, now.covers), ratio(before.net, before.covers)),
      labourPts: lab(now) != null && lab(before) != null ? (lab(now) - lab(before)) * 100 : null,
    } : null,
  };
}

/** Calendar months; rates come from summed numerators and denominators, never averaged. */
export function months(days) {
  const m = new Map();
  for (const d of days) {
    const k = d.iso.slice(0, 7);
    const x = m.get(k) ?? { month: k, days: 0, net: 0, covers: 0, orders: 0, food: 0, labour: 0, earned: 0, discounts: 0, _n: { food: 0, labour: 0, earned: 0, orders: 0 } };
    x.days++; x.net += d.net; x.covers += d.covers; x.discounts += d.discounts ?? 0;
    for (const f of ['food', 'labour', 'earned', 'orders']) if (d[f] != null) { x[f] += d[f]; x._n[f]++; }
    m.set(k, x);
  }
  return [...m.values()].map(({ _n, ...x }) => {
    const inMonth = new Date(Date.UTC(+x.month.slice(0, 4), +x.month.slice(5, 7), 0)).getUTCDate();
    // A rate needs its numerator on every day held, or it's unknown.
    for (const f of ['food', 'labour', 'earned', 'orders']) if (_n[f] !== x.days) x[f] = null;
    return { ...x, inMonth, complete: x.days === inMonth };
  });
}

/** Average of numeric day fields over some days; a field any day lacks is null. */
function averageDays(list) {
  if (!list.length) return null;
  const avg = (f) => (list.every((d) => d[f] != null) ? sumOf(list, (d) => d[f]) / list.length : null);
  /** @type {Record<string, any>} */
  const out = { n: list.length, isos: list.map((d) => d.iso) };
  for (const f of ['net', 'gross', 'discounts', 'refunds', 'voids', 'tax', 'tips', 'foodSales', 'drinkSales', 'covers', 'orders', 'labour', 'labourHours', 'food', 'earned', 'turnMin']) out[f] = avg(f);
  out.check = ratio(sumOf(list, (d) => d.net), sumOf(list, (d) => d.covers));
  const chans = new Set(list.flatMap((d) => Object.keys(d.channels)));
  out.channels = Object.fromEntries([...chans].map((c) => [c, sumOf(list, (d) => d.channels[c] ?? 0) / list.length]));
  // Hours: average per clock hour over the days that hold hours.
  const withHours = list.filter((d) => d.hours?.length);
  const hrs = new Map();
  for (const d of withHours) for (const h of d.hours) {
    const x = hrs.get(h.h) ?? { h: h.h, covers: 0, sales: 0, orders: 0, labourHours: 0, labour: 0, _lab: 0 };
    x.covers += h.covers; x.sales += h.sales; x.orders += h.orders ?? 0;
    if (h.labourHours != null) { x.labourHours += h.labourHours; x.labour += h.labour ?? 0; x._lab++; }
    hrs.set(h.h, x);
  }
  out.hours = withHours.length ? [...hrs.values()].map((x) => ({ h: x.h, covers: x.covers / withHours.length, sales: x.sales / withHours.length, orders: x.orders / withHours.length, labourHours: x._lab ? x.labourHours / withHours.length : null, labour: x._lab ? x.labour / withHours.length : null })) : [];
  return out;
}

export const COMPARISONS = {
  prev: { label: 'Previous same weekday', short: (dow) => `last ${dow}`, desc: 'The same weekday one week earlier.' },
  recent: { label: 'Recent same weekdays', short: (dow) => `the average of the last 4 ${dow}s`, desc: 'Average of the same weekday over the 4 weeks before, days held only.' },
  ly: { label: 'Same weekday a year earlier', short: (dow) => `the same ${dow} a year earlier`, desc: 'The same weekday 52 weeks (364 days) earlier: not the same calendar date.' },
};

/** The comparison for a day, by method. Null when the data holds none. */
export function compareDay(days, iso, method = 'recent') {
  const byIso = new Map(days.map((d) => [d.iso, d]));
  const pick = method === 'prev' ? [addDays(iso, -7)] : method === 'ly' ? [lastYear(iso)] : [1, 2, 3, 4].map((w) => addDays(iso, -7 * w));
  const list = pick.map((x) => byIso.get(x)).filter(Boolean);
  const out = averageDays(list);
  if (out) out.partial = list.some((d) => d.complete === false);
  return out;
}

/** The same weekday in the 8 weeks before a day, held days only (calendar shading). */
export function weekdayBaseline(days, iso, weeks = 8, byIso = new Map(days.map((d) => [d.iso, d]))) {
  const prev = [];
  for (let w = 1; w <= weeks; w++) { const d = byIso.get(addDays(iso, -7 * w)); if (d) prev.push(d); }
  if (!prev.length) return null;
  return { n: prev.length, net: sumOf(prev, (d) => d.net) / prev.length, covers: sumOf(prev, (d) => d.covers) / prev.length };
}

/* ---------------------------------------------------------- day parts */

/** Default day parts, on the service clock (4…27). A restaurant changes them on the page. */
export const DEFAULT_DAYPARTS = [
  { name: 'Breakfast', from: 4, to: 11 },
  { name: 'Lunch', from: 11, to: 16 },
  { name: 'Dinner', from: 16, to: 22 },
  { name: 'Late night', from: 22, to: 28 },
];

/** Check day parts: names, whole hours on the service clock, no overlaps. Returns an error string or null. */
export function daypartError(parts) {
  if (!Array.isArray(parts) || !parts.length) return 'Add at least one day part.';
  if (parts.length > 8) return 'At most 8 day parts.';
  const sorted = [...parts].sort((a, b) => a.from - b.from);
  for (const [i, p] of sorted.entries()) {
    if (!String(p.name || '').trim()) return 'Every day part needs a name.';
    if (!(Number.isInteger(p.from) && Number.isInteger(p.to) && p.from >= DAY_STARTS_AT && p.to <= 24 + DAY_STARTS_AT && p.to > p.from)) return `${p.name}: hours must run forward inside the business day (4 am to 4 am).`;
    if (i && sorted[i - 1].to > p.from) return `${sorted[i - 1].name} and ${p.name} overlap.`;
  }
  return null;
}

/**
 * Sales, checks and covers by day part, from a day's hours. Each check sits in
 * the hour it was opened, so it counts in exactly one part; hours no part
 * covers are reported as "Outside day parts" so the parts add back to the day.
 */
export function dayparts(day, parts = DEFAULT_DAYPARTS) {
  if (!day?.hours?.length) return null;
  const rows = parts.map((p) => ({ name: p.name, from: p.from, to: p.to, sales: 0, covers: 0, orders: 0 }));
  const other = { name: 'Outside day parts', from: null, to: null, sales: 0, covers: 0, orders: 0 };
  for (const h of day.hours) {
    const sh = serviceHour(h.h);
    const row = rows.find((p) => sh >= p.from && sh < p.to) ?? other;
    row.sales += h.sales; row.covers += h.covers; row.orders += h.orders ?? 0;
  }
  return [...rows, ...(other.sales || other.covers ? [other] : [])].map((r) => ({ ...r, check: ratio(r.sales, r.covers) }));
}
export const hourLabel = (h) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);
export const partHours = (p) => `${hourLabel(p.from % 24)}–${hourLabel(p.to % 24)}`;

/* ------------------------------------------------------ what changed */

/**
 * The most important change against a comparison, in observational terms:
 * sales split arithmetically into the covers effect (Δcovers × the
 * comparison's check) and the check effect (covers × Δcheck), and the day
 * part and channel that moved most. "Largest arithmetic contributor", never
 * "because".
 */
export function explainDay(day, base, { parts = DEFAULT_DAYPARTS, label = 'the comparison' } = {}) {
  if (!day || !base || base.net == null || !base.net) return null;
  const dNet = day.net - base.net;
  const pct = change(day.net, base.net);
  const coversEffect = base.check != null ? (day.covers - base.covers) * base.check : null;
  const checkEffect = day.check != null && base.check != null ? day.covers * (day.check - base.check) : null;
  const dp = dayparts(day, parts), bp = base.hours?.length ? dayparts({ hours: base.hours }, parts) : null;
  const partMoves = dp && bp ? dp.map((p) => ({ name: p.name, d: p.sales - (bp.find((x) => x.name === p.name)?.sales ?? 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)) : [];
  const chanMoves = Object.keys({ ...day.channels, ...base.channels }).map((c) => ({ name: c, d: (day.channels[c] ?? 0) - (base.channels[c] ?? 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const flat = pct != null && Math.abs(pct) < 0.03;
  const drivers = [
    coversEffect != null && { key: 'covers', d: coversEffect, text: `${day.covers > base.covers ? 'more' : 'fewer'} covers (${Math.round(day.covers - base.covers) > 0 ? '+' : '−'}${Math.abs(Math.round(day.covers - base.covers))})` },
    checkEffect != null && { key: 'check', d: checkEffect, text: `a ${day.check > base.check ? 'higher' : 'lower'} average check (${day.check > base.check ? '+' : '−'}$${Math.abs(day.check - base.check).toFixed(2)})` },
  ].filter(Boolean).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  return {
    dNet, pct, flat, coversEffect, checkEffect, drivers, partMoves, chanMoves,
    headline: flat
      ? `Sales were in line with ${label} (${pct >= 0 ? '+' : '−'}${Math.abs(pct * 100).toFixed(1)}%).`
      : `Sales were ${Math.abs(pct * 100).toFixed(0)}% ${dNet > 0 ? 'above' : 'below'} ${label}${drivers[0] ? `; the largest arithmetic contributor was ${drivers[0].text}` : ''}.`,
  };
}

/* ------------------------------------------------------------ heat grid */

/**
 * Weekday × hour: average per hour over the days that held that weekday, over
 * the hours the room actually trades. A cell with no observation is null
 * (shown as missing), which is different from a measured zero.
 * @param {{ iso: string, dow: string, hour: number }[]} hours
 * @param {string} field covers | sales | splh (sales per labour hour) | cps (covers per server) | ticketMin | seatUse
 */
export function heatGrid(hours, field) {
  const seen = new Set(), daysByDow = new Map(), cell = new Map();
  for (const h of hours) {
    (daysByDow.get(h.dow) ?? daysByDow.set(h.dow, new Set()).get(h.dow)).add(h.iso);
    if ((h.covers ?? 0) > 0 || (h.sales ?? 0) > 0) seen.add(serviceHour(h.hour));
    const c = cell.get(`${h.dow}|${h.hour}`) ?? { num: 0, den: 0, n: 0 };
    if (field === 'splh') { if (h.labourHours) { c.num += h.sales; c.den += h.labourHours; c.n++; } }
    else if (field === 'cps') { if (h.servers) { c.num += h.covers; c.den += h.servers; c.n++; } }
    else if (h[field] != null) { c.num += h[field]; c.n++; }
    cell.set(`${h.dow}|${h.hour}`, c);
  }
  const hrs = [...seen].sort((a, b) => a - b);
  const span = hrs.length ? Array.from({ length: hrs.at(-1) - hrs[0] + 1 }, (_, i) => (hrs[0] + i) % 24) : [];
  const avg = (c, dow) => {
    if (field === 'splh' || field === 'cps') return c && c.den ? c.num / c.den : null;
    if (field === 'ticketMin' || field === 'seatUse') return c && c.n ? c.num / c.n : null;
    const n = daysByDow.get(dow)?.size ?? 0;
    return n ? (c?.num ?? 0) / n : null; // a trading hour with no orders on those days is a real zero
  };
  return { hours: span, rows: DOW.map((dow) => ({ dow, cells: span.map((hour) => ({ hour, v: avg(cell.get(`${dow}|${hour}`), dow) })) })) };
}

/** A month laid out Monday-first, padded with nulls. */
export function calendar(monthKey) {
  const first = `${monthKey}-01`;
  const lead = DOW.indexOf(dowOf(first));
  const n = new Date(Date.UTC(+monthKey.slice(0, 4), +monthKey.slice(5, 7), 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  return cells;
}

/* ------------------------------------------------------------------ CSV */

/** One CSV cell: quoted when needed, and text a spreadsheet would run as a formula is neutralised. */
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV of the days in [from, to]: a header block (room, period, time zone,
 * source, generation time, column definitions), then one row per day held.
 * Only the columns the data has; a missing day is absent, never a zero row.
 * @param {any} view
 * @param {{ room?: string, from?: string, to?: string, tz?: string, generated?: Date }} [opts]
 */
export function daysCsv(view, { room = '', from, to, tz = 'restaurant local time', generated = new Date() } = {}) {
  const has = view.has;
  const cols = [
    ['business_date', 'Business day (4 am to 4 am, ' + tz + ')', (d) => d.iso], ['weekday', '', (d) => d.dow],
    ['status', 'final, or partial when the day was still trading or syncing', (d) => (d.complete === false ? 'partial' : 'final')],
    ['source', 'toast-api (sync), toast-export (upload) or sample', (d) => d.source],
    ['net_sales_usd', 'Order amount after discounts, before tax and tips, voided orders excluded', (d) => d.net],
    ['gross_sales_usd', 'Net sales plus discounts', (d) => d.gross], ['discounts_usd', '', (d) => d.discounts],
    ...(has.refunds ? [['refunds_usd', 'Refunded on this day', (d) => d.refunds]] : []),
    ...(has.tax ? [['tax_usd', 'Not part of sales', (d) => d.tax]] : []),
    ...(has.tips ? [['tips_usd', 'Tips and gratuity, not part of sales', (d) => d.tips]] : []),
    ...(has.mix ? [['food_sales_usd', 'By Toast sales category', (d) => d.foodSales], ['beverage_sales_usd', 'By Toast sales category', (d) => d.drinkSales]] : []),
    ['checks', 'Orders not voided', (d) => d.orders], ['covers', 'Guests on those orders', (d) => d.covers], ['avg_check_usd', 'Net sales ÷ covers', (d) => d.check],
    ...view.channels.map((c) => [`sales_${c.replace(/\W+/g, '_').toLowerCase()}_usd`, `Net sales, ${c}`, (d) => d.channels[c] ?? 0]),
    ...(has.food ? [['food_cost_usd', 'Sample: food cost', (d) => d.food]] : []),
    ...(has.labour ? [['labour_usd', 'Actual pay from time entries, by the day the shift started', (d) => d.labour], ['labour_pct', 'Labour ÷ net sales × 100', (d) => (d.labour != null && d.net ? (d.labour / d.net) * 100 : null)]] : []),
    ...(view.days.some((d) => d.labourHours != null) ? [['labour_hours', 'Payable hours', (d) => d.labourHours]] : []),
    ...(has.voids ? [['voids_after_send_usd', 'Items voided after they reached the kitchen', (d) => d.voids]] : []),
    ...(has.turn ? [['dine_in_turn_min', 'Average opened-to-paid minutes, dine-in', (d) => d.turnMin]] : []),
    ...(has.ticket ? [['ticket_min', 'Sample: ticket time', (d) => d.ticketMin]] : []),
    ...(has.earned ? [['contribution_after_food_and_labour_usd', 'Net sales − food cost − labour (not profit)', (d) => d.earned]] : []),
  ];
  const rows = view.days.filter((d) => (!from || d.iso >= from) && (!to || d.iso <= to));
  const head = [
    ['# Coversight daily export'], ['# Room', room], ['# Period', `${rows[0]?.iso ?? ''} to ${rows.at(-1)?.iso ?? ''}`, `${rows.length} days held`],
    ['# Business day', `4 am to 4 am, ${tz}`], ['# Data', view.own ? 'Your Toast data' : 'SAMPLE DATA, not a real restaurant'],
    ['# Generated', generated.toISOString()], ['# Calculation', CALC_VERSION],
    ...cols.filter(([, def]) => def).map(([k, def]) => [`# ${k}`, def]),
  ];
  return [...head.map((r) => r.map(csvCell).join(',')), cols.map((c) => c[0]).join(','), ...rows.map((d) => cols.map(([, , f]) => csvCell(f(d))).join(','))].join('\n');
}
