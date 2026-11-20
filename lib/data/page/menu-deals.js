/**
 * Specials and deals: what a deal really costs, what it most likely does,
 * and what it has done since it went live. Pure; browser and server share it.
 *
 * Three kinds:
 *   bundle     "Buy 3 tacos, get 1 free". For the guests who take it, the
 *              dish is cheaper by one in (buy + 1); the Price Lab's learned
 *              reaction says how many more they order. The free plate costs
 *              its food, not its menu price.
 *   threshold  "Free appetizer with $75 or more". Each one costs the
 *              appetizer's food; it pays for itself when guests spend up to
 *              the line. How many checks reach it is the owner's count (or
 *              Toast's check sizes when they come in), never a typed guess.
 *   comeback   "Free dessert on your next visit within 30 days", handed out on
 *              the receipt. It pays for itself when enough cards bring a
 *              guest back; the room's own money kept per guest says how many.
 *
 * Results come from the owner's weekly redemption count (or the POS discount
 * report when it's connected), and for a bundle the dish's own weeks.
 */
import { predict } from './menu-lab.js';

const sum = (xs) => xs.reduce((s, x) => s + x, 0);
export const DEAL_KINDS = {
  bundle: { label: 'Buy some, get one free', icon: 'Gift', example: 'Buy 3 tacos, get 1 free' },
  threshold: { label: 'Free item over a check size', icon: 'Receipt', example: 'Free appetizer with $75 or more' },
  comeback: { label: 'Come-back offer', icon: 'Repeat', example: 'Free dessert on your next visit' },
};

/** What one guest brings in, kept after food and staff, from this room's week: the value of a return visit. */
export function keptPerGuest(d) {
  const w = d.week;
  return w.covers ? w.earned / w.covers : 0;
}
/** Food cost as a share of sales: what is kept from each extra dollar a guest spends, before staff. */
const marginRate = (d) => (d.week.net ? 1 - d.week.food / d.week.net : 0.7);

/**
 * @param {any} d deriveRoom
 * @param {any} lab learn(d)
 * @param {{ kind: string, dish?: string, buy?: number, free?: string, threshold?: number, checks?: number, takeUp?: number, cards?: number, days?: number }} deal
 */
export function dealEconomics(d, lab, deal) {
  const menu = d.menu.menu;
  const find = (k) => menu.find((m) => m.key === k);
  if (deal.kind === 'bundle') {
    const m = find(deal.dish);
    const buy = Math.max(1, Math.round(deal.buy || 3));
    if (!m) return null;
    const takeUp = Math.min(1, Math.max(0, deal.takeUp ?? 0.3));
    const share = 1 / (buy + 1);
    const effective = m.price * (1 - share);
    const base = { ...m, units: m.units * takeUp };
    const r = predict(lab, base, effective);
    const freePerWeek = r ? (r.plates * share) : (m.units * takeUp * share);
    return {
      kind: 'bundle', dish: m, buy, freeCost: m.cost, guestValue: m.price,
      perWeek: { free: freePerWeek, foodCost: freePerWeek * m.cost },
      kept: r ? r.kept : null, good: r ? r.good : null, bad: r ? r.bad : null, extraPlates: r ? r.plates - base.units : null,
      takeUp,
      breakEven: m.price - m.cost > 0 ? Math.ceil((freePerWeek * m.cost) / (m.price - m.cost)) : null,
      title: `Buy ${buy} ${m.name.toLowerCase()}, get 1 free`,
    };
  }
  if (deal.kind === 'threshold') {
    const f = find(deal.free);
    const T = Math.max(1, deal.threshold || 75);
    if (!f) return null;
    const checks = Math.max(0, deal.checks ?? 0);
    const cost = checks * f.cost;
    const rate = marginRate(d);
    const spendUp = rate > 0 ? cost / rate : null;
    return {
      kind: 'threshold', dish: f, threshold: T, freeCost: f.cost, guestValue: f.price, checks,
      perWeek: { free: checks, foodCost: cost },
      spendUp, kept: null, good: null, bad: null,
      title: `Free ${f.name.toLowerCase()} with $${T} or more`,
    };
  }
  if (deal.kind === 'comeback') {
    const f = find(deal.free);
    if (!f) return null;
    const cards = Math.max(0, deal.cards ?? 0);
    const visit = keptPerGuest(d);
    const net = visit - f.cost;
    return {
      kind: 'comeback', dish: f, freeCost: f.cost, guestValue: f.price, cards, days: deal.days || 30,
      visit, netPerReturn: net,
      /* Some guests who redeem would have come back anyway; the offer pays when at
         least this share of redemptions are visits that wouldn't have happened. */
      newShare: visit > 0 ? Math.min(1, f.cost / visit) : null,
      perWeek: { free: null, foodCost: null },
      kept: null, good: null, bad: null,
      title: `Free ${f.name.toLowerCase()} on your next visit within ${deal.days || 30} days`,
    };
  }
  return null;
}

/**
 * What a live deal has done: free plates given and their food, from the
 * weekly counts entered (or the POS discount report), and for a come-back
 * offer the share of cards that brought a guest back.
 * @param {any} deal saved deal with counts: [{ week, redeemed, given? }]
 */
export function dealResults(d, deal) {
  const counts = deal.counts || [];
  if (!counts.length) return null;
  const f = d.menu.menu.find((m) => m.key === (deal.kind === 'bundle' ? deal.dish : deal.free));
  const redeemed = sum(counts.map((c) => c.redeemed || 0));
  const given = sum(counts.map((c) => c.given || 0));
  const food = f ? redeemed * f.cost : 0;
  const out = { weeks: counts.length, redeemed, food, guestValue: f ? redeemed * f.price : 0 };
  if (deal.kind === 'comeback') {
    const visit = keptPerGuest(d);
    out.given = given;
    out.returnRate = given ? redeemed / given : null;
    out.kept = redeemed * visit - food;
  }
  return out;
}

/**
 * Guests by visit number, when guest data is connected: how many came once,
 * twice, three times or more, and the share who made it from each visit to
 * the next. Null without guest data, so nothing is claimed.
 * @param {{ visits?: number[] } | null} guests visits[i] = guests seen at least i+1 times
 */
export function visitLadder(guests) {
  const v = guests?.visits;
  if (!v || v.length < 2 || !v[0]) return null;
  return v.map((n, i) => ({ visit: i + 1, guests: n, onward: i + 1 < v.length && n ? v[i + 1] / n : null }));
}
