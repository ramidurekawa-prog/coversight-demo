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
  good: { label: 'Good', tone: 'good', icon: 'CircleCheck' },
  watch: { label: 'Watch', tone: 'warn', icon: 'TriangleAlert' },
  bad: { label: 'Fix now', tone: 'bad', icon: 'CircleAlert' },
  nodata: { label: 'No data yet', tone: 'neutral', icon: 'Unplug' },
};
export const STATUS_ORDER = ['bad', 'watch', 'good', 'nodata'];

/**
 * Every part of running the restaurant, in three groups: bringing guests in,
 * running the shift, and what food and drink cost. area: the coverage rule
 * that says which feeds a lever needs (none for sales: it reads the POS).
 */
export const GROUPS = [
  { id: 'guests', name: 'Guests & sales', about: 'Who comes in and what they spend' },
  { id: 'shift', name: 'Your team & the shift', about: 'Staff, the kitchen and the register' },
  { id: 'costs', name: 'Food & drink costs', about: 'What you buy, charge and use' },
];
export const LEVERS = [
  { id: 'sales', group: 'guests', name: 'Sales & guests', about: 'How many guests came and what they spent', icon: 'TrendingUp', go: 'week', lever: 'Sales', area: null },
  { id: 'throughput', group: 'guests', name: 'Tables', about: 'Whether you run out of seats', icon: 'Armchair', go: 'throughput', lever: 'Throughput', area: 'foh' },
  { id: 'channels', group: 'guests', name: 'Delivery', about: 'What delivery apps leave you', icon: 'Bike', go: 'channels', lever: 'Channels', area: 'channels' },
  { id: 'labour', group: 'shift', name: 'Labor', about: 'What you pay your team', icon: 'Users', go: 'labour', lever: 'Labour', area: 'labour' },
  { id: 'kitchen', group: 'shift', name: 'Kitchen speed', about: 'How fast food gets to guests', icon: 'ChefHat', go: 'kitchen', lever: 'Kitchen', area: 'kitchen' },
  { id: 'controls', group: 'shift', name: 'Giveaways', about: 'Free food, discounts and cancelled orders', icon: 'ShieldCheck', go: 'controls', lever: 'Controls', area: 'controls' },
  { id: 'menu', group: 'costs', name: 'Menu prices', about: 'What you charge for each dish', icon: 'UtensilsCrossed', go: 'menu', lever: 'Menu', area: 'menu' },
  { id: 'purchasing', group: 'costs', name: 'Supplier prices', about: 'What you pay for food and drink', icon: 'Truck', go: 'purchasing', lever: 'Purchasing', area: 'purchasing' },
  { id: 'inventory', group: 'costs', name: 'Food used', about: 'Kitchen food used but not sold', icon: 'Package', go: 'inventory', lever: 'Inventory', area: 'inventory' },
  { id: 'bar', group: 'costs', name: 'Bar & drinks', about: 'Drinks poured but not sold', icon: 'Wine', go: 'inventory', lever: 'Inventory', area: 'bar' },
];
/** Parts of the business Coversight doesn't read yet, said once so nothing looks covered that isn't. */
export const NOT_TRACKED = ['guest reviews', 'equipment and repairs'];
const BAR_MOVE = /pour|bar|wine|bourbon|cocktail|beer/i;

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
const moveOf = (c) => (c ? { id: c.id, kind: c.kind, item: c.item, to: c.to, lever: c.lever, why: c.why, title: c.title, value: c.value, lo: c.lo, hi: c.hi, claim: c.claim } : null);

/** Where each kind of fix is made, for the guided steps (lib/data/writebacks.js WHERE). */
const FIX_SYSTEM = { price: 'Toast menu', markup: 'Toast delivery menus', voids: 'Toast', Labour: '7shifts', Kitchen: 'Kitchen display' };
/**
 * A fix as the task Lever Check approves in place. It uses the same approval
 * ids the lever pages use (a price change is checked against the next Toast
 * data), so approving here or there is one task, never two.
 */
