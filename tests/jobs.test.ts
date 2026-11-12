import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { readToastExports } from '../lib/data/toast.js';
import { weeklySeries } from '../lib/data/readers.js';
import type { Db } from '../server/db/client';
import { checkpoints, jobRuns, orgs, snapshots, testWindows, users } from '../server/db/schema';
import { runJob, runCleanup, jobStatus } from '../server/jobs';
import { commitInput, createSampleOrg } from '../server/org';
import { listWindows, runProofLoop, runReverify, startWindow, stopWindow } from '../server/proof';
import { loadDataset } from '../server/dataset';
import { freshDb } from './helpers/db';
import { toastFixture } from './helpers/toast-fixture.js';

let db: Db;
let orgId: string;
const v = () => ({ orgId, userId: 'u1', rooms: null });
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});

const summary = (opts: Parameters<typeof toastFixture>[0]) => {
  const files = toastFixture(opts);
  const { unknown, ...s } = readToastExports(Object.entries(files).map(([name, text]) => ({ name, text })));
  return JSON.parse(JSON.stringify(s));
};
const load = (s: unknown) => commitInput(db, { ...v(), roomId: 'oakland', kind: 'toast', rows: [s] });

describe('nightly detection', () => {
  it('snapshots every room: levers, findings and the week, and marks own data', async () => {
    await load(summary({}));
    const [res] = await runJob(db, 'detection', { orgId });
    expect(res!.ok).toBe(true);
    const snaps = await db.select().from(snapshots).where(eq(snapshots.orgId, orgId));
    expect(snaps.map((s) => s.roomId).sort()).toEqual(['berkeley', 'oakland', 'walnut']);
    const oak = snaps.find((s) => s.roomId === 'oakland')!.data as { own: boolean; dataEnd: string; levers: unknown[] };
    expect(oak.own).toBe(true);
    expect(oak.dataEnd).toBe('2026-10-24');
    expect(oak.levers).toHaveLength(6);
    expect((snaps.find((s) => s.roomId === 'walnut')!.data as { own: boolean }).own).toBe(false);
    // Running it again replaces, never duplicates.
    await runJob(db, 'detection', { orgId });
    expect((await db.select().from(snapshots).where(eq(snapshots.orgId, orgId))).length).toBe(3);
  });
});

describe('a test window, end to end on the restaurant’s own Toast data', () => {
  const cut = Date.UTC(2026, 9, 25); // the day after the test starts

  it('starts on the overtime lever, records a checkpoint per new week, and closes Verified at the lower bound', async () => {
    await load(summary({}));
    const w = await startWindow(db, v(), { roomId: 'oakland', lever: 'overtime' });
    expect(w.startedAt).toBe('2026-10-24');
    expect(w.metric).toBe('otMinutes');
    expect(w.baseline).toBe(240); // 2 cooks × 2 h every Saturday
    await expect(startWindow(db, v(), { roomId: 'oakland', lever: 'overtime' })).rejects.toThrow(/already running/);

    // Two weeks later: two checkpoints, still running.
    await load(summary({ weeks: 15, end: Date.UTC(2026, 10, 8), otCut: cut }));
    let res = await runProofLoop(db, orgId, new Date('2026-11-09T12:00:00Z'));
    expect(res.recorded).toBe(2);
    let [state] = await listWindows(db, orgId);
    expect(state!.status).toBe('running');
    expect(state!.day).toBe(14);
    expect(state!.checkpoints.map((c) => c.observed)).toEqual([0, 0]);

    // Day 28: four checkpoints, closed, booked at the lower bound.
    await load(summary({ weeks: 17, end: Date.UTC(2026, 10, 22), otCut: cut }));
    res = await runProofLoop(db, orgId, new Date('2026-11-23T12:00:00Z'));
    expect(res.recorded).toBe(2);
    expect(res.closed).toHaveLength(1);
    [state] = await listWindows(db, orgId);
    expect(state!.status).toBe('verified');
    expect(state!.checkpoints.map((c) => c.day)).toEqual([7, 14, 21, 28]);
    expect(state!.bookedCents).toBeGreaterThan(0);
    expect(state!.bookedCents).toBe(Math.max(0, state!.lowCents!));
    // 240 min/wk saved × the half-time premium per minute.
    expect(state!.pointCents).toBe(240 * w.centsPerUnitWeek);
    // Running the loop again changes nothing.
    expect((await runProofLoop(db, orgId, new Date('2026-11-24T12:00:00Z'))).recorded).toBe(0);
  });

  it('a lever that did not move closes Rejected and books nothing', async () => {
    await load(summary({}));
    await startWindow(db, v(), { roomId: 'oakland', lever: 'overtime' });
    await load(summary({ weeks: 17, end: Date.UTC(2026, 10, 22) }));
    await runProofLoop(db, orgId, new Date('2026-11-23T12:00:00Z'));
    const [state] = await listWindows(db, orgId);
    expect(state!.status).toBe('rejected');
    expect(state!.bookedCents).toBe(0);
  });

  it('waits, rather than failing, when no new data has arrived for over a week', async () => {
    await load(summary({}));
    await startWindow(db, v(), { roomId: 'oakland', lever: 'overtime' });
    await runProofLoop(db, orgId, new Date('2026-11-20T12:00:00Z'));
    const [state] = await listWindows(db, orgId, null, new Date('2026-11-20T12:00:00Z'));
    expect(state!.status).toBe('waiting');
    expect(state!.staleDays).toBeGreaterThan(9);
  });

  it('weekly reverification reverses a verified result whose guardrail broke', async () => {
    await load(summary({}));
    const w = await startWindow(db, v(), { roomId: 'oakland', lever: 'overtime' });
    await load(summary({ weeks: 17, end: Date.UTC(2026, 10, 22), otCut: cut }));
    await runProofLoop(db, orgId, new Date('2026-11-23T12:00:00Z'));
    expect((await runReverify(db, orgId)).reversed).toEqual([]);
    // The check base was set at start; pretend checks have since fallen 10%.
    const g = (await db.select().from(testWindows).where(eq(testWindows.id, w.id)))[0]!.guard as { avgCheckBase: number; turnBase: number };
    await db.update(testWindows).set({ guard: { ...g, avgCheckBase: g.avgCheckBase / 0.9 } }).where(eq(testWindows.id, w.id));
    expect((await runReverify(db, orgId)).reversed).toEqual([w.id]);
    const [state] = await listWindows(db, orgId);
    expect(state!.status).toBe('reversed');
    expect(state!.bookedCents).toBe(0);
  });

  it('refuses unknown levers, too little history, and other people’s rooms; can be stopped', async () => {
    await expect(startWindow(db, v(), { roomId: 'oakland', lever: 'nope' })).rejects.toThrow(/known lever/);
    await expect(startWindow(db, { ...v(), rooms: ['berkeley'] }, { roomId: 'oakland', lever: 'overtime' })).rejects.toThrow(/not one of yours/);
    await expect(startWindow(db, v(), { roomId: 'oakland', lever: 'menu_margin', dish: 'nope' })).rejects.toThrow(/dish with price history/);
    const w = await startWindow(db, v(), { roomId: 'walnut', lever: 'labour' }); // sample data works too
    await stopWindow(db, v(), w.id);
    expect((await listWindows(db, orgId))[0]!.status).toBe('stopped');
    await expect(stopWindow(db, v(), w.id)).rejects.toThrow(/Only a running/);
  });
});

