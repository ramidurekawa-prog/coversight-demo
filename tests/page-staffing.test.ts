import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { validate } from '../lib/data/ingest.js';
import type { Db } from '../server/db/client';
import { auditLog, tasks, users } from '../server/db/schema';
import { commitInput, createSampleOrg } from '../server/org';
import { clearServiceCache } from '../server/page/service';
import { loadStaffing, refuseShift } from '../server/page/staffing';
import { loadToday } from '../server/page/today';
import { createTask, updateTask, verifyTasks } from '../server/tasks';
import { freshDb } from './helpers/db';

/* The pre-shift staffing call on the server, for a room run by hand: three
 * weeks of dinners by hour and tonight's schedule typed on Data. Tuesday
 * Nov 24, noon Pacific. */
let db: Db;
let orgId: string;
type V = { orgId: string; userId: string; role: 'owner' | 'admin' | 'gm' | 'floor'; rooms: string[] | null };
const owner = (): V => ({ orgId, userId: 'u1', role: 'owner', rooms: null });
const gm = (rooms: string[] | null = ['oakland']) => ({ orgId, userId: 'u2', role: 'gm' as const, rooms });
const floor = () => ({ orgId, userId: 'u3', role: 'floor' as const, rooms: ['oakland'] });
const NOW = new Date('2026-11-24T20:00:00Z');
const TUE = '2026-11-24';
const ID = 'shift:2026-11-24:dinner:start:server-di-1630:1700';

const add = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const HOURS = [[16, 6, 3], [17, 20, 4], [18, 36, 4], [19, 40, 4], [20, 24, 4], [21, 12, 4]];
const SERVICES = Array.from({ length: 21 }, (_, i) => add(TUE, -(i + 1))).flatMap((d) => HOURS.map(([h, covers, servers]) => ({ date: d, hour: `${h}:00`, covers, servers })));
const sh = (name: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ date: TUE, role: 'Server', name, start, end, rate: 24, ...extra });
const SHIFTS = [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Cy', '16:00', '22:00'), sh('Di', '16:30', '22:00')];
const rowsOf = (kind: string, r: unknown[]) => validate(kind, r).rows;
const commit = (kind: string, r: unknown[]) => commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind, rows: rowsOf(kind, r) });
const approve = (v: V = owner(), approvalId = ID, extra: Record<string, unknown> = {}) =>
  createTask(db, v, { roomId: 'oakland', approvalId, title: 'Whatever the browser says', system: 'Somewhere', diff: [], ...extra }, { now: NOW });

beforeEach(async () => {
  db = await freshDb();
  clearServiceCache();
  await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'o@example.com' }, { id: 'u2', name: 'Marcus', email: 'g@example.com' }, { id: 'u3', name: 'Fay', email: 'f@example.com' }]);
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  await commit('services', SERVICES);
  await commit('shifts', SHIFTS);
});

