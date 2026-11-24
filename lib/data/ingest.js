/**
 * Manual ingestion: parse, map, validate and preview hand-entered data before
 * it touches any figure. Pure functions; the Data inputs screen drives them.
 *
 * Each kind has a schema: the columns, their accepted header aliases,
 * a type, and rules that produce row-level errors (block the commit) or
 * warnings (allowed, but shown).
 */

import { applyInputs } from './apply.js';
import { deriveRoom, money } from './model.js';
import { theoreticalUsage } from './seed.js';

/* ------------------------------------------------------------------ CSV */
/** RFC 4180-ish: quoted fields, escaped quotes, CRLF or LF, trailing newline. Returns the grid, blank lines dropped. */
export function parseRows(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  // A file with tabs and no commas outside quotes is tab-separated (a paste from Excel or Sheets).
  const sep = /\t/.test(s.split(/\r?\n/, 1)[0]) ? '\t' : ',';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === sep || (sep === ',' && ch === '\t')) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** A grid with a header row → { headers, rows: records }. */
export function gridToTable(grid, headerRow = 0) {
  if (!grid.length || headerRow >= grid.length) return { headers: [], rows: [] };
  const headers = grid[headerRow].map((h) => String(h ?? '').trim());
  return { headers, rows: grid.slice(headerRow + 1).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()]))).filter((r) => Object.values(r).some((v) => v !== '')) };
}

export function parseCSV(text) {
  return gridToTable(parseRows(text));
}

