// Test windows: start one on a lever, record checkpoints as weeks of data land,
// close at day 28 with the platform's estimator (lib/data/pilot.js), and
// reverse a verified result if a guardrail breaks afterwards.
import { and, asc, eq, inArray } from 'drizzle-orm';

import { leverReport } from '../lib/data/levers.js';
import { deriveRoom } from '../lib/data/model.js';
import { guardrailCheck, windowState } from '../lib/data/pilot.js';
import { baselineOf, dataDay, dataEnd, dueCheckpoints, LEVER_METRIC, weeklySeries } from '../lib/data/readers.js';
import type { Db } from './db/client';
import { auditLog, checkpoints, testWindows } from './db/schema';
import { loadDataset } from './dataset';
import { InputError } from './org';

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

/** The pilot-shaped object windowState() reads, from a window and its checkpoints. */
function pilotOf(w: Win, cps: Cp[], room: Room) {
  const g = w.guard as { avgCheckBase: number; turnBase: number };
  const check = weeklySeries(room, 'avgCheck');
  const turn = weeklySeries(room, 'turnMinutes');
  const weekly = [0, 7, 14, 21, 28, 35].map((d) => {
    const end = new Date(Date.parse(`${w.startedAt}T00:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
    const c = check.find((p) => p.weekEnd === end)?.value;
    const t = turn.find((p) => p.weekEnd === end)?.value;
    return { avgCheck: c ?? g.avgCheckBase, turn: t ?? g.turnBase };
  });
  return {
    baseline: w.baseline, direction: w.direction, sign: w.direction === 'up' ? 1 : -1, centsPerUnitWeek: w.centsPerUnitWeek,
    windowDays: WINDOW_DAYS, checkpointEvery: EVERY,
    checkpoints: cps.map((c) => ({ day: c.day, observed: c.observed, controlDelta: c.controlDelta, services: c.services })),
    guardrails: { ...GUARD, avgCheckBase: g.avgCheckBase, turnBase: g.turnBase, weekly },
  };
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
    centsPerUnitWeek: centsPerUnit(spec.metric, room, l), startedAt, guard: { avgCheckBase: check, turnBase: turn }, userId: v.userId,
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
    return { ...w, checkpoints: mine, series: series.slice(-12), staleDays: room ? Math.round((now.getTime() - Date.parse(`${dataEnd(room)}T23:59:59Z`)) / 864e5) : null, unit: LEVER_METRIC[w.lever as keyof typeof LEVER_METRIC]?.unit };
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
    for (const c of dueCheckpoints(series, w.startedAt, WINDOW_DAYS, EVERY)) {
      const res = await db.insert(checkpoints).values({ windowId: w.id, day: c.day, weekEnd: c.weekEnd, observed: c.observed, services: 7 }).onConflictDoNothing().returning({ id: checkpoints.id });
      recorded += res.length;
    }
    const cps = await db.select().from(checkpoints).where(eq(checkpoints.windowId, w.id)).orderBy(asc(checkpoints.day));
    const day = Math.min(WINDOW_DAYS, dataDay(room, w.startedAt));
    const stale = (now.getTime() - Date.parse(`${dataEnd(room)}T23:59:59Z`)) / 864e5 > STALE_DAYS;
    const st = windowState(pilotOf(w, cps, room), { day, feedFailing: stale && day < WINDOW_DAYS });
    const isClosed = st.status === 'verified' || st.status === 'rejected';
    await db.update(testWindows).set({
      status: st.status as Win['status'], day, bookedCents: st.bookedCents, lowCents: st.effect.lowCents, pointCents: st.effect.pointCents, method: st.effect.method,
      updatedAt: new Date(), ...(isClosed ? { closedAt: new Date() } : {}),
    }).where(eq(testWindows.id, w.id));
    if (isClosed) {
      closed.push(w.id);
      await db.insert(auditLog).values({ orgId, userId: null, action: `window.${st.status}`, detail: { id: w.id, bookedCents: st.bookedCents, lowCents: st.effect.lowCents } });
    }
  }
  return { windows: ws.length, recorded, closed };
}

/** Weekly reverification: a verified result whose guardrail has since broken is reversed. */
export async function runReverify(db: Db, orgId: string) {
  const loaded = await loadDataset(db, orgId);
  if (!loaded) return { checked: 0, reversed: [] };
  const ws = await db.select().from(testWindows).where(and(eq(testWindows.orgId, orgId), eq(testWindows.status, 'verified')));
  const reversed: string[] = [];
  for (const w of ws) {
    const room = loaded.ds.rooms[w.roomId];
    if (!room) continue;
    const g = w.guard as { avgCheckBase: number; turnBase: number };
    const check = last(weeklySeries(room, 'avgCheck'))?.value ?? g.avgCheckBase;
    const turn = last(weeklySeries(room, 'turnMinutes'))?.value ?? g.turnBase;
    const pilot = { guardrails: { ...GUARD, avgCheckBase: g.avgCheckBase, turnBase: g.turnBase, weekly: [{ avgCheck: check, turn }] } };
    const res = guardrailCheck(pilot, 0, false);
    if (!res.ok) {
      reversed.push(w.id);
      await db.update(testWindows).set({ status: 'reversed', bookedCents: 0, updatedAt: new Date() }).where(eq(testWindows.id, w.id));
      await db.insert(auditLog).values({ orgId, userId: null, action: 'window.reversed', detail: { id: w.id, rows: res.rows.filter((r: { ok: boolean }) => !r.ok).map((r: { label: string; pct: number }) => ({ label: r.label, pct: r.pct })) } });
    }
  }
  return { checked: ws.length, reversed };
}
