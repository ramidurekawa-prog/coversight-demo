import { describe, expect, test } from 'vitest';

import { heat, densify } from '../lib/data/dense.js';
import { deriveRoom } from '../lib/data/model.js';
import {
  checkEntry, coverage, entryTotals, hourLabel, loadGridFromHeat, loadGridFromPlans, moves, peakCell, planServices, sampleServices, shortPhrase, splitMoves, topIssue, withEntry,
} from '../lib/data/page/labour.js';
import { buildSeed } from '../lib/data/seed.js';
import { ACTION_KEYS } from '../server/actions';

const ds: any = buildSeed();
const rooms = Object.keys(ds.rooms);

describe('Labor page', () => {
  test('every sample room has services whose hours line up', () => {
    for (const id of rooms) {
      const svcs = sampleServices(ds.rooms[id].labour);
      expect(svcs.length, id).toBeGreaterThan(0);
      for (const s of svcs) {
        expect(s.hours.length).toBeGreaterThan(0);
        for (const h of s.hours) { expect(Number.isFinite(h.sched)).toBe(true); expect(Number.isFinite(h.need)).toBe(true); expect(h.label).toMatch(/^\d{1,2} (AM|PM)$/); }
      }
    }
  });

  test('coverage is counted from the hours, never typed', () => {
    const sat = sampleServices(ds.rooms.walnut.labour).find((s) => s.key === 'sat')!;
    const c = coverage(sat);
    expect(c.short).toBe(2);
    expect(c.shortAt.map((x) => x.label)).toEqual(['7 PM', '8 PM']);
    expect(c.spare).toBe(1);
    expect(shortPhrase(c.shortAt)).toBe('one server short at 7 PM and 8 PM');
    expect(shortPhrase([{ label: '6 PM', by: 1 }, { label: '7 PM', by: 2 }])).toBe('short at 6 PM (1) and 7 PM (2)');
  });

  test('the first thing to look at is the service with the most short hours', () => {
    for (const id of rooms) {
      const svcs = sampleServices(ds.rooms[id].labour);
      const top = topIssue(svcs)!;
      const most = Math.max(...svcs.map((s) => coverage(s).short));
      expect(top.cov.short, id).toBe(most);
      expect(top.kind).toBe(most > 0 ? 'short' : 'spare');
    }
    expect(topIssue([{ key: 'x', day: 'Mon', label: 'Monday', hours: [{ label: '5 PM', sched: 3, need: 3, covers: 10 }] }])).toBeNull();
  });

  test('moves are unique, lead with service risk and never claim a saving for coverage', () => {
    for (const id of rooms) {
      const d = deriveRoom(ds, id);
      const list = moves({ services: sampleServices(d.room.labour), candidates: d.candidates, draft: d.room.labour.draft });
      expect(new Set(list.map((m) => m.id)).size).toBe(list.length);
      expect(list[0].kind).toBe('cover');
      expect(list[0].worthNote).toBe('No savings claimed');
      for (const m of list.filter((x) => x.kind === 'candidate')) {
        const c = d.candidates.find((x: any) => x.id === m.finding);
        expect(c.lever).toBe('Labour');
        expect(m.value).toBe(c.value);
      }
      const split = splitMoves(list, { [list[0].id]: { s: 'planned', at: 'now' }, [list[1].id]: { s: 'skipped', at: 'now' } });
      expect(split.planned.map((m) => m.id)).toEqual([list[0].id]);
      expect(split.skipped.map((m) => m.id)).toEqual([list[1].id]);
      expect(split.open.length).toBe(list.length - 2);
    }
  });

  test('a room on its own clock-ins uses the same shapes', () => {
    const plans = { Fri: { hours: [{ hour: 17, covers: 20, servers: 4.2, need: 4 }, { hour: 18, covers: 44, servers: 5, need: 7 }] }, Mon: null };
    const svcs = planServices(plans);
    expect(svcs.map((s) => s.key)).toEqual(['Fri']);
    expect(coverage(svcs[0])).toMatchObject({ short: 2, spare: 0 });
    const g = loadGridFromPlans(plans);
    expect(g.hours.map((h) => h.label)).toEqual(['5 PM', '6 PM']);
    expect(g.rows[0].cells).toEqual([4.8, 8.8]);
    expect(hourLabel(0)).toBe('12 AM');
    expect(hourLabel(12)).toBe('12 PM');
  });

  test('the load grid only shows hours that have readings', () => {
    const dense = densify(ds.rooms.oakland)!;
    const g = loadGridFromHeat(heat(dense.hours));
    expect(g.rows.length).toBe(7);
    expect(g.hours.length).toBeGreaterThan(0);
    for (const r of g.rows) expect(r.cells.length).toBe(g.hours.length);
    const top: any = peakCell(g);
    expect(top.v).toBe(Math.max(...g.rows.flatMap((r) => r.cells.filter((v): v is number => v != null))));
  });

  test('hand-entered days are checked, kept one per date, and accepted by the server schema', () => {
    expect(checkEntry({ date: '2026-10-20' }).ok).toBe(false);
    expect(checkEntry({ date: 'yesterday', cost: 10 }).ok).toBe(false);
    expect(checkEntry({ date: '2026-10-28', cost: 10 }, { today: '2026-10-27' }).ok).toBe(false);
    expect(checkEntry({ date: '2026-10-20', cost: -1 }).ok).toBe(false);
    const a = checkEntry({ date: '2026-10-20', cost: '1290.456', hours: '86', sched: '' });
    expect(a).toEqual({ ok: true, entry: { date: '2026-10-20', cost: 1290.46, hours: 86 } });
    const b = checkEntry({ date: '2026-10-20', cost: 1300 });
    const c = checkEntry({ date: '2026-10-21', hours: 80 });
    let list = withEntry([], (a as any).entry);
    list = withEntry(list, (b as any).entry);
    list = withEntry(list, (c as any).entry);
    expect(list.map((e: any) => e.date)).toEqual(['2026-10-21', '2026-10-20']);
    expect(entryTotals(list, '2026-10-19', '2026-10-25')).toEqual({ days: 2, cost: 1300, hours: 80, sched: null });
    expect(entryTotals(list, '2026-10-26', '2026-11-01')).toEqual({ days: 0, cost: null, hours: null, sched: null });
    const schema = ACTION_KEYS['labour.entries'].schema;
    expect(schema.safeParse(list).success).toBe(true);
    expect(schema.safeParse([{ date: '10/20/2026', cost: 5 }]).success).toBe(false);
    expect(schema.safeParse([{ date: '2026-10-20', cost: -5 }]).success).toBe(false);
    expect(ACTION_KEYS['labour.moves'].schema.safeParse({ 'cover:sat': { s: 'planned', at: '2026-10-27T00:00:00Z' } }).success).toBe(true);
    expect(ACTION_KEYS['labour.moves'].schema.safeParse({ 'cover:sat': { s: 'done', at: 'x' } }).success).toBe(false);
  });
});
