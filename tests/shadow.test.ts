/* eslint-disable @typescript-eslint/no-explicit-any */
// Shadow mode: the call Coversight would have made for each service, logged
// before it (frozen) and graded after it against the guests who came and the
// schedule that ran. Nothing is acted on or booked.
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyInputs } from '../lib/data/apply.js';
import { validate } from '../lib/data/ingest.js';
import { gradeShadow, shadowEntry, staffingDecision } from '../lib/data/page/staffing.js';
import { SEED } from '../lib/data/seed.js';
import { SHADOW_MIN, shadowReport } from '../lib/data/shadow.js';
import type { Db } from '../server/db/client';
import { shadowCalls, users } from '../server/db/schema';
import { runJob } from '../server/jobs';
import { commitInput, createSampleOrg } from '../server/org';
import { loadShadow, runShadow } from '../server/shadow';
import { freshDb } from './helpers/db';

const TUE = '2026-11-24';
const add = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const PAST = Array.from({ length: 21 }, (_, i) => add(TUE, -(i + 1)));
const HOURS = [[16, 6, 3], [17, 20, 4], [18, 36, 4], [19, 40, 4], [20, 24, 4], [21, 12, 4]];
const SERVICES = PAST.flatMap((d) => HOURS.map(([h, covers, servers]) => ({ date: d, hour: `${h}:00`, covers, servers })));
const sh = (name: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ date: TUE, role: 'Server', name, start, end, rate: 24, ...extra });
const SHIFTS = [sh('Ana', '16:00', '22:00'), sh('Ben', '16:00', '22:00'), sh('Carlos', '16:00', '22:00'), sh('Diana', '4:30 pm', '22:00')];
const ENTRIES = { shifts: { at: '2026-11-23T18:00:00Z', date: '2026-11-23' }, services: { at: '2026-11-23T18:00:00Z', date: '2026-11-23' } };
const rows = (kind: string, r: unknown[]) => validate(kind, r).rows;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const roomWith = (services: any[] = SERVICES, shifts: any[] = SHIFTS): any => ({ ...applyInputs(SEED, { oakland: { services: { rows: rows('services', services) }, shifts: { rows: rows('shifts', shifts) } } }).rooms.oakland, id: 'oakland' });