describe('readers on the sample', () => {
  it('every lever metric reads a series on every sample room', async () => {
    const { ds } = (await loadDataset(db, orgId))!;
    for (const id of ['oakland', 'berkeley', 'walnut']) {
      for (const m of ['otMinutes', 'idleServerHours', 'exceptionDollars', 'menuMargin', 'turnMinutes', 'avgCheck']) {
        expect(weeklySeries(ds.rooms[id], m).length, `${id} ${m}`).toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe('job runs and cleanup', () => {
  it('records every run per org, ok or not', async () => {
    await runJob(db, 'proof', { orgId, trigger: 'manual' });
    const st = await jobStatus(db, orgId);
    expect(st.jobs.map((j) => j.job)).toEqual(['sync', 'links', 'agents', 'detection', 'proof', 'reverify', 'billing', 'cleanup', 'trends']);
    expect(st.jobs.find((j) => j.job === 'proof')!.last!.ok).toBe(true);
    expect(st.jobs.find((j) => j.job === 'proof')!.last!.trigger).toBe('manual');
    expect(st.jobs.find((j) => j.job === 'detection')!.last).toBeNull();
  });

  it('deletes sample guests older than 30 days with their sample copy, and nobody else', async () => {
    await db.insert(users).values({ id: 'g-old', name: 'G', email: 'g1@sample.coversight.local', isAnonymous: true, createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-01') });
    await db.insert(users).values({ id: 'g-new', name: 'G', email: 'g2@sample.coversight.local', isAnonymous: true });
    const old = await createSampleOrg(db, { ownerId: 'g-old' });
    await createSampleOrg(db, { ownerId: 'g-new' });
    const res = await runCleanup(db, new Date('2026-11-10'));
    expect(res).toEqual({ guests: 1, orgs: 1 });
    expect(await db.select().from(orgs).where(eq(orgs.id, old.id))).toEqual([]);
    expect((await db.select().from(orgs)).length).toBe(2); // the owner's and the new guest's
  });
});

describe('the cron route', () => {
  it('needs the secret', async () => {
    const { GET } = await import('../app/api/cron/[job]/route');
    const ctx = (job: string) => ({ params: Promise.resolve({ job }) });
    delete process.env.CRON_SECRET;
    expect((await GET(new Request('http://x/api/cron/proof'), ctx('proof'))).status).toBe(503);
    process.env.CRON_SECRET = 's3cret-s3cret-s3cret-s3cret-s3cret';
    expect((await GET(new Request('http://x/api/cron/proof', { headers: { authorization: 'Bearer nope' } }), ctx('proof'))).status).toBe(401);
    expect((await GET(new Request('http://x/api/cron/nope', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), ctx('nope'))).status).toBe(404);
    const ok = await GET(new Request('http://x/api/cron/detection', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), ctx('detection'));
    expect(ok.status).toBe(200);
    expect((await ok.json()).orgs).toBe(1);
    expect((await db.select().from(jobRuns)).length).toBe(1);
    expect((await db.select().from(checkpoints)).length).toBe(0);
    delete process.env.CRON_SECRET;
  });
});
