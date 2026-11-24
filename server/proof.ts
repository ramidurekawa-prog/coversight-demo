// Test windows: start one on a lever, record checkpoints as weeks of data land,
// close at day 28 with the platform's estimator (lib/data/pilot.js), and
// reverse a verified result if a guardrail breaks afterwards.
import { and, asc, eq, inArray } from 'drizzle-orm';

import { leverReport } from '../lib/data/levers.js';
import { deriveRoom } from '../lib/data/model.js';
import { guardrailCheck, proofStages, windowState } from '../lib/data/pilot.js';
import { baselineOf, controlReading, dataDay, dataEnd, dueCheckpoints, LEVER_METRIC, servicesOf, weeklySeries } from '../lib/data/readers.js';
import type { Db } from './db/client';
import { auditLog, checkpoints, testWindows } from './db/schema';
import { loadDataset } from './dataset';
import { InputError } from './org';
import { notify } from './notify';

const WINDOW_DAYS = 28;
const EVERY = 7;
const STALE_DAYS = 9; // no new week of data for this long → the window waits
const GUARD = { avgCheck: { label: 'Average check', maxDropPct: 5 }, turn: { label: 'Turn time', maxRisePct: 15 } };

type Win = typeof testWindows.$inferSelect;
type Cp = typeof checkpoints.$inferSelect;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Room = any;

function centsPerUnit(metric: string, room: Room, lever: { weekly?: number; expectedUnits?: number | null } | undefined) {
  const wage = room.levers?.wage ?? 18;
  switch (metric) {
    case 'exceptionDollars': case 'dishMargin': case 'menuMargin': return 100;
    case 'otMinutes': return Math.round(((wage * 0.5) / 60) * 100);
    case 'idleServerHours': return Math.round(wage * 100);
    default: {
      const w = lever?.weekly, u = lever?.expectedUnits;
      return w && u ? Math.max(1, Math.round(Math.abs(w / u) * 100)) : 100;
    }
  }
}

const last = <T>(a: T[]) => a[a.length - 1];

type Guard = { avgCheckBase: number; turnBase: number; projectedCents?: number | null };

/**
 * The pilot-shaped object windowState() reads, from a window and its
 * checkpoints. A guardrail week the room's own data doesn't have stays empty
 * (null): it is never filled in with the baseline, so a missing reading keeps
 * the test pending instead of quietly passing it.
 */
