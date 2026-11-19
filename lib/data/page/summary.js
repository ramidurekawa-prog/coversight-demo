// Lever Check, as data. Pure: one surface-level read of every money lever in a
// room, with the good, the bad and the one thing that matters most. It replaces
// the Coverage map. Every figure comes from deriveRoom() (lib/data/model.js),
// the This week comparators (so "a normal week" means the same thing on both
// pages) or the room's own test windows. Nothing here is typed in.
//
// Status, matched to real urgency and impact (Ramidu, 2026-11-16):
//   good   green: on track, not worse than a normal week, no limit crossed
//   watch  amber: drifting, a cost creeping past WATCH_SHARE of sales, or the data is delayed
//   bad    red:   worse than a normal week, or a limit was crossed, with dollars on it
//   nodata grey:  the data this lever reads isn't in yet; never shown as zero

import { coverageOf, TEST_LEVER } from '../coverage.js';
import { money, SUBSCRIPTION } from '../model.js';
import { awaitingData, bankedFromWindows, blockedReason, comparators, defaultComparator, weekOf } from './week.js';

export const STATUS = {
  good: { label: 'On track', tone: 'good', icon: 'CircleCheck' },
  watch: { label: 'Watch', tone: 'warn', icon: 'TriangleAlert' },
  bad: { label: 'Needs you', tone: 'bad', icon: 'CircleAlert' },
  nodata: { label: 'No data yet', tone: 'neutral', icon: 'Unplug' },
};
export const STATUS_ORDER = ['bad', 'watch', 'good', 'nodata'];

/** The levers, in sidebar order. area: the coverage rule that says which feeds it needs. */
export const LEVERS = [
  { id: 'labour', name: 'Labor', icon: 'Users', go: 'labour', lever: 'Labour', area: 'labour' },
  { id: 'menu', name: 'Menu & pricing', icon: 'UtensilsCrossed', go: 'menu', lever: 'Menu', area: 'menu' },
  { id: 'purchasing', name: 'Purchasing', icon: 'Truck', go: 'purchasing', lever: 'Purchasing', area: 'purchasing' },
  { id: 'inventory', name: 'Inventory & waste', icon: 'Package', go: 'inventory', lever: 'Inventory', area: 'inventory' },
  { id: 'kitchen', name: 'Kitchen', icon: 'ChefHat', go: 'kitchen', lever: 'Kitchen', area: 'kitchen' },
  { id: 'throughput', name: 'Tables & turns', icon: 'Armchair', go: 'throughput', lever: 'Throughput', area: 'foh' },
  { id: 'controls', name: 'Comps & voids', icon: 'ShieldCheck', go: 'controls', lever: 'Controls', area: 'controls' },
  { id: 'channels', name: 'Delivery', icon: 'Bike', go: 'channels', lever: 'Channels', area: 'channels' },
];