describe('shadow mode, pure', () => {
  const room = roomWith();
  const dec: any = staffingDecision(room, { date: TUE, meal: 'dinner', today: TUE, nowMin: 12 * 60, entries: ENTRIES });
  const entry: any = shadowEntry(dec, { issuedAt: "2026-11-24T11:30:00Z", dataEnd: "2026-11-23" });

  it('freezes the call with what it read', () => {
    expect(['act', 'hold']).toContain(dec.state);
    expect(entry.state).toBe(dec.state);
    expect(entry.forecast.covers).toBe(dec.forecast.covers);
    expect(entry.hours.length).toBe(dec.hours.length);
    expect(entry.hours[0]).toHaveProperty('scheduled');
    expect(entry.hours[0]).toHaveProperty('after');
    expect(entry.inputs.dataEnd).toBe('2026-11-23');
  });

  it('waits for the guests who came before grading', () => {
    expect(gradeShadow(entry, room)).toEqual({ state: 'waiting', waitingOn: 'guests' });
  });

  it('grades against the guests who came: forecast miss, and server-hours over or short for the schedule and the call', () => {
    // Tuesday's guests entered after the service: a quiet night.
    const quiet = HOURS.map(([h, covers]) => ({ date: TUE, hour: `${h}:00`, covers: Math.round(covers * 0.6), servers: 4 }));
    const after = roomWith([...SERVICES, ...quiet]);
    const g = gradeShadow(entry, after) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(g.state).toBe('graded');
    expect(g.covers.actual).toBe(quiet.reduce((t, r) => t + r.covers, 0));
    expect(g.covers.error).toBe(g.covers.actual - entry.forecast.covers);
    expect(g.gap.plan.over).toBeGreaterThanOrEqual(g.gap.call.over);
    expect(['call', 'same']).toContain(g.closer);
    expect(g.followed).toBe(false);
    expect(g.gap.clock).toBeNull();
  });

  it('uses the POS guests when none were typed, and the clock-ins when they are in', () => {
    const clocked = SHIFTS.map((s) => ({ ...s, clock_in: s.start, clock_out: s.end }));
    const after = roomWith(SERVICES, clocked);
    const guests = new Map(HOURS.map(([h, c]) => [h, c]));
    const g = gradeShadow(entry, after, { guests }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(g.state).toBe('graded');
    expect(g.gap.clock).not.toBeNull();
  });

  it('reports nothing as savings, and says how many services it still needs', () => {
    const r0 = shadowReport([{ ...entry }]);
    expect(r0.status).toBe('collecting');
    expect(r0.note).toMatch(new RegExp(`${SHADOW_MIN} graded services`));
    const g = { state: 'graded', closer: 'call', followed: false, covers: { forecast: 100, low: 80, high: 120, actual: 90, error: -10, inRange: true }, gap: { plan: { over: 3, short: 0 }, call: { over: 1, short: 0.5 }, clock: null } };
    const many = Array.from({ length: SHADOW_MIN }, (_, i) => ({ date: add(TUE, -i - 1), meal: 'dinner', state: 'act', graded: g }));
    const r = shadowReport(many, { wageCents: 2400 });
    expect(r.status).toBe('ready');
    expect(r.forecast.inRange).toBe(SHADOW_MIN);
    expect(r.staffing.closer).toBe(SHADOW_MIN);
    expect(r.staffing.idleFewer).toBe(14);
    expect(r.staffing.simulatedCents).toBe(14 * 2400);
    expect(r.claim.simulated).toBe('Simulated');
  });
});

describe('shadow mode, server', () => {
  let db: Db;
  let orgId: string;
  beforeEach(async () => {
    db = await freshDb();
    await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
    orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  });
  const v = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
  const morning = new Date('2026-11-24T11:30:00Z'); // 3:30 am Pacific

  it('logs today’s and tomorrow’s calls once (the first issue is frozen), then grades the service once guests are in', async () => {
    await commitInput(db, { ...v(), roomId: 'oakland', kind: 'services', rows: SERVICES });
    await commitInput(db, { ...v(), roomId: 'oakland', kind: 'shifts', rows: SHIFTS });
    const first = await runShadow(db, orgId, { now: morning, fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(first.logged).toBeGreaterThan(0);
    const again = await runShadow(db, orgId, { now: new Date('2026-11-24T12:30:00Z'), fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(again.logged).toBe(0);
    const rowsBefore = await db.select().from(shadowCalls).where(eq(shadowCalls.roomId, 'oakland'));
    expect(rowsBefore.some((r) => r.date === TUE && r.meal === 'dinner')).toBe(true);

    // The next morning, with Tuesday's guests entered, Tuesday dinner is graded.
    const tue = HOURS.map(([h, covers]) => ({ date: TUE, hour: `${h}:00`, covers, servers: 4 }));
    await commitInput(db, { ...v(), roomId: 'oakland', kind: 'services', rows: [...SERVICES, ...tue] });
    const next = await runShadow(db, orgId, { now: new Date('2026-11-25T11:30:00Z'), fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(next.graded).toBeGreaterThanOrEqual(1);
    const rec = await loadShadow(db, v(), { roomId: 'oakland' });
    expect(rec.report.graded).toBeGreaterThanOrEqual(1);
    expect(rec.latest[0]!.date).toBe(TUE);
    expect(rec.report.claim.simulated).toBe('Simulated');
  }, 60_000);

  it('runs as the scheduled shadow job', async () => {
    const [res] = await runJob(db, 'shadow', { orgId, now: morning, fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(res!.ok).toBe(true);
  }, 60_000);

  it('refuses another room’s record', async () => {
    await expect(loadShadow(db, { ...v(), rooms: ['berkeley'] }, { roomId: 'oakland' })).rejects.toThrow(/not one of yours/);
  });
});
