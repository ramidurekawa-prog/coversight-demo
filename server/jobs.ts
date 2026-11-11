// Scheduled jobs. Vercel Cron calls /api/cron/<job> with CRON_SECRET; an owner
// or admin can also run one for their own org from the System screen. Every
// run is recorded per org in job_runs.
import { and, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';

import { leverReport } from '../lib/data/levers.js';
import { deriveRoom } from '../lib/data/model.js';
import { dataEnd } from '../lib/data/readers.js';
import type { Db } from './db/client';
import { jobRuns, memberships, orgs, snapshots, users } from './db/schema';
import { loadDataset } from './dataset';
import { runProofLoop, runReverify } from './proof';
import { verifyTasks } from './tasks';

export const JOBS = {
  detection: { schedule: 'Daily, 2:00 am Pacific', what: 'Re-reads every room’s data, re-grades the six levers and re-ranks the findings', cron: '0 10 * * *' },
  proof: { schedule: 'Daily, 4:00 am Pacific', what: 'Records due checkpoints and closes test windows that reached day 28', cron: '0 12 * * *' },
  reverify: { schedule: 'Mondays, 3:00 am Pacific', what: 'Checks average check and turn time against each verified test’s guardrails; a breach reverses it', cron: '0 11 * * 1' },
  cleanup: { schedule: 'Daily, 5:00 am Pacific', what: 'Deletes “try the sample” guests older than 30 days and their sample copies', cron: '0 13 * * *' },
} as const;
export type JobName = keyof typeof JOBS;

/** Nightly detection for one org: one snapshot per room. */
export async function runDetection(db: Db, orgId: string) {
  const loaded = await loadDataset(db, orgId);
  if (!loaded) return { rooms: 0 };
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(loaded.ds.rooms)) {
    const room = loaded.ds.rooms[id];
    const d = deriveRoom(loaded.ds, id);
    const levers = leverReport(room, d).map((l: Record<string, unknown>) => ({ key: l.key, name: l.name, scope: l.scope, weekly: l.weekly, grade: l.grade, confidence: l.confidence ?? null }));
    const findings = d.candidates.filter((c: { value: number }) => c.value > 0.5).sort((a: { value: number }, b: { value: number }) => b.value - a.value)
      .slice(0, 20).map((c: { id: string; title?: string; lever?: string; value: number }) => ({ id: c.id, title: c.title ?? c.id, lever: c.lever ?? null, value: Math.round(c.value) }));
    const data = { dataEnd: dataEnd(room), own: !!room.fromToast, week: { net: Math.round(d.week.net), earned: Math.round(d.week.earned), covers: d.week.covers }, levers, findings };
    await db.insert(snapshots).values({ orgId, roomId: id, kind: 'detection', data })
      .onConflictDoUpdate({ target: [snapshots.orgId, snapshots.roomId, snapshots.kind], set: { data, at: new Date() } });
    out[id] = { levers: levers.length, findings: findings.length, own: data.own };
  }
  const checked = await verifyTasks(db, orgId);
  return { rooms: Object.keys(out).length, byRoom: out, tasks: checked };
}

/** Sample guests older than 30 days, and orgs nobody belongs to any more. */
export async function runCleanup(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 864e5);
  const gone = await db.delete(users).where(and(eq(users.isAnonymous, true), lt(users.createdAt, cutoff))).returning({ id: users.id });
  const orphans = await db.delete(orgs).where(and(eq(orgs.sample, true), notInArray(orgs.id, db.select({ id: memberships.orgId }).from(memberships)))).returning({ id: orgs.id });
  return { guests: gone.length, orgs: orphans.length };
}

async function record(db: Db, job: JobName, orgId: string | null, trigger: string, fn: () => Promise<unknown>) {
  const [run] = await db.insert(jobRuns).values({ job, orgId, trigger }).returning({ id: jobRuns.id });
  try {
    const detail = await fn();
    await db.update(jobRuns).set({ finishedAt: new Date(), ok: true, detail: detail as object }).where(eq(jobRuns.id, run!.id));
    return { orgId, ok: true, detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(jobRuns).set({ finishedAt: new Date(), ok: false, detail: { error: message.slice(0, 500) } }).where(eq(jobRuns.id, run!.id));
    return { orgId, ok: false, detail: { error: message } };
  }
}

/** Run a job for one org (owner's "Run now") or every org (the schedule). */
export async function runJob(db: Db, job: JobName, { orgId, trigger = 'schedule', now = new Date() }: { orgId?: string; trigger?: string; now?: Date } = {}) {
  if (job === 'cleanup') return [await record(db, job, null, trigger, () => runCleanup(db, now))];
  const ids = orgId ? [orgId] : (await db.select({ id: orgs.id }).from(orgs)).map((o) => o.id);
  const results = [];
  for (const id of ids) {
    results.push(await record(db, job, id, trigger, () => (job === 'detection' ? runDetection(db, id) : job === 'proof' ? runProofLoop(db, id, now) : runReverify(db, id))));
  }
  return results;
}

/** The System screen: last runs per job for this org, and the latest snapshots. */
export async function jobStatus(db: Db, orgId: string, roomScope: string[] | null = null) {
  const runs = await db.select().from(jobRuns).where(sql`${jobRuns.orgId} = ${orgId} or ${jobRuns.orgId} is null`).orderBy(desc(jobRuns.startedAt)).limit(60);
  const snaps = await db.select().from(snapshots).where(roomScope ? and(eq(snapshots.orgId, orgId), inArray(snapshots.roomId, roomScope)) : eq(snapshots.orgId, orgId));
  return {
    jobs: Object.entries(JOBS).map(([k, j]) => ({ job: k, ...j, last: runs.find((r) => r.job === k) ?? null })),
    runs: runs.slice(0, 30),
    snapshots: Object.fromEntries(snaps.map((s) => [`${s.roomId}:${s.kind}`, { ...s }])),
  };
}
