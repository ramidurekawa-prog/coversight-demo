/**
 * Menu prices: everything the Menu page shows for one room, pure, from
 * deriveRoom(ds, roomId). The browser and the server call the same code.
 *
 * The headline and status follow the Lever Check card for this lever
 * ("Menu prices"): the ready price changes add up to the big number, or,
 * with none ready, what a plate leaves after food. Nothing here is typed in;
 * every figure comes from the room's menu, its 52 weeks and its candidates.
 */
import { money } from '../model.js';
import { balance, learn, predict, trackRecord } from './menu-lab.js';
import { blockedReason, comparators, defaultComparator, weekOf } from './week.js';
import { TEST_LEVER } from '../coverage.js';

/** Food cost a point above a normal week is a problem; a quarter point is worth watching (Lever Check's rule). */
export const RATE_LIMIT = 0.01;
const WATCH = 0.0025;
/** A dish whose plate cost is over 40% of its price "costs too much to make" (Lever Check's rule). */
export const HIGH_FOOD = 0.4;
/** How many weeks a "cost of waiting" is counted over: four weeks, about a month. */
export const WAIT_WEEKS = 4;
/** Price changes go out a few at a time, one menu update each: the best five first. */
export const ROUND_SIZE = 5;

const round = (n) => Math.round(n);
const pc = (n, dp = 0) => `${(n * 100).toFixed(dp)}%`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const say = (n) => words[n] ?? String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Which of the four corners of the plate map a dish sits in. */
export function cornerOf(m, meanUnits, cmWeighted) {
  const busy = m.units >= meanUnits;
  const rich = m.cm >= cmWeighted;
  return busy && rich ? 'star' : busy ? 'thin' : rich ? 'gem' : 'rethink';
}
export const CORNERS = {
  star: { label: 'Sells a lot, earns a lot', tip: 'Keep these just as they are.', tone: 'good' },
  thin: { label: 'Sells a lot, earns a little', tip: 'Guests love these. A small price step is often safe.', tone: 'warn' },
  gem: { label: 'Sells a little, earns a lot', tip: 'Put these where guests look first.', tone: 'good' },
  rethink: { label: 'Sells a little, earns a little', tip: 'Fix the recipe, or make room on the menu.', tone: 'mute' },
};

/** Task ids a menu change is tracked under: price:<dish>:<price> for a price, menu:<id> for the rest. */
export const taskIdOf = (c) => (c.kind === 'price' && c.item && c.to != null ? `price:${c.item}:${c.to}` : `menu:${c.id}`);

/** A verified or limited result banks a week; a real group counts only its own verified windows. */
export function menuBanked(d, windows = null) {
  if (Array.isArray(windows)) {
    return windows.filter((w) => w.roomId === d.id && w.status === 'verified' && TEST_LEVER[w.lever] === 'Menu')
      .map((w) => ({ id: w.id, title: w.title, week: (w.bookedCents || 0) / 100 }));
  }
  return d.proofs.filter((p) => p.lever === 'Menu' && (p.outcome === 'verified' || p.outcome === 'limited') && !p.paused && p.bookable > 0)
    .map((p) => ({ id: p.id, title: p.title, week: p.bookable }));
}

/**
 * @param {any} d deriveRoom(ds, roomId)
 * @param {{ tasks?: any[], windows?: any[] | null, matchedWeeks?: number[], fence?: number, keepOrders?: number }} [opts]
 *   fence: the room's limit on one price move, in percent. keepOrders: the least share of a dish's orders a move may keep.
 */
