/**
 * Apply hand-entered inputs to the dataset. Pure: returns a new dataset and
 * never mutates the seed.
 *
 * inputs shape: { [roomId]: { [kind]: { rows, date, label, n } } }
 * Kinds: recipes, invoices, counts, waste, channels, exceptions.
 *
 * Verified packets are never touched here: their rates are frozen in the
 * packet. Inputs change menus, costs, counts and exceptions, which move
 * estimates, observed figures and detectors only.
 */

export const KIND_LABEL = {
  recipes: 'Recipe costs',
  invoices: 'Invoice lines',
  counts: 'Inventory count',
  waste: 'Waste log',
  channels: 'Sales by channel',
  exceptions: 'Register exceptions',
};

const norm = (s) => String(s || '').trim().toLowerCase();

function applyRecipes(room, rows) {
  const menu = room.menu.map((m) => {
    const r = rows.find((x) => norm(x.dish) === norm(m.name) || norm(x.dish) === norm(m.key));
    if (!r) return m;
    return { ...m, price: r.price ?? m.price, cost: r.cost ?? m.cost };
  });
  return { ...room, menu };
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
  const counts = room.counts.map((c) => {
    const r = rows.find((x) => norm(x.item) === norm(c.item) || norm(x.item) === norm(c.label));
    if (!r) return c;
    return { ...c, open: r.open ?? c.open, close: r.close, received: r.received ?? c.received, counted: true };
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

function applyExceptions(room, rows) {
  const staff = room.staff.map((s) => ({ ...s }));
  rows.forEach((r) => {
    const hit = staff.find((s) => norm(s.name) === norm(r.employee));
    const vals = { sales: r.sales, postVoid: r.post_send_voids, comps: r.comps, disc: r.discounts };
    if (hit) Object.assign(hit, vals);
    else staff.push({ name: r.employee, role: r.role || 'Server', rate: 14.5, hours: 0, ...vals, added: true });
  });
  return { ...room, staff };
}

const APPLY = { recipes: applyRecipes, invoices: applyInvoices, counts: applyCounts, waste: applyWaste, channels: applyChannels, exceptions: applyExceptions };

export function applyInputs(seed, inputs = {}) {
  const rooms = { ...seed.rooms };
  Object.entries(inputs).forEach(([roomId, kinds]) => {
    if (!rooms[roomId]) return;
    let room = rooms[roomId];
    Object.entries(kinds || {}).forEach(([kind, entry]) => {
      if (entry && APPLY[kind]) room = APPLY[kind](room, entry.rows || []);
    });
    rooms[roomId] = room;
  });
  return { ...seed, rooms, inputs };
}
