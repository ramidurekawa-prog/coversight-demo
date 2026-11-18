import { describe, expect, test } from 'vitest';

import { heat, densify } from '../lib/data/dense.js';
import { deriveRoom } from '../lib/data/model.js';
import {
  changeText, checkEntry, costByRole, coverage, dayOfTitle, entryTotals, gapGrid, groupShare, hourLabel, loadGridFromHeat, loadGridFromPlans, moves, peakCell, planServices, sampleServices, serverWage, shortPhrase,
  splitMoves, stageOf, topIssue, trustOf, weekDays, weekSummary, weekTotals, withEntry,
  checkCrew, deptSplit, followUps, forecastWeek, kitchenLoad, lineCheck, loadGridFromServices, mathChecks, needFor,
} from '../lib/data/page/labour.js';
import { covercastRoom, serverRate, shiftPulseDay } from '../lib/data/forecast/index.js';
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
      for (const m of list.filter((x) => x.kind === 'cover')) { expect(m.title).toMatch(/^Add /); expect(m.cost).toBe(Math.round(m.hours! * wage)); expect(m.stage).toBe('opportunity'); }
      for (const m of list.filter((x) => x.kind === 'spare')) { expect(m.title).toMatch(/^Schedule /); expect(m.cost).toBe(-Math.round(m.hours! * wage)); }
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
    expect(g.rows.flatMap((r) => r.cells).filter((v) => v != null && v < 0).reduce((t: number, v) => t - (v as number), 0)).toBe(ds.rooms.walnut.labour.kpis.short);
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

  test('servers needed follows one rule in every hour: guests ÷ pace, rounded up', () => {
    for (const id of rooms) {
      const L = ds.rooms[id].labour;
      for (const svc of sampleServices(L)) for (const h of svc.hours) expect(needFor(h.covers, L.kpis.rate), `${id} ${svc.key} ${h.label}`).toBe(h.need);
    }
    expect(needFor(0, 5)).toBe(1);
    expect(needFor(11, 5)).toBe(3);
    expect(needFor(10, 0)).toBeNull();
  });

  test('the guests-per-server grid comes from the same services as the chart', () => {
    for (const id of rooms) {
      const L = ds.rooms[id].labour, svcs = sampleServices(L), g = loadGridFromServices(svcs);
      expect(g.rows.length).toBe(7);
      for (const r of g.rows) {
        const svc = svcs.find((x: any) => x.day === r.day)!;
        r.cells.forEach((v: number | null, i: number) => {
          const h = svc.hours.find((x: any) => x.label === g.hours[i].label);
          expect(v).toBe(h ? Math.round((h.covers / h.sched) * 10) / 10 : null);
          /* above the pace exactly when the hour is short */
          if (h) expect(h.covers / h.sched > L.kpis.rate).toBe(h.sched < h.need);
        });
      }
    }
  });

  test('the page checks its own math, and the sample passes', () => {
    for (const id of rooms) {
      const room = ds.rooms[id], d: any = deriveRoom(ds, id), svcs = sampleServices(room.labour);
      const checks = mathChecks({ services: svcs, rate: room.labour.kpis.rate, roles: costByRole(room.staff), weekLabour: d.week.labour, totals: weekTotals(weekDays(svcs)), kpis: room.labour.kpis, feed: { state: 'healthy', last: 'now' } });
      expect(checks.map((c: any) => c.key)).toEqual(['need', 'week', 'roles', 'feed']);
      for (const c of checks) expect(c.ok, `${id} ${c.key}: ${c.detail}`).toBe(true);
    }
    const bad = mathChecks({ services: [{ day: 'Mon', hours: [{ label: '5 PM', covers: 30, sched: 3, need: 3 }] }], rate: 5, feed: { state: 'stale', last: '18 hours ago' } } as any);
    expect(bad[0].ok).toBe(false);
    expect(bad[0].detail).toContain('Mon 5 PM');
    expect(bad.at(-1)!.ok).toBe(false);
    expect(mathChecks({})[0].ok).toBeNull();
  });

  test('recorded plans are followed up against the latest data', () => {
    const list = [{ id: 'cover:sat', title: 'Add 1 server', where: 'Saturday dinner', day: 'Sat' }];
    const f = followUps({ 'cover:sat': { s: 'planned', at: 'x' }, 'cover:mon': { s: 'planned', at: 'y', t: 'Add 2 servers' }, 'spare:tue': { s: 'skipped', at: 'z' } }, list);
    expect(f.waiting.map((x: any) => x.id)).toEqual(['cover:sat']);
    expect(f.closed).toEqual([{ id: 'cover:mon', title: 'Add 2 servers', at: 'y' }]);
    expect(ACTION_KEYS['labour.moves'].schema.safeParse({ 'cover:sat': { s: 'planned', at: '2026-10-27T00:00:00Z', t: 'Add 1 server' } }).success).toBe(true);
  });

  test('front of house and kitchen split adds up to the week', () => {
    for (const id of rooms) {
      const room = ds.rooms[id], d: any = deriveRoom(ds, id);
      const depts = deptSplit(room.staff, { net: d.week.net, covers: d.week.covers }, room.levers.ot);
      expect(depts.map((x: any) => x.key)).toEqual(['foh', 'boh']);
      expect(depts.reduce((t: number, x: any) => t + x.cost, 0)).toBeCloseTo(d.week.labour, 0);
      expect(depts.reduce((t: number, x: any) => t + x.share, 0)).toBeCloseTo(1, 3);
      expect(depts.reduce((t: number, x: any) => t + x.ofSales, 0)).toBeCloseTo(d.week.labourRate, 3);
      for (const x of depts) {
        expect(x.wage).toBeCloseTo(x.cost / x.hours, 2);
        expect(x.perGuest).toBeCloseTo(x.cost / d.week.covers, 2);
        expect(x.roles.reduce((t: number, r: any) => t + r.people, 0)).toBe(x.people);
      }
      expect(depts[1].otHours).toBe(Math.round((room.levers.ot.boh.at(-1) / 60) * 10) / 10);
      expect(depts[1].roles.map((r: any) => r.role)).toContain('Line cook');
    }
    expect(deptSplit([], {})).toEqual([]);
  });

  test('kitchen speed by hour marks every hour over target and finds the slowest run', () => {
    const k: any = kitchenLoad([
      { dow: 'Fri', hour: 18, tickets: 10, ticketMin: 13 }, { dow: 'Fri', hour: 18, tickets: 14, ticketMin: 15 },
      { dow: 'Fri', hour: 19, tickets: 20, ticketMin: 18 }, { dow: 'Fri', hour: 20, tickets: 18, ticketMin: 16 },
      { dow: 'Sat', hour: 19, tickets: 22, ticketMin: 15 }, { dow: 'Sat', hour: 20, tickets: 0, ticketMin: 0 },
    ], 14);
    expect(k.hours.map((h: any) => h.label)).toEqual(['6 PM', '7 PM', '8 PM']);
    expect(k.rows.map((r: any) => r.day)).toEqual(['Fri', 'Sat']);
    expect(k.rows[0].cells[0]).toEqual({ hour: 18, label: '6 PM', tickets: 12, min: 14, over: 0 });
    expect(k.rows[0].cells[1].over).toBe(4);
    expect(k.rows[1].cells[2]).toBeNull();
    expect(k.lateHours).toBe(3);
    expect(k.worst).toEqual({ day: 'Fri', from: '7 PM', to: '9 PM', hours: 2, min: 18 });
    expect(kitchenLoad([], 14)).toBeNull();
    expect(kitchenLoad([{ dow: 'Fri', hour: 18, tickets: 10, ticketMin: 13 }], 0)).toBeNull();
    for (const id of rooms) {
      const real: any = kitchenLoad(densify(ds.rooms[id])!.hours, ds.rooms[id].tickets.target);
      expect(real.rows.length).toBe(7);
      expect(real.lateHours).toBe(real.rows.reduce((t: number, r: any) => t + r.cells.filter((c: any) => c?.over).length, 0));
    }
  });

  test('cooks by the hour tell a people problem from a station problem', () => {
    const cells = [
      { hour: 17, label: '5 PM', tickets: 12, min: 12, over: 0 },
      { hour: 18, label: '6 PM', tickets: 16, min: 13, over: 0 },
      { hour: 19, label: '7 PM', tickets: 24, min: 18, over: 4 },
      { hour: 20, label: '8 PM', tickets: 12, min: 16, over: 2 },
      { hour: 21, label: '9 PM', tickets: 8, min: 15, over: 1 },
    ];
    const l = lineCheck(cells, { 17: 3, 18: 4, 19: 4, 20: 4 } as any);
    expect(l.usual).toBe(4);
    expect(l.stretched.map((r: any) => r.label)).toEqual(['7 PM']);
    expect(l.station.map((r: any) => r.label)).toEqual(['8 PM']);
    expect(l.rows.at(-1)).toMatchObject({ cooks: null, perCook: null, read: null });
    expect(lineCheck(cells, null as any).usual).toBeNull();
    expect(checkCrew({ 17: '3', 18: '4.2', 19: '' })).toEqual({ ok: true, crew: { 17: 3, 18: 4 } });
    expect(checkCrew({ 17: '99' }).ok).toBe(false);
    expect(checkCrew({}).ok).toBe(false);
    const schema = ACTION_KEYS['labour.crew'].schema;
    expect(schema.safeParse({ Fri: { 17: 3, 18: 4.5 } }).success).toBe(true);
    expect(schema.safeParse({ Friday: { 17: 3 } }).success).toBe(false);
    expect(schema.safeParse({ Fri: { 25: 3 } }).success).toBe(false);
    expect(schema.safeParse({ Fri: { 17: 99 } }).success).toBe(false);
  });

  test('the sample has one server pace: lever hours and the 13-week rows follow labour.kpis.rate', () => {
    for (const id of rooms) {
      const room = ds.rooms[id], pace = room.labour.kpis.rate;
      /* the pace measured from the lever hours (what the forecast sizes servers with) sits within half a guest of the Labor page's */
      expect(Math.abs(serverRate(room)! - pace), id).toBeLessThan(0.5);
      for (const h of densify(room)!.hours) expect(h.servers).toBe(Math.max(2, Math.ceil(h.covers / pace)));
    }
  });

  test('next week is the forecast held against the schedule the room runs now', () => {
    const svcs = [{ day: 'Mon', label: 'Monday dinner', hours: [{ label: '5 PM', sched: 3 }, { label: '6 PM', sched: 5 }, { label: '7 PM', sched: 5 }] }];
    const w = forecastWeek([
      { iso: '2026-10-26', weekday: 'Monday', hours: [{ hour: 12, covers: 30, low: 25, high: 35, serversPlan: 6 }, { hour: 17, covers: 14, low: 12, high: 16, serversPlan: 3 }, { hour: 18, covers: 24, low: 21, high: 27, serversPlan: 6 }, { hour: 19, covers: 20, low: 18, high: 22, serversPlan: 4 }] },
      { iso: '2026-10-27', weekday: 'Tuesday', hours: [{ hour: 18, covers: 20, low: 18, high: 22, serversPlan: 4 }] },
    ], svcs);
    expect(w.days[0]).toMatchObject({ day: 'Mon', covers: 58, low: 51, high: 65, peak: { label: '6 PM', need: 6 }, short: 1, spare: 1 });
    expect(w.days[0].hours.length).toBe(3); // noon is not on the schedule, so it is not judged
    expect(w.days[1]).toMatchObject({ day: 'Tue', svc: null, short: 0 });
    expect(w).toMatchObject({ short: 1, spare: 1 });
    expect(w.worst!.day).toBe('Mon');
    for (const id of rooms) {
      const room = ds.rooms[id], cc: any = covercastRoom(room, { accuracy: false });
      const real = forecastWeek(cc.covers.days.slice(0, 7).map((x: any) => { const sp: any = shiftPulseDay(cc, x.iso); return { iso: x.iso, weekday: x.weekday, hours: [...(sp.lunch?.hours || []), ...(sp.dinner?.hours || [])] }; }), sampleServices(room.labour));
      expect(real.days.length).toBe(7);
      for (const x of real.days) { expect(x.hours.length, `${id} ${x.day}`).toBeGreaterThan(0); expect(x.low).toBeLessThanOrEqual(x.covers!); expect(x.high).toBeGreaterThanOrEqual(x.covers!); }
      expect(real.short).toBe(real.days.reduce((t: number, x: any) => t + x.short, 0));
    }
  });
});
