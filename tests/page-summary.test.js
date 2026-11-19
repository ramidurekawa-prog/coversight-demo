import { describe, expect, test } from 'vitest';

import { deriveRoom } from '../lib/data/model.js';
import { GROUPS, LEVERS, STATUS, fixTask, leverSummary, vitalsOf } from '../lib/data/page/summary.js';
import { comparators, defaultComparator } from '../lib/data/page/week.js';
import { SEED } from '../lib/data/seed.js';

const ROOMS = Object.keys(SEED.rooms);
const opts = { matchedWeeks: SEED.matchedWeeks };

describe('Lever Check, computed', () => {
  test('every room reads every lever, and the counts add up to the levers', () => {
    for (const id of ROOMS) {
      const v = leverSummary(deriveRoom(SEED, id), opts);
      expect(v.levers.map((l) => l.id)).toEqual(LEVERS.map((l) => l.id));
      for (const l of v.levers) expect(Object.keys(STATUS), `${id} ${l.id}`).toContain(l.status);
      expect(Object.values(v.count).reduce((a, b) => a + b, 0)).toBe(LEVERS.length);
      expect(v.headline).toContain(`${v.count.good} of ${LEVERS.length}`);
      for (const l of v.levers.filter((x) => x.status !== 'nodata')) {
        expect(l.big.value, `${id} ${l.id}`).toBeTruthy();
        expect(l.big.claim, `${id} ${l.id} carries a claim`).toBeTruthy();
      }
    }
  });

  test('the week matches the This week page: same comparator, same sums', () => {
    const d = deriveRoom(SEED, 'oakland');
    const v = vitalsOf(d, opts);
    const base = defaultComparator(comparators(d.hist.rows, opts));
    expect(v.comparator).toBe(base.label);
    expect(v.sales.now).toBe(Math.round(d.week.net));
    expect(v.sales.change).toBeCloseTo(d.hist.rows.at(-1).net - base.row.net);
    expect(v.kept.now).toBe(v.sales.now - d.hist.rows.at(-1).food - d.hist.rows.at(-1).labour);
  });

  test('figures come from the model, not typed in', () => {
    const d = deriveRoom(SEED, 'oakland');
    const v = leverSummary(d, opts);
    const by = Object.fromEntries(v.levers.map((l) => [l.id, l]));
    expect(by.purchasing.big.value).toBe(`$${Math.round(d.inv.priceLeg).toLocaleString('en-US')}`);
    expect(by.controls.status).toBe('bad'); // one server over her post-send void limit
    expect(by.labour.good.text).toBe('Saving you $97 every week'); // the Thursday prep packet
    expect(v.banked).toBe(d.banked.week);
  });

  test('the first thing to do is The plan’s best ready move, never a blocked one', () => {
    const d = deriveRoom(SEED, 'oakland');
    const v = leverSummary(d, opts);
    expect(v.top.kind).toBe('move');
    expect(v.top.title).not.toMatch(/salmon from/); // waits on recipe costs
    expect(d.candidates.find((c) => c.title === v.top.title)).toBeTruthy();
  });

  test('a real group counts only its own verified windows, never the sample’s packets', () => {
    const d = deriveRoom(SEED, 'oakland');
    expect(leverSummary(d, { ...opts, windows: [] }).banked).toBe(0);
    const w = [{ roomId: 'oakland', lever: 'labour', status: 'verified', bookedCents: 4200 }, { roomId: 'berkeley', lever: 'labour', status: 'verified', bookedCents: 9900 }];
    expect(leverSummary(d, { ...opts, windows: w }).banked).toBe(42);
  });

  test('a missing feed is "no data yet", never zero', () => {
    const d = deriveRoom(SEED, 'oakland');
    const off = { ...d, feeds: d.feeds.map((f) => (f.name === 'Invoices' ? { ...f, state: 'off' } : f)) };
    const p = leverSummary(off, opts).levers.find((l) => l.id === 'purchasing');
    expect(p.status).toBe('nodata');
    expect(p.big).toBeNull();
    expect(p.missing).toEqual(['Invoices']);
  });

  test('no kitchen screen connected: Kitchen speed is locked (grey), like the Kitchen page', () => {
    const d = deriveRoom(SEED, 'oakland');
    const off = { ...d, feeds: d.feeds.map((f) => (f.name === 'Kitchen display' ? { ...f, state: 'off' } : f)) };
    const k = leverSummary(off, opts).levers.find((l) => l.id === 'kitchen');
    expect(k.status).toBe('nodata');
    expect(k.big).toBeNull();
    expect(k.fix).toBeNull();
  });

  test('a new room waiting on its first sales shows no numbers', () => {
    const d = deriveRoom(SEED, 'oakland');
    const waiting = { ...d, room: { ...d.room, profile: { ...d.room.profile, awaitingData: true } } };
    const v = leverSummary(waiting, opts);
    expect(v.vitals).toBeNull();
    expect(v.levers.every((l) => l.status === 'nodata')).toBe(true);
  });

  test('the hub: proof band, ranks, trends and what Coversight is doing all come from the data', () => {
    const group = ROOMS.map((id) => deriveRoom(SEED, id));
    const d = group[0];
    const v = leverSummary(d, { ...opts, group });
    expect(v.outcome.toDate).toBe(d.banked.toDate);
    expect(v.outcome.payback.times.toFixed(1)).toBe(d.banked.coverage.toFixed(1)); // the pinned 1.2×
    expect(v.outcome.plan.value).toBeCloseTo(d.plan.sorted.filter((c) => d.plan.chosen.has(c.id) && c.value > 0.5 && !c.prevent && !(c.needs === 'recipes')).reduce((t, c) => t + c.value, 0));
    const by = Object.fromEntries(v.levers.map((l) => [l.id, l]));
    expect(by.labour.handled.kind).toBe('testing'); // Tuesday dinner, closes Nov 3
    expect(by.labour.trend.values).toHaveLength(12);
    expect(v.handled).toBe(v.levers.filter((l) => l.handled).length);
    for (const id of ['labour', 'menu', 'controls']) {
      const ranks = group.map((g) => leverSummary(g, { ...opts, group }).levers.find((l) => l.id === id).rank.rank).sort();
      expect(ranks, id).toEqual([1, 2, 3]);
    }
    // a real group never shows the sample's packets or payback
    const real = leverSummary(d, { ...opts, group, windows: [] });
    expect(real.outcome.toDate).toBe(0);
    expect(real.outcome.payback).toBeNull();
    expect(real.levers.every((l) => !l.handled)).toBe(true);
  });

  test('the hub: every part of the restaurant sits in a group, and bar use is not counted twice', () => {
    expect(LEVERS.every((l) => GROUPS.some((g) => g.id === l.group))).toBe(true);
    const d = deriveRoom(SEED, 'oakland');
    const by = Object.fromEntries(leverSummary(d, opts).levers.map((l) => [l.id, l]));
    expect(by.inventory.big.value).toBe(`$${Math.round(d.usage.kitchenWeek)}/wk`);
    expect(by.bar.big.value).toBe(`$${Math.round(d.usage.barWeek)}/wk`);
    expect(by.sales.big.value).toBe(`$${Math.round(d.week.net).toLocaleString('en-US')}`);
    expect(by.sales.good.text).toMatch(/^\d+ more guests/);
  });

  test('a fix is approved in place with the same task id the lever page uses', () => {
    const d = deriveRoom(SEED, 'oakland');
    const v = leverSummary(d, opts);
    const by = Object.fromEntries(v.levers.map((l) => [l.id, l]));
    expect(fixTask(by.controls.fix).approvalId).toBe('void-reason');
    const price = fixTask(v.top.move);
    expect(price.approvalId).toBe('price:ribeye:44');
    expect(price.diff[0]).toEqual(['ribeye steak price', '$42', '$44']);
    expect(fixTask(by.labour.fix)).toMatchObject({ approvalId: 'lever:satpeak', system: '7shifts' });
  });
});
