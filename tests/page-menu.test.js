import { describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { findingBlocked } from '../lib/data/findings.js';
import { deriveRoom, money, priceMove } from '../lib/data/model.js';
import { CORNERS, ROUND_SIZE, WAIT_WEEKS, menuView, plateCostRows } from '../lib/data/page/menu.js';
import { balance, explain, learn, predict, trackRecord } from '../lib/data/page/menu-lab.js';
import { blockedReason } from '../lib/data/page/week.js';
import { checkRows } from '../lib/data/page/inputs.js';
import { SEED } from '../lib/data/seed.js';

const rooms = Object.keys(SEED.rooms);

describe('Menu page figures come from the model', () => {
  it.each(rooms)('%s: the big number is this round of the Balanced menu', (id) => {
    const d = deriveRoom(SEED, id);
    const v = menuView(d);
    const bal = balance(d, { maxPrice: 8, keepOrders: 0.9, skip: (m) => (m.costEstimated ? 'guess' : (() => { const c = d.candidates.find((x) => x.kind === 'price' && x.item === m.key); return c ? blockedReason(c, d) : null; })()) });
    const prices = v.ready.filter((m) => m.kind === 'price');
    for (const m of prices) {
      const b = bal.moves.find((x) => x.key === m.item);
      expect(b, m.item).toBeTruthy();
      expect(m.value).toBeCloseTo(b.kept);
      expect(m.lo).toBeGreaterThanOrEqual(0);
    }
    expect(v.ready.length).toBeLessThanOrEqual(ROUND_SIZE);
    const sum = v.ready.reduce((s, c) => s + c.value, 0);
    expect(v.big.value).toBe(v.ready.length ? `${money(Math.round(sum))}/wk` : money(d.menu.cmWeighted, { cents: true }));
    expect(v.headline).toContain(money(Math.round(sum)));
    expect(v.cmWeighted).toBe(d.menu.cmWeighted);
  });

  it('pins the sample Oakland page', () => {
    const v = menuView(deriveRoom(SEED, 'oakland'));
    expect(v.headline).toBe('Five changes could add $418 a week.');
    expect(v.status).toBe('watch');
    expect(v.pick.id).toBe('price-ribeye');
    expect(v.pick.to).toBe(45);
    expect(v.waiting.map((m) => m.id)).toEqual(['price-salmon']);
    expect(v.waiting[0].needsCost).toBe(true);
    expect(v.good).toBe('Margherita Pizza makes you the most money');
    expect(v.bad).toBe('Grilled Salmon costs too much to make (43% of its price)');
    expect(v.progress).toEqual({ done: 0, of: 6 });
    expect(v.waitCost).toBeCloseTo(v.pick.value * WAIT_WEEKS);
  });

  it('every dish sits in exactly one corner of the Plate Map, and +$1 is the model’s move', () => {
    const d = deriveRoom(SEED, 'berkeley');
    const v = menuView(d);
    const named = v.list.filter((m) => !m.balancing);
    expect(Object.values(v.corners).reduce((s, n) => s + n, 0)).toBe(named.length);
    for (const m of v.list) {
      expect(Object.keys(CORNERS)).toContain(m.corner);
      if (!m.balancing) expect(m.plusOne).toBeCloseTo(predict(v.lab, m, m.price + 1).kept);
    }
  });

  it('a change already approved counts toward the plan', () => {
    const d = deriveRoom(SEED, 'oakland');
    const v = menuView(d, { tasks: [{ roomId: 'oakland', approvalId: 'price:ribeye:44', status: 'open' }] });
    expect(v.progress.done).toBe(1);
    expect(v.pick.id).toBe('price-red');
    const cancelled = menuView(d, { tasks: [{ roomId: 'oakland', approvalId: 'price:ribeye:44', status: 'cancelled' }] });
    expect(cancelled.progress.done).toBe(0);
  });

  it('counts only verified menu windows for a real group', () => {
    const d = deriveRoom(SEED, 'oakland');
    const v = menuView(d, { windows: [
      { id: 'w1', roomId: 'oakland', status: 'verified', lever: 'menu_margin', title: 'Ribeye', bookedCents: 8600 },
      { id: 'w2', roomId: 'oakland', status: 'running', lever: 'menu_margin', title: 'Carbonara', bookedCents: 0 },
      { id: 'w3', roomId: 'berkeley', status: 'verified', lever: 'menu_margin', title: 'Other room', bookedCents: 5000 },
    ] });
    expect(v.bankedWeek).toBe(86);
    expect(v.banked).toHaveLength(1);
  });
});

describe('fixing a plate cost on the page', () => {
  it('keeps the earlier recipe rows and replaces only this dish', () => {
    const prior = [{ dish: 'Ribeye Steak', price: 42, cost: 17.6 }, { dish: 'Grilled Salmon', price: 28, cost: 12.5 }];
    const salmon = SEED.rooms.oakland.menu.find((m) => m.key === 'salmon');
    const rows = plateCostRows(prior, salmon, 11.9);
    expect(rows).toEqual([{ dish: 'Ribeye Steak', price: 42, cost: 17.6 }, { dish: 'Grilled Salmon', price: 28, cost: 11.9 }]);
    expect(checkRows('recipes', rows, SEED.rooms.oakland).ok).toBe(true);
  });

  it('a confirmed plate cost unblocks the change that was waiting on it', () => {
    const before = deriveRoom(SEED, 'oakland');
    const salmon = before.candidates.find((c) => c.id === 'salmon');
    expect(findingBlocked(salmon, before.room)).toMatch(/recipe costs/);
    const dish = SEED.rooms.oakland.menu.find((m) => m.key === 'salmon');
    const ds = applyInputs(SEED, { oakland: { recipes: { rows: plateCostRows([], dish, dish.cost), date: 'today', n: 1 } } });
    const after = deriveRoom(ds, 'oakland');
    expect(findingBlocked(after.candidates.find((c) => c.id === 'salmon'), after.room)).toBeNull();
    const v = menuView(after);
    expect(v.ready.map((m) => m.id)).toContain('price-salmon');
    expect(v.pick.id).toBe('price-salmon');
  });
});

describe('Price Lab', () => {
  it.each(rooms)('%s: predictions of past price changes beat "same as last week", and the 80%% range holds about 8 in 10', (id) => {
    const t = trackRecord(deriveRoom(SEED, id));
    expect(t.n).toBeGreaterThan(50);
    expect(t.err).toBeLessThan(t.naiveErr);
    expect(t.inside).toBeGreaterThan(0.7);
    expect(t.inside).toBeLessThan(0.95);
  });

  it('a dish with an earlier measurement keeps it as its prior; a hand-added dish leans on the whole menu', () => {
    const d = deriveRoom(SEED, 'oakland');
    const lab = learn(d);
    const ribeye = d.menu.menu.find((m) => m.key === 'ribeye');
    expect(Math.abs(lab.dishes.ribeye.e - ribeye.e)).toBeLessThan(0.15);
    expect(lab.dishes.ribeye.se).toBeLessThanOrEqual(ribeye.se + 1e-9);
    const added = { ...ribeye, key: 'own-x', added: true };
    const d2 = { ...d, menu: { ...d.menu, menu: [...d.menu.menu, added] } };
    const lab2 = learn(d2);
    expect(lab2.dishes['own-x'].e).toBeCloseTo(lab2.pool.mu);
  });

  it('with no switching, the most likely result is the constant-reaction move at the learned reaction', () => {
    const d = deriveRoom(SEED, 'oakland');
    const lab = learn(d);
    const m = d.menu.menu.find((x) => x.key === 'carbonara');
    const r = predict(lab, m, 22);
    expect(lab.switching.share).toBe(0);
    expect(r.kept).toBeCloseTo(priceMove(m, 22, lab.dishes.carbonara.e).delta);
    expect(r.bad).toBeLessThanOrEqual(r.kept);
    expect(r.good).toBeGreaterThanOrEqual(r.kept);
  });

  it('Balanced menu stays inside the fence and the order limit, and never risks a losing week', () => {
    const d = deriveRoom(SEED, 'walnut');
    const b = balance(d, { maxPrice: 5, keepOrders: 0.95 });
    expect(b.moves.length).toBeGreaterThan(0);
    for (const m of b.moves) {
      expect(Math.abs(m.to / m.from - 1)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(m.plates).toBeGreaterThanOrEqual(m.units * 0.95 - 1e-9);
      expect(m.bad).toBeGreaterThanOrEqual(0);
    }
    expect(balance(d, { maxPrice: 8, keepOrders: 0.9 }).kept).toBeGreaterThanOrEqual(b.kept);
  });

  it('Menu Maker explains a prediction in plain words with both cases', () => {
    const d = deriveRoom(SEED, 'oakland');
    const lab = learn(d);
    const m = d.menu.menu.find((x) => x.key === 'ribeye');
    const text = explain(lab, m, predict(lab, m, 45));
    expect(text).toMatch(/guests barely notice its price/);
    expect(text).toMatch(/bad case keeps \$\d+/);
  });
});

describe('change tracking', () => {
  it('groups approved price changes into menu versions with rollout steps, and the reprint waits for live changes', async () => {
    const { menuChanges, teamNote } = await import('../lib/data/page/menu.js');
    const d = deriveRoom(SEED, 'oakland');
    const tasks = [
      { id: 't1', roomId: 'oakland', approvalId: 'price:ribeye:45', status: 'done', createdAt: '2026-11-19T18:00:00Z' },
      { id: 't2', roomId: 'oakland', approvalId: 'price:red:15', status: 'open', createdAt: '2026-11-19T18:05:00Z' },
      { id: 't3', roomId: 'oakland', approvalId: 'price:carbonara:22.5', status: 'cancelled', createdAt: '2026-11-19T18:06:00Z' },
      { id: 't4', roomId: 'berkeley', approvalId: 'price:ribeye:43', status: 'open', createdAt: '2026-11-19T18:06:00Z' },
    ];
    const c = menuChanges(d, { tasks, rollout: { 'price:ribeye:45': { staff: '2026-11-19T19:00:00Z' } } });
    expect(c.rows.map((r) => r.dish)).toEqual(['ribeye', 'red']);
    expect(c.versions).toHaveLength(1);
    expect(c.versions[0].n).toBe(2);
    expect(c.apps).toBe(true);
    expect(c.steps.map((s) => s.k)).toEqual(['toast', 'apps', 'print', 'staff', 'check']);
    const rib = c.rows.find((r) => r.dish === 'ribeye');
    expect(rib.live).toBe(true);
    expect(rib.ticks.staff).toBeTruthy();
    expect(c.printQueue.map((r) => r.dish)).toEqual(['ribeye']);
    expect(teamNote(c.rows.filter((r) => r.live))).toBeNull();
    expect(teamNote(c.rows)).toMatch(/House Red \(glass\) is now \$15 \(was \$14\)/);
  });

  it('the rollout key refuses anything but a price change and known steps', async () => {
    const { ACTION_KEYS } = await import('../server/actions.ts');
    const sch = ACTION_KEYS['menu.rollout'].schema;
    expect(sch.safeParse({ 'price:ribeye:45': { toast: '2026-11-19T18:00:00Z' } }).success).toBe(true);
    expect(sch.safeParse({ 'drop table': { toast: 'x' } }).success).toBe(false);
    expect(sch.safeParse({ 'price:ribeye:45': { bogus: 'x' } }).success).toBe(false);
  });
});

describe('specials and deals', () => {
  it('a free plate costs its food, not its menu price, and a bundle uses the learned reaction', async () => {
    const { dealEconomics, dealResults, keptPerGuest, visitLadder } = await import('../lib/data/page/menu-deals.js');
    const d = deriveRoom(SEED, 'oakland');
    const lab = learn(d);
    const tacos = d.menu.menu.find((m) => m.key === 'tacos') || d.menu.menu.find((m) => /taco/i.test(m.name));
    const b = dealEconomics(d, lab, { kind: 'bundle', dish: tacos.key, buy: 3, takeUp: 0.25 });
    expect(b.freeCost).toBe(tacos.cost);
    expect(b.guestValue).toBe(tacos.price);
    const r = predict(lab, { ...tacos, units: tacos.units * 0.25 }, tacos.price * 0.75);
    expect(b.kept).toBeCloseTo(r.kept);
    expect(b.title).toBe(`Buy 3 ${tacos.name.toLowerCase()}, get 1 free`);

    const fries = d.menu.menu.find((m) => m.key === 'fries');
    const t = dealEconomics(d, lab, { kind: 'threshold', free: 'fries', threshold: 75, checks: 40 });
    expect(t.perWeek.foodCost).toBeCloseTo(40 * fries.cost);
    expect(t.spendUp).toBeCloseTo((40 * fries.cost) / (1 - d.week.food / d.week.net));

    const c = dealEconomics(d, lab, { kind: 'comeback', free: 'affogato', days: 30 });
    expect(c.visit).toBeCloseTo(keptPerGuest(d));
    expect(c.newShare).toBeCloseTo(c.freeCost / c.visit);
    const res = dealResults(d, { kind: 'comeback', free: 'affogato', counts: [{ week: '2026-10-19', redeemed: 14, given: 120 }] });
    expect(res.returnRate).toBeCloseTo(14 / 120);
    expect(res.kept).toBeCloseTo(14 * c.visit - 14 * c.freeCost);
    expect(visitLadder(null)).toBeNull();
    expect(visitLadder({ visits: [400, 120, 60] })[0].onward).toBeCloseTo(0.3);
  });

  it('the deals key bounds what a deal can hold', async () => {
    const { ACTION_KEYS } = await import('../server/actions.ts');
    const sch = ACTION_KEYS['menu.deals'].schema;
    expect(sch.safeParse([{ id: 'deal-1', kind: 'bundle', status: 'live', dish: 'tacos', buy: 3, at: '2026-11-19T18:00:00Z' }]).success).toBe(true);
    expect(sch.safeParse([{ id: 'deal-1', kind: 'coupon', status: 'live', at: 'x' }]).success).toBe(false);
    expect(sch.safeParse([{ id: 'deal-1', kind: 'bundle', status: 'live', buy: 99, at: 'x' }]).success).toBe(false);
  });
});