describe('Staffing on the server', () => {
  it('reads the same call the browser shows, for the viewer’s own room only', async () => {
    const r = await loadStaffing(db, owner(), { roomId: 'oakland', date: TUE }, { now: NOW }) as Record<string, any>;
    expect(r.dinner).toMatchObject({ state: 'act', approvalId: ID, estimate: { cents: 1200, claim: 'est' } });
    expect(r.lunch.state).toBe('closed');
    await expect(loadStaffing(db, gm(['berkeley']), { roomId: 'oakland' }, { now: NOW })).rejects.toThrow(/not one of yours/);
    await expect(loadStaffing(db, owner(), { roomId: 'oakland', date: '2027-06-01' }, { now: NOW })).rejects.toThrow(/two months/);
  });

  it('approving re-checks the call and keeps the server’s own evidence, not the browser’s words', async () => {
    const t = await approve();
    expect(t.title).toBe('Start Di at 5 pm, not 4:30 pm');
    expect(t.system).toBe('Your schedule');
    expect(t.expect).toEqual({ type: 'shift', date: TUE, meal: 'dinner', kind: 'start' });
    const ev = t.evidence as Record<string, any>;
    expect(ev).toMatchObject({ rule: 'staffing.v1', approvedByName: 'Maria', approvedRole: 'owner', estimate: { minutes: 30, rateCents: 2400, cents: 1200 } });
    expect(ev.version).toMatch(/^[0-9a-f]{8}$/);
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, 'task.created')));
    expect(audit!.detail).toMatchObject({ approvalId: ID, evidence: true, version: ev.version });
  });

  it('a retry or a second manager on the same change gets the same task; a different change for the service is refused', async () => {
    const [a, b] = await Promise.all([approve(), approve(gm())]);
    expect(a.id).toBe(b.id);
    expect(await db.select().from(tasks).where(eq(tasks.approvalId, ID))).toHaveLength(1);
    await expect(approve(owner(), 'shift:2026-11-24:dinner:end:server-ana-1600:2000')).rejects.toThrow(/already has an approved staffing change/);
  });

  it('a floor manager can’t approve; a GM of another room can’t either', async () => {
    await expect(approve(floor())).rejects.toThrow(/floor manager/);
    await expect(approve(gm(['berkeley']))).rejects.toThrow(/not one of yours/);
    await expect(refuseShift(db, owner(), { roomId: 'oakland', approvalId: 'shift:nope' }, { now: NOW })).rejects.toThrow(/isn’t a staffing change/);
  });

  it('refuses when the facts moved since the card was shown, or the time to decide has passed', async () => {
    // Di is now on at 5 already: the schedule fits, so the 4:30 change no longer stands.
    await commit('shifts', SHIFTS.map((s) => (s.name === 'Di' ? { ...s, start: '17:00' } : s)));
    await expect(approve()).rejects.toThrow(/changed since it was shown|numbers moved/);
    await commit('shifts', SHIFTS);
    await expect(createTask(db, owner(), { roomId: 'oakland', approvalId: ID, title: 't', system: 's', diff: [] }, { now: new Date('2026-11-24T23:45:00Z') })).rejects.toThrow(/changed since it was shown/);
    await expect(approve()).resolves.toMatchObject({ approvalId: ID });
  });

  it('a send-home made up outside Service is refused by the same check Service runs', async () => {
    await expect(approve(owner(), 'cut:2026-11-24:20:00')).rejects.toThrow();
    expect(await db.select().from(tasks).where(eq(tasks.approvalId, 'cut:2026-11-24:20:00'))).toHaveLength(0);
  });

  it('Today shows the call as one card, and the approval moves it to Being handled', async () => {
    const t0 = await loadToday(db, owner(), 'oakland', NOW) as Record<string, any>;
    const card = t0.cards.find((c: { id: string }) => c.id === `staff:${TUE}:dinner`);
    expect(card).toMatchObject({ state: 'needs_review' });
    await approve();
    const t1 = await loadToday(db, owner(), 'oakland', NOW) as Record<string, any>;
    expect(t1.cards.find((c: { id: string }) => c.id === `staff:${TUE}:dinner`).state).toBe('approved');
  });

  it('clock-ins entered after the shift confirm the change, or say it fell short; nothing is counted as savings', async () => {
    const t = await approve();
    await updateTask(db, owner(), t.id, 'done');
    // A 15-minute-late start: $6 observed against the $12 estimated, so the task says it doesn't match yet.
    await commit('shifts', SHIFTS.map((s) => ({ ...s, clock_in: s.name === 'Di' ? '16:45' : s.start, clock_out: s.end })));
    await verifyTasks(db, orgId);
    let [row] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row!.status).toBe('mismatch');
    expect((row!.outcome as Record<string, any>).observed).toMatchObject({ minutes: 15, cents: 600, claim: 'obs' });
    expect((row!.outcome as Record<string, any>).qualified.state).toBe('not-eligible');
    await commit('shifts', SHIFTS.map((s) => ({ ...s, clock_in: s.name === 'Di' ? '17:00' : s.start, clock_out: s.end })));
    await verifyTasks(db, orgId);
    [row] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row!.status).toBe('verified');
    expect((row!.outcome as Record<string, any>).observed).toMatchObject({ minutes: 30, cents: 1200 });
  });
});
