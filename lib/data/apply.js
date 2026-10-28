/**
 * Apply hand-entered inputs to the dataset. Pure: returns a new dataset and
 * never mutates the seed.
 *
 * inputs shape: { [roomId]: { [kind]: { rows, date, label, n, opts? } } }
 * Kinds: profile, recipes, invoices, counts, waste, channels, exceptions.
 * opts.replace (recipes, exceptions) swaps the sample menu or team for the
 * rows entered. When the menu is replaced, the sample figures that haven't
 * been entered yet (team, exceptions, channels, invoices, history) are scaled
 * to the new sales, so a restaurant of any size reads sensibly.
 *
 * Verified packets are never touched here: their rates are frozen in the
 * packet. Inputs change menus, costs, counts and exceptions, which move
 * estimates, observed figures and detectors only.
 */

import { theoreticalUsage } from './seed.js';

export const KIND_LABEL = {
  profile: 'Restaurant profile',
  recipes: 'Recipe costs',
  invoices: 'Invoice lines',
  counts: 'Inventory count',
  waste: 'Waste log',
  channels: 'Sales by channel',
  exceptions: 'Register exceptions',
};

const norm = (s) => String(s || '').trim().toLowerCase();

const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dish';
/* A dish we have no history for gets the menu's typical elasticity, with a wide
   standard error, so any price move on it comes out Modelled with a wide band. */
const NEW_DISH_E = -1.0;
const NEW_DISH_SE = 0.45;

function applyRecipes(room, rows, opts = {}) {
  const match = (m, x) => norm(x.dish) === norm(m.name) || norm(x.dish) === norm(m.key);
  const updated = (m, r) => ({ ...m, price: r.price ?? m.price, cost: r.cost ?? m.cost, units: r.units ?? m.units, cat: r.category || m.cat });
  const used = new Set();
  const fresh = (r) => {
    let k = `own-${slug(r.dish)}`;
    while (used.has(k)) k += '-x';
    used.add(k);
    return { key: k, name: r.dish, cat: r.category || 'Food', price: r.price, cost: r.cost, units: r.units, e: NEW_DISH_E, se: NEW_DISH_SE, added: true };
  };
  let menu;
  if (opts.replace) {
    menu = rows.map((r) => {
      const m = room.menu.find((x) => !x.balancing && match(x, r));
      return m ? { ...updated(m, r), name: r.dish } : fresh(r);
    }).filter((m) => m.units > 0);
  } else {
    menu = room.menu.map((m) => {
      const r = rows.find((x) => match(m, x));
      return r ? updated(m, r) : m;
    });
    rows.filter((r) => !room.menu.some((m) => match(m, r)) && r.units > 0).forEach((r) => menu.push(fresh(r)));
  }
  return { ...room, menu, menuReplaced: !!opts.replace || room.menuReplaced };
}

function applyProfile(room, rows) {
  const r = rows[0];
  if (!r) return room;
  const short = r.short || r.name.replace(/^the\s+/i, '').split(/\s+/).slice(0, 2).join(' ');
  return {
    ...room,
    profile: { ...room.profile, name: r.name, short, seats: r.seats, gm: r.gm || room.profile.gm, own: true },
    anchor: { ...room.anchor, covers: r.covers },
    coversSet: true,
  };
}

function applyInvoices(room, rows) {
  const invoices = room.invoices.map((s) => ({ ...s }));
  rows.forEach((r) => {
    const hit = invoices.find((s) => norm(s.item) === norm(r.item));
    if (hit) {
      hit.p1 = r.unit_price;
      hit.q1 = r.qty;
      if (r.vendor) hit.vendor = r.vendor;
    } else {
      invoices.push({ item: r.item, unit: r.unit || 'each', vendor: r.vendor || 'Unknown vendor', p0: r.unit_price, p1: r.unit_price, q0: 0, q1: r.qty, added: true });
    }
  });
  return { ...room, invoices };
}

function applyCounts(room, rows) {
  const match = (c, x) => norm(x.item) === norm(c.item) || norm(x.item) === norm(c.label);
  const counts = room.counts.map((c) => {
    const r = rows.find((x) => match(c, x));
    if (!r) return c;
    return { ...c, open: r.open ?? c.open, close: r.close, received: r.received ?? c.received, cost: r.unit_cost ?? c.cost, ...(r.expected != null ? { theo: r.expected } : {}), counted: true };
  });
  rows.filter((r) => !room.counts.some((c) => match(c, r))).forEach((r) => {
    counts.push({ item: r.item, unit: r.unit || 'each', open: r.open ?? 0, received: r.received ?? 0, close: r.close, cost: r.unit_cost ?? 0, theo: r.expected ?? 0, tol: 0.05, cat: 'Kitchen', counted: true, added: true });
  });
  return { ...room, counts };
}