export function toCSV(columns, rows) {
  const esc = (v) => {
    let t = v == null ? '' : String(v);
    /* A cell starting with = + - @ would run as a formula in Excel or Sheets;
       a leading apostrophe makes it text. Plain negative numbers stay numbers. */
    if (/^[=+\-@\t\r]/.test(t) && !/^-\d+(\.\d+)?$/.test(t)) t = `'${t}`;
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns.map(esc).join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

/* ------------------------------------------------------------------ schemas */
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const WASTE_REASONS = ['spoiled', 'dropped', 'overcooked', 'returned', 'expired', 'trim', 'other'];
const CHANNELS = ['Dine-in', 'Takeout', 'DoorDash', 'Uber Eats'];

/* `max` is a hard ceiling: past it the row is an error, not a warning, so a
   stray paste (1e308, a phone number in a price column) can't reach a figure. */
export const SCHEMAS = {
  profile: {
    title: 'Restaurant profile', icon: 'Store', feed: null, single: true,
    blurb: 'Your restaurant\'s name, seats and weekly covers. Renames this room everywhere and moves margin per cover.',
    columns: [
      { k: 'name', label: 'Restaurant name', type: 'text', aliases: ['restaurant', 'location', 'venue'], required: true, maxLen: 60 },
      { k: 'short', label: 'Short name (sidebar)', type: 'text', aliases: ['short name', 'nickname'], required: false, maxLen: 20 },
      { k: 'gm', label: 'General manager', type: 'text', aliases: ['manager', 'gm name'], required: false, maxLen: 40 },
      { k: 'seats', label: 'Seats', unit: 'seats in the dining room', type: 'number', aliases: ['capacity'], required: true, max: 2000, int: true },
      { k: 'covers', label: 'Covers, per week', unit: 'guests in a usual week', type: 'number', aliases: ['guests', 'covers per week', 'weekly covers'], required: true, max: 50000, int: true },
      { k: 'laborTarget', label: 'Labor target, % of sales', unit: '% (type 30 for 30%)', type: 'number', aliases: ['labor target', 'labour target', 'labor %', 'target labor'], required: false, max: 100 },
    ],
  },
  days: {
    title: 'Daily sales and labor', icon: 'CalendarDays', feed: null,
    blurb: 'One line per day: net sales, guests and labor. Use it when the register or scheduling connection is missing or wrong. Seven days make a week of sales and labor on every page.',
    replace: { label: 'Replace every day entered so far with these rows', note: 'Only these days are kept. Days you entered before and left out here are removed.' },
    columns: [
      { k: 'date', label: 'Date', type: 'text', aliases: ['day', 'business date', 'business day'], required: true, maxLen: 20 },
      { k: 'sales', label: 'Net sales', unit: '$ for the day, after discounts, before tax and tips', type: 'money', aliases: ['net sales', 'net', 'sales total', 'revenue'], required: true, max: 500000 },
      { k: 'covers', label: 'Guests', unit: 'people served that day', type: 'number', aliases: ['covers', 'guest count', 'guests served'], required: false, max: 20000, int: true },
      { k: 'labor_cost', label: 'Labor cost', unit: '$ of hourly wages for the day', type: 'money', aliases: ['labor', 'labour', 'labour cost', 'wages', 'payroll'], required: false, max: 200000 },
      { k: 'labor_hours', label: 'Labor hours', unit: 'hours worked by hourly staff', type: 'number', aliases: ['hours', 'hours worked', 'labour hours', 'total hours'], required: false, max: 5000 },
    ],
  },
  recipes: {
    title: 'Recipe costs', icon: 'FileSpreadsheet', feed: 'Recipe costs',
    blurb: 'Menu price and plate cost per dish. Add your own dishes with plates sold per week, or replace the sample menu entirely. Moves food cost, earned, every menu margin and the price moves in the plan.',
    replace: { label: 'Replace the sample menu with these dishes', note: 'Only your rows are on the menu. Sample staff, exceptions, channels and history are scaled to your sales until you enter your own.' },
    columns: [
      { k: 'dish', label: 'Dish', type: 'text', aliases: ['item', 'menu item', 'name'], required: true, maxLen: 60 },
      { k: 'price', label: 'Menu price', unit: '$ per plate', type: 'money', aliases: ['menu price', 'sell price'], required: true, max: 500 },
      { k: 'cost', label: 'Plate cost', unit: '$ of ingredients per plate', type: 'money', aliases: ['plate cost', 'plate_cost', 'food cost', 'recipe cost'], required: true, max: 200 },
      { k: 'units', label: 'Plates per week', unit: 'plates sold in a usual week', type: 'number', aliases: ['plates', 'sold', 'qty sold', 'units sold', 'weekly units', 'covers'], required: false, max: 5000 },
      { k: 'category', label: 'Category', type: 'text', aliases: ['cat', 'section', 'menu section'], required: false, maxLen: 30 },
    ],
  },
  invoices: {
    title: 'Invoice lines', icon: 'Receipt', feed: 'Invoices',
    blurb: 'This period\'s unit price and quantity per item. Moves the vendor price split and the renegotiation finding.',
    columns: [
      { k: 'item', label: 'Item', type: 'text', aliases: ['product', 'sku', 'description'], required: true, maxLen: 60 },
      { k: 'vendor', label: 'Vendor', type: 'text', aliases: ['supplier'], required: false, maxLen: 40 },
      { k: 'unit', label: 'Unit', unit: 'how it is sold: lb, case, each', type: 'text', aliases: ['uom', 'pack'], required: false, maxLen: 20 },
      { k: 'unit_price', label: 'Unit price', unit: '$ per unit, not per case unless the unit is a case', type: 'money', aliases: ['price', 'unit cost', 'cost'], required: true, max: 5000 },
      { k: 'qty', label: 'Quantity, last 28 days', unit: 'units bought, in the unit above', type: 'number', aliases: ['quantity', 'units', 'cases'], required: true, max: 100000 },
      { k: 'price_before', label: 'Unit price before', unit: '$ per unit on the earlier invoices, to see price creep', type: 'money', aliases: ['previous price', 'old price', 'last price', 'prior price'], required: false, max: 5000 },
      { k: 'agreed_price', label: 'Agreed price', unit: '$ per unit on your order guide or contract', type: 'money', aliases: ['contract price', 'order guide price', 'quoted price'], required: false, max: 5000 },
      { k: 'pack', label: 'Pack size', unit: 'how many are in one case or pack, like 12', type: 'number', aliases: ['pack size', 'case size', 'count per case', 'per case'], required: false, max: 10000 },
      { k: 'pack_before', label: 'Pack size before', unit: 'how many were in it before, or on your order guide', type: 'number', aliases: ['previous pack', 'old pack size', 'order guide pack'], required: false, max: 10000 },
    ],
  },
  counts: {
    title: 'Inventory count', icon: 'ClipboardList', feed: 'Inventory counts',
    blurb: 'What\'s on the shelf now, per counted item. Add your own items with what came in, what they cost and what the menu should have used. Moves actual usage and every usage gap.',
    columns: [
      { k: 'item', label: 'Item', type: 'text', aliases: ['product', 'sku'], required: true, maxLen: 60 },
      { k: 'close', label: 'Counted on hand', unit: 'in the item\'s unit', rowUnit: true, type: 'number', aliases: ['on hand', 'count', 'closing', 'closing count'], required: true, max: 100000 },
      { k: 'open', label: 'Opening count', unit: 'in the item\'s unit', rowUnit: true, type: 'number', aliases: ['opening', 'opening count', 'start'], required: false, max: 100000 },
      { k: 'received', label: 'Received, 28 days', unit: 'in the item\'s unit', rowUnit: true, type: 'number', aliases: ['received', 'delivered', 'purchased', 'in'], required: false, max: 100000 },
      { k: 'expected', label: 'Expected use, 28 days', unit: 'in the item\'s unit', rowUnit: true, type: 'number', aliases: ['expected', 'theoretical', 'theoretical usage', 'should use'], required: false, max: 100000 },
      { k: 'unit', label: 'Unit', unit: 'how it is counted: lb, each, case', type: 'text', aliases: ['uom'], required: false, maxLen: 20 },
      { k: 'unit_cost', label: 'Unit cost', unit: '$ per counted unit', type: 'money', aliases: ['cost', 'cost per unit'], required: false, max: 5000 },
    ],
  },
  waste: {
    title: 'Waste log', icon: 'Trash2', feed: 'Waste log',
    blurb: 'Spoiled, dropped and remade food. Explains part of a usage gap, so it isn\'t counted as unexplained.',
    columns: [
      { k: 'item', label: 'Item', type: 'text', aliases: ['product', 'sku'], required: true, maxLen: 60 },
      { k: 'qty', label: 'Quantity', unit: 'in the item\'s counted unit', rowUnit: true, type: 'number', aliases: ['quantity', 'amount'], required: true, max: 10000 },
      { k: 'reason', label: 'Reason', type: 'enum', options: WASTE_REASONS, aliases: ['why', 'cause'], required: true },
      { k: 'date', label: 'Date', type: 'text', aliases: ['day', 'when'], required: false, maxLen: 20 },
    ],
  },
  channels: {
    title: 'Sales by channel', icon: 'Bike', feed: 'Delivery statements',
    blurb: 'This week\'s sales, orders and refunds per channel. Moves channel contribution and the delivery markup range.',
    columns: [
      { k: 'channel', label: 'Channel', type: 'enum', options: CHANNELS, aliases: ['source', 'platform'], required: true },
      { k: 'sales', label: 'Net sales, this week', unit: '$ for the week', type: 'money', aliases: ['net sales', 'revenue', 'gross'], required: true, max: 500000 },
      { k: 'orders', label: 'Orders', unit: 'orders in the week', type: 'number', aliases: ['tickets', 'checks', 'count'], required: true, max: 50000, int: true },
      { k: 'refunds', label: 'Refunds', unit: '$ for the week', type: 'money', aliases: ['refund', 'adjustments'], required: false, max: 100000 },
    ],
  },
  shifts: {
    title: 'Staff schedule', icon: 'CalendarClock', feed: null,
    blurb: 'Who works when, one line per shift. It is what a staffing call is checked against. After the shift, add when people clocked in and out to see what really happened.',
    replace: { label: 'Replace the whole schedule with these rows', note: 'Only these shifts are kept. Dates you entered before and left out here are removed.' },
    columns: [
      { k: 'date', label: 'Date', type: 'text', aliases: ['day', 'business date', 'shift date'], required: true, maxLen: 20 },
      { k: 'role', label: 'Role', type: 'text', aliases: ['position', 'job', 'job title'], required: true, maxLen: 30 },
      { k: 'start', label: 'Starts', unit: 'scheduled start, like 4:30 pm', type: 'text', aliases: ['start time', 'shift start', 'scheduled start', 'from'], required: true, maxLen: 10 },
      { k: 'end', label: 'Ends', unit: 'scheduled end, like 10 pm', type: 'text', aliases: ['end time', 'shift end', 'scheduled end', 'to', 'until'], required: true, maxLen: 10 },
      { k: 'name', label: 'Name', type: 'text', aliases: ['employee', 'staff', 'person', 'team member'], required: false, maxLen: 40 },
      { k: 'rate', label: 'Hourly rate', unit: '$ an hour before tips', type: 'money', aliases: ['pay rate', 'wage', 'hourly', 'hourly rate'], required: false, max: 200 },
      { k: 'clock_in', label: 'Clocked in', unit: 'actual time, after the shift', type: 'text', aliases: ['clock in', 'actual in', 'punch in', 'clocked in at'], required: false, maxLen: 10 },
      { k: 'clock_out', label: 'Clocked out', unit: 'actual time, after the shift', type: 'text', aliases: ['clock out', 'actual out', 'punch out', 'clocked out at'], required: false, maxLen: 10 },
      { k: 'paid_hours', label: 'Paid hours', unit: 'hours on payroll for the shift; 0 for a no-show', type: 'number', aliases: ['paid hours', 'hours paid', 'payroll hours', 'regular hours'], required: false, max: 24 },
    ],
  },
  services: {
    title: 'Guests by hour', icon: 'Clock', feed: null,
    blurb: 'Past services hour by hour: guests seated and servers on. Three of the same weekday give lunch or dinner its own forecast and staffing check. Most registers print this as a sales-by-hour report.',
    replace: { label: 'Replace every hour entered so far with these rows', note: 'Only these hours are kept. Dates you entered before and left out here are removed.' },
    columns: [
      { k: 'date', label: 'Date', type: 'text', aliases: ['day', 'business date', 'business day'], required: true, maxLen: 20 },
      { k: 'hour', label: 'Hour starting', unit: 'like 5 pm or 17:00', type: 'text', aliases: ['time', 'hour of day', 'hour start', 'start'], required: true, maxLen: 10 },
      { k: 'covers', label: 'Guests', unit: 'guests seated that hour', type: 'number', aliases: ['guests', 'guest count', 'covers seated'], required: true, max: 2000, int: true },
      { k: 'servers', label: 'Servers on', unit: 'servers working that hour', type: 'number', aliases: ['servers on', 'staff on', 'servers working'], required: true, max: 200, int: true },
    ],
  },
  exceptions: {
    title: 'Register exceptions', icon: 'ShieldCheck', feed: 'Toast',
    blurb: 'Per person, last 28 days: sales, post-send voids, comps and discounts, plus weekly hours and pay rate. Moves every control limit, signal and the labour line.',
    replace: { label: 'Replace the sample staff with these people', note: 'Only your rows are on the team. Kitchen staff with no sales still count toward labour.' },
    columns: [
      { k: 'employee', label: 'Employee', type: 'text', aliases: ['name', 'server', 'staff'], required: true, maxLen: 40 },
      { k: 'role', label: 'Role', type: 'text', aliases: ['position', 'job'], required: false, maxLen: 30 },
      { k: 'sales', label: 'Sales, 28 days', unit: '$ over 28 days', type: 'money', aliases: ['net sales'], required: true, max: 2000000 },
      { k: 'post_send_voids', label: 'Post-send voids', unit: '$ over 28 days', type: 'money', aliases: ['voids', 'void', 'post send voids'], required: true, max: 200000 },
      { k: 'comps', label: 'Comps', unit: '$ over 28 days', type: 'money', aliases: ['comp'], required: true, max: 200000 },
      { k: 'discounts', label: 'Discounts', unit: '$ over 28 days', type: 'money', aliases: ['discount', 'promos'], required: true, max: 200000 },
      { k: 'hours', label: 'Hours per week', unit: 'hours in a usual week', type: 'number', aliases: ['weekly hours', 'hrs'], required: false, max: 100 },
      { k: 'rate', label: 'Hourly rate', type: 'money', aliases: ['pay rate', 'wage', 'hourly'], required: false, max: 200 },
    ],
  },
};
export const KINDS = Object.keys(SCHEMAS);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A date as written by hand: 2026-10-03, 10/3/2026, 10/3, Oct 3. Returns a UTC day, or null. */
export function parseDay(t, now = new Date()) {
  const s = String(t || '').trim();
  if (!s) return null;
  let y, m, d;
  let x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (x) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) [m, d, y] = [+x[1], +x[2], x[3] ? (+x[3] < 100 ? 2000 + +x[3] : +x[3]) : now.getUTCFullYear()];
  else if ((x = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)) && MONTHS.includes(x[1].toLowerCase())) [m, d, y] = [MONTHS.indexOf(x[1].toLowerCase()) + 1, +x[2], x[3] ? +x[3] : now.getUTCFullYear()];
  else return null;
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCMonth() === m - 1 && day.getUTCDate() === d ? day : null;
}

