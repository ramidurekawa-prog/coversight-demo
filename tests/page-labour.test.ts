import { describe, expect, test } from 'vitest';

import { heat, densify } from '../lib/data/dense.js';
import { deriveRoom } from '../lib/data/model.js';
import {
  changeText, checkEntry, costByRole, coverage, dayOfTitle, entryTotals, gapGrid, groupShare, hourLabel, loadGridFromHeat, loadGridFromPlans, moves, peakCell, planServices, sampleServices, serverWage, shortPhrase,
  splitMoves, stageOf, topIssue, trustOf, weekDays, weekSummary, weekTotals, withEntry,
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
    expect(shortPhrase([{ label: '6 PM', by: 1 }, { label: '7 PM', by: 2 }])).toBe('up to 2 servers short, 6 PM to 8 PM');
    expect(shortPhrase([{ label: '5 PM', by: 1 }, { label: '8 PM', by: 2 }])).toBe('short at 5 PM (1) and 8 PM (2)');
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

  test('the week reconciles: short and spare hours across the seven days equal the room’s weekly figures', () => {
    for (const id of rooms) {
      const wk = weekDays(sampleServices(ds.rooms[id].labour));
      expect(wk.map((x) => x.day)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
      expect(wk.every((x) => x.svc), id).toBe(true);
      const t = weekTotals(wk);
      expect(t.short, id).toBe(ds.rooms[id].labour.kpis.short);
      expect(t.spare, id).toBe(ds.rooms[id].labour.kpis.idle);
      const sm = weekSummary(wk);
      expect(sm.shortage!.cov.short).toBe(Math.max(...wk.map((x) => x.cov!.short)));
      expect(sm.excess!.cov.spare).toBe(Math.max(...wk.map((x) => x.cov!.spare)));
      expect(sm.missing).toEqual([]);
    }
    const partial = weekDays([{ key: 'x', day: 'Mon', label: 'Monday', hours: [{ label: '5 PM', sched: 3, need: 3, covers: 10 }] }]);
    expect(partial.map((x) => x.status)).toEqual(['ok', 'missing', 'missing', 'missing', 'missing', 'missing', 'missing']);
    expect(weekSummary(partial)).toMatchObject({ shortage: null, excess: null, missing: ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] });
    expect(weekSummary(partial).matched!.day).toBe('Mon');
  });

  test('moves are unique, say the exact change, and cost comes from hours × the servers’ rate', () => {
    for (const id of rooms) {
      const d = deriveRoom(ds, id);
      const wage = serverWage(d.room.staff)!;
      const svcs = sampleServices(d.room.labour);
      const list = moves({ services: svcs, candidates: d.candidates, draft: d.room.labour.draft, wage });
      expect(new Set(list.map((m) => m.id)).size).toBe(list.length);
      expect(list[0].kind).toBe('cover');
      for (const m of list.filter((x) => x.kind === 'cover')) { expect(m.title).toMatch(/^Add /); expect(m.cost).toBe(Math.round(m.hours * wage)); expect(m.stage).toBe('opportunity'); }
      for (const m of list.filter((x) => x.kind === 'spare')) { expect(m.title).toMatch(/^Schedule /); expect(m.cost).toBe(-Math.round(m.hours * wage)); }
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
    expect(changeText('add', [{ label: '7 PM', by: 1 }, { label: '8 PM', by: 1 }])).toBe('Add 1 server, 7 PM to 9 PM');
    expect(changeText('add', [{ label: '6 PM', by: 1 }, { label: '7 PM', by: 2 }])).toBe('Add up to 2 servers, 6 PM to 8 PM');
    expect(changeText('add', [{ label: '5 PM', by: 1 }, { label: '8 PM', by: 2 }])).toBe('Add 1 at 5 PM and 2 at 8 PM');
    expect(changeText('cut', [{ label: '9 PM', by: 1 }])).toBe('Schedule 1 fewer server, 9 PM to 10 PM');
    expect(dayOfTitle('Start Sunday brunch staff 30 minutes earlier')).toBe('Sun');
    expect(dayOfTitle('Move 4 hours off Iris’s week')).toBeNull();
  });

  test('confidence follows the data: stale feeds and thin history lower it', () => {
    const m = { kind: 'cover', day: 'Sat' };
    const ok = { state: 'healthy', last: '40 min ago' };
    expect(trustOf(m, { weeks: 13, feed: ok, rate: 5.61 })).toMatchObject({ confidence: 'High', quality: 'Complete', basis: '13 Saturdays of covers and servers on the floor' });
    expect(trustOf(m, { weeks: 5, feed: ok }).confidence).toBe('Medium');
    expect(trustOf(m, { weeks: 2, feed: ok }).confidence).toBe('Low');
    expect(trustOf(m, { weeks: 13, feed: { state: 'stale', last: '18 hours ago' } })).toMatchObject({ confidence: 'Low', quality: 'Schedule feed is out of date' });
    expect(trustOf({ kind: 'candidate', p: 0.62, claim: 'mod' }, { feed: ok }).confidence).toBe('Medium');
    expect(trustOf({ kind: 'candidate', p: 0.95, claim: 'obs', prevent: true }, { feed: ok }).confidence).toBe('High');
    expect(stageOf('limited')).toBe('verified');
    expect(stageOf('testing')).toBe('testing');
    expect(stageOf('reversed')).toBe('reversed');
  });

  test('cost by role adds up to the week’s hourly labor', () => {
    for (const id of rooms) {
      const d = deriveRoom(ds, id);
      const r = costByRole(d.room.staff);
      expect(Math.abs(r.total - d.week.labour)).toBeLessThan(1);
      expect(Math.abs(r.foh + r.boh - r.total)).toBeLessThan(0.01);
      expect(r.roles.find((x) => x.role === 'Server')!.foh).toBe(true);
      expect(r.roles.find((x) => x.role === 'Line cook')!.foh).toBe(false);
    }
    expect(groupShare([{ net: 100, labour: 20 }, { net: 300, labour: 100 }])).toBeCloseTo(0.3);
    const g = gapGrid(sampleServices(ds.rooms.walnut.labour));
    expect(g.rows.length).toBe(7);
    expect(g.rows.flatMap((r) => r.cells).filter((v) => v != null && v < 0).reduce((t, v) => t - (v as number), 0)).toBe(ds.rooms.walnut.labour.kpis.short);
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
    expect(ACTION_KEYS['labour.view'].schema.safeParse('ops').success).toBe(true);
    expect(ACTION_KEYS['labour.view'].schema.safeParse('chef').success).toBe(false);
  });
});
