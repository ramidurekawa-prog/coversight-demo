import { describe, expect, test } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { parseCSV, preview, toCSV, validate } from '../lib/data/ingest.js';
import { deriveGroup, deriveRoom, tmpl } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';

const oak = SEED.rooms.oakland;
const entry = (rows, opts) => ({ rows, date: 'Oct 28', label: 'x', n: rows.length, ...(opts ? { opts } : {}) });
const derive = (inputs, room = 'oakland') => deriveRoom(applyInputs(SEED, inputs), room);

/** Every number reachable from a derived room is finite. */
function finite(obj, path = 'd', seen = new Set()) {
  const bad = [];
  if (obj == null || typeof obj !== 'object' || seen.has(obj)) return bad;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'room' || k === 'allProof') continue;
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${path}.${k}`);
    else if (typeof v === 'string' && /NaN|undefined|Infinity/.test(v)) bad.push(`${path}.${k} = ${v}`);
    else if (v && typeof v === 'object') bad.push(...finite(v, `${path}.${k}`, seen));
  }
  return bad;
}

describe('hard ceilings and formula text (D-04, D-06)', () => {
  test('absurd values are errors, not warnings', () => {
    const res = validate('channels', [{ channel: 'DoorDash', sales: '1e308', orders: '50' }], oak, null);
    expect(res.errors).toBe(1);
    expect(res.rows).toHaveLength(0);
    expect(validate('recipes', [{ dish: 'Grilled Salmon', price: '30', cost: '250' }], oak, null).errors).toBe(1);
    expect(validate('channels', [{ channel: 'Dine-in', sales: '30000', orders: '12.5' }], oak, null).errors).toBe(1);
  });

  test('a count implying 10× what the menu needs is an error', () => {
    const res = validate('counts', [{ item: 'Salmon fillet', close: '0', received: '5000' }], oak, null);
    expect(res.errors).toBe(1);
  });

  test('formula-looking text is refused on the way in', () => {
    const res = validate('exceptions', [{ employee: '=HYPERLINK("http://x")', sales: '1000', post_send_voids: '0', comps: '0', discounts: '0' }], oak, null);
    expect(res.errors).toBe(1);
  });

  test('and neutralised on the way out; negative numbers stay numbers', () => {
    const csv = toCSV(['a', 'b', 'c'], [{ a: '=1+1', b: '-12.5', c: '@SUM(A1)' }]);
    expect(csv.split('\n')[1]).toBe("'=1+1,-12.5,'@SUM(A1)");
    expect(parseCSV(csv).rows[0].b).toBe('-12.5');
  });
});

describe('narrative follows the data (D-02)', () => {
  test('sample Oakland shows the recipe, salmon and count cards', () => {
    const d = deriveRoom(SEED, 'oakland');
    const ids = d.queue.map((q) => q.id);
    expect(ids).toEqual(expect.arrayContaining(['recipes', 'salmon', 'count', 'ot', 'cut']));
    expect(tmpl(d.queue.find((q) => q.id === 'count').title, d.tokens)).toBe('Spot-count salmon fillet, romaine hearts, house red and bourbon');
  });

  test('a recipe upload removes the stale-recipes card and line', () => {
    const d = derive({ oakland: { recipes: entry([{ dish: 'Grilled Salmon', price: 28, cost: 11.9 }]) } });
    expect(d.queue.map((q) => q.id)).not.toContain('recipes');
    const text = JSON.stringify(d.queue.map((q) => tmpl(`${q.title} ${q.body}`, d.tokens)));
    expect(text).not.toMatch(/18 days old/);
  });

  test('a clean count removes the count card and the inventory note', () => {
    const rows = oak.counts.map((c) => ({ item: c.item, close: +(c.open + c.received - (c.theo ?? 0) - 0).toFixed(2) }));
    // Close each item to exactly its theoretical usage: nothing past tolerance.
    const d0 = deriveRoom(SEED, 'oakland');
    const clean = d0.usage.rows.map((r) => ({ item: r.item, close: +(r.open + r.received - r.theo).toFixed(3) }));
    expect(rows.length).toBe(clean.length);
    const d = derive({ oakland: { counts: entry(clean) } });
    expect(d.usage.flagged).toHaveLength(0);
    expect(d.queue.map((q) => q.id)).not.toContain('count');
    const inv = d.areas.find((a) => a.id === 'inventory');
    expect(inv.note).not.toMatch(/flagged/i);
  });

  test('no gated line survives once its condition clears, in any room', () => {
    for (const id of ['oakland', 'berkeley', 'walnut']) {
      const staff = SEED.rooms[id].staff.filter((s) => s.sales > 0).map((s) => ({ employee: s.name, sales: s.sales, post_send_voids: 0, comps: 0, discounts: 0 }));
      const d = derive({ [id]: { exceptions: entry(staff) } }, id);
      expect(d.staff.signalCount, id).toBe(0);
      expect(d.queue.some((q) => q.when === 'signal:comps'), id).toBe(false);
      expect(d.alarms.some((a) => a.when === 'signal:comps'), id).toBe(false);
      expect(d.meeting.some((m) => m.when === 'signal:comps'), id).toBe(false);
    }
  });
});

describe('your own restaurant', () => {
  const profile = [{ name: 'Casa Lumen', short: 'Casa Lumen', gm: 'R. Rekawa', seats: 48, covers: 620 }];
  const menu = [
    { dish: 'Margherita', price: 18, cost: 4.2, units: 140, category: 'Pizza' },
    { dish: 'Diavola', price: 21, cost: 5.6, units: 95, category: 'Pizza' },
    { dish: 'Burrata', price: 16, cost: 6.1, units: 60, category: 'Starters' },
    { dish: 'Tiramisu', price: 11, cost: 2.4, units: 70, category: 'Dessert' },
    { dish: 'House red, glass', price: 13, cost: 3.1, units: 180, category: 'Wine' },
  ];
  const team = [
    { employee: 'Ari', role: 'Server', sales: 26000, post_send_voids: 180, comps: 220, discounts: 300, hours: 32, rate: 17 },
    { employee: 'Bo', role: 'Server', sales: 24000, post_send_voids: 900, comps: 260, discounts: 280, hours: 30, rate: 17 },
    { employee: 'Cy', role: 'Bartender', sales: 9000, post_send_voids: 40, comps: 120, discounts: 60, hours: 28, rate: 18 },
    { employee: 'Dee', role: 'Line cook', sales: 0, post_send_voids: 0, comps: 0, discounts: 0, hours: 40, rate: 22 },
    { employee: 'Eli', role: 'Line cook', sales: 0, post_send_voids: 0, comps: 0, discounts: 0, hours: 38, rate: 21 },
  ];
  const counts = [{ item: 'Mozzarella (lb)', close: 12, open: 20, received: 140, expected: 120, unit: 'lb', unit_cost: 5.4 }];

  test('every row validates in replace mode', () => {
    expect(validate('profile', profile, oak, null).errors).toBe(0);
    expect(validate('recipes', menu, oak, null, { replace: true }).errors).toBe(0);
    expect(validate('exceptions', team, oak, null, { replace: true }).errors).toBe(0);
    expect(validate('counts', counts, oak, null).errors).toBe(0);
    expect(validate('recipes', [{ dish: 'Calzone', price: 19, cost: 5 }], oak, null).errors).toBe(1);
  });

  const inputs = {
    oakland: {
      profile: entry(profile),
      recipes: entry(menu, { replace: true }),
      exceptions: entry(team, { replace: true }),
      counts: entry(counts),
    },
  };

  test('the room becomes the restaurant entered, with no NaN anywhere', () => {
    const d = derive(inputs);
    expect(d.profile.name).toBe('Casa Lumen');
    expect(d.menu.menu.map((m) => m.name)).toEqual(menu.map((m) => m.dish));
    expect(Math.round(d.week.gross)).toBe(menu.reduce((s, m) => s + m.price * m.units, 0));
    expect(Math.round(d.week.labour)).toBe(Math.round(team.reduce((s, p) => s + p.hours * p.rate, 0)));
    expect(d.week.covers).toBe(620);
    expect(d.staff.people.map((p) => p.name)).toEqual(['Ari', 'Bo', 'Cy']);
    expect(d.usage.flagged.map((r) => r.item)).toContain('Mozzarella (lb)');
    expect(finite(d)).toEqual([]);
    const text = [...d.queue, ...d.meeting].map((q) => tmpl(`${q.title || q.k} ${q.body} ${q.value || ''}`, d.tokens)).join(' ');
    expect(text).not.toMatch(/\{[\w-]+\}/);
    expect(text).not.toMatch(/salmon|\bAna\b|\bJess\b|Oakland/i);
  });

  test('own dishes get Modelled price moves; verified dollars never move', () => {
    const d = derive(inputs);
    const own = d.candidates.filter((c) => c.own);
    expect(own.length).toBeGreaterThan(0);
    own.forEach((c) => { expect(c.claim).toBe('mod'); expect(c.hi).toBeGreaterThan(c.lo); });
    expect(d.banked.week).toBe(deriveRoom(SEED, 'oakland').banked.week);
    const pv = preview(SEED, {}, 'oakland', 'recipes', menu, { replace: true });
    expect(pv.frozen.every((f) => f.same)).toBe(true);
  });

  test('the group still derives and names the new room', () => {
    const g = deriveGroup(applyInputs(SEED, inputs));
    expect(g.rows.find((r) => r.id === 'oakland').name).toBe('Casa Lumen');
    expect(Number.isFinite(g.earned)).toBe(true);
  });

  test('a replaced menu with sample everything else scales the rest', () => {
    const d = derive({ oakland: { recipes: entry(menu, { replace: true }) } });
    expect(d.week.net).toBeGreaterThan(0);
    expect(d.week.labourRate).toBeLessThan(0.5);
    expect(finite(d)).toEqual([]);
  });
});