function pilotOf(w: Win, cps: Cp[], room: Room) {
  const g = w.guard as Guard;
  const check = weeklySeries(room, 'avgCheck');
  const turn = weeklySeries(room, 'turnMinutes');
  const weekly = [0, 7, 14, 21, 28, 35].map((d) => {
    const end = new Date(Date.parse(`${w.startedAt}T00:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
    const own = d === 0 || servicesOf(room, end) != null;
    const c = own ? check.find((p) => p.weekEnd === end)?.value : undefined;
    const t = own ? turn.find((p) => p.weekEnd === end)?.value : undefined;
    return { avgCheck: c ?? null, turn: t ?? null };
  });
  return {
    baseline: w.baseline, direction: w.direction, sign: w.direction === 'up' ? 1 : -1, centsPerUnitWeek: w.centsPerUnitWeek,
    windowDays: WINDOW_DAYS, checkpointEvery: EVERY,
    checkpoints: cps.map((c) => ({ day: c.day, observed: c.observed, controlDelta: c.controlDelta, services: c.services })),
    guardrails: { ...GUARD, avgCheckBase: g.avgCheckBase, turnBase: g.turnBase, weekly },
    projectedCents: g.projectedCents ?? null,
  };
}

/** The window's state on its current day: matched controls are used when every checkpoint has one. */
function stateOf(w: Win, cps: Cp[], room: Room, opts: { day: number; feedFailing?: boolean }) {
  const controls = cps.length > 0 && cps.every((c) => c.controlDelta != null);
  return windowState(pilotOf(w, cps, room), { ...opts, controls });
}

export async function startWindow(db: Db, v: { orgId: string; userId: string | null; rooms: string[] | null }, { roomId, lever, dish }: { roomId: unknown; lever: unknown; dish?: unknown }) {
  if (typeof roomId !== 'string' || typeof lever !== 'string' || !(lever in LEVER_METRIC)) throw new InputError('roomId and a known lever are required');
  if (v.rooms && !v.rooms.includes(roomId)) throw new InputError('That room is not one of yours.');
  const loaded = await loadDataset(db, v.orgId);
  const room = loaded?.ds.rooms[roomId];
  if (!room) throw new InputError(`no room '${roomId}' in this org`);
  const spec = LEVER_METRIC[lever as keyof typeof LEVER_METRIC];
  const open = await db.select({ id: testWindows.id }).from(testWindows)
    .where(and(eq(testWindows.orgId, v.orgId), eq(testWindows.roomId, roomId), eq(testWindows.lever, lever), inArray(testWindows.status, ['running', 'waiting'])));
  if (open.length) throw new InputError('A test on this lever is already running in this room.');
  let dishKey: string | null = null;
  if (spec.metric === 'dishMargin') {
    dishKey = typeof dish === 'string' ? dish : null;
    if (!dishKey || !room.menu.some((m: { key: string }) => m.key === dishKey) || !room.levers?.priceHistory?.[dishKey]) throw new InputError('Pick a dish with price history to test.');
  }
  const series = weeklySeries(room, spec.metric, { dish: dishKey ?? undefined });
  const startedAt = dataEnd(room);
  const baseline = baselineOf(series, startedAt);
  if (baseline == null || series.filter((p) => p.weekEnd <= startedAt).length < 2) throw new InputError('Not enough weeks of data on this lever to set a baseline (needs 2+).');
  const d = deriveRoom(loaded!.ds, roomId);
  const l = leverReport(room, d).find((x: { key: string }) => x.key === lever);
  const check = baselineOf(weeklySeries(room, 'avgCheck'), startedAt) ?? 0;
  const turn = baselineOf(weeklySeries(room, 'turnMinutes'), startedAt) ?? 0;
  const title = `${l?.name ?? lever}: ${spec.metric === 'dishMargin' ? room.menu.find((m: { key: string }) => m.key === dishKey).name : l?.scope ?? room.profile.short}`;
  const [row] = await db.insert(testWindows).values({
    orgId: v.orgId, roomId, lever, metric: spec.metric, dish: dishKey, title, direction: spec.direction, baseline,
    centsPerUnitWeek: centsPerUnit(spec.metric, room, l), startedAt,
    // projectedCents: the lever's own weekly estimate at the start, kept apart from what is measured and verified.
    guard: { avgCheckBase: check, turnBase: turn, projectedCents: l?.weekly > 0 ? Math.round(l.weekly * 100) : null }, userId: v.userId,
  }).returning();
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'window.started', detail: { id: row!.id, roomId, lever, baseline, startedAt } });
  return row!;
}

export async function stopWindow(db: Db, v: { orgId: string; userId: string; rooms: string[] | null }, id: string) {
  const [w] = await db.select().from(testWindows).where(and(eq(testWindows.orgId, v.orgId), eq(testWindows.id, id)));
  if (!w) throw new InputError('no such test');
  if (v.rooms && !v.rooms.includes(w.roomId)) throw new InputError('That room is not one of yours.');
  if (!['running', 'waiting'].includes(w.status)) throw new InputError('Only a running test can be stopped.');
  await db.update(testWindows).set({ status: 'stopped', closedAt: new Date(), updatedAt: new Date() }).where(eq(testWindows.id, id));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'window.stopped', detail: { id } });
}

/** Every window in the org with its live state; `now` decides whether data is stale. */
export async function listWindows(db: Db, orgId: string, roomScope: string[] | null = null, now = new Date()) {
  const loaded = await loadDataset(db, orgId);
  if (!loaded) return [];
  const ws = await db.select().from(testWindows).where(eq(testWindows.orgId, orgId)).orderBy(asc(testWindows.createdAt));
  const ids = ws.map((w) => w.id);
  const cps = ids.length ? await db.select().from(checkpoints).where(inArray(checkpoints.windowId, ids)).orderBy(asc(checkpoints.day)) : [];
  return ws.filter((w) => !roomScope || roomScope.includes(w.roomId)).map((w) => {
    const room = loaded.ds.rooms[w.roomId];
    const mine = cps.filter((c) => c.windowId === w.id);
    const series = room ? weeklySeries(room, w.metric, { dish: w.dish ?? undefined }) : [];
    const st = room ? stateOf(w, mine, room, { day: w.day, feedFailing: w.status === 'waiting' && (now.getTime() - Date.parse(`${dataEnd(room)}T23:59:59Z`)) / 864e5 > STALE_DAYS }) : null;
    const waitingOn = w.status === 'waiting' ? (st?.waitingOn ?? []) : [];
    const controls = [...new Set(mine.flatMap((c) => c.controls ?? []))];
    // The stored status wins (a reversal happens after the close); the figures come from the stored effect.
    const effect = { method: w.method ?? 'unmeasured', pointCents: w.pointCents ?? 0, lowCents: w.lowCents ?? 0 };
    const stages = proofStages({ status: w.status, effect, waitingOn, projectedCents: (w.guard as Guard).projectedCents ?? null });
    return { ...w, checkpoints: mine, series: series.slice(-12), staleDays: room ? Math.round((now.getTime() - Date.parse(`${dataEnd(room)}T23:59:59Z`)) / 864e5) : null, unit: LEVER_METRIC[w.lever as keyof typeof LEVER_METRIC]?.unit, waitingOn, controls, stages, gates: st?.gates ?? [] };
  });
}

/** Daily proof loop for one org: record due checkpoints, update every open window. */
export async function runProofLoop(db: Db, orgId: string, now = new Date()) {
  const loaded = await loadDataset(db, orgId);
  if (!loaded) return { windows: 0 };
  const ws = await db.select().from(testWindows).where(and(eq(testWindows.orgId, orgId), inArray(testWindows.status, ['running', 'waiting'])));
  let recorded = 0;
  const closed: string[] = [];
  for (const w of ws) {
    const room = loaded.ds.rooms[w.roomId];
    if (!room) continue;
    const series = weeklySeries(room, w.metric, { dish: w.dish ?? undefined });
    // Rooms running the same test can't be each other's control.
    const busy = ws.filter((o) => o.id !== w.id && o.lever === w.lever).map((o) => o.roomId);
    const spec = { roomId: w.roomId, metric: w.metric, dish: w.dish, startedAt: w.startedAt, baseline: w.baseline, exclude: busy };
    for (const c of dueCheckpoints(series, w.startedAt, WINDOW_DAYS, EVERY)) {
      const ctl = controlReading(loaded.ds.rooms, spec, c.weekEnd);
      const res = await db.insert(checkpoints).values({
        windowId: w.id, day: c.day, weekEnd: c.weekEnd, observed: c.observed, services: servicesOf(room, c.weekEnd),
        controlDelta: ctl.controlDelta, controls: ctl.controls,
      }).onConflictDoNothing().returning({ id: checkpoints.id });
      recorded += res.length;
    }
    // Evidence that arrived after a checkpoint was first read (a late upload) fills it in; a recorded value is never changed.
    for (const c of await db.select().from(checkpoints).where(eq(checkpoints.windowId, w.id))) {
      const fill: Partial<Cp> = {};
      if (c.services == null) { const n = servicesOf(room, c.weekEnd); if (n != null) fill.services = n; }
      if (c.controlDelta == null) { const ctl = controlReading(loaded.ds.rooms, spec, c.weekEnd); if (ctl.controlDelta != null) { fill.controlDelta = ctl.controlDelta; fill.controls = ctl.controls; } }
      if (Object.keys(fill).length) await db.update(checkpoints).set(fill).where(eq(checkpoints.id, c.id));
    }
    const cps = await db.select().from(checkpoints).where(eq(checkpoints.windowId, w.id)).orderBy(asc(checkpoints.day));
    const day = Math.min(WINDOW_DAYS, dataDay(room, w.startedAt));
    const stale = (now.getTime() - Date.parse(`${dataEnd(room)}T23:59:59Z`)) / 864e5 > STALE_DAYS;
    const st = stateOf(w, cps, room, { day, feedFailing: stale && day < WINDOW_DAYS });
    const isClosed = st.status === 'verified' || st.status === 'rejected';
    await db.update(testWindows).set({
      status: st.status as Win['status'], day, bookedCents: st.bookedCents, lowCents: st.effect.lowCents, pointCents: st.effect.pointCents, method: st.effect.method,
      updatedAt: new Date(), ...(isClosed ? { closedAt: new Date() } : {}),
    }).where(eq(testWindows.id, w.id));
    if (isClosed) {
      closed.push(w.id);
      await db.insert(auditLog).values({ orgId, userId: null, action: `window.${st.status}`, detail: { id: w.id, bookedCents: st.bookedCents, lowCents: st.effect.lowCents } });
      const dollars = `$${Math.round(st.bookedCents / 100).toLocaleString('en-US')}`;
      await notify(db, {
        orgId, roomId: w.roomId, kind: `window.${st.status}`, severity: st.status === 'verified' ? 'good' : 'warn', link: '/windows/', dedupe: `window.${st.status}:${w.id}`,
        title: st.status === 'verified' ? `It worked: ${w.title}, ${dollars} a week, verified` : `Not proven: ${w.title}`,
        body: st.status === 'verified'
          ? `The 28-day test closed and the change held. Coversight books ${dollars} a week, the low end of what it measured${st.effect.method === 'diff_in_diff' ? ', after taking out what your other locations moved' : ''}. It keeps checking the guardrails every week and tells you if it slips.`
          : 'The 28-day test closed without a move big and steady enough to count. Nothing is booked. You can keep the change or undo it.',
      });
    } else if (st.status === 'waiting' && w.status !== 'waiting' && !st.waitingOn.includes('feed')) {
      await notify(db, {
        orgId, roomId: w.roomId, kind: 'window.pending', severity: 'warn', link: '/windows/', dedupe: `window.pending:${w.id}`,
        title: `Pending: ${w.title}`,
        body: `The 28 days are up, but ${st.waitingOn.map((k: string) => (k === 'guardrails' ? 'average check and turn time' : 'the number of services')).join(' and ')} for the last week ${st.waitingOn.length > 1 ? 'are' : 'is'} missing from your own data. Nothing is booked, and nothing is assumed. Add the week on Data and the test closes on the next run.`,
      });
    } else if (st.status === 'waiting' && w.status !== 'waiting') {
      await notify(db, {
        orgId, roomId: w.roomId, kind: 'window.waiting', severity: 'warn', link: '/inputs/', dedupe: `window.waiting:${w.id}:${dataEnd(room)}`,
        title: `Test paused: no new Toast data since ${dataEnd(room)}`,
        body: `${w.title} needs the next week of data to keep measuring. Upload the latest Toast export on Data inputs; the test picks up where it left off.`,
      });
    }
  }
  return { windows: ws.length, recorded, closed };
}

/** Weekly reverification: a verified result whose guardrail has since broken is reversed. */
export async function runReverify(db: Db, orgId: string) {
  const loaded = await loadDataset(db, orgId);
  if (!loaded) return { checked: 0, reversed: [], unchecked: [] };
  const ws = await db.select().from(testWindows).where(and(eq(testWindows.orgId, orgId), eq(testWindows.status, 'verified')));
  const reversed: string[] = [];
  const unchecked: string[] = [];
  for (const w of ws) {
    const room = loaded.ds.rooms[w.roomId];
    if (!room) continue;
    const g = w.guard as Guard;
    // The latest week of the room's own data; a reading it doesn't have is unknown, never the baseline.
    const end = dataEnd(room);
    const own = servicesOf(room, end) != null;
    const check = own ? weeklySeries(room, 'avgCheck').find((p) => p.weekEnd === end)?.value ?? null : null;
    const turn = own ? weeklySeries(room, 'turnMinutes').find((p) => p.weekEnd === end)?.value ?? null : null;
    const pilot = { guardrails: { ...GUARD, avgCheckBase: g.avgCheckBase, turnBase: g.turnBase, weekly: [{ avgCheck: check, turn }] } };
    const res = guardrailCheck(pilot, 0, false);
    if (res.missing) { unchecked.push(w.id); continue; }
    if (res.failed) {
      reversed.push(w.id);
      await db.update(testWindows).set({ status: 'reversed', bookedCents: 0, reversedAt: new Date(), updatedAt: new Date() }).where(eq(testWindows.id, w.id));
      await notify(db, {
        orgId, roomId: w.roomId, kind: 'window.reversed', severity: 'warn', link: '/windows/', dedupe: `window.reversed:${w.id}`,
        title: `Reversed: ${w.title}`,
        body: `A guardrail broke after this result was verified (${res.rows.filter((r: { ok: boolean }) => !r.ok).map((r: { label: string; pct: number | null }) => `${r.label} ${(r.pct ?? 0).toFixed(1)}%`).join(', ')}). It no longer books savings. Consider undoing the change.`,
      });
      await db.insert(auditLog).values({ orgId, userId: null, action: 'window.reversed', detail: { id: w.id, rows: res.rows.filter((r: { ok: boolean }) => !r.ok).map((r: { label: string; pct: number | null }) => ({ label: r.label, pct: r.pct })) } });
    }
  }
  return { checked: ws.length, reversed, unchecked };
}
