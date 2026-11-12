/**
 * Toast nightly data exports → Coversight inputs.
 *
 * Every Toast restaurant can turn on the nightly data export (Toast Web →
 * Reports → Data exports) or download the same CSVs by hand. This reads the
 * files by their real headers (doc.toasttab.com, "Data export field
 * reference") and turns them into the inputs the rest of the model already
 * understands, so a group's own Toast history drives every figure without API
 * credentials:
 *
 *   ItemSelectionDetails.csv → recipes (price, plates/week), priceHistory,
 *                              voids by server, channel sales
 *   OrderDetails.csv         → covers, parties per hour, turn times, reseat gaps,
 *                              discounts by server, weekly net
 *   TimeEntries.csv          → servers on the floor per hour, overtime, wage,
 *                              hours and pay per employee, weekly labour
 *   PaymentDetails.csv       → refunds by channel
 *   KitchenTimings.csv       → ticket times by station and hour
 *
 * Pure JS: the browser parses (files can be many MB; only the summary is
 * sent), the server re-validates the summary's shape and bounds.
 */

import { parseCSV } from './ingest.js';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MS_DAY = 864e5;
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const norm = (s) => String(s || '').trim().toLowerCase();
const sum = (a) => a.reduce((s, x) => s + x, 0);

/* ------------------------------------------------------------------ files */
/** Header fingerprints: a file is a kind when it carries every one of these. */
export const TOAST_FILES = {
  items: { file: 'ItemSelectionDetails.csv', needs: ['Order Id', 'Menu Item', 'Net Price', 'Qty', 'Void?'], feeds: 'menu prices and plates, price history, voids, channels' },
  orders: { file: 'OrderDetails.csv', needs: ['Order Id', 'Opened', '# of Guests', 'Server', 'Amount'], feeds: 'covers, parties per hour, turn times, discounts, weekly sales' },
  time: { file: 'TimeEntries.csv', needs: ['Employee', 'Job Title', 'In Date', 'Out Date', 'Wage'], feeds: 'servers on the floor, overtime, wages, weekly labour' },
  payments: { file: 'PaymentDetails.csv', needs: ['Payment Id', 'Order Id', 'Dining Option', 'Refund Amount'], feeds: 'refunds by channel' },
  kitchen: { file: 'KitchenTimings.csv', needs: ['Station', 'Fired Date', 'Fulfillment Time'], feeds: 'ticket times by station' },
};

export function detectToastFile(headers) {
  const set = new Set(headers.map((h) => h.trim()));
  return Object.entries(TOAST_FILES).find(([, f]) => f.needs.every((h) => set.has(h)))?.[0] ?? null;
}