function applyWaste(room, rows) {
  const toItem = (x) => room.counts.find((c) => norm(c.item) === norm(x) || norm(c.label) === norm(x))?.item || x;
  return { ...room, waste: [...(room.waste || []), ...rows.map((r) => ({ ...r, item: toItem(r.item) }))] };
}

function applyChannels(room, rows) {
  const channels = room.channels.map((c) => {
    const r = rows.find((x) => norm(x.channel) === norm(c.name) || norm(x.channel) === c.k);
    if (!r) return c;
    return { ...c, sales: r.sales, avg: r.orders ? r.sales / r.orders : c.avg, refunds: r.refunds ?? c.refunds };
  });
  return { ...room, channels };
}

const DEFAULT_RATE = 16.5;
function applyExceptions(room, rows, opts = {}) {
  const sample = room.staff.map((s) => ({ ...s }));
  const staff = opts.replace ? [] : sample;
  rows.forEach((r) => {
    const hit = (opts.replace ? sample : staff).find((s) => norm(s.name) === norm(r.employee));
    const vals = { sales: r.sales, postVoid: r.post_send_voids, comps: r.comps, disc: r.discounts, ...(r.hours != null ? { hours: r.hours } : {}), ...(r.rate != null ? { rate: r.rate } : {}), ...(r.role ? { role: r.role } : {}) };
    if (hit) {
      Object.assign(hit, vals);
      if (opts.replace) staff.push(hit);
    } else staff.push({ name: r.employee, role: r.role || (r.sales > 0 ? 'Server' : 'Line cook'), rate: DEFAULT_RATE, hours: 0, ...vals, added: true });
  });
  return { ...room, staff, staffSet: true };
}

/* Menu replaced: scale what's still sample to the new sales. */
function scaleToMenu(room, seedRoom, kinds) {
  const gross = (menu) => menu.reduce((s, m) => s + m.price * m.units, 0);
  const k = gross(room.menu) / gross(seedRoom.menu);
  if (!Number.isFinite(k) || k <= 0) return room;
  const out = { ...room, scale: k };
  if (!kinds.exceptions) out.staff = room.staff.map((s) => ({ ...s, sales: s.sales * k, postVoid: s.postVoid * k, comps: s.comps * k, disc: s.disc * k, hours: s.hours * k }));
  if (!kinds.channels) out.channels = room.channels.map((c) => ({ ...c, sales: c.sales * k, refunds: c.refunds * k }));
  if (!kinds.invoices) out.invoices = room.invoices.map((r) => ({ ...r, q0: r.q0 * k, q1: r.q1 * k }));
  if (!kinds.profile) out.anchor = { ...room.anchor, covers: Math.max(1, Math.round(room.anchor.covers * k)) };
  /* Sample count items the new menu never uses would read as pure loss; keep only yours and the ones its dishes use. */
  out.counts = room.counts.filter((c) => c.added || c.counted || theoreticalUsage(room.menu, c.item) > 0);
  out.waste = (room.waste || []).filter((w) => out.counts.some((c) => c.item === w.item));
  out.history = room.history.map((r) => ({ ...r, net: r.net * k, food: r.food * k, labour: r.labour * k, earned: r.earned * k, covers: Math.max(1, Math.round(r.covers * k)) }));
  return out;
}

const APPLY = { profile: applyProfile, recipes: applyRecipes, invoices: applyInvoices, counts: applyCounts, waste: applyWaste, channels: applyChannels, exceptions: applyExceptions };

export function applyInputs(seed, inputs = {}) {
  const rooms = { ...seed.rooms };
  Object.entries(inputs).forEach(([roomId, kinds]) => {
    if (!rooms[roomId]) return;
    let room = rooms[roomId];
    const present = kinds || {};
    /* Recipes before counts and waste (usage reads the menu); the rest in any order. */
    ['profile', 'recipes', 'exceptions', 'invoices', 'counts', 'waste', 'channels'].forEach((kind) => {
      const entry = present[kind];
      if (entry && APPLY[kind]) room = APPLY[kind](room, entry.rows || [], entry.opts || {});
    });
    if (room.menuReplaced) room = scaleToMenu(room, seed.rooms[roomId], present);
    rooms[roomId] = room;
  });
  return { ...seed, rooms, inputs };
}
