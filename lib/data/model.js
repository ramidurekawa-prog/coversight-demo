/**
 * Every figure in the demo, derived from a room's data. Pure functions, no
 * React: route files, tests and the browser all use them, and an upload or a
 * room switch is just a re-derive.
 *
 * Verified packets are frozen: their bookable rates come from the packet,
 * never from current data, so new inputs can change estimates, observed
 * figures and detectors but never a number that's already been proven.
 */

import { RECIPES, ROOM_IDS, theoreticalUsage } from './seed.js';

export const SUBSCRIPTION = 349;
export const DAYS_TO_DATE = 127; // Jun 22 → Oct 26 inclusive
export const ACCRUAL_START = 'Jun 22';

/* ------------------------------------------------------------------ format */
export const money = (n, opts = {}) => {
  const { cents = false, sign = false } = opts;
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const pre = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${pre}$${s}`;
};
const minus = (n, d = 2) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`;
const pct = (n, d = 1) => `${(n * 100).toFixed(d)}%`;

/* ------------------------------------------------------------------ menu */
export const PERSIST = {
  structural: { w: 1.0, label: 'Structural' },
  holds: { w: 0.8, label: 'Holds until next change' },
  upkeep: { w: 0.6, label: 'Needs upkeep' },
  week: { w: 0.4, label: 'This week only' },
};

/** Weekly contribution change from moving one item to `newPrice`, constant-elasticity demand. */
export function priceMove(item, newPrice, e = item.e) {
  if (e == null) return null;
  const cm = item.price - item.cost;
  const q1 = item.units * Math.pow(newPrice / item.price, e);
  const before = cm * item.units;
  const after = (newPrice - item.cost) * q1;
  return { q1, before, after, delta: after - before, lost: item.units - q1 };
}
/** Point and interval (elasticity ± 1.64 se ≈ 90%) for a price move. */
export function priceMoveInterval(item, newPrice) {
  const p = priceMove(item, newPrice);
  if (!p) return null;
  const a = priceMove(item, newPrice, item.e - 1.64 * item.se).delta;
  const b = priceMove(item, newPrice, Math.min(-0.05, item.e + 1.64 * item.se)).delta;
  return { ...p, lo: Math.min(a, b), hi: Math.max(a, b) };
}

export function menuStats(menu) {
  const rows = menu.map((m) => ({ ...m, cm: +(m.price - m.cost).toFixed(2) }));
  const units = rows.reduce((s, m) => s + m.units, 0);
  return {
    menu: rows,
    cmUnweighted: rows.reduce((s, m) => s + m.cm, 0) / rows.length,
    cmWeighted: rows.reduce((s, m) => s + m.cm * m.units, 0) / units,
    gross: rows.reduce((s, m) => s + m.price * m.units, 0),
    food: rows.reduce((s, m) => s + m.cost * m.units, 0),
    units,
  };
}

/* ------------------------------------------------------------------ purchasing
   price leg = (p1 − p0) × q1; mix leg = (q1 − q0) × p0; they sum to the total. */
export function invoiceStats(invoices) {
  const rows = invoices.map((r) => ({
    ...r,
    priceLeg: (r.p1 - r.p0) * r.q1,
    mixLeg: (r.q1 - r.q0) * r.p0,
    total: r.p1 * r.q1 - r.p0 * r.q0,
    pct: (r.p1 / r.p0 - 1) * 100,
  }));
  const byVendor = {};
  rows.forEach((r) => { byVendor[r.vendor] = (byVendor[r.vendor] || 0) + r.priceLeg; });
  return {
    invoices: rows,
    priceLeg: rows.reduce((s, r) => s + r.priceLeg, 0),
    mixLeg: rows.reduce((s, r) => s + r.mixLeg, 0),
    before: rows.reduce((s, r) => s + r.p0 * r.q0, 0),
    after: rows.reduce((s, r) => s + r.p1 * r.q1, 0),
    byVendor: Object.entries(byVendor).map(([vendor, leg]) => ({ vendor, leg })).sort((a, b) => b.leg - a.leg),
  };
}

/* ------------------------------------------------------------------ register controls
   Per person, per exception type: a p-chart limit for their volume,
   p̄ ± 3·√(p̄(1−p̄)/n), n = checks. Above the upper limit is a signal. */
export const AVG_CHECK = 64;
export const EXCEPTION_TYPES = [
  { k: 'postVoid', label: 'Post-send voids', short: 'post-send voids', note: 'voids after the kitchen fired the order' },
  { k: 'comps', label: 'Comps', short: 'comps', note: 'comps' },
  { k: 'disc', label: 'Discounts', short: 'discounts', note: 'discounts' },
];
export function staffStats(staff) {
  const people = staff.filter((s) => s.sales > 0).map((s) => ({ ...s, checks: Math.round(s.sales / AVG_CHECK) }));
  const sales = people.reduce((s, p) => s + p.sales, 0);
  const types = {};
  EXCEPTION_TYPES.forEach(({ k }) => {
    const total = people.reduce((s, p) => s + p[k], 0);
    const pbar = total / sales;
    people.forEach((p) => {
      p[`${k}Rate`] = p[k] / p.sales;
      p[`${k}Ucl`] = pbar + 3 * Math.sqrt((pbar * (1 - pbar)) / p.checks);
      p[`${k}Signal`] = p[`${k}Rate`] > p[`${k}Ucl`];
    });
    const signals = people.filter((p) => p[`${k}Signal`]);
    const rest = people.filter((p) => !p[`${k}Signal`]);
    const base = rest.reduce((s, p) => s + p[k], 0) / rest.reduce((s, p) => s + p.sales, 0);
    const excess = signals.reduce((s, p) => s + (p[`${k}Rate`] - base) * p.sales, 0);
    types[k] = { total, pbar, base, signals, excess, week: total / 4 };
  });
  return {
    people, sales, types,
    weekTotal: (types.postVoid.total + types.comps.total + types.disc.total) / 4,
    compsDiscWeek: (types.comps.total + types.disc.total) / 4,
    signalCount: EXCEPTION_TYPES.reduce((s, { k }) => s + types[k].signals.length, 0),
  };
}

/* ------------------------------------------------------------------ usage
   Theoretical = Σ plates × recipe quantity (28 days). Actual = open + received
   − close. Logged waste explains part of any gap; the unexplained part is
   what's compared with the count tolerance. */
export function usageStats(room) {
  const rows = room.counts.map((c) => {
    /* A hand-entered item carries its own expected use; sample items use the recipe map. */
    const theo = c.theo != null ? c.theo : theoreticalUsage(room.menu, c.item);
    const actual = c.open + c.received - c.close;
    const waste = (room.waste || []).filter((w) => w.item === c.item).reduce((s, w) => s + (+w.qty || 0), 0);
    const over = actual - theo;
    const unexplained = over - waste;
    const pctGap = theo ? unexplained / theo : 0;
    return {
      ...c, label: c.label || c.item, theo, actual, over, waste, unexplained,
      pct: pctGap, dollars: unexplained * c.cost, wasteDollars: waste * c.cost,
      flag: theo > 0 && pctGap > c.tol,
      why: c.theo != null ? 'your expected use, entered by hand' : usageWhy(room.menu, c.item),
    };
  });
  const flagged = rows.filter((r) => r.flag);
  const week = (cat) => flagged.filter((r) => !cat || r.cat === cat).reduce((s, r) => s + r.dollars, 0) / 4;
  return { rows, flagged, week: week(), kitchenWeek: week('Kitchen'), barWeek: week('Bar'), wasteWeek: rows.reduce((s, r) => s + r.wasteDollars, 0) / 4 };
}
function usageWhy(menu, sku) {
  const parts = [];
  menu.forEach((m) => (RECIPES[m.key] || []).forEach(([s, q]) => { if (s === sku) parts.push(`${m.units} ${m.name.toLowerCase()} a week`); }));
  return parts.slice(0, 2).join(' + ') || 'not on the recipe map';
}

/* ------------------------------------------------------------------ channels
   Contribution before labour = sales − food − fees − packaging − refunds. */
export function channelStats(channels, foodRate) {
  const rows = channels.map((c) => {
    const orders = c.sales / c.avg;
    const food = c.sales * foodRate;
    const fees = c.sales * c.fee;
    const packaging = orders * c.pack;
    const contrib = c.sales - food - fees - packaging - c.refunds;
    return { ...c, orders, food, fees, packaging, contrib, per100: (contrib / c.sales) * 100 };
  });
  const delivery = rows.filter((c) => c.k === 'dd' || c.k === 'ue');
  const contribAt = (m, v) => delivery.reduce((s, c) => {
    const keep = 1 - v;
    const sales = c.sales * (1 + m) * keep;
    return s + sales - c.food * keep - sales * c.fee - c.packaging * keep - c.refunds * keep;
  }, 0);
  const base = contribAt(0, 0);
  const total = rows.reduce((s, c) => s + c.sales, 0);
  return {
    channels: rows, delivery,
    deliverySales: delivery.reduce((s, c) => s + c.sales, 0),
    deliveryShare: delivery.reduce((s, c) => s + c.sales, 0) / total,
    deliveryRefunds: delivery.reduce((s, c) => s + c.refunds, 0),
    markupHi: contribAt(0.1, 0) - base,
    markupLo: contribAt(0.1, 1 / 6) - base,
    total,
  };
}

/* ------------------------------------------------------------------ the week */
export function weekStats(room, menuS, staffS) {
  const net = menuS.gross - staffS.compsDiscWeek;
  const food = menuS.food;
  const labour = room.staff.reduce((s, p) => s + p.hours * p.rate, 0);
  const earned = net - food - labour;
  const covers = room.anchor.covers;
  return { gross: menuS.gross, net, food, labour, earned, covers, marginPerCover: earned / covers, foodRate: food / net, labourRate: labour / net, exceptions: staffS.weekTotal };
}

export function historyStats(room, week, matchedWeeks) {
  const rows = room.history.map((r) => ({ ...r }));
  const last = rows[rows.length - 1];
  Object.assign(last, { net: Math.round(week.net), food: Math.round(week.food), labour: Math.round(week.labour), earned: Math.round(week.earned), excPct: +((week.exceptions / week.net) * 100).toFixed(2) });
  rows.forEach((r) => {
    r.prime = (r.food + r.labour) / r.net;
    r.foodRate = r.food / r.net;
    r.labourRate = r.labour / r.net;
    r.check = r.net / r.covers;
  });
  const matchedMean = matchedWeeks.reduce((s, i) => s + rows[i].earned, 0) / matchedWeeks.length;
  return { rows, matchedMean, marginMove: last.earned - matchedMean };
}

/** Mean ± 3σ from a baseline window of a series. */
export function controlLimits(values, baseline = values.length - 1) {
  const b = values.slice(0, baseline);
  const mean = b.reduce((s, v) => s + v, 0) / b.length;
  const sd = Math.sqrt(b.reduce((s, v) => s + (v - mean) ** 2, 0) / (b.length - 1));
  return { mean, sd, ucl: mean + 3 * sd, lcl: mean - 3 * sd };
}

/* ------------------------------------------------------------------ proof */
export const OUTCOMES = ['verified', 'limited', 'testing', 'data', 'reversed', 'inconclusive', 'directional'];

/** All packets, with input-driven status changes applied (never their rates). */
export function proofList(ds) {
  return ds.proof.map((p) => {
    const unblocked = p.unblockedBy && ds.inputs?.[p.loc]?.[p.unblockedBy];
    if (!unblocked) return { ...p };
    return { ...p, outcome: 'testing', held: `Window restarted ${unblocked.date}`, reason: null, checkpoint: `${unblocked.label} uploaded ${unblocked.date}; the window restarted from the upload`, lo: -60, hi: 300, point: 120, closes: 'Dec 15', progress: 2 };
  });
}

export function bankedStats(proofs) {
  const accruing = proofs.filter((p) => p.outcome === 'verified' || p.outcome === 'limited');
  const live = accruing.filter((p) => !p.paused);
  const week = live.reduce((s, p) => s + p.bookable, 0);
  const paused = accruing.filter((p) => p.paused).reduce((s, p) => s + p.bookable, 0);
  const toDate = accruing.reduce((s, p) => s + (p.bookable / 7) * (p.accrualDays || 0), 0);
  const sept = accruing.reduce((s, p) => s + (p.bookable / 7) * (p.septDays || 0), 0);
  const lead = [...live].sort((a, b) => b.bookable - a.bookable)[0] || null;
  return { week, paused, toDate, sept, coverage: sept / SUBSCRIPTION, daily: week / 7, lead, live, accruing, reversed: proofs.filter((p) => p.outcome === 'reversed') };
}

/* ------------------------------------------------------------------ candidates */
/* Up to two price moves on hand-entered dishes: the ones earning the most a
   week with food cost at or under 35%, priced up about 6% (at least $1).
   New dishes carry the menu's typical elasticity with a wide band, so these
   are Modelled with wide intervals, never more. */
export const OWN_PRICE_IDS = ['own-price-1', 'own-price-2'];
function ownPriceSpecs(menu) {
  return menu
    .filter((m) => m.added && m.cost / m.price <= 0.35 && m.units >= 5)
    .sort((a, b) => (b.price - b.cost) * b.units - (a.price - a.cost) * a.units)
    .slice(0, 2)
    .map((m, i) => ({
      id: OWN_PRICE_IDS[i], kind: 'price', item: m.key, to: Math.max(Math.ceil(m.price) + 1, Math.round(m.price * 1.06)), short: m.name.toLowerCase(),
      lever: 'Menu', p: 0.5, persist: 'structural', hours: 0.5, claim: 'mod', own: true,
      why: 'One of your best earners at {fc} food cost. With no price history yet we use the typical elasticity ({e}) and a wide band; a 4-week test narrows it.',
    }));
}

export function valueCandidates(room, ctx) {
  const { menuS, invS, staffS, usageS, chanS } = ctx;
  const out = [];
  const people = new Set(room.staff.map((s) => s.name));
  [...room.candidates, ...ownPriceSpecs(menuS.menu)].forEach((spec) => {
    let c = null;
    if (spec.who && !people.has(spec.who)) return;
    if (spec.kind === 'price') {
      const item = menuS.menu.find((m) => m.key === spec.item);
      const pm = item && priceMoveInterval(item, spec.to);
      if (!pm) return;
      const short = spec.short || (item.key === 'benedict' ? 'crab benedict' : item.name.toLowerCase());
      const fill = { e: minus(item.e), fc: `${Math.round((item.cost / item.price) * 100)}%`, to: money(spec.to), from: money(item.price), lost: Math.round(pm.lost), step: money(spec.to - item.price) };
      c = { ...spec, title: `Raise the ${short} from ${money(item.price)} to ${money(spec.to)}`, value: pm.delta, lo: pm.lo, hi: pm.hi, why: tmpl(spec.why, fill), move: pm };
    } else if (spec.kind === 'vendor') {
      const rows = spec.skus.map((k) => invS.invoices.find((r) => r.item === k)).filter(Boolean);
      const v = rows.reduce((s, r) => s + (r.priceLeg / 4) * 0.6, 0);
      c = { ...spec, value: v, lo: v * 0.8, hi: v * 1.1, why: tmpl(spec.why, { pct0: `${rows[0]?.pct.toFixed(1)}%`, pct1: `${rows[1]?.pct.toFixed(1)}%` }) };
    } else if (spec.kind === 'usage') {
      const v = usageS.flagged.filter((r) => spec.skus.includes(r.item)).reduce((s, r) => s + r.dollars, 0) / 4;
      c = { ...spec, value: v, lo: v * 0.5, hi: v * 1.2 };
    } else if (spec.kind === 'voids' || spec.kind === 'comps') {
      const t = staffS.types[spec.kind === 'voids' ? 'postVoid' : 'comps'];
      const v = t.excess / 4;
      c = { ...spec, value: v, lo: v * 0.4, hi: v * 1.1 };
    } else if (spec.kind === 'markup') {
      c = { ...spec, value: (chanS.markupLo + chanS.markupHi) / 2, lo: chanS.markupLo, hi: chanS.markupHi };
    } else {
      c = { ...spec };
    }
    /* On your own restaurant, sample-only moves go: typed labour and kitchen
       figures, vendor calls on sample invoices, and anything worth nothing. */
    if (ctx.own && !spec.own) {
      if (c.kind === 'fixed') return;
      if (c.kind === 'vendor' && !ctx.inputs.invoices) return;
      if (!(c.value > 0.5)) return;
    }
    const w = PERSIST[c.persist].w;
    out.push({ ...c, edv: c.value * c.p * w, perHour: (c.value * c.p * w) / c.hours });
  });
  return out;
}

export function choosePlan(cands, hours) {
  const sorted = [...cands].sort((a, b) => b.perHour - a.perHour);
  let used = 0;
  const chosen = new Set();
  sorted.forEach((c) => { if (c.perHour > 0 && used + c.hours <= hours + 1e-9) { chosen.add(c.id); used += c.hours; } });
  return { sorted, chosen, used };
}

/* ------------------------------------------------------------------ feeds */
const BASE_FEEDS = [
  { name: 'Toast', what: 'Sales, items, voids, comps, covers', last: '2 minutes ago', state: 'healthy', risk: 0 },
  { name: '7shifts', what: 'Schedules and clock-ins', last: '18 hours ago', state: 'healthy', risk: 0, fix: 'Reconnect' },
  { name: 'Recipe costs', what: 'Plate costs, uploaded as CSV', last: '4 days ago', state: 'healthy', risk: 0, fix: 'Upload CSV', input: 'recipes' },
  { name: 'Kitchen display', what: 'Ticket times by station', last: '1 hour ago', state: 'healthy', risk: 0, fix: 'Fix export' },
  { name: 'Inventory counts', what: 'Monthly manual count, entered in Toast', last: 'Oct 1 count', state: 'partial', risk: 0, note: 'Counted once a month by hand. A single count carries about ±3% error, so smaller usage gaps are noise.', fix: 'Add a spot count', input: 'counts' },
  { name: 'Waste log', what: 'Spoiled, dropped and remade food, logged by the kitchen', last: 'No entries yet', state: 'off', risk: 0, note: 'Without it, every usage gap is unexplained.', fix: 'Start a log', input: 'waste' },
  { name: 'Invoices', what: 'Vendor invoices from your inbox', last: '3 days ago', state: 'healthy', risk: 0, fix: 'Add invoice lines', input: 'invoices' },
  { name: 'Delivery statements', what: 'DoorDash and Uber Eats payouts, commissions, refunds', last: 'Monday payout', state: 'healthy', risk: 0, fix: 'Enter channel sales', input: 'channels' },
  { name: 'QuickBooks Online', what: 'Ledger, for reconciliation', last: 'Sep 30 close', state: 'healthy', risk: 0 },
  { name: 'Waitlist', what: 'Guests turned away or waiting', last: 'Not connected', state: 'off', risk: 0, note: 'Without it, faster turns can never be claimed.', fix: 'Connect' },
];
const INPUT_FEED = { recipes: 'Recipe costs', counts: 'Inventory counts', waste: 'Waste log', invoices: 'Invoices', channels: 'Delivery statements', exceptions: 'Toast' };

export function feedsFor(room, inputs, riskSalmon) {
  return BASE_FEEDS.map((f) => {
    const o = room.feeds[f.name];
    let feed = { ...f };
    if (o) {
      const [state, last, risk, note] = o;
      feed = { ...feed, state, last, risk: risk === 'salmon' ? riskSalmon : risk, note: note ?? (state === 'healthy' ? null : feed.note) };
    }
    const kind = Object.keys(INPUT_FEED).find((k) => INPUT_FEED[k] === f.name && inputs?.[k]);
    if (kind) feed = { ...feed, state: 'healthy', last: `${inputs[kind].date} · manual entry`, risk: 0, note: `${inputs[kind].n} rows entered by hand. Figures that read this feed now use them.`, manual: true };
    return feed;
  });
}

/* ------------------------------------------------------------------ text */
export function tmpl(str, vals) {
  return String(str || '').replace(/\{([\w-]+)\}/g, (m, k) => (vals[k] != null ? vals[k] : m));
}

/* ------------------------------------------------------------------ operating areas */
const AREA_DEFS = [
  { id: 'labour', area: 'Labour & scheduling', icon: 'Users', examples: 'Overstaffed shoulders, overtime, shifts that miss demand', data: ['Toast', '7shifts'], view: 'Revenue per labour hour vs matched weeks', screen: 'labour' },
  { id: 'demand', area: 'Demand & tonight’s staffing', icon: 'CloudSun', examples: 'Slow nights not caught in time, rushes understaffed', data: ['Toast', '7shifts'], view: 'Covers nowcast vs comparable nights', screen: 'service' },
  { id: 'menu', area: 'Menu & pricing', icon: 'UtensilsCrossed', examples: 'Underpriced plates, stale recipe costs, weak mix', data: ['Toast', 'Recipe costs'], view: 'Contribution vs popularity, priced by elasticity', screen: 'menu' },
  { id: 'purchasing', area: 'Purchasing & vendors', icon: 'Truck', examples: 'Price creep, missed credits, emergency buys', data: ['Invoices'], view: 'Invoice change split into vendor price and your mix', screen: 'purchasing' },
  { id: 'inventory', area: 'Inventory, prep & waste', icon: 'Package', examples: 'Over-portioning, trim waste, spoilage, shrink', data: ['Toast', 'Invoices', 'Inventory counts', 'Waste log'], view: 'Theoretical vs actual usage', screen: 'inventory' },
  { id: 'bar', area: 'Bar & beverage', icon: 'Wine', examples: 'Over-pouring, untracked comps, high pour cost', data: ['Toast', 'Inventory counts'], view: 'Pour variance and bar comps vs limits', screen: 'inventory' },
  { id: 'kitchen', area: 'Kitchen flow & ticket times', icon: 'ChefHat', examples: 'Station bottlenecks, poor batching, remakes', data: ['Kitchen display', 'Toast'], view: 'Ticket time by hour and station vs target', screen: 'kitchen' },
  { id: 'foh', area: 'Tables & turns', icon: 'Armchair', examples: 'Empty tables while guests wait, slow resets and closeouts', data: ['Toast', 'Waitlist'], view: 'Share of time the room is full', screen: 'throughput' },
  { id: 'controls', area: 'Register controls', icon: 'ShieldCheck', examples: 'Voids after send, comps, discounts, overrides', data: ['Toast'], view: 'Per-person control limits', screen: 'controls' },
  { id: 'channels', area: 'Delivery & channels', icon: 'Bike', examples: 'Commission drag, refunds, delivery priced like dine-in', data: ['Toast', 'Delivery statements'], view: 'Contribution per $100 by channel', screen: 'channels' },
  { id: 'guests', area: 'Guest experience & retention', icon: 'Heart', examples: 'Order errors, repeat visits, reviews', data: ['Toast'], view: 'Comps and remakes on late tickets', screen: 'build', stage: 'none', note: 'Needs review and loyalty feeds (gap 20)', fig: 'Not built yet', claim: 'none' },
  { id: 'facilities', area: 'Facilities & compliance', icon: 'Wrench', examples: 'Equipment downtime, temperature logs, energy', data: [], view: '—', screen: 'build', stage: 'none', note: 'Risk more than recoverable margin; partner, don’t build', fig: 'Out of scope', claim: 'none' },
];

function areasFor(room, d) {
  const menuMoves = d.candidates.filter((c) => c.lever === 'Menu');
  const figs = {
    labour: d.banked.week > 0 ? [`${money(d.banked.week)}/wk banked`, 'book'] : ['$0 banked', 'none'],
    demand: room.service.mode === 'cut' ? [`${money(room.service.value)} tonight`, 'obs'] : room.service.mode === 'quiet' ? ['Nothing to do tonight', 'none'] : ['Watching tonight', 'none'],
    menu: [`${money(Math.round(menuMoves.reduce((s, c) => s + c.value, 0)))}/wk in ${menuMoves.length} moves`, 'mod'],
    purchasing: [`${money(Math.round(d.inv.priceLeg))} vendor rises, 28 days`, 'obs'],
    inventory: d.usage.kitchenWeek > 0 ? [`${money(Math.round(d.usage.kitchenWeek))}/wk past tolerance`, 'est'] : ['Inside tolerance', 'none'],
    bar: d.usage.barWeek > 0 ? [`${money(Math.round(d.usage.barWeek))}/wk past tolerance`, 'est'] : ['Inside tolerance', 'none'],
    kitchen: ['$0 claimable', 'none'],
    foh: ['$0 claimable', 'none'],
    controls: d.staff.signalCount ? [`${money(Math.round(d.staff.types.postVoid.excess + d.staff.types.comps.excess + d.staff.types.disc.excess))} over limit, 28 days`, 'obs'] : ['Everyone inside limits', 'none'],
    channels: [`${money(Math.round(d.chan.markupLo))} to ${money(Math.round(d.chan.markupHi))}/wk`, 'est'],
  };
  /* Sample notes describe the sample data; once inputs cover an area, its note is built from the figures. */
  const inp = d.inputs || {};
  const names = (cat) => listing(d.usage.flagged.filter((r) => r.cat === cat).map((r) => r.label.replace(/\s*\(.*\)$/, '').replace(/,.*$/, '').toLowerCase()));
  const live = {
    menu: (inp.recipes || room.menuReplaced) && [menuMoves.length ? 'act' : 'understand', menuMoves.length ? `${menuMoves.length} price move${menuMoves.length === 1 ? '' : 's'} ranked from your menu` : 'No price move clears the bar yet'],
    inventory: (inp.counts || inp.waste || room.menuReplaced) && (d.usage.kitchenWeek > 0 ? ['detect', `${names('Kitchen')} past tolerance; check portions and waste`] : ['understand', 'Counted kitchen items inside tolerance']),
    bar: (inp.counts || room.menuReplaced) && (d.usage.barWeek > 0 ? ['detect', `${names('Bar')} past tolerance`] : ['understand', 'Counted bar items inside tolerance']),
    controls: inp.exceptions && (d.staff.signalCount ? ['act', `${d.staff.signalCount} limit${d.staff.signalCount === 1 ? '' : 's'} crossed in 28 days`] : ['understand', 'Everyone inside their limits']),
  };
  return AREA_DEFS.map((a) => {
    if (a.stage) return a;
    const [stage, note] = live[a.id] || room.areas[a.id];
    const [fig, claim] = figs[a.id];
    return { ...a, stage, note: tmpl(note, { ceiling: money(room.throughput.ceiling) }), fig, claim };
  });
}

/* ------------------------------------------------------------------ narrative gates
   Room content is written for the sample data. A card or agenda line that
   names a condition carries `when`; once inputs clear that condition the line
   goes (or falls back to `alt`), so the story never contradicts the figures. */
export function whenOk(cond, d) {
  if (!cond) return true;
  const [k, arg] = cond.split(/:(.*)/s);
  switch (k) {
    case 'stale': return d.feeds.some((f) => f.name === arg && f.state !== 'healthy');
    case 'cand': return d.candidates.some((c) => c.id === arg && c.value > 0.5);
    case 'staff': return d.room.staff.some((s) => s.name === arg);
    case 'flagged': return d.usage.flagged.length > 0;
    case 'flag': return d.usage.flagged.some((r) => r.item === arg);
    case 'signal': return d.staff.types[arg === 'voids' ? 'postVoid' : arg].signals.length > 0;
    default: return true;
  }
}
function gate(list, d) {
  return (list || []).flatMap((x) => (whenOk(x.when, d) ? [x] : x.alt ? [{ ...x, body: x.alt, decision: undefined, when: undefined }] : []));
}
/** The agenda keeps a decision slot: if the written one no longer applies, the top-ranked open move takes it. */
function meetingFor(d) {
  const items = gate(d.room.meeting, d);
  if (!items.some((m) => m.k === 'One decision')) {
    const top = d.plan.sorted.find((c) => c.value > 0.5 && !c.prevent);
    if (top) {
      const at = Math.max(0, items.findIndex((m) => m.k.startsWith('Commit')));
      items.splice(at, 0, { k: 'One decision', mins: 5, icon: 'Gavel', body: `${top.title}? About ${money(Math.round(top.value))}/wk, ${Math.round(top.p * 100)}% chance it verifies.`, decision: ['Approve', 'Hold for two weeks', 'Not for us'] });
    }
  }
  return items;
}
const listing = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/* ------------------------------------------------------------------ one room, everything */
const ROOM_CACHE = new WeakMap();
export function deriveRoom(ds, roomId) {
  let byRoom = ROOM_CACHE.get(ds);
  if (!byRoom) { byRoom = new Map(); ROOM_CACHE.set(ds, byRoom); }
  if (!byRoom.has(roomId)) byRoom.set(roomId, deriveRoomUncached(ds, roomId));
  return byRoom.get(roomId);
}
function deriveRoomUncached(ds, roomId) {
  const room = ds.rooms[roomId];
  const inputs = ds.inputs?.[roomId] || {};
  const menuS = menuStats(room.menu);
  const invS = invoiceStats(room.invoices);
  const staffS = staffStats(room.staff);
  const week = weekStats(room, menuS, staffS);
  const usageS = usageStats(room);
  const chanS = channelStats(room.channels, week.foodRate);
  const hist = historyStats(room, week, ds.matchedWeeks);
  const allProof = proofList(ds);
  const proofs = allProof.filter((p) => p.loc === roomId);
  const banked = bankedStats(proofs);
  const own = !!(inputs.profile || inputs.exceptions || room.menuReplaced);
  const candidates = valueCandidates(room, { menuS, invS, staffS, usageS, chanS, own, inputs });
  const plan = choosePlan(candidates, room.managerHours);
  const exposure = candidates.filter((c) => !c.prevent).reduce((s, c) => s + c.value, 0);
  const salmon = menuS.menu.find((m) => m.key === 'salmon');
  const salmonCand = candidates.find((c) => c.kind === 'price' && c.item === 'salmon');
  const salmonMove = salmonCand?.move || null;
  const feeds = feedsFor(room, inputs, salmonMove ? Math.round(salmonMove.delta) : 0);
  const d = {
    id: roomId, room, profile: room.profile, inputs,
    menu: menuS, inv: invS, staff: staffS, week, usage: usageS, chan: chanS, hist,
    proofs, allProof, banked, candidates, plan, exposure, feeds,
    staleCount: feeds.filter((f) => f.state === 'stale').length,
    salmon, salmonMove,
    /* Own restaurant entered: profile, team or a replaced menu. */
    ownData: own,
    claimable: Math.max(0, Math.min(banked.week, hist.marginMove)),
  };
  d.unexplained = hist.marginMove - d.claimable;
  d.queue = gate(room.queue, d);
  d.alarms = gate(room.alarms, d);
  d.meeting = meetingFor(d);
  d.areas = areasFor(room, d);
  const chosen = plan.sorted.filter((c) => plan.chosen.has(c.id));
  d.tokens = {
    salmonWk: salmonMove ? `about ${money(Math.round(salmonMove.delta))}/wk` : 'no estimate',
    salmonLost: salmonMove ? Math.round(salmonMove.lost) : 0,
    banked: money(banked.week),
    room: room.profile.short,
    planCount: ['No', 'One', 'Two', 'Three', 'Four', 'Five'][chosen.length] || chosen.length,
    planList: chosen.map((c) => c.title.charAt(0).toLowerCase() + c.title.slice(1)).join('; '),
    ceiling: money(room.throughput.ceiling),
    markupRange: `${money(Math.round(chanS.markupLo))} to ${money(Math.round(chanS.markupHi))}/wk`,
    deliveryShare: pct(chanS.deliveryShare, 0),
    refunds: money(chanS.deliveryRefunds),
    compsExcess: money(Math.round(staffS.types.comps.excess)),
    bourbonGap: pct(usageS.rows.find((r) => r.item === 'Bourbon (oz)')?.pct || 0),
    wcmSlide: money(Math.max(0, hist.rows[38].wcm - hist.rows[51].wcm), { cents: true }),
    flaggedList: listing(usageS.flagged.map((r) => r.label.replace(/\s*\(.*\)$/, '').replace(/,.*$/, '').toLowerCase())),
    flaggedLead: usageS.flagged.length === 1 ? 'It is' : usageS.flagged.length === 2 ? 'Both are' : `All ${['', '', '', 'three', 'four', 'five', 'six'][usageS.flagged.length] || usageS.flagged.length} are`,
  };
  candidates.forEach((c) => { d.tokens[c.id] = `about ${money(Math.round(c.value))}/wk`; });
  return d;
}

/* ------------------------------------------------------------------ the group */
const GROUP_CACHE = new WeakMap();
export function deriveGroup(ds) {
  if (!GROUP_CACHE.has(ds)) GROUP_CACHE.set(ds, deriveGroupUncached(ds));
  return GROUP_CACHE.get(ds);
}
function deriveGroupUncached(ds) {
  const rooms = ROOM_IDS.map((id) => deriveRoom(ds, id));
  const row = (d) => {
    const testing = d.proofs.filter((p) => p.outcome === 'testing');
    return {
      id: d.id, name: d.profile.short, banked: d.banked.week, paused: d.banked.paused, earned: d.week.earned, net: d.week.net,
      alarms: d.alarms.length, tests: testing.length, stale: d.staleCount,
      note: d.alarms[0]?.title || (testing[0] ? `${testing[0].title}: ${testing[0].checkpoint || testing[0].held}` : d.banked.reversed[0] ? `${d.banked.reversed[0].title} reversed` : 'Quiet week'),
      d,
    };
  };
  const rows = rooms.map(row);
  const cmp = [
    { k: 'Labour, share of sales', better: 'low', v: rooms.map((d) => d.week.labourRate * 100), f: (x) => `${x.toFixed(1)}%` },
    { k: 'Margin per cover', better: 'high', v: rooms.map((d) => d.week.marginPerCover), f: (x) => `$${x.toFixed(2)}` },
    { k: 'Comps and voids, share of sales', better: 'low', v: rooms.map((d) => ((d.staff.types.comps.week + d.staff.types.postVoid.week) / d.week.net) * 100), f: (x) => `${x.toFixed(1)}%` },
    { k: 'Delivery, share of sales', better: 'neutral', v: rooms.map((d) => d.chan.deliveryShare * 100), f: (x) => `${x.toFixed(1)}%` },
    { k: 'Friday lunch ticket time', better: 'low', v: rooms.map((d) => d.room.tickets.friLunch), f: (x) => `${x} min` },
    { k: 'Seat-hours used', better: 'high', v: rooms.map((d) => d.room.throughput.seatUse), f: (x) => `${x}%` },
    { k: 'Usage past tolerance, per week', better: 'low', v: rooms.map((d) => d.usage.week), f: (x) => money(Math.round(x)) },
    { k: 'Banked per manager-hour', better: 'high', v: rooms.map((d) => d.room.bankedPerHour), f: (x) => `$${x}` },
  ];
  return {
    rooms, rows, cmp,
    banked: rows.reduce((s, r) => s + r.banked, 0),
    paused: rows.reduce((s, r) => s + r.paused, 0),
    earned: rows.reduce((s, r) => s + r.earned, 0),
    alarms: rows.reduce((s, r) => s + r.alarms, 0),
    stale: rows.reduce((s, r) => s + r.stale, 0),
    proofs: proofList(ds),
  };
}

/** Every finding id in the dataset (for static routes). */
export function allFindingIds(ds) {
  /* Own-dish price moves are created by inputs, so their routes always exist. */
  return [...new Set([...ROOM_IDS.flatMap((id) => deriveRoom(ds, id).candidates.map((c) => c.id)), ...OWN_PRICE_IDS])];
}