/**
 * A clock time as written by hand: 4:30 pm, 4:30p, 4pm, 16:30, 1630. Returns
 * minutes after midnight, or null. Without am or pm it's the 24-hour clock, so
 * "4:30" is 4:30 in the morning; `smallHours` lets a check say so.
 */
export function parseClock(t) {
  const s = String(t ?? '').trim().toLowerCase().replace(/\./g, '');
  if (!s) return null;
  let m = /^(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)$/.exec(s);
  if (m) {
    let h = +m[1];
    const mi = +(m[2] ?? 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    const pm = m[3].startsWith('p');
    if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12;
    return h * 60 + mi;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s) || /^(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  return null;
}
/** A time typed without am/pm that lands between 1 and 6:59 in the morning: probably meant as afternoon. */
export const smallHours = (t) => !/[ap]/i.test(String(t ?? '')) && (() => { const v = parseClock(t); return v != null && v >= 60 && v < 7 * 60; })();
/** Minutes after midnight → "16:30" (how a time is stored once it's been read). */
export const clockText = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Header → column key, using labels and aliases, ignoring case and punctuation. */
export function mapColumns(headers, kind) {
  const cols = SCHEMAS[kind].columns;
  const map = {};
  headers.forEach((h) => {
    const hk = key(h);
    const col = cols.find((c) => key(c.k) === hk || key(c.label) === hk || c.aliases.some((a) => key(a) === hk));
    if (col && !Object.values(map).includes(col.k)) map[h] = col.k;
  });
  const missing = cols.filter((c) => c.required && !Object.values(map).includes(c.k)).map((c) => c.label);
  const ignored = headers.filter((h) => !map[h]);
  return { map, missing, ignored };
}

const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !['the', 'of', 'a', 'at', 'per'].includes(w));
/**
 * For headers no label or alias matched: the column each one most likely
 * is, by the words they share ("Employee Name" → Name, "In" → Clocked in).
 * Only a suggestion: each one is shown as a guess and needs a yes. Never
 * two headers to one column, never a column already matched.
 * @returns {Record<string, string>} header → column key
 */
export function guessColumns(headers, kind, map = {}) {
  const cols = SCHEMAS[kind].columns;
  const taken = new Set(Object.values(map));
  const out = {};
  for (const h of headers) {
    if (map[h]) continue;
    const hw = words(h);
    if (!hw.length) continue;
    let best = null;
    for (const c of cols) {
      if (taken.has(c.k)) continue;
      const names = [c.k.replace(/_/g, ' '), c.label, ...c.aliases].map(words);
      const score = Math.max(...names.map((n) => hw.filter((w) => n.includes(w)).length / Math.max(hw.length, 1)));
      if (score > 0 && (!best || score > best.score)) best = { k: c.k, score };
    }
    if (best && best.score >= 0.5) { out[h] = best.k; taken.add(best.k); }
  }
  return out;
}

function parseValue(v, col) {
  const t = String(v ?? '').trim();
  if (t === '') return { value: null };
  if (col.type === 'money' || col.type === 'number') {
    const n = Number(t.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
    if (!Number.isFinite(n)) return { error: `"${t}" isn't a number` };
    if (col.max != null && n > col.max) return { error: `${col.label} over ${col.type === 'money' ? money(col.max) : col.max.toLocaleString('en-US')} isn't plausible; check the column` };
    if (col.int && !Number.isInteger(n)) return { error: `${col.label} must be a whole number` };
    return { value: n };
  }
  if (col.type === 'enum') {
    const hit = col.options.find((o) => key(o) === key(t));
    if (!hit) return { error: `"${t}" isn't one of ${col.options.join(', ')}` };
    return { value: hit };
  }
  if (/^[=+@]/.test(t) || (/^-/.test(t) && !/^-\d/.test(t))) return { error: `"${t.slice(0, 20)}" looks like a spreadsheet formula` };
  if (col.maxLen && t.length > col.maxLen) return { error: `${col.label} is over ${col.maxLen} characters` };
  return { value: t };
}

/* ------------------------------------------------------------------ validation */
/**
 * @returns {{ rows: object[], issues: {row:number, col:string|null, level:'error'|'warn', msg:string}[], errors:number, warnings:number }}
 * `row` is 1-based, matching the table the person sees.
 */
export function validate(kind, rawRows, room, mapping, opts = {}) {
  const schema = SCHEMAS[kind];
  const issues = [];
  const rows = [];
  const add = (row, col, level, msg) => issues.push({ row, col, level, msg });
  const seen = new Set();
  rawRows.forEach((raw, i) => {
    const n = i + 1;
    const rec = {};
    let bad = false;
    schema.columns.forEach((col) => {
      const src = mapping ? Object.keys(mapping).find((h) => mapping[h] === col.k) : col.k;
      const { value, error } = parseValue(src != null ? raw[src] : undefined, col);
      if (error) { add(n, col.k, 'error', error); bad = true; return; }
      // A blank is not a zero: a number left blank says so, and a typed 0 is kept as a real zero.
      if (value == null && col.required) { add(n, col.k, 'error', col.type === 'number' || col.type === 'money' ? `${col.label} is blank. Type 0 if it really was none` : `${col.label} is required`); bad = true; return; }
      if (value != null && (col.type === 'money' || col.type === 'number') && value < 0) { add(n, col.k, 'error', `${col.label} can't be negative`); bad = true; return; }
      rec[col.k] = value;
    });
    if (bad) return;
    if (kind === 'days' || kind === 'shifts' || kind === 'services') {
      // One line per day: the date is stored as 2026-10-03 however it was typed, so a day can be matched later.
      const day = parseDay(rec.date, opts.now);
      if (!day) { add(n, 'date', 'error', `“${rec.date}” isn’t a date (use 2026-10-03, 10/3 or Oct 3)`); return; }
      rec.date = day.toISOString().slice(0, 10);
    }
    if (kind === 'shifts' || kind === 'services') {
      // Times are stored as 16:30 however they were typed; one that can't be read, or reads two ways, stops the row.
      const fields = kind === 'shifts' ? ['start', 'end', 'clock_in', 'clock_out'] : ['hour'];
      for (const f of fields) {
        if (rec[f] == null) continue;
        const t = parseClock(rec[f]);
        const label = schema.columns.find((c) => c.k === f).label;
        if (t == null) { add(n, f, 'error', `“${rec[f]}” isn’t a time (use 4:30 pm or 16:30)`); bad = true; break; }
        // Typed with no am/pm and read as the small hours: allowed (a close can run past midnight), but said.
        if (smallHours(rec[f])) add(n, f, 'warn', `${label} “${rec[f]}” is read as ${Math.floor(t / 60) % 12 || 12}:${String(t % 60).padStart(2, '0')} am. Add pm if you meant the afternoon`);
        rec[f] = clockText(t);
      }
      if (bad) return;
    }
    const ident = kind === 'shifts' ? (rec.name ? key(`${rec.date}|${rec.role}|${rec.start}|${rec.name}`) : `row-${n}`)
      : kind === 'services' ? `${rec.date}|${rec.hour}`
        : key(rec.dish || rec.item || rec.channel || rec.employee || (kind === 'days' ? rec.date : '')) + (kind === 'waste' ? `-${n}` : '');
    if (seen.has(ident)) { add(n, null, 'error', kind === 'days' ? 'Duplicate row: this date appears twice' : kind === 'services' ? 'Duplicate row: this date and hour appear twice' : kind === 'shifts' ? 'Duplicate row: the same person, role and start appear twice' : 'Duplicate row: this name appears twice'); return; }
    seen.add(ident);
    const ok = RULES[kind](rec, room, (col, level, msg) => add(n, col, level, msg), opts);
    if (ok !== false) rows.push(rec);
  });
  if (!rawRows.length) add(0, null, 'error', 'No rows to check');
  if (schema.single && rawRows.length > 1) add(0, null, 'error', 'One row only: this is one restaurant');
  if (opts.replace && kind === 'recipes' && rows.length && rows.length < 3) add(0, null, 'error', 'A replacement menu needs at least 3 dishes');
  if (opts.replace && kind === 'exceptions' && rows.length && !rows.some((r) => r.sales > 0)) add(0, null, 'error', 'A replacement team needs at least one person with sales');
  return { rows, issues, errors: issues.filter((x) => x.level === 'error').length, warnings: issues.filter((x) => x.level === 'warn').length };
}

const findMenu = (room, name) => room.menu.find((m) => key(m.name) === key(name) || key(m.key) === key(name));
const findCount = (room, name) => room.counts.find((c) => key(c.item) === key(name) || key(c.label) === key(name));

const RULES = {
  days(r, room, add, opts) {
    const now = opts.now || new Date();
    if (Date.parse(`${r.date}T00:00:00Z`) > now.getTime() + 864e5) { add('date', 'error', 'Dated in the future'); return false; }
    if (r.sales === 0 && (r.covers || 0) > 0) { add('sales', 'error', 'Guests with no sales; check the columns'); return false; }
    if (r.covers > 0) { const check = r.sales / r.covers; if (check < 5 || check > 400) add('covers', 'warn', `${money(check, { cents: true })} per guest looks off; check sales and guests`); }
    if (r.labor_cost != null && r.sales > 0 && r.labor_cost > r.sales) add('labor_cost', 'warn', 'Labor cost is above sales for the day');
    if (r.labor_cost != null && r.labor_hours > 0) { const rate = r.labor_cost / r.labor_hours; if (rate < 7 || rate > 80) add('labor_hours', 'warn', `${money(rate, { cents: true })} an hour looks off; check hours and cost`); }
    return true;
  },
  shifts(r, room, add, opts) {
    const now = opts.now || new Date();
    const at = Date.parse(`${r.date}T00:00:00Z`);
    if (at > now.getTime() + 21 * 864e5) { add('date', 'error', 'More than three weeks ahead; add it nearer the time'); return false; }
    if (at < now.getTime() - 120 * 864e5) { add('date', 'error', 'Older than 120 days'); return false; }
    const m = (t) => { const [h, mi] = t.split(':').map(Number); return h * 60 + mi; };
    const start = m(r.start);
    let end = m(r.end);
    // A shift that ends before it starts runs past midnight, but only into the small hours.
    if (end <= start) { if (end < 6 * 60) end += 24 * 60; else { add('end', 'error', 'Ends before it starts'); return false; } }
    if (end - start > 16 * 60) { add('end', 'error', 'Longer than 16 hours; check the times'); return false; }
    if (r.clock_out != null && r.clock_in == null) { add('clock_in', 'error', 'A clock-out needs its clock-in'); return false; }
    if (r.clock_in != null) {
      let ci = m(r.clock_in);
      if (ci < start - 12 * 60) ci += 24 * 60;
      if (Math.abs(ci - start) > 4 * 60) add('clock_in', 'warn', `Clocked in ${Math.round(Math.abs(ci - start) / 60)} hours from the scheduled start; check the times`);
      if (at > now.getTime() + 864e5) { add('clock_in', 'error', 'A clock-in can’t be in the future'); return false; }
    }
    if (r.rate === 0) { add('rate', 'error', 'An hourly rate of $0 isn’t a rate; leave it blank if you don’t know it'); return false; }
    if (r.rate != null && (r.rate < 7 || r.rate > 80)) add('rate', 'warn', `${money(r.rate, { cents: true })} an hour looks off; check the column`);
    return true;
  },
  services(r, room, add, opts) {
    const now = opts.now || new Date();
    if (Date.parse(`${r.date}T00:00:00Z`) > now.getTime() + 864e5) { add('date', 'error', 'Dated in the future'); return false; }
    if (!/:00$/.test(r.hour)) { add('hour', 'error', 'Use the hour it starts, like 5 pm'); return false; }
    if (r.servers === 0 && r.covers > 0) add('servers', 'warn', 'Guests with no servers on: fine for a bar-only hour, otherwise check the columns');
    if (r.servers > 0 && r.covers / r.servers > 40) add('covers', 'warn', `${Math.round(r.covers / r.servers)} guests per server in an hour looks high; check the columns`);
    return true;
  },
  profile(r, room, add) {
    if (r.seats === 0) { add('seats', 'error', 'Seats must be above 0'); return false; }
    if (r.covers === 0) { add('covers', 'error', 'Covers must be above 0'); return false; }
    if (r.covers > r.seats * 7 * 6) add('covers', 'warn', `${r.covers.toLocaleString('en-US')} covers is over 6 turns a day on ${r.seats} seats`);
    return true;
  },
  recipes(r, room, add, opts) {
    const m = findMenu(room, r.dish);
    if (r.price === 0) { add('price', 'error', 'Menu price must be above $0'); return false; }
    if (r.cost >= r.price) { add('cost', 'error', `Plate cost ${money(r.cost, { cents: true })} is at or above the price`); return false; }
    if (r.units != null && r.units === 0 && opts.replace) { add('units', 'error', 'Plates per week must be above 0 on a replacement menu'); return false; }
    const fc = r.cost / r.price;
    if (fc > 0.45) add('cost', 'warn', `${Math.round(fc * 100)}% food cost is unusually high; check the recipe`);
    if (!m) {
      if (r.units == null) { add('units', 'error', `"${r.dish}" is new: add plates per week so it can be counted`); return false; }
      add('dish', 'warn', 'New dish: added to the menu');
      return true;
    }
    if (opts.replace && r.units == null) add('units', 'warn', `No plates per week: keeps today's ${m.units}`);
    const move = r.price / m.price - 1;
    if (Math.abs(move) > 0.08) add('price', 'warn', `${move > 0 ? '+' : ''}${(move * 100).toFixed(0)}% vs today's price, past your 8% fence`);
    if (Math.abs(r.cost / m.cost - 1) > 0.3) add('cost', 'warn', `Plate cost moved ${(((r.cost / m.cost) - 1) * 100).toFixed(0)}% from ${money(m.cost, { cents: true })}`);
    return true;
  },
  invoices(r, room, add) {
    if (r.qty === 0) { add('qty', 'error', 'Quantity must be above 0'); return false; }
    const hit = room.invoices.find((s) => key(s.item) === key(r.item));
    if (!hit) add('item', 'warn', 'New item: added as a new invoice line with no prior period');
    else if (Math.abs(r.unit_price / hit.p1 - 1) > 0.15) add('unit_price', 'warn', `${(((r.unit_price / hit.p1) - 1) * 100).toFixed(0)}% vs the last invoice (${money(hit.p1, { cents: true })}); check for a unit mix-up`);
    return true;
  },
  counts(r, room, add) {
    let c = findCount(room, r.item);
    if (!c) {
      if (r.unit_cost == null || r.received == null) { add('item', 'error', `"${r.item}" is new: add what was received and the unit cost`); return false; }
      add('item', 'warn', r.expected == null ? 'New item: added, but with no expected use it can\'t be flagged' : 'New item: added to the count sheet');
      c = { item: r.item, unit: r.unit || 'each', open: 0, received: r.received, theo: r.expected ?? 0 };
    }
    const open = r.open ?? c.open;
    const received = r.received ?? c.received;
    const theo = r.expected ?? c.theo ?? theoreticalUsage(room.menu, c.item);
    const actual = open + received - r.close;
    if (actual < 0) { add('close', 'error', `Implies negative usage: on hand is more than opening + received (${+(open + received).toFixed(1)} ${c.unit})`); return false; }
    if (theo > 0 && actual > theo * 10) { add('close', 'error', `Implies ${+(actual).toFixed(1)} ${c.unit} used, over 10× what the menu needs; check the units`); return false; }
    if (theo > 0) {
      const gap = (actual - theo) / theo;
      if (gap > 0.25) add('close', 'warn', `Implies ${(gap * 100).toFixed(0)}% more used than sold; recount before committing`);
      if (gap < -0.1) add('close', 'warn', `Implies ${(-gap * 100).toFixed(0)}% less used than sold; a delivery may be missing`);
    }
    return true;
  },
  waste(r, room, add) {
    const c = findCount(room, r.item);
    if (!c) { add('item', 'error', `"${r.item}" isn't a counted item, so it can't explain a usage gap`); return false; }
    if (r.qty === 0) { add('qty', 'error', 'Quantity must be above 0'); return false; }
    const theo = theoreticalUsage(room.menu, c.item);
    if (theo && r.qty > theo * 0.2) add('qty', 'warn', `${r.qty} ${c.unit} is over 20% of what the menu uses in 28 days`);
    return true;
  },
  channels(r, room, add) {
    if (r.orders === 0) { add('orders', 'error', 'Orders must be above 0'); return false; }
    const avg = r.sales / r.orders;
    if (avg < 8 || avg > 250) add('orders', 'warn', `Average order ${money(avg, { cents: true })} looks off`);
    if (r.refunds != null && r.refunds > r.sales * 0.15) add('refunds', 'warn', 'Refunds over 15% of sales');
    return true;
  },
  exceptions(r, room, add, opts) {
    const known = room.staff.find((s) => key(s.name) === key(r.employee));
    const ex = r.post_send_voids + r.comps + r.discounts;
    if (r.sales === 0) {
      if (ex > 0) { add('sales', 'error', 'Exceptions with no sales; check the columns'); return false; }
      if (r.hours == null && !known) { add('hours', 'error', 'No sales: add weekly hours so this person counts toward labour'); return false; }
    } else if (ex > r.sales * 0.2) { add('sales', 'error', 'Exceptions over 20% of sales; check the columns'); return false; }
    if (r.hours != null && r.rate == null && !known) add('rate', 'warn', 'No rate: uses $16.50 an hour');
    if (!known && !opts.replace) add('employee', 'warn', 'Not on the staff list: added as a new person');
    return true;
  },
};

/* ------------------------------------------------------------------ templates (pre-filled from the room) */
export function templateRows(kind, room) {
  switch (kind) {
    case 'profile': return [{ name: room.profile.name, short: room.profile.short, gm: room.profile.gm, seats: room.profile.seats, covers: room.anchor.covers }];
    case 'days': return (room.days || []).map((r) => ({ date: r.date, sales: r.sales, covers: r.covers ?? '', labor_cost: r.labor_cost ?? '', labor_hours: r.labor_hours ?? '' }));
    case 'recipes': return room.menu.filter((m) => !m.balancing).map((m) => ({ dish: m.name, price: m.price, cost: m.cost, units: m.units, category: m.cat }));
    case 'invoices': return room.invoices.slice(0, 8).map((s) => ({ item: s.item, vendor: s.vendor, unit: s.unit, unit_price: s.p1, qty: s.q1 }));
    case 'counts': return room.counts.map((c) => ({ item: c.label || c.item, close: c.close, open: c.open, received: c.received, expected: c.theo != null ? c.theo : '', unit: c.unit, unit_cost: c.cost }));
    case 'waste': return [{ item: room.counts[0].label || room.counts[0].item, qty: '', reason: 'trim', date: '' }];
    case 'channels': return room.channels.map((c) => ({ channel: c.name, sales: c.sales, orders: Math.round(c.sales / c.avg), refunds: c.refunds }));
    case 'shifts': return (room.shifts || []).map((r) => ({ date: r.date, role: r.role, start: r.start, end: r.end, name: r.name ?? '', rate: r.rate ?? '', clock_in: r.clock_in ?? '', clock_out: r.clock_out ?? '' }));
    case 'services': return (room.serviceOwn?.rows || []).map((r) => ({ date: r.date, hour: r.hour, covers: r.covers, servers: r.servers }));
    case 'exceptions': return room.staff.map((s) => ({ employee: s.name, role: s.role, sales: s.sales, post_send_voids: s.postVoid, comps: s.comps, discounts: s.disc, hours: +(+s.hours).toFixed(1), rate: s.rate }));
    default: return [];
  }
}
export function templateCSV(kind, room) {
  return toCSV(SCHEMAS[kind].columns.map((c) => c.k), templateRows(kind, room));
}

/* ------------------------------------------------------------------ preview */
const METRICS = {
  days: [
    ['Net sales, this week', (d) => d.week.net, 'money', 'obs'],
    ['Hourly labour, this week', (d) => d.week.labour, 'money', 'obs'],
    ['Covers, this week', (d) => d.week.covers, 'count', 'obs'],
  ],
  profile: [
    ['Covers, this week', (d) => d.week.covers, 'count', 'obs'],
    ['Margin per cover', (d) => d.week.marginPerCover, 'cents', 'obs'],
    ['Earned per seat, this week', (d) => d.week.earned / d.profile.seats, 'cents', 'obs'],
  ],
  recipes: [
    ['Food cost, this week', (d) => d.week.food, 'money', 'obs'],
    ['Earned, this week', (d) => d.week.earned, 'money', 'obs'],
    ['Weighted margin per dish', (d) => d.menu.cmWeighted, 'cents', 'obs'],
    ['Open exposure', (d) => d.exposure, 'money', 'est'],
  ],
  invoices: [
    ['Vendor price movement, 28 days', (d) => d.inv.priceLeg, 'money', 'obs'],
    ['Your mix, 28 days', (d) => d.inv.mixLeg, 'money', 'obs'],
    ['Open exposure', (d) => d.exposure, 'money', 'est'],
  ],
  counts: [
    ['Usage past tolerance, per week', (d) => d.usage.week, 'money', 'est'],
    ['Items past tolerance', (d) => d.usage.flagged.length, 'count', 'est'],
    ['Open exposure', (d) => d.exposure, 'money', 'est'],
  ],
  waste: [
    ['Logged waste, per week', (d) => d.usage.wasteWeek, 'money', 'obs'],
    ['Usage past tolerance, per week', (d) => d.usage.week, 'money', 'est'],
    ['Items past tolerance', (d) => d.usage.flagged.length, 'count', 'est'],
  ],
  channels: [
    ['Delivery share of sales', (d) => d.chan.deliveryShare * 100, 'pct', 'obs'],
    ['Delivery refunds, per week', (d) => d.chan.deliveryRefunds, 'money', 'obs'],
    ['Markup range, top end', (d) => d.chan.markupHi, 'money', 'est'],
  ],
  shifts: [],
  services: [],
  exceptions: [
    ['Hourly labour, this week', (d) => d.week.labour, 'money', 'obs'],
    ['People above a limit', (d) => d.staff.signalCount, 'count', 'obs'],
    ['Over the limit, 28 days', (d) => d.staff.types.postVoid.excess + d.staff.types.comps.excess + d.staff.types.disc.excess, 'money', 'obs'],
    ['Exceptions, share of sales', (d) => (d.staff.weekTotal / d.week.net) * 100, 'pct', 'obs'],
  ],
};
const FROZEN = [
  ['Banked this week', (d) => d.banked.week],
  ['Banked to date', (d) => d.banked.toDate],
];

/** Before/after for the figures this kind moves, plus the ones it can never move. */
export function preview(seed, inputs, roomId, kind, rows, opts) {
  const before = deriveRoom(applyInputs(seed, inputs), roomId);
  const nextInputs = { ...inputs, [roomId]: { ...(inputs[roomId] || {}), [kind]: { rows, date: 'preview', label: SCHEMAS[kind].title, n: rows.length, ...(opts ? { opts } : {}) } } };
  const after = deriveRoom(applyInputs(seed, nextInputs), roomId);
  const fmt = (v, t) => (t === 'money' ? money(Math.round(v)) : t === 'cents' ? money(v, { cents: true }) : t === 'pct' ? `${v.toFixed(1)}%` : Math.round(v).toLocaleString('en-US'));
  return {
    moves: METRICS[kind].map(([label, f, t, claim]) => {
      const a = f(before), b = f(after);
      return { label, before: fmt(a, t), after: fmt(b, t), changed: Math.abs(b - a) > (t === 'count' ? 0 : 0.5), up: b > a, claim };
    }),
    frozen: FROZEN.map(([label, f]) => ({ label, value: money(Math.round(f(before))), same: Math.round(f(before)) === Math.round(f(after)) })),
  };
}
