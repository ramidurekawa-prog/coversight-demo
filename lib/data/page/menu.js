/**
 * Menu prices: everything the Menu page shows for one room, pure, from
 * deriveRoom(ds, roomId). The browser and the server call the same code.
 *
 * The headline and status follow the Lever Check card for this lever
 * ("Menu prices"): the ready price changes add up to the big number, or,
 * with none ready, what a plate leaves after food. Nothing here is typed in;
 * every figure comes from the room's menu, its 52 weeks and its candidates.
 */
import { money, priceMoveInterval } from '../model.js';
import { blockedReason, comparators, defaultComparator, weekOf } from './week.js';
import { TEST_LEVER } from '../coverage.js';

/** Food cost a point above a normal week is a problem; a quarter point is worth watching (Lever Check's rule). */
export const RATE_LIMIT = 0.01;
const WATCH = 0.0025;
/** A dish whose plate cost is over 40% of its price "costs too much to make" (Lever Check's rule). */
export const HIGH_FOOD = 0.4;
/** How many weeks a "cost of waiting" is counted over: four weeks, about a month. */
export const WAIT_WEEKS = 4;

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
 * @param {{ tasks?: any[], windows?: any[] | null, matchedWeeks?: number[] }} [opts]
 */
export function menuView(d, { tasks = [], windows = null, matchedWeeks = [] } = {}) {
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

  /* The changes: every menu move with money on it. Done = already a task. */
  const open = (id) => tasks.some((t) => t.roomId === d.id && t.approvalId === id && t.status !== 'cancelled');
  const moves = d.candidates
    .filter((c) => c.lever === 'Menu' && c.value > 0.5 && !c.prevent)
    .map((c) => {
      const item = c.kind === 'price' ? menu.find((m) => m.key === c.item) : null;
      const blocked = blockedReason(c, d);
      const id = taskIdOf(c);
      return {
        id: c.id, taskId: id, kind: c.kind, item: c.item || null, title: c.title, why: c.why || '', claim: c.claim,
        value: c.value, lo: c.lo, hi: c.hi, from: item?.price ?? null, to: c.to ?? null,
        lost: c.move ? c.move.lost : null, units: item?.units ?? null,
        blocked, ready: !blocked, done: open(id),
        needsCost: !!blocked && (c.needs === 'recipes' || !!item?.costEstimated),
      };
    })
    .sort((a, b) => b.value - a.value);
  const ready = moves.filter((m) => m.ready);
  const sum = ready.reduce((s, c) => s + c.value, 0);
  const waiting = moves.filter((m) => !m.ready);
  const waitingSum = waiting.reduce((s, c) => s + c.value, 0);
  const pick = ready.find((m) => !m.done) || null;
  const doneCount = moves.filter((m) => m.done).length;
  const doneSum = moves.filter((m) => m.done).reduce((t, c) => t + c.value, 0);
  const openSum = moves.filter((m) => !m.done).reduce((t, c) => t + c.value, 0);

  /* Good and bad, one line each (Lever Check's lines). */
  const best = [...dishes].sort((a, b) => b.cm * b.units - a.cm * a.units)[0] || null;
  const high = dishes.filter((m) => !m.balancing && m.cost / m.price > HIGH_FOOD).sort((a, b) => b.cost / b.price - a.cost / a.price);
  const status = food?.status === 'bad' ? 'bad' : food?.status === 'watch' || high.length ? 'watch' : 'good';

  const big = ready.length
    ? { value: `${money(round(sum))}/wk`, label: `more a week from ${ready.length === 1 ? 'one price change' : `${ready.length} price changes`}`, claim: 'mod', sum }
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
    const up = m.e == null ? null : priceMoveInterval(m, m.price + 1);
    return { ...m, foodRate: m.cost / m.price, corner: cornerOf(m, meanUnits, cmW), plusOne: up ? up.delta : null };
  });
  const corners = Object.fromEntries(Object.keys(CORNERS).map((k) => [k, list.filter((m) => m.corner === k && !m.balancing).length]));
  const banked = menuBanked(d, windows);
  const bankedWeek = banked.reduce((s, b) => s + b.week, 0);
  const estimated = menu.filter((m) => m.costEstimated);

  return {
    period, status, headline, big, best, high, food, meanUnits, cmWeighted: cmW,
    good: best ? `${best.name} makes you the most money` : null,
    bad: high[0] ? `${high[0].name} costs too much to make (${pc(high[0].cost / high[0].price)} of its price)` : null,
    moves, ready, waiting, waitingSum, pick, sum, doneCount, doneSum, openSum,
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