export function menuView(d, { tasks = [], windows = null, matchedWeeks = [], fence = 8, keepOrders = 0.9 } = {}) {
  const real = Array.isArray(windows);
  const menu = d.menu.menu;
  const dishes = menu.filter((m) => m.units > 0);
  const cmW = d.menu.cmWeighted;
  const meanUnits = mean(menu.map((m) => m.units));
  const rows = d.hist.rows;
  const cur = rows[rows.length - 1];
  const period = weekOf(rows)?.label ?? cur?.label ?? 'this week';

  /* Food cost against a normal week: the same comparator Lever Check uses. */
  const base = cur ? defaultComparator(comparators(rows, { matchedWeeks, real })) : null;
  const rate = (r) => (r?.net ? r.food / r.net : 0);
  const food = base ? { now: rate(cur), then: rate(base.row), vs: base.label } : null;
  if (food) food.status = food.now - food.then > RATE_LIMIT ? 'bad' : food.now - food.then > WATCH ? 'watch' : 'good';

  /* The changes: the Balanced menu's price moves (Price Lab), plus any menu
     change that isn't a price (a placement test). Done = already a task. */
  const lab = learn(d);
  const openTask = (pred) => tasks.some((t) => t.roomId === d.id && pred(t.approvalId) && t.status !== 'cancelled');
  const priceBlock = (m) => {
    if (m.costEstimated) return 'Its plate cost is a guess. Enter what it costs to make first.';
    const c = d.candidates.find((x) => x.kind === 'price' && x.item === m.key);
    return c ? blockedReason(c, d) : null;
  };
  const bal = balance(d, { lab, maxPrice: fence, keepOrders, skip: priceBlock });
  const priceMoves = [...bal.moves.map((b) => ({ b, blocked: null })), ...bal.held.map((b) => ({ b, blocked: b.why }))].map(({ b, blocked }) => {
    const item = menu.find((m) => m.key === b.key);
    return {
      id: `price-${b.key}`, taskId: `price:${b.key}:${b.to}`, kind: 'price', item: b.key,
      title: `${b.to > b.from ? 'Raise' : 'Lower'} the ${b.name.toLowerCase()} from ${money(b.from)} to ${money(b.to)}`, why: '',
      claim: item?.costEstimated ? 'est' : 'mod', value: b.kept, lo: b.bad, hi: b.good, sales: b.sales,
      from: b.from, to: b.to, lost: b.lost, units: b.units,
      blocked, ready: !blocked, done: openTask((id) => id.startsWith(`price:${b.key}:`)),
      needsCost: !!blocked,
    };
  });
  const otherMoves = d.candidates
    .filter((c) => c.lever === 'Menu' && c.kind !== 'price' && c.value > 0.5 && !c.prevent)
    .map((c) => {
      const blocked = blockedReason(c, d);
      const id = taskIdOf(c);
      return { id: c.id, taskId: id, kind: c.kind, item: null, title: c.title, why: c.why || '', claim: c.claim, value: c.value, lo: c.lo, hi: c.hi, sales: null, from: null, to: null, lost: null, units: null, blocked, ready: !blocked, done: openTask((x) => x === id), needsCost: false };
    });
  const all = [...priceMoves, ...otherMoves].sort((a, b) => Number(b.ready) - Number(a.ready) || b.value - a.value);
  /* This round: every change already made, then the best ready ones up to ROUND_SIZE, then what waits on data. */
  const doneOnes = all.filter((m) => m.done);
  const fresh = all.filter((m) => !m.done && m.ready).slice(0, Math.max(0, ROUND_SIZE - doneOnes.length));
  const moves = [...all.filter((m) => m.ready && (m.done || fresh.includes(m))), ...all.filter((m) => !m.ready && !m.done)];
  const later = all.filter((m) => !moves.includes(m));
  const ready = moves.filter((m) => m.ready);
  const sum = ready.reduce((s, c) => s + c.value, 0);
  const waiting = moves.filter((m) => !m.ready);
  const waitingSum = waiting.reduce((s, c) => s + c.value, 0);
  const pick = ready.find((m) => !m.done) || null;
  const doneCount = moves.filter((m) => m.done).length;
  const doneSum = moves.filter((m) => m.done).reduce((t, c) => t + c.value, 0);
  const openSum = moves.filter((m) => !m.done).reduce((t, c) => t + c.value, 0);
  const badSum = ready.reduce((s, c) => s + c.lo, 0);
  const track = trackRecord(d);

  /* Good and bad, one line each (Lever Check's lines). */
  const best = [...dishes].sort((a, b) => b.cm * b.units - a.cm * a.units)[0] || null;
  const high = dishes.filter((m) => !m.balancing && m.cost / m.price > HIGH_FOOD).sort((a, b) => b.cost / b.price - a.cost / a.price);
  const status = food?.status === 'bad' ? 'bad' : food?.status === 'watch' || high.length ? 'watch' : 'good';

  const big = ready.length
    ? { value: `${money(round(sum))}/wk`, label: `more a week from ${ready.length === 1 ? 'one change' : `${ready.length} changes`}`, claim: 'mod', sum, bad: badSum }
    : { value: money(cmW, { cents: true }), label: 'left per plate after food', claim: 'obs', sum: 0 };
  const headline = ready.length
    ? `${cap(ready.length === 1 ? 'one change' : `${say(ready.length)} changes`)} could add ${money(round(sum))} a week.`
    : status === 'good' ? `Your menu is earning well. Each plate leaves ${money(cmW, { cents: true })}.`
    : `Each plate leaves ${money(cmW, { cents: true })} after food.`;

  /* How this week's plate compares with the room's own recent weeks. */
  const recent = rows.slice(-13, -1);
  const beat = cur ? recent.filter((r) => r.wcm < cur.wcm).length : 0;
  let streak = 0;
  const avg = mean(recent.map((r) => r.wcm));
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - 13); i--) { if (rows[i].wcm >= avg) streak++; else break; }
  const slide = rows.length > 13 ? rows[rows.length - 14].wcm - cur.wcm : 0;

  /* Every dish, with the corner it sits in and what +$1 would do. */
  const list = menu.map((m) => {
    const up = m.balancing ? null : predict(lab, m, m.price + 1);
    const L = lab.dishes[m.key];
    return { ...m, foodRate: m.cost / m.price, corner: cornerOf(m, meanUnits, cmW), plusOne: up ? up.kept : null, reaction: L?.e ?? null, priceChanges: L?.changes ?? 0 };
  });
  const corners = Object.fromEntries(Object.keys(CORNERS).map((k) => [k, list.filter((m) => m.corner === k && !m.balancing).length]));
  const banked = menuBanked(d, windows);
  const bankedWeek = banked.reduce((s, b) => s + b.week, 0);
  const estimated = menu.filter((m) => m.costEstimated);

  return {
    period, status, headline, big, best, high, food, meanUnits, cmWeighted: cmW,
    good: best ? `${best.name} makes you the most money` : null,
    bad: high[0] ? `${high[0].name} costs too much to make (${pc(high[0].cost / high[0].price)} of its price)` : null,
    moves, ready, waiting, waitingSum, pick, sum, doneCount, doneSum, openSum, badSum, lab, balanced: bal, track, later, all, fence, keepOrders,
    progress: { done: doneCount, of: moves.length },
    waitCost: pick ? pick.value * WAIT_WEEKS : 0,
    weeks: { beat, of: recent.length, streak, slide, avg, wcm: cur?.wcm ?? cmW },
    list, corners, banked, bankedWeek, estimated,
    dishes: menu.length,

  };
}

/**
 * The rows a plate-cost fix saves: what the room already entered for recipes,
 * with this dish's row replaced. Recipes replace their whole entry on save,
 * so the earlier rows travel with it.
 */
export function plateCostRows(prior, dish, cost) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const keep = (prior || []).filter((r) => norm(r.dish) !== norm(dish.name) && norm(r.dish) !== norm(dish.key));
  return [...keep, { dish: dish.name, price: dish.price, cost, ...(dish.added ? { units: dish.units, category: dish.cat } : {}) }];
}

export { pc as pct, plural };
