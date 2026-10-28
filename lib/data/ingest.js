/**
 * Manual ingestion: parse, map, validate and preview hand-entered data before
 * it touches any figure. Pure functions; the Data inputs screen drives them.
 *
 * Six kinds, each with a schema: the columns, their accepted header aliases,
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
    const t = v == null ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

/* ------------------------------------------------------------------ schemas */
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const WASTE_REASONS = ['spoiled', 'dropped', 'overcooked', 'returned', 'expired', 'trim', 'other'];
const CHANNELS = ['Dine-in', 'Takeout', 'DoorDash', 'Uber Eats'];

export const SCHEMAS = {
  recipes: {
    title: 'Recipe costs', icon: 'FileSpreadsheet', feed: 'Recipe costs',
    blurb: 'Menu price and plate cost per dish. Moves food cost, earned, every menu margin and the price moves in the plan.',
    columns: [
      { k: 'dish', label: 'Dish', type: 'text', aliases: ['item', 'menu item', 'name'], required: true },
      { k: 'price', label: 'Menu price', type: 'money', aliases: ['menu price', 'sell price'], required: true },
      { k: 'cost', label: 'Plate cost', type: 'money', aliases: ['plate cost', 'plate_cost', 'food cost', 'recipe cost'], required: true },
    ],
  },
  invoices: {
    title: 'Invoice lines', icon: 'Receipt', feed: 'Invoices',
    blurb: 'This period\'s unit price and quantity per item. Moves the vendor price split and the renegotiation finding.',
    columns: [
      { k: 'item', label: 'Item', type: 'text', aliases: ['product', 'sku', 'description'], required: true },
      { k: 'vendor', label: 'Vendor', type: 'text', aliases: ['supplier'], required: false },
      { k: 'unit', label: 'Unit', type: 'text', aliases: ['uom', 'pack'], required: false },
      { k: 'unit_price', label: 'Unit price', type: 'money', aliases: ['price', 'unit cost', 'cost'], required: true },
      { k: 'qty', label: 'Quantity, last 28 days', type: 'number', aliases: ['quantity', 'units', 'cases'], required: true },
    ],
  },
  counts: {
    title: 'Inventory count', icon: 'ClipboardList', feed: 'Inventory counts',
    blurb: 'What\'s on the shelf now, per counted item. Moves actual usage and every usage gap.',
    columns: [
      { k: 'item', label: 'Item', type: 'text', aliases: ['product', 'sku'], required: true },
      { k: 'close', label: 'Counted on hand', type: 'number', aliases: ['on hand', 'count', 'closing', 'closing count'], required: true },
      { k: 'open', label: 'Opening count (optional)', type: 'number', aliases: ['opening', 'opening count', 'start'], required: false },
    ],
  },
  waste: {
    title: 'Waste log', icon: 'Trash2', feed: 'Waste log',
    blurb: 'Spoiled, dropped and remade food. Explains part of a usage gap, so it isn\'t counted as unexplained.',
    columns: [
      { k: 'item', label: 'Item', type: 'text', aliases: ['product', 'sku'], required: true },
      { k: 'qty', label: 'Quantity', type: 'number', aliases: ['quantity', 'amount'], required: true },
      { k: 'reason', label: 'Reason', type: 'enum', options: WASTE_REASONS, aliases: ['why', 'cause'], required: true },
      { k: 'date', label: 'Date', type: 'text', aliases: ['day', 'when'], required: false },
    ],
  },
  channels: {
    title: 'Sales by channel', icon: 'Bike', feed: 'Delivery statements',
    blurb: 'This week\'s sales, orders and refunds per channel. Moves channel contribution and the delivery markup range.',
    columns: [
      { k: 'channel', label: 'Channel', type: 'enum', options: CHANNELS, aliases: ['source', 'platform'], required: true },
      { k: 'sales', label: 'Net sales, this week', type: 'money', aliases: ['net sales', 'revenue', 'gross'], required: true },
      { k: 'orders', label: 'Orders', type: 'number', aliases: ['tickets', 'checks', 'count'], required: true },
      { k: 'refunds', label: 'Refunds', type: 'money', aliases: ['refund', 'adjustments'], required: false },
    ],
  },
  exceptions: {
    title: 'Register exceptions', icon: 'ShieldCheck', feed: 'Toast',
    blurb: 'Per person, last 28 days: sales, post-send voids, comps and discounts. Moves every control limit and signal.',
    columns: [
      { k: 'employee', label: 'Employee', type: 'text', aliases: ['name', 'server', 'staff'], required: true },
      { k: 'role', label: 'Role', type: 'text', aliases: ['position', 'job'], required: false },
      { k: 'sales', label: 'Sales, 28 days', type: 'money', aliases: ['net sales'], required: true },
      { k: 'post_send_voids', label: 'Post-send voids', type: 'money', aliases: ['voids', 'void', 'post send voids'], required: true },
      { k: 'comps', label: 'Comps', type: 'money', aliases: ['comp'], required: true },
      { k: 'discounts', label: 'Discounts', type: 'money', aliases: ['discount', 'promos'], required: true },
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
    return { value: n };
  }
  if (col.type === 'enum') {
    const hit = col.options.find((o) => key(o) === key(t));
    if (!hit) return { error: `"${t}" isn't one of ${col.options.join(', ')}` };
    return { value: hit };
  }
  return { value: t };
}

/* ------------------------------------------------------------------ validation */
/**
 * @returns {{ rows: object[], issues: {row:number, col:string|null, level:'error'|'warn', msg:string}[], errors:number, warnings:number }}
 * `row` is 1-based, matching the table the person sees.
 */
export function validate(kind, rawRows, room, mapping) {
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
    const ok = RULES[kind](rec, room, (col, level, msg) => add(n, col, level, msg));
    if (ok !== false) rows.push(rec);
  });
  if (!rawRows.length) add(0, null, 'error', 'No rows to check');
  return { rows, issues, errors: issues.filter((x) => x.level === 'error').length, warnings: issues.filter((x) => x.level === 'warn').length };
}