/* ------------------------------------------------------------------ values */
/** Toast writes dates as "10/27/26 5:43 PM", "10/27/2026 17:43" or ISO. Returns ms (local wall clock as UTC) or null. */
export function parseToastDate(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
  if (m) {
    let [, mo, d, y, h = '0', mi = '0', sec = '0', ap] = m;
    let year = +y; if (year < 100) year += 2000;
    let hour = +h;
    if (ap) { const pm = /p/i.test(ap); if (hour === 12) hour = pm ? 12 : 0; else if (pm) hour += 12; }
    const v = Date.UTC(year, +mo - 1, +d, hour, +mi, +sec);
    return Number.isFinite(v) ? v : null;
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return null;
}
/** "$1,234.50", "(12.00)", "12" → number; blank → 0. */
export function money(s) {
  const t = String(s ?? '').trim();
  if (!t) return 0;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const v = parseFloat(t.replace(/[^0-9.]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : 0;
}
const yes = (s) => /^(true|yes|y|1)$/i.test(String(s || '').trim());
/** Minutes from "0:58:12", "58:12", "58 minutes", "1.2 hours" or a bare number of minutes. */
export function minutes(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const hms = t.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (hms) return hms[3] != null ? +hms[1] * 60 + +hms[2] + +hms[3] / 60 : +hms[1] + +hms[2] / 60;
  const v = parseFloat(t);
  if (!Number.isFinite(v)) return null;
  return /hour|hr/i.test(t) ? v * 60 : /sec/i.test(t) ? v / 60 : v;
}

/** Dining option → one of the four channels the model knows. */
export function channelOf(option) {
  const o = norm(option);
  if (/door\s*dash/.test(o)) return 'DoorDash';
  if (/uber/.test(o)) return 'Uber Eats';
  if (/take|pick|to ?go|online|curbside/.test(o)) return 'Takeout';
  return 'Dine-in';
}
const isDineIn = (option) => channelOf(option) === 'Dine-in';

/** Job title → overtime group the overtime lever reads. */
export function jobGroup(title) {
  const t = norm(title);
  if (/bar(?!back)|bartend|mixolog/.test(t)) return 'bar';
  if (/cook|chef|kitchen|line|prep|dish|sous|pastry|boh|expo|porter/.test(t)) return 'boh';
  return 'foh';
}
const isServer = (title) => /server|waiter|waitress|captain/.test(norm(title));

/* ------------------------------------------------------------------ summary */
/**
 * @param {{ kind: string, rows: Record<string,string>[] }[]} files parsed exports (any subset)
 * @returns the summary: weeks covered, inputs for existing kinds, and the `toast` kind (levers, history, tickets)
 */
export function summarizeToast(files) {
  const by = (k) => files.filter((f) => f.kind === k).flatMap((f) => f.rows);
  const items = by('items'), orders = by('orders'), time = by('time'), payments = by('payments'), kitchen = by('kitchen');

  // The window ends at the newest timestamp in any file; weeks count back from there.
  const stamps = [
    ...items.map((r) => parseToastDate(r['Order Date'] || r['Sent Date'])),
    ...orders.map((r) => parseToastDate(r.Opened)),
    ...time.map((r) => parseToastDate(r['In Date'])),
    ...kitchen.map((r) => parseToastDate(r['Fired Date'])),
  ].filter((x) => x != null);
  if (!stamps.length) return { ok: false, error: 'No dated rows found in these files.' };
  const end = Math.max(...stamps);
  const endDay = Math.floor(end / MS_DAY) * MS_DAY + MS_DAY; // midnight after the last day
  const weekOf = (ms) => Math.floor((endDay - ms) / (7 * MS_DAY)); // 0 = the latest 7 days
  const first = Math.min(...stamps);
  const weeksCovered = Math.min(52, weekOf(first) + 1);
  const recent = (ms, w = 4) => ms != null && weekOf(ms) < w;
  const toWin = (w) => (w); // weeks back → index from oldest is (n-1-w)

  const out = { ok: true, end: new Date(end).toISOString().slice(0, 10), weeksCovered, files: [...new Set(files.map((f) => f.kind))], rows: {}, toast: {}, notes: [] };

  /* ---- menu: price and plates per week, last 4 weeks; price history, last 8 */
  if (items.length) {
    const live = items.filter((r) => !yes(r['Void?']));
    const dish = new Map();
    for (const r of live) {
      const t = parseToastDate(r['Order Date'] || r['Sent Date']);
      const name = String(r['Menu Item'] || '').trim();
      if (!name || t == null) continue;
      const qty = money(r.Qty) || 1;
      const net = money(r['Net Price']);
      const gross = money(r['Gross Price']) || net;
      const w = weekOf(t);
      if (!dish.has(name)) dish.set(name, { name, cat: r['Sales Category'] || r['Menu Group'] || '', weeks: new Map() });
      const wk = dish.get(name).weeks;
      const cell = wk.get(w) || { units: 0, gross: 0 };
      cell.units += qty; cell.gross += gross;
      wk.set(w, cell);
    }
    const recipes = [];
    const priceHistory = {};
    for (const d of dish.values()) {
      const last4 = [0, 1, 2, 3].map((w) => d.weeks.get(w) || { units: 0, gross: 0 });
      const units = sum(last4.map((c) => c.units)) / Math.min(4, weeksCovered);
      const gross = sum(last4.map((c) => c.gross));
      const qty = sum(last4.map((c) => c.units));
      if (qty <= 0) continue;
      recipes.push({ dish: d.name, price: r2(gross / qty), units: r1(units), category: /bev|drink|wine|beer|liquor|cocktail/i.test(d.cat) ? 'Drink' : 'Food' });
      const hist = [];
      for (let w = Math.min(8, weeksCovered) - 1; w >= 0; w--) {
        const c = d.weeks.get(w);
        if (c && c.units > 0) hist.push({ price: r2(c.gross / c.units), units: Math.round(c.units) });
      }
      if (hist.length >= 4) priceHistory[d.name] = hist;
    }
    recipes.sort((a, b) => b.units * b.price - a.units * a.price);
    out.rows.recipes = recipes.slice(0, 300);
    out.toast.priceHistory = Object.fromEntries(Object.entries(priceHistory).sort((a, b) => b[1].length - a[1].length).slice(0, 120));

    // Channels from items (orders and refunds added below when the files are there).
    const ch = {};
    for (const r of live) {
      const t = parseToastDate(r['Order Date'] || r['Sent Date']);
      if (!recent(t, 1)) continue;
      const c = channelOf(r['Dining Option']);
      ch[c] ??= { channel: c, sales: 0, orders: new Set(), refunds: 0 };
      ch[c].sales += money(r['Net Price']);
      ch[c].orders.add(r['Order Id']);
    }
    out._channels = ch;
  }

  /* ---- employees: sales, voids, discounts (28 days), hours and wage */
  const emp = new Map();
  const E = (name) => {
    const k = String(name || '').trim();
    if (!k) return null;
    if (!emp.has(k)) emp.set(k, { employee: k, role: '', sales: 0, post_send_voids: 0, comps: 0, discounts: 0, hours: null, rate: null, checks: new Set() });
    return emp.get(k);
  };
  for (const r of items) {
    const t = parseToastDate(r['Order Date'] || r['Sent Date']);
    if (!recent(t)) continue;
    const e = E(r.Server); if (!e) continue;
    if (yes(r['Void?'])) { if (String(r['Sent Date'] || '').trim()) e.post_send_voids += Math.abs(money(r['Gross Price']) || money(r['Net Price'])); }
    else e.sales += money(r['Net Price']);
  }
  for (const r of orders) {
    const t = parseToastDate(r.Opened);
    if (!recent(t) || yes(r.Voided)) continue;
    const e = E(r.Server); if (!e) continue;
    e.discounts += Math.abs(money(r['Discount Amount']));
    e.checks.add(r['Order Id']);
    if (!items.length) e.sales += money(r.Amount);
  }

  /* ---- time entries: role, wage, hours/week; OT minutes by group; on-floor servers by hour */
  const onFloor = new Map(); // `${week}|${day}|${hour}` → Set(employee)
  const otWeeks = { boh: [0, 0, 0, 0], foh: [0, 0, 0, 0], bar: [0, 0, 0, 0] };
  const labourWeeks = new Map();
  const otWeekMin = new Map();
  let wagePay = 0, wageHours = 0;
  for (const r of time) {
    const tin = parseToastDate(r['In Date']); const tout = parseToastDate(r['Out Date']);
    if (tin == null) continue;
    const w = weekOf(tin);
    const pay = money(r['Total Pay']);
    labourWeeks.set(w, (labourWeeks.get(w) || 0) + pay);
    const otAll = money(r['Overtime Hours']);
    if (otAll > 0) otWeekMin.set(w, (otWeekMin.get(w) || 0) + Math.round(otAll * 60));
    if (w >= 4) continue;
    const hours = money(r['Payable Hours']) || money(r['Total Hours']) || (tout ? (tout - tin) / 36e5 : 0);
    const wage = money(r.Wage);
    const e = E(r.Employee);
    if (e) {
      e.role ||= r['Job Title'] || '';
      e.hours = (e.hours || 0) + hours / Math.min(4, weeksCovered);
      if (wage > 0) e.rate = wage;
    }
    if (wage > 0 && hours > 0) { wagePay += wage * hours; wageHours += hours; }
    const ot = money(r['Overtime Hours']);
    if (ot > 0) otWeeks[jobGroup(r['Job Title'])][3 - w] += Math.round(ot * 60);
    if (isServer(r['Job Title']) && tout != null && tout > tin) {
      for (let h = Math.floor(tin / 36e5); h * 36e5 < tout; h++) {
        const ms = h * 36e5;
        // On the floor for the hour if clocked in for at least half of it.
        const overlap = Math.min(tout, ms + 36e5) - Math.max(tin, ms);
        if (overlap < 18e5) continue;
        const d = new Date(ms);
        const key = `${weekOf(ms)}|${DAY[d.getUTCDay()]}|${d.getUTCHours()}`;
        if (!onFloor.has(key)) onFloor.set(key, new Set());
        onFloor.get(key).add(r.Employee);
      }
    }
  }
  if (time.length) {
    out.toast.ot = otWeeks;
    if (wageHours > 0) out.toast.wage = r2(wagePay / wageHours);
  }
  const people = [...emp.values()].filter((e) => e.sales > 0 || e.hours > 0);
  if (people.length) {
    out.rows.exceptions = people.map((e) => ({
      employee: e.employee, role: e.role || (e.sales > 0 ? 'Server' : ''), sales: r2(e.sales), post_send_voids: r2(e.post_send_voids), comps: r2(e.comps), discounts: r2(e.discounts),
      ...(e.hours != null ? { hours: r1(e.hours) } : {}), ...(e.rate != null ? { rate: r2(e.rate) } : {}),
    })).slice(0, 400);
  }

  /* ---- orders: covers, parties, turns, reseat gaps, weekly net */
  if (orders.length) {
    const live = orders.filter((r) => !yes(r.Voided));
    const hours = new Map();
    const netWeeks = new Map(), coverWeeks = new Map();
    const turns = [];
    const turnWeeks = new Map();
    const byTable = new Map();
    for (const r of live) {
      const t = parseToastDate(r.Opened);
      if (t == null) continue;
      const w = weekOf(t);
      const guests = Math.max(0, Math.round(money(r['# of Guests'])));
      netWeeks.set(w, (netWeeks.get(w) || 0) + money(r.Amount));
      coverWeeks.set(w, (coverWeeks.get(w) || 0) + guests);
      if (!isDineIn(r['Dining Options'])) continue;
      const durAll = minutes(r['Duration (Opened to Paid)']) ?? (parseToastDate(r.Paid) != null ? (parseToastDate(r.Paid) - t) / 6e4 : null);
      if (durAll != null && durAll > 5 && durAll < 360) { const tw = turnWeeks.get(w) || [0, 0]; tw[0] += durAll; tw[1] += 1; turnWeeks.set(w, tw); }
      const d = new Date(t);
      const day = DAY[d.getUTCDay()];
      if (w < 4) {
        const key = `${w}|${day}|${d.getUTCHours()}`;
        const c = hours.get(key) || { week: 3 - w, day, hour: d.getUTCHours(), covers: 0, parties: 0 };
        c.covers += guests; c.parties += 1;
        hours.set(key, c);
        const dur = minutes(r['Duration (Opened to Paid)']) ?? (parseToastDate(r.Paid) != null ? (parseToastDate(r.Paid) - t) / 6e4 : null);
        if (dur != null && dur > 5 && dur < 360) turns.push({ fri: day === 'Fri' && d.getUTCHours() >= 17, min: r1(dur) });
        const table = String(r.Table || '').trim();
        const closed = parseToastDate(r.Paid) ?? parseToastDate(r.Closed);
        if (table && closed != null) {
          if (!byTable.has(table)) byTable.set(table, []);
          byTable.get(table).push({ open: t, close: closed });
        }
      }
    }
    const serviceHours = [...hours.entries()].map(([key, c]) => ({ ...c, servers: onFloor.get(key)?.size ?? 0 }))
      .filter((h) => h.covers > 0 && (h.servers > 0 || !time.length))
      .map((h) => (time.length ? h : { ...h, servers: null }))
      .sort((a, b) => a.week - b.week || DAY.indexOf(a.day) - DAY.indexOf(b.day) || a.hour - b.hour);
    if (time.length) out.toast.serviceHours = serviceHours.slice(0, 2000);
    else out.notes.push('Add TimeEntries.csv to measure servers on the floor per hour (the labour lever needs it).');
    if (turns.length) out.toast.turns = turns.slice(-400);
    const gaps = [];
    for (const list of byTable.values()) {
      list.sort((a, b) => a.open - b.open);
      for (let i = 0; i + 1 < list.length; i++) {
        const sameNight = Math.floor(list[i].open / MS_DAY) === Math.floor(list[i + 1].open / MS_DAY);
        const g = (list[i + 1].open - list[i].close) / 6e4;
        gaps.push(sameNight && g >= 0 && g <= 120 ? r1(g) : null);
      }
    }
    if (gaps.length) out.toast.reseatGaps = gaps.slice(-300);
    const weeks = Math.min(52, weeksCovered);
    const history = [];
    for (let w = weeks - 1; w >= 0; w--) {
      if (!netWeeks.has(w)) continue;
      const tw = turnWeeks.get(w);
      history.push({
        ago: w, net: Math.round(netWeeks.get(w)), covers: coverWeeks.get(w) || 0, labour: labourWeeks.has(w) ? Math.round(labourWeeks.get(w)) : null,
        turn: tw ? r1(tw[0] / tw[1]) : null, otMin: time.length ? otWeekMin.get(w) || 0 : null,
      });
    }
    out.toast.history = history;
    const last4 = [0, 1, 2, 3].filter((w) => coverWeeks.has(w));
    if (last4.length) out.toast.covers = Math.round(sum(last4.map((w) => coverWeeks.get(w))) / last4.length);

    // Weekly per-server void/discount rates for the controls lever (12 weeks).
    const vw = new Map();
    for (const r of live) {
      const t = parseToastDate(r.Opened); if (t == null) continue;
      const w = weekOf(t); if (w >= 12) continue;
      const k = `${w}|${r.Server}`;
      const c = vw.get(k) || { week: 11 - w, server: String(r.Server || '').trim(), checks: 0, sales: 0, exceptions: 0 };
      c.checks += 1; c.sales += money(r.Amount); c.exceptions += Math.abs(money(r['Discount Amount']));
      vw.set(k, c);
    }
    for (const r of items) {
      if (!yes(r['Void?']) || !String(r['Sent Date'] || '').trim()) continue;
      const t = parseToastDate(r['Order Date'] || r['Sent Date']); if (t == null) continue;
      const w = weekOf(t); if (w >= 12) continue;
      const c = vw.get(`${w}|${r.Server}`);
      if (c) c.exceptions += Math.abs(money(r['Gross Price']) || money(r['Net Price']));
    }
    const voidWeeks = [...vw.values()].filter((c) => c.server && c.checks >= 5).map((c) => ({ ...c, sales: r2(c.sales), exceptions: r2(c.exceptions) }));
    if (weeksCovered >= 12 && voidWeeks.length) out.toast.voidWeeks = voidWeeks.sort((a, b) => a.week - b.week || a.server.localeCompare(b.server));
    else out.notes.push(`Voids and comps need 12 weeks of orders to compare against; these files cover ${weeksCovered}.`);

    // Channel orders and refunds.
    out._channels ??= {};
    for (const r of live) {
      const t = parseToastDate(r.Opened);
      if (!recent(t, 1)) continue;
      const c = channelOf(r['Dining Options']);
      out._channels[c] ??= { channel: c, sales: 0, orders: new Set(), refunds: 0 };
      if (!items.length) out._channels[c].sales += money(r.Amount);
      out._channels[c].orders.add(r['Order Id']);
    }
  } else {
    out.notes.push('Add OrderDetails.csv for covers, turn times and weekly sales.');
  }
  for (const r of payments) {
    const t = parseToastDate(r['Refund Date'] || r['Paid Date']);
    if (!recent(t, 1)) continue;
    const ref = Math.abs(money(r['Refund Amount']));
    if (!ref) continue;
    const c = channelOf(r['Dining Option']);
    out._channels ??= {};
    out._channels[c] ??= { channel: c, sales: 0, orders: new Set(), refunds: 0 };
    out._channels[c].refunds += ref;
  }
  if (out._channels) {
    out.rows.channels = Object.values(out._channels).filter((c) => c.sales > 0).map((c) => ({ channel: c.channel, sales: r2(c.sales), orders: Math.max(1, c.orders.size), refunds: r2(c.refunds) }));
  }
  delete out._channels;

  /* ---- kitchen: ticket minutes by station and hour, Fri and Sat dinner */
  if (kitchen.length) {
    const st = new Map();
    const slots = { Fri: [[], [], [], [], [], []], Sat: [[], [], [], [], [], []] };
    for (const r of kitchen) {
      const t = parseToastDate(r['Fired Date']);
      if (!recent(t)) continue;
      const m = minutes(r['Fulfillment Time']) ?? ((parseToastDate(r['Fulfilled Date']) ?? t) - t) / 6e4;
      if (!(m > 0 && m < 120)) continue;
      const s = String(r.Station || 'Kitchen').trim();
      st.set(s, (st.get(s) || 0) + 1);
      const d = new Date(t);
      const day = DAY[d.getUTCDay()], h = d.getUTCHours() - 17;
      if (slots[day] && h >= 0 && h < 6) slots[day][h].push(m);
    }
    const total = sum([...st.values()]);
    const avg = (a) => (a.length ? r1(sum(a) / a.length) : null);
    if (total) {
      out.toast.tickets = {
        stations: [...st.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => [k, Math.round((n / total) * 100)]),
        fri: slots.Fri.map(avg), sat: slots.Sat.map(avg),
      };
    }
  }

  const counted = { files: out.files.length, recipes: out.rows.recipes?.length || 0, employees: out.rows.exceptions?.length || 0, serviceHours: out.toast.serviceHours?.length || 0 };
  out.counted = counted;
  return out;
}

/** Read File-like {name, text} objects, detect each, summarise. */
export function readToastExports(texts) {
  const files = [];
  const unknown = [];
  for (const { name, text } of texts) {
    const parsed = parseCSV(text);
    const kind = detectToastFile(parsed.headers);
    if (kind) files.push({ kind, name, rows: parsed.rows });
    else unknown.push(name);
  }
  if (!files.length) return { ok: false, error: 'None of these look like Toast data exports. Expected files such as ItemSelectionDetails.csv, OrderDetails.csv or TimeEntries.csv.', unknown };
  return { ...summarizeToast(files), unknown };
}
