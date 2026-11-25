import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BRAIN_MODEL } from '../server/ai/claude';
import { loadMise, thinkMise } from '../server/ai/mise';
import { runJob } from '../server/jobs';
import type { Db } from '../server/db/client';
import { auditLog, notifications, orgs, snapshots, testWindows, users } from '../server/db/schema';
import { createSampleOrg } from '../server/org';
import { freshDb } from './helpers/db';
import { fakeClaude } from './helpers/fake-claude';

const NOW = new Date('2026-10-28T03:15:00Z');
let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });

beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'Maria Reyes', email: 'maria@example.com' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });

const logged = async () => db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, 'mise.read')));

describe('Mise, the restaurant’s brain', () => {
  it('runs on one brain model setting', () => {
    expect(BRAIN_MODEL).toBe('claude-fable-5-2');
  });

  it('without a key, stands on its built-in reads and spends nothing', async () => {
    const m = await loadMise(db, owner(), 'oakland', { now: NOW });
    expect(m).toMatchObject({ roomId: 'oakland', ai: false, engine: 'builtin' });
    expect(await logged()).toHaveLength(0);
  });

  it('with a key, asks the brain model, keeps only grounded lines and caches them', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { f, calls } = fakeClaude({
      levels: [
        { id: 'location', read: 'Oakland does about $41,620 a week, and Tuesdays drag.' },
        { id: 'team', read: 'Your team brings in $999,999 a night.' }, // not in the records
      ],
      consultants: [{ page: 'labour', read: 'Roster Coach has the most results here.' }],
    });
    const m = await loadMise(db, owner(), 'oakland', { fetchImpl: f, now: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.model).toBe(BRAIN_MODEL);
    expect(m).toMatchObject({ ai: true, engine: 'ai', model: BRAIN_MODEL });
    expect(m.reads.levels.location).toMatch(/\$41,620/);
    expect(m.reads.levels.team).toBeUndefined(); // failed the figure check, discarded
    expect(m.reads.consultants.labour).toMatch(/Roster Coach/);
    expect(await logged()).toHaveLength(1);

    // The same room and records: read from the cache, no second call.
    const again = await loadMise(db, owner(), 'oakland', { fetchImpl: f, now: NOW });
    expect(calls).toHaveLength(1);
    expect(again.reads.levels.location).toBe(m.reads.levels.location);
  });

  it('falls back to the built-in reads when the provider is down', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { f } = fakeClaude({}, 500);
    const m = await loadMise(db, owner(), 'oakland', { fetchImpl: f, now: NOW });
    expect(m).toMatchObject({ engine: 'builtin', reads: { levels: {}, consultants: {} } });
  });

  it('only reads rooms the viewer can see', async () => {
    await expect(loadMise(db, { orgId, userId: 'u1', role: 'gm', rooms: ['berkeley'] }, 'oakland', { now: NOW })).rejects.toThrow(/not one of yours/);
  });
});

describe('Mise, always on', () => {
  const state = async () => (await db.select().from(snapshots).where(and(eq(snapshots.orgId, orgId), eq(snapshots.kind, 'mise.state'))));
  const learned = async () => (await db.select().from(notifications).where(and(eq(notifications.orgId, orgId), eq(notifications.kind, 'mise.learned'))));

  it('takes stock of every room without anyone opening a page, and re-reads only what changed', async () => {
    const first = await thinkMise(db, orgId, { now: NOW });
    expect(first).toEqual({ rooms: 3, changed: 3, learned: 0 });
    const st = await state();
    expect(st).toHaveLength(3);
    const oak = st.find((x) => x.roomId === 'oakland')!.data as { known: number; smarter: string[]; at: string };
    expect(oak.known).toBe(18);
    expect(oak.smarter[0]).toBe('7shifts, brought up to date');
    expect((await loadMise(db, owner(), 'oakland', { now: NOW })).thought).toBe(NOW.toISOString());
    expect(await thinkMise(db, orgId, { now: NOW })).toEqual({ rooms: 3, changed: 0, learned: 0 });
  }, 60_000);

  it('tells the room what it learned when a test closes, once', async () => {
    await db.update(orgs).set({ sample: false }).where(eq(orgs.id, orgId));
    const [w] = await db.insert(testWindows).values({ orgId, roomId: 'oakland', lever: 'labour', metric: 'labour', title: 'Trim Monday lunch by one server', direction: 'down', baseline: 1, centsPerUnitWeek: 100, startedAt: '2026-09-01', guard: {}, status: 'running', day: 14 }).returning();
    await thinkMise(db, orgId, { now: NOW });
    expect(await learned()).toHaveLength(0); // still running: nothing to learn yet
    await db.update(testWindows).set({ status: 'verified', pointCents: 9000, lowCents: 2000, bookedCents: 6000, closedAt: new Date('2026-10-01') }).where(eq(testWindows.id, w.id));
    const r = await thinkMise(db, orgId, { now: NOW });
    expect(r.learned).toBe(1);
    const [n] = await learned();
    expect(n).toMatchObject({ roomId: 'oakland', title: 'Mise learned from “Trim Monday lunch by one server”', link: '/consultants' });
    expect(n.body).toMatch(/^Held up at Oakland/);
    await db.update(testWindows).set({ day: 28 }).where(eq(testWindows.id, w.id));
    await thinkMise(db, orgId, { now: NOW });
    expect(await learned()).toHaveLength(1);
  }, 60_000);

  it('runs as its own nightly job and after new data lands', async () => {
    await db.update(orgs).set({ sample: false }).where(eq(orgs.id, orgId));
    const [r] = await runJob(db, 'mise', { orgId, now: NOW });
    expect(r.ok).toBe(true);
    expect(await state()).toHaveLength(3);
    await db.delete(snapshots).where(eq(snapshots.kind, 'mise.state'));
    await runJob(db, 'proof', { orgId, now: NOW });
    expect(await state()).toHaveLength(3);
  }, 60_000);
});
