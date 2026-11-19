import { describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { findingBlocked } from '../lib/data/findings.js';
import { deriveRoom, money, priceMoveInterval } from '../lib/data/model.js';
import { CORNERS, WAIT_WEEKS, menuView, plateCostRows, taskIdOf } from '../lib/data/page/menu.js';
import { blockedReason } from '../lib/data/page/week.js';
import { checkRows } from '../lib/data/page/inputs.js';
import { SEED } from '../lib/data/seed.js';

const rooms = Object.keys(SEED.rooms);

describe('Menu page figures come from the model', () => {
  it.each(rooms)('%s: the big number is the ready price changes, as on Lever Check', (id) => {
    const d = deriveRoom(SEED, id);
    const v = menuView(d);
    const ready = d.candidates.filter((c) => c.lever === 'Menu' && c.value > 0.5 && !c.prevent && !blockedReason(c, d));
    const sum = ready.reduce((s, c) => s + c.value, 0);
    expect(v.ready.map((m) => m.id).sort()).toEqual(ready.map((c) => c.id).sort());
    expect(v.big.value).toBe(ready.length ? `${money(Math.round(sum))}/wk` : money(d.menu.cmWeighted, { cents: true }));
    expect(v.headline).toContain(money(Math.round(sum)));
    expect(v.cmWeighted).toBe(d.menu.cmWeighted);
  });

  it('pins the sample Oakland page', () => {
    const v = menuView(deriveRoom(SEED, 'oakland'));
    expect(v.headline).toBe('Two changes could add $153 a week.');
    expect(v.status).toBe('watch');
    expect(v.pick.id).toBe('ribeye');
    expect(v.waiting.map((m) => m.id)).toEqual(['salmon']);
    expect(v.waiting[0].needsCost).toBe(true);
    expect(v.good).toBe('Margherita Pizza makes you the most money');
    expect(v.bad).toBe('Grilled Salmon costs too much to make (43% of its price)');
    expect(v.progress).toEqual({ done: 0, of: 3 });
    expect(v.waitCost).toBeCloseTo(v.pick.value * WAIT_WEEKS);
  });

  it('every dish sits in exactly one corner of the Plate Map, and +$1 is the model’s move', () => {
    const d = deriveRoom(SEED, 'berkeley');
    const v = menuView(d);
    const named = v.list.filter((m) => !m.balancing);
    expect(Object.values(v.corners).reduce((s, n) => s + n, 0)).toBe(named.length);
    for (const m of v.list) {
      expect(Object.keys(CORNERS)).toContain(m.corner);
      if (m.e != null) expect(m.plusOne).toBeCloseTo(priceMoveInterval(m, m.price + 1).delta);
    }
  });

  it('a change already approved counts toward the plan', () => {
    const d = deriveRoom(SEED, 'oakland');
    const ribeye = d.candidates.find((c) => c.id === 'ribeye');
    const v = menuView(d, { tasks: [{ roomId: 'oakland', approvalId: taskIdOf(ribeye), status: 'open' }] });
    expect(v.progress.done).toBe(1);
    expect(v.pick.id).toBe('carb');
    const cancelled = menuView(d, { tasks: [{ roomId: 'oakland', approvalId: taskIdOf(ribeye), status: 'cancelled' }] });
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
    expect(v.ready.map((m) => m.id)).toContain('salmon');
    expect(v.headline).toBe('Three changes could add $299 a week.');
  });
});