const findMenu = (room, name) => room.menu.find((m) => key(m.name) === key(name) || key(m.key) === key(name));
const findCount = (room, name) => room.counts.find((c) => key(c.item) === key(name) || key(c.label) === key(name));

const RULES = {
  recipes(r, room, add) {
    const m = findMenu(room, r.dish);
    if (!m) { add('dish', 'error', `"${r.dish}" isn't on this room's menu`); return false; }
    if (r.price === 0) { add('price', 'error', 'Menu price must be above $0'); return false; }
    if (r.cost >= r.price) { add('cost', 'error', `Plate cost ${money(r.cost, { cents: true })} is at or above the price`); return false; }
    const fc = r.cost / r.price;
    if (fc > 0.45) add('cost', 'warn', `${Math.round(fc * 100)}% food cost is unusually high; check the recipe`);
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
    const c = findCount(room, r.item);
    if (!c) { add('item', 'error', `"${r.item}" isn't on this room's count sheet`); return false; }
    const open = r.open ?? c.open;
    const theo = theoreticalUsage(room.menu, c.item);
    const actual = open + c.received - r.close;
    if (actual < 0) { add('close', 'error', `Implies negative usage: on hand is more than opening + received (${+(open + c.received).toFixed(1)} ${c.unit})`); return false; }
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
  exceptions(r, room, add) {
    if (r.sales === 0) { add('sales', 'error', 'Sales must be above 0 to set a limit'); return false; }
    const ex = r.post_send_voids + r.comps + r.discounts;
    if (ex > r.sales * 0.2) { add('sales', 'error', 'Exceptions over 20% of sales; check the columns'); return false; }
    if (!room.staff.some((s) => key(s.name) === key(r.employee))) add('employee', 'warn', 'Not on the staff list: added as a new person');
    return true;
  },
};

/* ------------------------------------------------------------------ templates (pre-filled from the room) */
export function templateRows(kind, room) {
  switch (kind) {
    case 'recipes': return room.menu.filter((m) => !m.balancing).map((m) => ({ dish: m.name, price: m.price, cost: m.cost }));
    case 'invoices': return room.invoices.slice(0, 8).map((s) => ({ item: s.item, vendor: s.vendor, unit: s.unit, unit_price: s.p1, qty: s.q1 }));
    case 'counts': return room.counts.map((c) => ({ item: c.label || c.item, close: c.close, open: c.open }));
    case 'waste': return [{ item: room.counts[0].label || room.counts[0].item, qty: '', reason: 'trim', date: '' }];
    case 'channels': return room.channels.map((c) => ({ channel: c.name, sales: c.sales, orders: Math.round(c.sales / c.avg), refunds: c.refunds }));
    case 'exceptions': return room.staff.filter((s) => s.sales > 0).map((s) => ({ employee: s.name, role: s.role, sales: s.sales, post_send_voids: s.postVoid, comps: s.comps, discounts: s.disc }));
    default: return [];
  }
}
export function templateCSV(kind, room) {
  return toCSV(SCHEMAS[kind].columns.map((c) => c.k), templateRows(kind, room));
}

/* ------------------------------------------------------------------ preview */
const METRICS = {
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
export function preview(seed, inputs, roomId, kind, rows) {
  const before = deriveRoom(applyInputs(seed, inputs), roomId);
  const nextInputs = { ...inputs, [roomId]: { ...(inputs[roomId] || {}), [kind]: { rows, date: 'preview', label: SCHEMAS[kind].title, n: rows.length } } };
  const after = deriveRoom(applyInputs(seed, nextInputs), roomId);
  const fmt = (v, t) => (t === 'money' ? money(Math.round(v)) : t === 'cents' ? money(v, { cents: true }) : t === 'pct' ? `${v.toFixed(1)}%` : String(v));
  return {
    moves: METRICS[kind].map(([label, f, t, claim]) => {
      const a = f(before), b = f(after);
      return { label, before: fmt(a, t), after: fmt(b, t), changed: Math.abs(b - a) > (t === 'count' ? 0 : 0.5), up: b > a, claim };
    }),
    frozen: FROZEN.map(([label, f]) => ({ label, value: money(Math.round(f(before))), same: Math.round(f(before)) === Math.round(f(after)) })),
  };
}
