import { describe, expect, test } from 'vitest';

import { deriveGroup, deriveRoom } from '../lib/data/model.js';
import { MATCHED_WEEKS, SEED } from '../lib/data/seed.js';

const ROOMS = ['oakland', 'berkeley', 'walnut'];
const d = Object.fromEntries(ROOMS.map((id) => [id, deriveRoom(SEED, id)]));

describe('the dataset', () => {
  test('is deterministic', async () => {
    const { buildSeed } = await import('../lib/data/seed.js');
    expect(JSON.stringify(buildSeed())).toBe(JSON.stringify(SEED));
  });

  test('every room closes: menu, staff and channels add up to the week', () => {
    for (const id of ROOMS) {
      const r = SEED.rooms[id];
      const a = r.anchor;
      expect(Math.round(d[id].week.net), id).toBe(a.net);
      expect(Math.round(d[id].week.food), id).toBe(a.food);
      expect(Math.round(d[id].week.labour), id).toBe(a.labour);
      expect(r.channels.reduce((s, c) => s + c.sales, 0), id).toBe(a.net);
      expect(r.history).toHaveLength(52);
      const sides = r.menu.find((m) => m.balancing);
      expect(sides.price, `${id} sides price`).toBeGreaterThan(3);
      expect(sides.cost, `${id} sides cost`).toBeGreaterThan(0);
      expect(sides.cost / sides.price, `${id} sides food cost`).toBeLessThan(0.6);
    }
  });

  test('size: ~40 dishes, 20+ staff, 28+ invoice lines per room', () => {
    for (const id of ROOMS) {
      expect(SEED.rooms[id].menu.length).toBeGreaterThanOrEqual(35);
      expect(SEED.rooms[id].staff.length).toBeGreaterThanOrEqual(20);
      expect(SEED.rooms[id].invoices.length).toBeGreaterThanOrEqual(28);
    }
    expect(SEED.proof.length).toBe(16);
  });

  test('matched weeks average to each room’s comparison figure', () => {
    for (const id of ROOMS) {
      const mean = MATCHED_WEEKS.reduce((s, i) => s + d[id].hist.rows[i].earned, 0) / MATCHED_WEEKS.length;
      expect(Math.round(mean)).toBe(SEED.rooms[id].anchor.matchedEarned);
    }
  });
});

describe('per-room stories hold', () => {
  test('Oakland: one post-send void signal (Kayla P., $512 over)', () => {
    const t = d.oakland.staff.types.postVoid;
    expect(t.signals.map((p) => p.name)).toEqual(['Kayla P.']);
    expect(Math.round(t.excess)).toBe(512);
    expect(d.oakland.staff.signalCount).toBe(1);
  });

  test('Walnut Creek: one comps signal (Dani K.); Berkeley: none', () => {
    expect(d.walnut.staff.types.comps.signals.map((p) => p.name)).toEqual(['Dani K.']);
    expect(d.berkeley.staff.signalCount).toBe(0);
  });

  test('usage flags', () => {
    expect(d.oakland.usage.flagged.map((r) => r.item)).toEqual(['Salmon fillet', 'Romaine hearts', 'House red (oz)', 'Bourbon (oz)']);
    expect(Math.round(d.oakland.usage.week)).toBe(167);
    expect(d.berkeley.usage.flagged.map((r) => r.item)).toEqual(['Ground chuck', 'Mozzarella, fresh']);
    expect(d.walnut.usage.flagged.map((r) => r.item)).toEqual(['Turkey breast', 'Bourbon (oz)']);
  });

  test('delivery markup ranges are honest (low end can lose money)', () => {
    expect(Math.round(d.oakland.chan.markupLo)).toBe(-7);
    expect(Math.round(d.oakland.chan.markupHi)).toBe(258);
    for (const id of ROOMS) expect(d[id].chan.markupLo).toBeLessThan(d[id].chan.markupHi);
  });

  test('banked by room; group bookable $479 with $88 paused', () => {
    expect(d.berkeley.banked.week).toBe(0);
    expect(d.walnut.banked.week).toBe(382);
    expect(d.walnut.banked.paused).toBe(88);
    const g = deriveGroup(SEED);
    expect(g.banked).toBe(479);
    expect(g.paused).toBe(88);
    expect(g.stale).toBe(3);
  });

  test('every room has a plan that fits its hours, with no prevented cost in exposure', () => {
    for (const id of ROOMS) {
      expect(d[id].plan.chosen.size).toBeGreaterThan(0);
      expect(d[id].plan.used).toBeLessThanOrEqual(d[id].room.managerHours);
      expect(d[id].exposure).toBeCloseTo(d[id].candidates.filter((c) => !c.prevent).reduce((s, c) => s + c.value, 0));
    }
  });

  test('coverage map: twelve areas per room, real screens', async () => {
    const { CV_PAGES } = await import('../lib/pages.js');
    for (const id of ROOMS) {
      expect(d[id].areas).toHaveLength(12);
      for (const a of d[id].areas) expect(a.screen === 'build' || CV_PAGES[a.screen], a.id).toBeTruthy();
    }
    expect(d.oakland.areas.find((a) => a.id === 'menu').fig).toBe('$299/wk in 3 moves');
  });

  test('content tokens all resolve', () => {
    for (const id of ROOMS) {
      const r = SEED.rooms[id];
      const texts = [...r.queue.flatMap((q) => [q.value, q.body]), ...r.meeting.map((m) => m.body)];
      for (const t of texts) expect(t.replace(/\{[\w-]+\}/g, (m) => (d[id].tokens[m.slice(1, -1)] != null ? 'ok' : m)), `${id}: ${t}`).not.toMatch(/\{[\w-]+\}/);
    }
  });
});
