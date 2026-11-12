// Dense sample detail: days, hours and dishes behind the sample's weekly
// history. Generated deterministically (seeded by room id), never typed, and
// always reconciled: a week's seven days add up exactly to that week's history
// row; a day's hours add up exactly to that day. The sample's weekly figures,
// and so every pinned headline, are unchanged.
//
// A room running on its own Toast data gets nothing from here: we never invent
// detail for a real restaurant.

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Share of a week's sales by weekday (Mon first). */
const DOW_SALES = [0.105, 0.11, 0.128, 0.142, 0.187, 0.198, 0.13];
/** Hours the room is open, and each hour's share of a day's covers (lunch and dinner peaks). */
const HOURS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const HOUR_WEEKDAY = [0.05, 0.1, 0.085, 0.035, 0.02, 0.04, 0.1, 0.165, 0.175, 0.125, 0.07, 0.035];
const HOUR_WEEKEND = [0.06, 0.11, 0.1, 0.06, 0.035, 0.04, 0.085, 0.145, 0.15, 0.12, 0.065, 0.03];
/** Daily rows kept for the hourly grid: the last 13 weeks. */
export const HOURLY_WEEKS = 13;
/** Prior-year growth assumed for the sample's year-before rows (per room). */
const PRIOR_GROWTH = { oakland: 0.052, berkeley: 0.031, walnut: 0.064 };

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Split `total` across weights, rounded to `step`, summing exactly to `total`. */
export function split(total, weights, step = 1) {
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const units = Math.round(total / step);
  const raw = weights.map((w) => (w / sum) * units);
  const out = raw.map(Math.floor);
  let left = units - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out.map((u) => Math.round(u * step * 100) / 100);
}

const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * @param {{ net: number, covers: number, food: number, labour: number, excPct: number, iso: string }} wk
 * @param {() => number} r
 * @param {{ k: string, sales: number }[]} channels
 * @param {boolean} prior
 */
function weekDays(wk, r, channels, prior) {
  const sw = DOW_SALES.map((w) => w * (0.9 + 0.2 * r()));
  const cw = sw.map((w, i) => w * (i >= 4 && i <= 5 ? 0.94 : 1) * (0.96 + 0.08 * r())); // weekend checks run higher
  const lw = sw.map((w) => 0.55 / 7 + 0.45 * w); // labour has a fixed floor every day
  const net = split(wk.net, sw, 0.01);
  const covers = split(wk.covers, cw, 1);
  const food = split(wk.food, net.map((n) => n * (0.97 + 0.06 * r())), 0.01);
  const labour = split(wk.labour, lw, 0.01);
  const chTot = channels.reduce((s, c) => s + c.sales, 0) || 1;
  return net.map((n, i) => {
    const exc = n * (wk.excPct / 100) * (0.8 + 0.4 * r());
    const ch = split(n, channels.map((c) => (c.sales / chTot) * (0.85 + 0.3 * r())), 0.01);
    const lunch = Math.round(n * (i >= 5 ? 0.36 : 0.3) * (0.9 + 0.2 * r()) * 100) / 100;
    return {
      iso: addDays(wk.iso, i), dow: DOW[i], week: wk.iso, prior,
      net: n, covers: covers[i], food: food[i], labour: labour[i],
      earned: Math.round((n - food[i] - labour[i]) * 100) / 100,
      check: covers[i] ? Math.round((n / covers[i]) * 100) / 100 : 0,
      voids: Math.round(exc * 0.38 * 100) / 100, comps: Math.round(exc * 0.34 * 100) / 100, discounts: Math.round(exc * 0.28 * 100) / 100,
      lunch, dinner: Math.round((n - lunch) * 100) / 100,
      channels: Object.fromEntries(channels.map((c, j) => [c.k, ch[j]])),
      turnMin: Math.round((58 + (i >= 4 && i <= 5 ? 9 : 0) + 8 * r()) * 10) / 10,
      ticketMin: Math.round((12.5 + (i >= 4 && i <= 5 ? 3.2 : 0) + 3 * r()) * 10) / 10,
    };
  });
}