export function fixTask(f) {
  if (!f) return null;
  if (f.kind === 'price') {
    const m = /from \$(\d+(?:\.\d+)?) to \$(\d+(?:\.\d+)?)/.exec(f.title);
    const dish = f.title.replace(/^Raise (the )?/, '').replace(/ from .*$/, '');
    return { approvalId: `price:${f.item}:${f.to}`, system: FIX_SYSTEM.price, title: f.title, diff: [[`${dish} price`, m ? `$${m[1]}` : '—', `$${f.to}`]] };
  }
  if (f.kind === 'markup') return { approvalId: 'delivery-markup', system: FIX_SYSTEM.markup, title: f.title, diff: [['Delivery prices', 'Same as dine-in', '10% higher']] };
  if (f.kind === 'voids') return { approvalId: 'void-reason', system: FIX_SYSTEM.voids, title: f.title, diff: [['Voids after an order is sent', 'Anyone can void', 'Manager PIN and a reason']] };
  return { approvalId: `lever:${f.id}`, system: FIX_SYSTEM[f.lever] || null, title: f.title, diff: [[f.title, '—', 'Done']] };
}

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
    guests: { now: cur.covers, then: b.covers, change: Math.round(cur.covers - b.covers) },
    check: { now: cur.covers ? cur.net / cur.covers : 0, then: b.covers ? b.net / b.covers : 0 },
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
    case 'sales': {
      const v = vitals;
      const cur = d.hist.rows.at(-1);
      if (!v) return { status: 'good', big: { value: money(round(d.week.net)), label: 'sales this week', claim: 'obs' }, good: { text: `${d.week.covers.toLocaleString('en-US')} guests this week`, claim: 'obs' }, bad: null, facts: [], fix: null };
      const gUp = v.guests.change >= 0;
      const cUp = v.check.now >= v.check.then;
      return {
        status: v.sales.status,
        big: { value: money(round(v.sales.now)), label: 'sales this week', claim: 'obs' },
        delta: { text: `${money(round(v.sales.change), { sign: true })} vs a normal week`, good: v.sales.change >= 0 },
        good: gUp ? { text: `${Math.abs(v.guests.change).toLocaleString('en-US')} more guests than a normal week`, claim: 'obs' }
          : cUp ? { text: `Each guest spent ${money(v.check.now, { cents: true })}, more than usual`, claim: 'obs' } : null,
        bad: !gUp ? { text: `${Math.abs(v.guests.change).toLocaleString('en-US')} fewer guests than a normal week`, claim: 'obs' }
          : !cUp ? { text: `Each guest spent less than usual (${money(v.check.now, { cents: true })})`, claim: 'obs' } : null,
        facts: [
          ['Guests this week', (cur?.covers ?? d.week.covers).toLocaleString('en-US'), 'obs'],
          ['Guests in a normal week', round(v.guests.then).toLocaleString('en-US'), 'obs'],
          ['Spent per guest', money(v.check.now, { cents: true }), 'obs'],
          ['Spent per guest, normal week', money(v.check.then, { cents: true }), 'obs'],
        ],
        fix: null,
      };
    }
    case 'bar': {
      const rows = d.usage.rows.filter((r) => r.cat === 'Bar');
      const flagged = rows.filter((r) => r.flag);
      const wk = d.usage.barWeek;
      const share = wk / (d.week.net || 1);
      const partial = late('Inventory counts');
      const moves = readyMoves(d, 'Inventory').filter((c) => BAR_MOVE.test(c.title));
      return {
        status: share > RED_SHARE && !partial ? 'bad' : flagged.length ? 'watch' : 'good',
        big: wk > 0 ? { value: `${money(round(wk))}/wk`, label: 'a week of drinks poured but not sold', claim: 'est' } : { value: 'All good', label: 'pours match what you sold', claim: 'obs' },
        good: rows.length ? { text: `${rows.length - flagged.length} of ${rows.length} drinks are right on`, claim: 'obs' } : null,
        bad: flagged.length ? { text: `Too much ${listing(flagged.map((r) => cleanLabel(r.label)))} poured`, claim: 'est' } : null,
        facts: rows.map((r) => [r.label, r.flag ? `${money(round(r.dollars))} over in 4 weeks` : 'right on', r.flag ? 'est' : 'obs']),
        fix: moveOf(moves[0]),
      };
    }
    case 'labour': {
      const lab = vitals?.labour;
      const wk = banked.Labour || 0;
      const moves = readyMoves(d, 'Labour');
      const ot = d.candidates.filter((c) => c.lever === 'Labour' && c.prevent && c.value > 0.5);
      const stale = late('7shifts');
      const status = lab?.status === 'bad' ? 'bad' : lab?.status === 'watch' || ot.length ? 'watch' : 'good';
      return {
        status,
        big: lab ? { value: pc(lab.now), label: 'of sales goes to staff pay', claim: 'obs' } : { value: money(round(d.week.labour)), label: 'staff pay this week', claim: 'obs' },
        delta: lab ? { text: `${pts(lab.change)} vs ${vitals.comparator.toLowerCase()}`, good: lab.change <= 0 } : null,
        good: wk > 0 ? { text: `Saving you ${money(round(wk))} every week`, claim: 'book' }
          : lab && lab.change <= 0 ? { text: 'Staff costs are normal or lower', claim: 'obs' }
          : d.week.labour > 0 ? { text: `Each $1 of staff pay brought in ${money(d.week.net / d.week.labour, { cents: true })}`, claim: 'obs' } : null,
        dataNote: stale ? 'Your schedule app hasn’t sent new shifts lately, so staff numbers may be a few days old.' : null,
        bad: ot.length ? { text: `${plural(ot.length, 'person', 'people')} about to get overtime pay`, claim: 'obs' }
          : moves[0] ? { text: `${moves[0].title}`, claim: moves[0].claim } : null,
        facts: [
          ['Staff pay this week', money(round(d.week.labour)), 'obs'],
          lab && ['Staff pay in a normal week', pc(lab.then), 'obs'],
          ['Saved every week', money(round(wk)), wk ? 'book' : 'none'],
          ot[0] && ['Overtime you can avoid', `${money(round(ot.reduce((s, c) => s + c.value, 0)))} this week`, 'obs'],
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
      const status = fr?.status === 'bad' ? 'bad' : fr?.status === 'watch' || high.length ? 'watch' : 'good';
      return {
        status,
        big: moves.length ? { value: `${money(round(sum))}/wk`, label: `more a week from ${moves.length === 1 ? 'one price change' : `${moves.length} price changes`}`, claim: 'mod' }
          : { value: money(d.menu.cmWeighted, { cents: true }), label: 'left per plate after food', claim: 'obs' },
        delta: null,
        good: best ? { text: `${best.name} makes you the most money`, claim: 'obs' } : null,
        dataNote: blocked.length ? `Your recipe costs are out of date, so ${plural(blocked.length, 'price change waits', 'price changes wait')} until they’re updated.` : null,
        bad: high[0] ? { text: `${high[0].name} costs too much to make (${pc(high[0].cost / high[0].price, 0)} of its price)`, claim: 'obs' } : null,
        facts: [
          ['Left per plate after food', money(d.menu.cmWeighted, { cents: true }), 'obs'],
          fr && ['Food cost this week', pc(fr.now), 'obs'],
          ['Dishes that cost too much to make', String(high.length), 'obs'],
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
        big: { value: money(round(Math.max(0, rises))), label: 'extra paid to suppliers in 4 weeks', claim: 'obs' },
        delta: null,
        good: held ? { text: `${held} of ${d.inv.invoices.length} items didn’t go up`, claim: 'obs' } : null,
        bad: top && top.leg > 0 ? { text: `${top.vendor} raised their prices`, claim: 'obs' } : null,
        facts: [
          ...d.inv.byVendor.filter((v) => v.leg > 0).slice(0, 3).map((v) => [v.vendor, `${money(round(v.leg), { sign: true })} in 28 days`, 'obs']),
          ['From buying more or less', `${money(round(d.inv.mixLeg), { sign: true })} in 28 days`, 'obs'],
        ],
        fix: moveOf(moves[0]),
      };
    }
    case 'inventory': {
      const all = d.usage;
      const rowsK = all.rows.filter((r) => r.cat !== 'Bar');
      const u = { rows: rowsK, flagged: rowsK.filter((r) => r.flag), week: all.kitchenWeek };
      const moves = readyMoves(d, 'Inventory').filter((c) => !BAR_MOVE.test(c.title) || /portion|salmon|turkey|burger/i.test(c.title));
      const partial = late('Inventory counts');
      const wasteOff = feed('Waste log')?.state === 'off';
      const share = u.week / (d.week.net || 1);
      const status = share > RED_SHARE && !partial ? 'bad' : share > WATCH_SHARE / 2 ? 'watch' : 'good';
      return {
        status,
        big: u.week > 0 ? { value: `${money(round(u.week))}/wk`, label: 'a week of kitchen food used but not sold', claim: 'est' } : { value: 'All good', label: 'no food going missing', claim: 'obs' },
        delta: null,
        good: u.rows.length ? { text: `${u.rows.length - u.flagged.length} of ${u.rows.length} items are right on`, claim: 'obs' } : null,
        bad: u.flagged.length ? { text: `Too much ${listing([...u.flagged.slice(0, 2).map((r) => cleanLabel(r.label)), ...(u.flagged.length > 2 ? [`${u.flagged.length - 2} more`] : [])])} used`, claim: 'est' } : null,
        facts: [
                    ['Last stock count', partial ? `${feed('Inventory counts').last}, about ±3%` : feed('Inventory counts')?.last ?? '—', 'obs'],
          wasteOff && ['Waste log', 'Not started yet', 'none'],
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
      const status = peak > t.target + 3 ? 'watch' : 'good';
      const [station, share] = t.stations[0] || [];
      return {
        status,
        big: { value: `${peak.toFixed(1)} min`, label: `longest wait for food (goal: ${t.target} min)`, claim: 'obs' },
        delta: null,
        good: { text: `On time ${onTime} of ${hours.length} busy hours`, claim: 'obs' },
        dataNote: stale ? `Kitchen times are from ${kds.last}, when the kitchen screen last sent them.` : null,
        bad: station && onTime < hours.length ? { text: `The ${station.toLowerCase()} is the slowest spot`, claim: 'obs' } : null,
        facts: t.stations.slice(0, 3).map(([s, v]) => [`${s}: share of slow orders`, `${v}%`, 'obs']),
        fix: null,
        note: 'A slow kitchen only costs money when guests can’t get a table, so we don’t put a dollar on it.',
      };
    }
    case 'throughput': {
      const T = d.room.throughput;
      const share = T.total ? T.intervals / T.total : 0;
      const wl = feed('Waitlist');
      const status = share > 0.03 ? 'watch' : 'good';
      return {
        status,
        big: { value: String(T.intervals), label: `times the room was full this week`, claim: 'obs' },
        delta: null,
        good: share <= 0.03 ? { text: `Free tables ${pc(1 - share, 0)} of the time`, claim: 'obs' } : { text: `Seats used ${T.seatUse}% of the time`, claim: 'obs' },
        bad: share > 0.03 ? { text: 'Some nights you ran out of tables', claim: 'obs' } : null,
        dataNote: wl?.state !== 'healthy' ? (wl?.state === 'off' ? 'With a waitlist connected we could also count guests who left.' : 'The waitlist is only partly connected, so some guests who left aren’t counted.') : null,
        facts: [
          ['Seats used', `${T.seatUse}%`, 'obs'],
          ['Busiest vs quietest meal', `${T.bestWorst}×`, 'obs'],
          ['Most faster tables could add', `${money(T.ceiling)}/mo`, 'est'],
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
        big: s.signalCount ? { value: money(over), label: 'given away too much in 4 weeks', claim: 'obs' } : { value: 'All good', label: 'no one gives away too much', claim: 'obs' },
        delta: null,
        good: { text: `Giveaways are ${pc(s.weekTotal / (d.week.net || 1))} of sales`, claim: 'obs' },
        bad: s.signalCount ? { text: `${plural(people, 'staff member gives', 'staff members give')} away too much`, claim: 'obs' }
          : paused.length ? { text: 'A fix that was working slipped', claim: 'none' } : null,
        facts: [
          ['Cancelled after cooking, a week', money(round(s.types.postVoid.week)), 'obs'],
          ['Free food, a week', money(round(s.types.comps.week)), 'obs'],
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
        big: delSales ? { value: money(round(delPer100)), label: 'you keep from every $100 of delivery', claim: 'obs' } : { value: '$0', label: 'delivery sales this week', claim: 'obs' },
        delta: null,
        good: dine ? { text: `Dine-in keeps ${money(round(dine.per100))} of every $100`, claim: 'obs' } : null,
        bad: delSales ? { text: `Apps take a big cut, and refunds cost ${money(round(c.deliveryRefunds))} this week`, claim: 'obs' } : null,
        facts: c.channels.map((x) => [`${x.name}: you keep per $100`, money(round(x.per100)), 'obs']),
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
  sales: (d) => [d.week.covers ? d.week.net / d.week.covers : null, true],
  bar: (d) => [d.usage.barWeek / (d.week.net || 1), false],
  labour: (d) => [d.week.labourRate, false],
  menu: (d) => [d.week.foodRate, false],
  purchasing: (d) => [d.inv.priceLeg / 4 / (d.week.net || 1), false],
  inventory: (d) => [d.usage.kitchenWeek / (d.week.net || 1), false],
  kitchen: (d) => [Math.max(...d.room.tickets.sat.filter((v) => v != null)), false],
  controls: (d) => [d.staff.weekTotal / (d.week.net || 1), false],
  channels: (d) => {
    const del = d.chan.delivery;
    const sales = del.reduce((s, x) => s + x.sales, 0);
    return [sales ? del.reduce((s, x) => s + x.contrib, 0) / sales : null, true];
  },
};
const ORD = ['', '1st', '2nd', '3rd'];
const RANK_WHAT = { sales: 'spend per guest', bar: 'drinks poured', labour: 'staff costs', menu: 'food costs', purchasing: 'supplier prices', inventory: 'food used', kitchen: 'kitchen speed', controls: 'giveaways', channels: 'delivery' };
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
  if (run) return { kind: 'testing', text: run.title, sub: run.closes ? `answer by ${run.closes}` : run.held, progress: run.progress ?? null };
  const ok = ps.find((p) => (p.outcome === 'verified' || p.outcome === 'limited') && !p.paused);
  if (ok) return { kind: 'verified', text: ok.title, sub: `saving ${money(ok.bookable)} a week`, claim: 'book' };
  const held = ps.find((p) => p.paused || p.outcome === 'data');
  if (held) return { kind: 'held', text: held.title, sub: held.paused ? 'paused until things settle' : 'waiting on new numbers' };
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
    const missing = waiting ? ['your sales'] : L.area ? area?.missing ?? [] : [];
    if (missing.length) {
      return {
        ...L, status: 'nodata', big: null, delta: null, good: null, bad: null, facts: [], fix: null,
        missing, next: { label: `Add ${missing[0]}`, go: missing[0] === 'Toast' ? 'connect' : 'inputs' },
      };
    }
    return { ...L, ...leverRead(L.id, d, { vitals, banked }), missing: [], trend: trendOf(L.id, d, { real }), rank: rankOf(L.id, d, group), handled: L.id === 'bar' || L.id === 'sales' ? null : handledOf(L, d, windows) };
  });
  const count = Object.fromEntries(Object.keys(STATUS).map((k) => [k, levers.filter((l) => l.status === k).length]));
  const bankedWeek = Object.values(banked).reduce((s, v) => s + v, 0);

  /* The one thing that matters most: the best ready move by value per manager-hour (The plan's order). */
  const first = waiting ? null : d.plan.sorted.find((c) => c.value > 0.5 && !c.prevent && !blockedReason(c, d) && c.claim !== 'est');
  const firstLever = first && LEVERS.find((l) => l.lever === first.lever && l.id !== 'bar');
  const worst = levers.filter((l) => l.status === 'bad');
  const top = first
    ? { kind: 'move', move: moveOf(first), title: first.title, value: first.value, claim: first.claim, lever: firstLever?.name ?? first.lever, go: firstLever?.go ?? 'plan', hours: first.hours }
    : worst[0] && !waiting ? { kind: 'fix', title: worst[0].bad?.text ?? worst[0].name, lever: worst[0].name, go: worst[0].go } : null;

  const n = levers.length;
  const headline = waiting
    ? 'Your levers light up as soon as your first week of sales comes in.'
    : `${count.good} of ${n} money levers look good.${count.bad ? ` ${count.bad === 1 ? 'One needs' : `${count.bad} need`} fixing now.` : ' Nothing needs fixing now.'}`;

  const trends = waiting ? {} : { sales: trendOf('sales', d, { real }), kept: trendOf('kept', d, { real }) };
  const outcome = outcomeOf(d, { windows, waiting });
  const handled = levers.filter((l) => l.handled).length;
  return { vitals, levers, count, top, banked: bankedWeek, headline, waiting, period: vitals?.period ?? null, trends, outcome, handled };
}
