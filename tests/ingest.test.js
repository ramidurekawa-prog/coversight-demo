import { describe, expect, test } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { mapColumns, parseCSV, preview, templateCSV, validate } from '../lib/data/ingest.js';
import { deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';

const oak = SEED.rooms.oakland;

describe('CSV', () => {
  test('quotes, escaped quotes, CRLF, BOM and blank lines', () => {
    const { headers, rows } = parseCSV('﻿dish,price\r\n"Grilled Salmon, wild",30\r\n\r\n"The ""Big"" Burger",19\r\n');
    expect(headers).toEqual(['dish', 'price']);
    expect(rows).toEqual([{ dish: 'Grilled Salmon, wild', price: '30' }, { dish: 'The "Big" Burger', price: '19' }]);
  });

  test('headers map by alias, case and punctuation', () => {
    const m = mapColumns(['Menu Item', 'Sell Price', 'Plate_Cost', 'Notes'], 'recipes');
    expect(m.map).toEqual({ 'Menu Item': 'dish', 'Sell Price': 'price', Plate_Cost: 'cost' });
    expect(m.missing).toEqual([]);
    expect(m.ignored).toEqual(['Notes']);
  });

  test('templates round-trip through the parser and validate clean', () => {
    for (const kind of ['recipes', 'invoices', 'counts', 'channels', 'exceptions']) {
      const { headers, rows } = parseCSV(templateCSV(kind, oak));
      const res = validate(kind, rows, oak, mapColumns(headers, kind).map);
      expect(res.errors, kind).toBe(0);
    }
  });
});

describe('validation', () => {
  test('recipes: unknown dish and cost ≥ price are errors; fence breach is a warning', () => {
    const res = validate('recipes', [
      { dish: 'Grilled Salmon', price: '$30.00', cost: '11.90' },
      { dish: 'Lobster Roll', price: '30', cost: '12' },
      { dish: 'Ribeye Steak', price: '42', cost: '44' },
      { dish: 'Pasta Carbonara', price: '25', cost: '5.10' },
      { dish: 'Caesar Salad', price: 'abc', cost: '3' },
    ], oak, null);
    expect(res.rows.map((r) => r.dish)).toEqual(['Grilled Salmon', 'Pasta Carbonara']);
    expect(res.errors).toBe(3);
    expect(res.issues.find((x) => x.row === 4).msg).toMatch(/past your 8% fence/);
    expect(res.issues.find((x) => x.row === 5).msg).toMatch(/isn't a number/);
  });

  test('counts: negative implied usage is an error', () => {
    const res = validate('counts', [{ item: 'Salmon fillet', close: '999' }], oak, null);
    expect(res.errors).toBe(1);
  });

  test('duplicates are errors', () => {
    const res = validate('channels', [{ channel: 'DoorDash', sales: '2000', orders: '50' }, { channel: 'doordash', sales: '2100', orders: '52' }], oak, null);
    expect(res.errors).toBe(1);
  });
});

describe('apply and preview', () => {
  test('a recipe upload moves food cost, earned and the salmon move; never banked', () => {
    const rows = [{ dish: 'Grilled Salmon', price: 28, cost: 13.2 }];
    const pv = preview(SEED, {}, 'oakland', 'recipes', rows);
    const food = pv.moves.find((m) => m.label.startsWith('Food cost'));
    expect(food.changed).toBe(true);
    expect(food.after).toBe('$12,315');
    expect(pv.frozen.every((f) => f.same)).toBe(true);
    const after = deriveRoom(applyInputs(SEED, { oakland: { recipes: { rows, date: 'Oct 27', label: 'Recipe costs', n: 1 } } }), 'oakland');
    expect(Math.round(after.week.earned)).toBe(18755);
    expect(after.banked.week).toBe(97);
    expect(after.feeds.find((f) => f.name === 'Recipe costs').state).toBe('healthy');
    expect(after.proofs.find((p) => p.id === 'salmon-plate').outcome).toBe('testing');
  });

  test('logged waste explains part of a gap', () => {
    const rows = [{ item: 'Salmon fillet', qty: 15, reason: 'trim' }];
    const after = deriveRoom(applyInputs(SEED, { oakland: { waste: { rows, date: 'Oct 27', label: 'Waste log', n: 1 } } }), 'oakland');
    const salmon = after.usage.rows.find((r) => r.item === 'Salmon fillet');
    expect(salmon.waste).toBe(15);
    expect(salmon.flag).toBe(false);
    expect(after.usage.wasteWeek).toBeGreaterThan(0);
  });

  test('a new person on the register gets a limit, and the seed is never mutated', () => {
    const before = JSON.stringify(SEED);
    const rows = [{ employee: 'New Hire', role: 'Server', sales: 6000, post_send_voids: 400, comps: 20, discounts: 30 }];
    const after = deriveRoom(applyInputs(SEED, { oakland: { exceptions: { rows, date: 'Oct 27', label: 'x', n: 1 } } }), 'oakland');
    expect(after.staff.types.postVoid.signals.map((p) => p.name)).toContain('New Hire');
    expect(JSON.stringify(SEED)).toBe(before);
  });

  test('empty inputs reproduce the seed exactly (undo and reset)', () => {
    expect(JSON.stringify(deriveRoom(applyInputs(SEED, {}), 'walnut').week)).toBe(JSON.stringify(deriveRoom(SEED, 'walnut').week));
  });
});