function dayHours(day, r, seats) {
  const weekend = day.dow === 'Sat' || day.dow === 'Sun';
  const w = (weekend ? HOUR_WEEKEND : HOUR_WEEKDAY).map((x) => x * (0.85 + 0.3 * r()));
  const covers = split(day.covers, w, 1);
  const sales = split(day.net, covers.map((c, i) => c * (HOURS[i] >= 17 ? 1.25 : 0.8) * (0.9 + 0.2 * r()) + 0.01), 0.01);
  return HOURS.map((h, i) => ({
    iso: day.iso, dow: day.dow, hour: h, covers: covers[i], sales: sales[i],
    servers: Math.max(2, Math.ceil(covers[i] / 14)),
    tickets: Math.round(covers[i] / 2.4),
    ticketMin: Math.round((10 + 9 * Math.min(1, covers[i] / (seats * 0.7)) + 2 * r()) * 10) / 10,
    seatUse: Math.min(100, Math.round((covers[i] * 1.05 / seats) * 100)),
  }));
}

const CACHE = new WeakMap();

/**
 * Days (two years: the sample's 52 weeks plus a prior year), hours (last 13
 * weeks) and dish units by week for one sample room. Null for own data.
 * @param {any} room
 */
export function densify(room) {
  if (!room?.history?.length || room.fromToast) return null;
  if (CACHE.has(room)) return CACHE.get(room);
  const id = room.profile?.id ?? 'room';
  const r = rng(hash(id));
  const g = PRIOR_GROWTH[id] ?? 0.04;
  const channels = (room.channels || []).filter((c) => c.sales > 0);
  // Prior year: each week 52 weeks earlier, smaller by the room's growth, with its own noise.
  const prior = room.history.map((w) => {
    const f = (1 / (1 + g)) * (0.96 + 0.08 * r());
    return { iso: addDays(w.iso, -364), net: Math.round(w.net * f), covers: Math.round(w.covers * f * 1.01), food: Math.round(w.food * f * 1.01), labour: Math.round(w.labour * (0.98 + 0.03 * r()) / (1 + g * 0.6)), excPct: w.excPct * (0.95 + 0.15 * r()) };
  });
  const days = [...prior.map((w) => weekDays(w, r, channels, true)), ...room.history.map((w) => weekDays(w, r, channels, false))].flat();
  const seats = room.profile?.seats ?? 80;
  const hours = days.slice(-HOURLY_WEEKS * 7).flatMap((d) => dayHours(d, r, seats));
  // Dish units by week: last week's units, scaled by each week's covers, with noise.
  const lastCovers = room.history.at(-1).covers || 1;
  const items = (room.menu || []).map((m) => ({
    key: m.key, name: m.name, cat: m.cat, price: m.price,
    units: room.history.map((w) => Math.max(0, Math.round((m.units * w.covers) / lastCovers * (0.85 + 0.3 * r())))),
  }));
  const out = { days, hours, items, weeks: room.history.map((w) => w.iso), priorGrowth: g };
  CACHE.set(room, out);
  return out;
}

/** Sum days into calendar months. */
export function byMonth(days) {
  const m = new Map();
  for (const d of days) {
    const k = d.iso.slice(0, 7);
    const x = m.get(k) ?? { month: k, days: 0, net: 0, covers: 0, food: 0, labour: 0, earned: 0, voids: 0, comps: 0, discounts: 0, prior: d.prior };
    x.days++; x.net += d.net; x.covers += d.covers; x.food += d.food; x.labour += d.labour; x.earned += d.earned;
    x.voids += d.voids; x.comps += d.comps; x.discounts += d.discounts;
    m.set(k, x);
  }
  return [...m.values()];
}

/** Average covers by weekday × hour over the hourly window. */
export function heat(hours) {
  const cell = {};
  for (const h of hours) {
    const k = `${h.dow}|${h.hour}`;
    (cell[k] ??= { n: 0, covers: 0, ticketMin: 0, seatUse: 0, servers: 0, sales: 0 });
    cell[k].n++; cell[k].covers += h.covers; cell[k].ticketMin += h.ticketMin; cell[k].seatUse += h.seatUse; cell[k].servers += h.servers; cell[k].sales += h.sales;
  }
  return DOW.map((d) => ({ dow: d, cells: HOURS.map((hr) => {
    const c = cell[`${d}|${hr}`];
    return { hour: hr, covers: c ? c.covers / c.n : 0, sales: c ? c.sales / c.n : 0, ticketMin: c ? c.ticketMin / c.n : 0, seatUse: c ? c.seatUse / c.n : 0, cps: c && c.servers ? c.covers / c.servers : 0 };
  }) }));
}

/** Count every number in a dense set (for "how much data is behind this"). */
export function pointCount(dense) {
  if (!dense) return 0;
  let n = 0;
  const walk = (v) => { if (typeof v === 'number') n++; else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x); };
  walk(dense.days); walk(dense.hours); walk(dense.items);
  return n;
}

export { DOW, HOURS };
