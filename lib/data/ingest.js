/**
 * Manual ingestion: parse, map, validate and preview hand-entered data before
 * it touches any figure. Pure functions; the Data inputs screen drives them.
 *
 * Seven kinds, each with a schema: the columns, their accepted header aliases,
 * a type, and rules that produce row-level errors (block the commit) or
 * warnings (allowed, but shown).
 */

import { applyInputs } from './apply.js';
import { deriveRoom, money } from './model.js';
import { theoreticalUsage } from './seed.js';

/* ------------------------------------------------------------------ CSV */
/** RFC 4180-ish: quoted fields, escaped quotes, CRLF or LF, trailing newline. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export function toCSV(columns, rows) {
  const esc = (v) => {
    let t = v == null ? '' : String(v);
    /* A cell starting with = + - @ would run as a formula in Excel or Sheets;
       a leading apostrophe makes it text. Plain negative numbers stay numbers. */
    if (/^[=+\-@\t\r]/.test(t) && !/^-\d+(\.\d+)?$/.test(t)) t = `'${t}`;
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
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
      { k: 'seats', label: 'Seats', type: 'number', aliases: ['capacity'], required: true, max: 2000, int: true },
      { k: 'covers', label: 'Covers, per week', type: 'number', aliases: ['guests', 'covers per week', 'weekly covers'], required: true, max: 50000, int: true },
    ],
  },
  recipes: {
    title: 'Recipe costs', icon: 'FileSpreadsheet', feed: 'Recipe costs',
    blurb: 'Menu price and plate cost per dish. Add your own dishes with plates sold per week, or replace the sample menu entirely. Moves food cost, earned, every menu margin and the price moves in the plan.',
    replace: { label: 'Replace the sample menu with these dishes', note: 'Only your rows are on the menu. Sample staff, exceptions, channels and history are scaled to your sales until you enter your own.' },
    columns: [
      { k: 'dish', label: 'Dish', type: 'text', aliases: ['item', 'menu item', 'name'], required: true, maxLen: 60 },
      { k: 'price', label: 'Menu price', type: 'money', aliases: ['menu price', 'sell price'], required: true, max: 500 },
      { k: 'cost', label: 'Plate cost', type: 'money', aliases: ['plate cost', 'plate_cost', 'food cost', 'recipe cost'], required: true, max: 200 },
      { k: 'units', label: 'Plates per week', type: 'number', aliases: ['plates', 'sold', 'qty sold', 'units sold', 'weekly units', 'covers'], required: false, max: 5000 },
      { k: 'category', label: 'Category', type: 'text', aliases: ['cat', 'section', 'menu section'], required: false, maxLen: 30 },
    ],
  },
  invoices: {
    title: 'Invoice lines', icon: 'Receipt', feed: 'Invoices',
    blurb: 'This period\'s unit price and quantity per item. Moves the vendor price split and the renegotiation finding.',
    columns: [
      { k: 'item', label: 'Item', type: 'text', aliases: ['product', 'sku', 'description'], required: true, maxLen: 60 },
      { k: 'vendor', label: 'Vendor', type: 'text', aliases: ['supplier'], required: false, maxLen: 40 },
      { k: 'unit', label: 'Unit', type: 'text', aliases: ['uom', 'pack'], required: false, maxLen: 20 },
      { k: 'unit_price', label: 'Unit price', type: 'money', aliases: ['price', 'unit cost', 'cost'], required: true, max: 5000 },
      { k: 'qty', label: 'Quantity, last 28 days', type: 'number', aliases: ['quantity', 'units', 'cases'], required: true, max: 100000 },
    ],
  },
  counts: {
    title: 'Inventory count', icon: 'ClipboardList', feed: 'Inventory counts',
    blurb: 'What\'s on the shelf now, per counted item. Add your own items with what came in, what they cost and what the menu should have used. Moves actual usage and every usage gap.',
    columns: [
      { k: 'item', label: 'Item', type: 'text', aliases: ['product', 'sku'], required: true, maxLen: 60 },
      { k: 'close', label: 'Counted on hand', type: 'number', aliases: ['on hand', 'count', 'closing', 'closing count'], required: true, max: 100000 },
      { k: 'open', label: 'Opening count', type: 'number', aliases: ['opening', 'opening count', 'start'], required: false, max: 100000 },
      { k: 'received', label: 'Received, 28 days', type: 'number', aliases: ['received', 'delivered', 'purchased', 'in'], required: false, max: 100000 },
      { k: 'expected', label: 'Expected use, 28 days', type: 'number', aliases: ['expected', 'theoretical', 'theoretical usage', 'should use'], required: false, max: 100000 },
      { k: 'unit', label: 'Unit', type: 'text', aliases: ['uom'], required: false, maxLen: 20 },
      { k: 'unit_cost', label: 'Unit cost', type: 'money', aliases: ['cost', 'cost per unit'], required: false, max: 5000 },
    ],
  },
  waste: {
    title: 'Waste log', icon: 'Trash2', feed: 'Waste log',
    blurb: 'Spoiled, dropped and remade food. Explains part of a usage gap, so it isn\'t counted as unexplained.',
    columns: [
      { k: 'item', label: 'Item', type: 'text', aliases: ['product', 'sku'], required: true, maxLen: 60 },
      { k: 'qty', label: 'Quantity', type: 'number', aliases: ['quantity', 'amount'], required: true, max: 10000 },
      { k: 'reason', label: 'Reason', type: 'enum', options: WASTE_REASONS, aliases: ['why', 'cause'], required: true },
      { k: 'date', label: 'Date', type: 'text', aliases: ['day', 'when'], required: false, maxLen: 20 },
    ],
  },
  channels: {
    title: 'Sales by channel', icon: 'Bike', feed: 'Delivery statements',
    blurb: 'This week\'s sales, orders and refunds per channel. Moves channel contribution and the delivery markup range.',
    columns: [
      { k: 'channel', label: 'Channel', type: 'enum', options: CHANNELS, aliases: ['source', 'platform'], required: true },
      { k: 'sales', label: 'Net sales, this week', type: 'money', aliases: ['net sales', 'revenue', 'gross'], required: true, max: 500000 },
      { k: 'orders', label: 'Orders', type: 'number', aliases: ['tickets', 'checks', 'count'], required: true, max: 50000, int: true },
      { k: 'refunds', label: 'Refunds', type: 'money', aliases: ['refund', 'adjustments'], required: false, max: 100000 },
    ],
  },
  exceptions: {
    title: 'Register exceptions', icon: 'ShieldCheck', feed: 'Toast',
    blurb: 'Per person, last 28 days: sales, post-send voids, comps and discounts, plus weekly hours and pay rate. Moves every control limit, signal and the labour line.',
    replace: { label: 'Replace the sample staff with these people', note: 'Only your rows are on the team. Kitchen staff with no sales still count toward labour.' },
    columns: [
      { k: 'employee', label: 'Employee', type: 'text', aliases: ['name', 'server', 'staff'], required: true, maxLen: 40 },
      { k: 'role', label: 'Role', type: 'text', aliases: ['position', 'job'], required: false, maxLen: 30 },
      { k: 'sales', label: 'Sales, 28 days', type: 'money', aliases: ['net sales'], required: true, max: 2000000 },
      { k: 'post_send_voids', label: 'Post-send voids', type: 'money', aliases: ['voids', 'void', 'post send voids'], required: true, max: 200000 },
      { k: 'comps', label: 'Comps', type: 'money', aliases: ['comp'], required: true, max: 200000 },
      { k: 'discounts', label: 'Discounts', type: 'money', aliases: ['discount', 'promos'], required: true, max: 200000 },
      { k: 'hours', label: 'Hours per week', type: 'number', aliases: ['weekly hours', 'hrs'], required: false, max: 100 },
      { k: 'rate', label: 'Hourly rate', type: 'money', aliases: ['pay rate', 'wage', 'hourly'], required: false, max: 200 },
    ],
  },
};
export const KINDS = Object.keys(SCHEMAS);

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
      if (value == null && col.required) { add(n, col.k, 'error', `${col.label} is required`); bad = true; return; }
      if (value != null && (col.type === 'money' || col.type === 'number') && value < 0) { add(n, col.k, 'error', `${col.label} can't be negative`); bad = true; return; }
      rec[col.k] = value;
    });
    if (bad) return;
    const ident = key(rec.dish || rec.item || rec.channel || rec.employee) + (kind === 'waste' ? `-${n}` : '');
    if (seen.has(ident)) { add(n, null, 'error', 'Duplicate row: this name appears twice'); return; }
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
    case 'recipes': return room.menu.filter((m) => !m.balancing).map((m) => ({ dish: m.name, price: m.price, cost: m.cost, units: m.units, category: m.cat }));
    case 'invoices': return room.invoices.slice(0, 8).map((s) => ({ item: s.item, vendor: s.vendor, unit: s.unit, unit_price: s.p1, qty: s.q1 }));
    case 'counts': return room.counts.map((c) => ({ item: c.label || c.item, close: c.close, open: c.open, received: c.received, expected: c.theo != null ? c.theo : '', unit: c.unit, unit_cost: c.cost }));
    case 'waste': return [{ item: room.counts[0].label || room.counts[0].item, qty: '', reason: 'trim', date: '' }];
    case 'channels': return room.channels.map((c) => ({ channel: c.name, sales: c.sales, orders: Math.round(c.sales / c.avg), refunds: c.refunds }));
    case 'exceptions': return room.staff.map((s) => ({ employee: s.name, role: s.role, sales: s.sales, post_send_voids: s.postVoid, comps: s.comps, discounts: s.disc, hours: +(+s.hours).toFixed(1), rate: s.rate }));
    default: return [];
  }
}
export function templateCSV(kind, room) {
  return toCSV(SCHEMAS[kind].columns.map((c) => c.k), templateRows(kind, room));
}

/* ------------------------------------------------------------------ preview */
const METRICS = {
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