/** Points a food or labor rate may drift above a normal week before it turns red. */
export const RATE_LIMIT = 0.01;
/** A weekly cost as a share of weekly sales: amber past WATCH_SHARE, red past RED_SHARE when no fix is ready. */
export const WATCH_SHARE = 0.005;
export const RED_SHARE = 0.02;
const round = (n) => Math.round(n);
const pts = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} pts`;
const pc = (n, dp = 1) => `${(n * 100).toFixed(dp)}%`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const listing = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cleanLabel = (l) => l.replace(/\s*\(.*\)$/, '').replace(/,.*$/, '').toLowerCase();

/**
 * What verified changes bank a week, per plan lever. A real group counts only
 * its own verified test windows; the sample counts its verification packets.
 */
export function bankedByLever(d, windows = null) {
  const out = {};
  if (Array.isArray(windows)) {
    for (const w of windows) {
      if (w.roomId !== d.id || w.status !== 'verified') continue;
      const lever = TEST_LEVER[w.lever];
      if (lever) out[lever] = (out[lever] || 0) + (w.bookedCents || 0) / 100;
    }
    return out;
  }
  for (const p of d.proofs) {
    if ((p.outcome === 'verified' || p.outcome === 'limited') && !p.paused) out[p.lever] = (out[p.lever] || 0) + p.bookable;
  }
  return out;
}

/** Changes that would help this lever and can be done now, best first. */
function readyMoves(d, lever) {
  return d.candidates
    .filter((c) => c.lever === lever && c.value > 0.5 && !c.prevent && !blockedReason(c, d))
    .sort((a, b) => b.value - a.value);
}
const moveOf = (c) => (c ? { id: c.id, title: c.title, value: c.value, lo: c.lo, hi: c.hi, claim: c.claim } : null);

/* ------------------------------------------------------------------ the week's vitals */
/**
 * Sales, food cost, labor and what the room kept, this week against a normal
 * week (the This week page's default comparator), or null with no baseline.
 */
export function vitalsOf(d, { matchedWeeks = [], real = false } = {}) {
  const rows = d.hist.rows;
  const cur = rows[rows.length - 1];
  const base = defaultComparator(comparators(rows, { matchedWeeks, real }));
  if (!cur || !base) return null;
  const b = base.row;
  const rate = (r, k) => (r.net ? r[k] / r.net : 0);
  const food = { now: rate(cur, 'food'), then: rate(b, 'food') };
  const labour = { now: rate(cur, 'labour'), then: rate(b, 'labour') };
  const rateStatus = (x) => (x.now - x.then > RATE_LIMIT ? 'bad' : x.now - x.then > 0.0025 ? 'watch' : 'good');
  const salesChange = cur.net - b.net;
  return {
    comparator: base.label, period: weekOf(rows)?.label ?? cur.label,
    sales: { now: cur.net, then: b.net, change: salesChange, pct: b.net ? salesChange / b.net : 0, status: salesChange / (b.net || 1) < -0.03 ? 'bad' : salesChange < 0 ? 'watch' : 'good' },
    food: { ...food, change: food.now - food.then, status: rateStatus(food) },
    labour: { ...labour, change: labour.now - labour.then, status: rateStatus(labour) },
    kept: { now: cur.earned, then: b.earned, change: cur.earned - b.earned, status: cur.earned >= b.earned ? 'good' : cur.earned < b.earned * 0.97 ? 'bad' : 'watch' },
  };
}

/* ------------------------------------------------------------------ one lever each */
/**
 * Each lever returns: status, big (value, unit, claim, period), good and bad
 * (one short line each, or null), facts behind the click, and the best fix.
 */
function leverRead(id, d, ctx) {
  const { vitals, banked } = ctx;
  const feed = (n) => d.feeds.find((f) => f.name === n);
  const late = (n) => { const f = feed(n); return f && f.state !== 'healthy' && f.state !== 'off'; };
  switch (id) {
    case 'labour': {
      const lab = vitals?.labour;
      const wk = banked.Labour || 0;
      const moves = readyMoves(d, 'Labour');
      const ot = d.candidates.filter((c) => c.lever === 'Labour' && c.prevent && c.value > 0.5);
      const stale = late('7shifts');
      const status = lab?.status === 'bad' ? 'bad' : stale || lab?.status === 'watch' ? 'watch' : 'good';
      return {
        status,
        big: lab ? { value: pc(lab.now), label: 'of sales to labor', claim: 'obs' } : { value: money(round(d.week.labour)), label: 'labor this week', claim: 'obs' },
        delta: lab ? { text: `${pts(lab.change)} vs ${vitals.comparator.toLowerCase()}`, good: lab.change <= 0 } : null,
        good: wk > 0 ? { text: `${money(round(wk))}/wk banked from verified changes`, claim: 'book' }
          : lab && lab.change <= 0 ? { text: 'Labor is at or under a normal week', claim: 'obs' }
          : d.week.labour > 0 ? { text: `Every $1 of labor brought in ${money(d.week.net / d.week.labour, { cents: true })} of sales`, claim: 'obs' } : null,
        bad: stale ? { text: `7shifts last synced ${feed('7shifts').last}, so labor checks are paused`, claim: 'none' }
          : ot.length ? { text: `${plural(ot.length, 'person', 'people')} heading into overtime`, claim: 'obs' }
          : moves[0] ? { text: `${moves[0].title}`, claim: moves[0].claim } : null,
        facts: [
          ['Labor this week', money(round(d.week.labour)), 'obs'],
          lab && [`Labor share, ${vitals.comparator.toLowerCase()}`, pc(lab.then), 'obs'],
          ['Banked a week', money(round(wk)), wk ? 'book' : 'none'],
          ot[0] && ['Overtime to head off', `${money(round(ot.reduce((s, c) => s + c.value, 0)))} this week`, 'obs'],
        ],
        fix: moveOf(moves[0]),
      };
    }
    case 'menu': {
      const moves = readyMoves(d, 'Menu');
      const blocked = d.candidates.filter((c) => c.lever === 'Menu' && c.value > 0.5 && blockedReason(c, d));
      const dishes = d.menu.menu.filter((m) => m.units > 0);
      const best = [...dishes].sort((a, b) => b.cm * b.units - a.cm * a.units)[0];
      const high = dishes.filter((m) => m.cost / m.price > 0.4).sort((a, b) => b.cost / b.price - a.cost / a.price);
      const sum = moves.reduce((s, c) => s + c.value, 0);
      const fr = vitals?.food;
      const status = fr?.status === 'bad' ? 'bad' : blocked.length || fr?.status === 'watch' ? 'watch' : 'good';
      return {
        status,
        big: moves.length ? { value: `${money(round(sum))}/wk`, label: `if ${plural(moves.length, 'price move')} work`, claim: 'mod' }
          : { value: money(d.menu.cmWeighted, { cents: true }), label: 'kept per plate after food cost', claim: 'obs' },
        delta: null,
        good: best ? { text: `${best.name} is your best earner: ${money(round(best.cm * best.units))} a week after food cost`, claim: 'obs' } : null,
        bad: blocked.length ? { text: `${plural(blocked.length, 'price move')} wait${blocked.length === 1 ? 's' : ''} on current recipe costs`, claim: 'none' }
          : high[0] ? { text: `${high[0].name} costs ${pc(high[0].cost / high[0].price, 0)} of its price in food`, claim: 'obs' } : null,
        facts: [
          ['Kept per plate, after food cost', money(d.menu.cmWeighted, { cents: true }), 'obs'],
          fr && ['Food cost share this week', pc(fr.now), 'obs'],
          ['Dishes over 40% food cost', String(high.length), 'obs'],
          ...moves.slice(0, 3).map((c) => [c.title, `${money(round(c.value))}/wk`, c.claim]),
        ],
        fix: moveOf(moves[0]),
      };
    }
    case 'purchasing': {
      const moves = readyMoves(d, 'Purchasing');
      const rises = d.inv.priceLeg;
      const top = d.inv.byVendor[0];
      const held = d.inv.invoices.filter((r) => r.p1 <= r.p0).length;
      const weekly = rises / 4;
      const share = weekly / (d.week.net || 1);
      const status = share > RED_SHARE && !moves.length ? 'bad' : share > WATCH_SHARE ? 'watch' : 'good';
      return {
        status,
        big: { value: money(round(Math.max(0, rises))), label: 'vendor price rises, 28 days', claim: 'obs' },
        delta: null,
        good: held ? { text: `${held} of ${d.inv.invoices.length} items held or dropped in price`, claim: 'obs' } : null,
        bad: top && top.leg > 0 ? { text: `${top.vendor} raised prices: ${money(round(top.leg))} in 28 days`, claim: 'obs' } : null,
        facts: [
          ...d.inv.byVendor.filter((v) => v.leg > 0).slice(0, 3).map((v) => [v.vendor, `${money(round(v.leg), { sign: true })} in 28 days`, 'obs']),
          ['From buying more or less (your mix)', `${money(round(d.inv.mixLeg), { sign: true })} in 28 days`, 'obs'],
        ],
        fix: moveOf(moves[0]),
      };
    }
    case 'inventory': {
      const moves = readyMoves(d, 'Inventory');
      const u = d.usage;
      const partial = late('Inventory counts');
      const wasteOff = feed('Waste log')?.state === 'off';
      const share = u.week / (d.week.net || 1);
      const status = share > RED_SHARE && !partial ? 'bad' : share > WATCH_SHARE / 2 ? 'watch' : 'good';
      return {
        status,
        big: u.week > 0 ? { value: `${money(round(u.week))}/wk`, label: 'used past recipe, a week', claim: 'est' } : { value: 'On target', label: 'every counted item inside tolerance', claim: 'obs' },
        delta: null,
        good: u.rows.length ? { text: `${u.rows.length - u.flagged.length} of ${u.rows.length} counted items on target`, claim: 'obs' } : null,
        bad: u.flagged.length ? { text: `${listing(u.flagged.map((r) => cleanLabel(r.label)))} ${u.flagged.length === 1 ? 'is' : 'are'} over`, claim: 'est' } : null,
        facts: [
          ['Kitchen items over', `${money(round(u.kitchenWeek))}/wk`, 'est'],
          ['Bar items over', `${money(round(u.barWeek))}/wk`, 'est'],
          ['Counts', partial ? `${feed('Inventory counts').last}, about ±3%` : feed('Inventory counts')?.last ?? '—', 'obs'],
          wasteOff && ['Waste log', 'Not started, so no gap is explained yet', 'none'],
        ],
        fix: moveOf(moves[0]),
      };
    }
    case 'kitchen': {
      const t = d.room.tickets;
      const hours = [...t.fri, ...t.sat].filter((v) => v != null);
      const onTime = hours.filter((v) => v <= t.target).length;
      const peak = Math.max(...t.sat.filter((v) => v != null));
      const kds = feed('Kitchen display');
      const stale = kds && kds.state === 'stale';
      // A slow line costs money only when it costs a table: no dollars here, so never red.
      const status = stale || peak > t.target + 3 ? 'watch' : 'good';
      const [station, share] = t.stations[0] || [];
      return {
        status,
        big: { value: `${peak.toFixed(1)} min`, label: `peak Saturday ticket, aim ${t.target}`, claim: 'obs' },
        delta: null,
        good: { text: `${onTime} of ${hours.length} Friday and Saturday dinner hours on target`, claim: 'obs' },
        bad: stale ? { text: `Kitchen display last exported ${kds.last}, so these are old`, claim: 'none' }
          : station && onTime < hours.length ? { text: `${station} holds ${share}% of late tickets`, claim: 'obs' } : null,
        facts: t.stations.slice(0, 3).map(([s, v]) => [`${s}: share of late tickets`, `${v}%`, 'obs']),
        fix: null,
        note: 'A slow kitchen only costs money when it costs a table, so no dollars are claimed here.',
      };
    }
    case 'throughput': {
      const T = d.room.throughput;
      const share = T.total ? T.intervals / T.total : 0;
      const wl = feed('Waitlist');
      const status = share > 0.03 ? 'watch' : 'good';
      return {
        status,
        big: { value: String(T.intervals), label: `of ${T.total} dinner slots full`, claim: 'obs' },
        delta: null,
        good: share <= 0.03 ? { text: `Tables were free ${pc(1 - share, 0)} of the time, so turns aren’t costing covers`, claim: 'obs' } : { text: `${T.seatUse}% of seat-hours used`, claim: 'obs' },
        bad: wl?.state !== 'healthy' ? { text: wl?.state === 'off' ? 'No waitlist connected, so walk-outs can’t be counted' : 'Waitlist only partly in, so walk-outs are undercounted', claim: 'none' } : null,
        facts: [
          ['Seat-hours used', `${T.seatUse}%`, 'obs'],
          ['Busiest vs quietest service', `${T.bestWorst}×`, 'obs'],
          ['Most a faster turn could add', `${money(T.ceiling)}/mo`, 'est'],
        ],
        fix: null,
      };
    }
    case 'controls': {
      const moves = readyMoves(d, 'Controls');
      const s = d.staff;
      const over = round(s.types.postVoid.excess + s.types.comps.excess + s.types.disc.excess);
      const people = new Set(['postVoid', 'comps', 'disc'].flatMap((k) => s.types[k].signals.map((p) => p.name))).size;
      const paused = d.proofs.filter((p) => p.lever === 'Controls' && p.paused);
      const status = s.signalCount ? 'bad' : paused.length ? 'watch' : 'good';
      return {
        status,
        big: s.signalCount ? { value: money(over), label: 'over limit, 28 days', claim: 'obs' } : { value: 'Inside limits', label: 'everyone, last 28 days', claim: 'obs' },
        delta: null,
        good: { text: `Comps, voids and discounts: ${pc(s.weekTotal / (d.week.net || 1))} of sales`, claim: 'obs' },
        bad: s.signalCount ? { text: `${plural(people, 'person', 'people')} over their limit`, claim: 'obs' }
          : paused.length ? { text: `A verified fix is paused: ${lower1(paused[0].title)}`, claim: 'none' } : null,
        facts: [
          ['Post-send voids, a week', money(round(s.types.postVoid.week)), 'obs'],
          ['Comps, a week', money(round(s.types.comps.week)), 'obs'],
          ['Discounts, a week', money(round(s.types.disc.week)), 'obs'],
        ],
        fix: moveOf(moves[0]),
      };
    }
    case 'channels': {
      const moves = d.candidates.filter((c) => c.lever === 'Channels' && c.hi > 0.5 && !c.prevent && !blockedReason(c, d));
      const c = d.chan;
      const dine = c.channels.find((x) => x.k === 'dine');
      const del = c.delivery;
      const delSales = del.reduce((s, x) => s + x.sales, 0);
      const delPer100 = delSales ? (del.reduce((s, x) => s + x.contrib, 0) / delSales) * 100 : 0;
      const gap = dine ? dine.per100 - delPer100 : 0;
      const status = delSales && gap > 20 && c.deliveryShare > 0.1 ? 'watch' : 'good';
      return {
        status,
        big: delSales ? { value: money(round(delPer100)), label: 'kept per $100 of delivery', claim: 'obs' } : { value: '$0', label: 'delivery sales this week', claim: 'obs' },
        delta: null,
        good: dine ? { text: `Dine-in keeps ${money(round(dine.per100))} of every $100`, claim: 'obs' } : null,
        bad: delSales ? { text: `Delivery is ${pc(c.deliveryShare, 0)} of sales and refunds cost ${money(round(c.deliveryRefunds))} this week`, claim: 'obs' } : null,
        facts: c.channels.map((x) => [`${x.name}: kept per $100`, money(round(x.per100)), 'obs']),
        fix: moves[0] ? { ...moveOf(moves[0]), range: true } : null,
      };
    }
    default: return null;
  }
}


/* ------------------------------------------------------------------ the hub's extras */
/** Weeks shown in each lever's trend line. */
export const TREND_WEEKS = 12;
const WINDOW_DAYS = 28;

/**
 * The weekly series behind a lever's headline, oldest first, from the room's
 * history (a real group's own weeks only). null when the lever has no weekly series.
 */
export function trendOf(id, d, { real = false } = {}) {
  const rows = d.hist.rows.filter((r) => !real || r.own).slice(-TREND_WEEKS);
  if (rows.length < 4) return null;
  const pick = {
    sales: (r) => r.net,
    kept: (r) => r.earned,
    labour: (r) => (r.net ? r.labour / r.net : null),
    menu: (r) => (r.net ? r.food / r.net : null),
    controls: (r) => (r.excPct != null ? r.excPct / 100 : null),
  }[id];
  if (!pick) return null;
  const values = rows.map(pick);
  if (values.some((v) => v == null || !Number.isFinite(v))) return null;
  return { values, weeks: rows.map((r) => r.label), lowerIsBetter: id !== 'sales' && id !== 'kept' };
}

/** How each lever compares across rooms: [value, higher is better]. */
const RANK = {
  labour: (d) => [d.week.labourRate, false],
  menu: (d) => [d.week.foodRate, false],
  purchasing: (d) => [d.inv.priceLeg / 4 / (d.week.net || 1), false],
  inventory: (d) => [d.usage.week / (d.week.net || 1), false],
  kitchen: (d) => [Math.max(...d.room.tickets.sat.filter((v) => v != null)), false],
  controls: (d) => [d.staff.weekTotal / (d.week.net || 1), false],
  channels: (d) => {
    const del = d.chan.delivery;
    const sales = del.reduce((s, x) => s + x.sales, 0);
    return [sales ? del.reduce((s, x) => s + x.contrib, 0) / sales : null, true];
  },
};
const ORD = ['', '1st', '2nd', '3rd'];
const RANK_WHAT = { labour: 'labor share', menu: 'food cost', purchasing: 'vendor prices', inventory: 'usage', kitchen: 'ticket times', controls: 'comps and voids', channels: 'delivery margin' };
/** Where this room ranks on a lever among the group's rooms that have their data in. */
export function rankOf(id, d, group = []) {
  const f = RANK[id];
  const rooms = group.filter((g) => !awaitingData(g.room));
  if (!f || rooms.length < 2 || !rooms.some((g) => g.id === d.id)) return null;
  const vals = rooms.map((g) => ({ id: g.id, v: f(g)[0] })).filter((x) => x.v != null && Number.isFinite(x.v));
  const [mine, higher] = f(d);
  if (mine == null || vals.length < 2) return null;
  const rank = 1 + vals.filter((x) => x.id !== d.id && (higher ? x.v > mine : x.v < mine)).length;
  const n = vals.length;
  const what = RANK_WHAT[id];
  const text = rank === 1 ? `Best ${what} of your ${n} rooms` : rank === n ? `Behind your other ${n - 1} rooms on ${what}` : `${ORD[rank] || `${rank}th`} of your ${n} rooms on ${what}`;
  return { rank, of: n, text, tone: rank === 1 ? 'good' : rank === n ? 'bad' : 'neutral' };
}

/**
 * What Coversight is doing on a lever right now: a test running, a change
 * verified and banking, or one held. A real group reads its own test windows.
 */
export function handledOf(L, d, windows = null) {
  if (Array.isArray(windows)) {
    const mine = windows.filter((w) => w.roomId === d.id && TEST_LEVER[w.lever] === L.lever);
    const run = mine.find((w) => w.status === 'running' || w.status === 'waiting');
    if (run) return { kind: 'testing', text: run.title, sub: `Day ${run.day ?? 0} of ${WINDOW_DAYS}`, progress: Math.min(100, Math.round(((run.day ?? 0) / WINDOW_DAYS) * 100)) };
    const ok = mine.find((w) => w.status === 'verified');
    if (ok) return { kind: 'verified', text: ok.title, sub: `${money(Math.round((ok.bookedCents || 0) / 100))}/wk banked`, claim: 'book' };
    return null;
  }
  const ps = d.proofs.filter((p) => p.lever === L.lever);
  const run = ps.find((p) => p.outcome === 'testing');
  if (run) return { kind: 'testing', text: run.title, sub: run.closes ? `Result by ${run.closes}` : run.held, progress: run.progress ?? null };
  const ok = ps.find((p) => (p.outcome === 'verified' || p.outcome === 'limited') && !p.paused);
  if (ok) return { kind: 'verified', text: ok.title, sub: `${money(ok.bookable)}/wk banked, holding ${ok.held}`, claim: 'book' };
  const held = ps.find((p) => p.paused || p.outcome === 'data');
  if (held) return { kind: 'held', text: held.title, sub: held.paused ? 'Paused until it is back inside its limit' : 'On hold until its data is current' };
  return null;
}

const CLAIM_RANK = ['est', 'mod', 'cau', 'obs', 'book'];
/** The proof band: what's banked, what this week's plan is worth, and payback on the fee. */
export function outcomeOf(d, { windows = null, waiting = false } = {}) {
  const real = Array.isArray(windows);
  const bw = real ? bankedFromWindows(windows, d.id) : null;
  const week = real ? bw.week : d.banked.week;
  const toDate = real ? bw.toDate : d.banked.toDate;
  const plan = waiting ? [] : d.plan.sorted.filter((c) => d.plan.chosen.has(c.id) && c.value > 0.5 && !c.prevent && !blockedReason(c, d));
  const weakest = plan.reduce((w, c) => (CLAIM_RANK.indexOf(c.claim) < CLAIM_RANK.indexOf(w) ? c.claim : w), 'book');
  const tests = real ? windows.filter((w) => w.roomId === d.id && (w.status === 'running' || w.status === 'waiting')).length : d.proofs.filter((p) => p.outcome === 'testing').length;
  return {
    week, toDate, tests,
    /* Payback is the sample's September package; a real group's shows once a month closes on the Accountant page. */
    payback: !real && d.banked.sept > 0 ? { times: d.banked.sept / SUBSCRIPTION, month: 'September', fee: SUBSCRIPTION } : null,
    plan: plan.length ? { value: plan.reduce((s, c) => s + c.value, 0), count: plan.length, hours: plan.reduce((s, c) => s + c.hours, 0), claim: weakest } : null,
  };
}

/**
 * Everything Lever Check shows for one room.
 * @param {any} d deriveRoom(ds, roomId)
 * @param {{ windows?: any[] | null, matchedWeeks?: number[], group?: any[] }} [opts]
 *   windows: a real group's test windows (null for the sample's packets).
 *   group: every room of the group, derived (for the rank on each lever).
 */
export function leverSummary(d, { windows = null, matchedWeeks = [], group = [] } = {}) {
  const real = Array.isArray(windows);
  const waiting = awaitingData(d.room);
  const vitals = waiting ? null : vitalsOf(d, { matchedWeeks, real });
  const banked = bankedByLever(d, windows);
  const areas = Object.fromEntries(coverageOf(d).map((a) => [a.id, a]));
  const levers = LEVERS.map((L) => {
    const area = areas[L.area];
    const missing = waiting ? ['your sales'] : area?.missing ?? [];
    if (missing.length) {
      return {
        ...L, status: 'nodata', big: null, delta: null, good: null, bad: null, facts: [], fix: null,
        missing, next: { label: `Bring in ${missing[0]}`, go: missing[0] === 'Toast' ? 'connect' : 'inputs' },
      };
    }
    return { ...L, ...leverRead(L.id, d, { vitals, banked }), missing: [], trend: trendOf(L.id, d, { real }), rank: rankOf(L.id, d, group), handled: handledOf(L, d, windows) };
  });
  const count = Object.fromEntries(Object.keys(STATUS).map((k) => [k, levers.filter((l) => l.status === k).length]));
  const bankedWeek = Object.values(banked).reduce((s, v) => s + v, 0);

  /* The one thing that matters most: the best ready move by value per manager-hour (The plan's order). */
  const first = waiting ? null : d.plan.sorted.find((c) => c.value > 0.5 && !c.prevent && !blockedReason(c, d) && c.claim !== 'est');
  const firstLever = first && LEVERS.find((l) => l.lever === first.lever);
  const worst = levers.filter((l) => l.status === 'bad');
  const top = first
    ? { kind: 'move', title: first.title, value: first.value, claim: first.claim, lever: firstLever?.name ?? first.lever, go: firstLever?.go ?? 'plan', hours: first.hours }
    : worst[0] && !waiting ? { kind: 'fix', title: worst[0].bad?.text ?? worst[0].name, lever: worst[0].name, go: worst[0].go } : null;

  const n = levers.length;
  const headline = waiting
    ? 'Your levers light up as soon as your first week of sales comes in.'
    : `${count.good} of ${n} levers on track.${count.bad ? ` ${count.bad === 1 ? 'One needs' : `${count.bad} need`} you now.` : ' Nothing urgent.'}`;

  const trends = waiting ? {} : { sales: trendOf('sales', d, { real }), kept: trendOf('kept', d, { real }) };
  const outcome = outcomeOf(d, { windows, waiting });
  const handled = levers.filter((l) => l.handled).length;
  return { vitals, levers, count, top, banked: bankedWeek, headline, waiting, period: vitals?.period ?? null, trends, outcome, handled };
}
