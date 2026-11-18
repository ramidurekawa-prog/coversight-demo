import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../server/db/client';
import { notifications, testWindows, users } from '../server/db/schema';
import { saveAction } from '../server/actions';
import { runJob } from '../server/jobs';
import { commitInput, createSampleOrg } from '../server/org';
import { commitWeekPlan, runWeekDigest, updateWeekPlanItem, weekSummary } from '../server/page/week';
import { actions } from '../server/db/schema';
import { and } from 'drizzle-orm';
import { createOwnOrg } from '../server/team';
import { freshDb } from './helpers/db';
import { readToastExports } from '../lib/data/toast.js';
import { toastFixture } from './helpers/toast-fixture.js';

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'maria@example.com' }, { id: 'u2', name: 'Gina', email: 'gina@example.com' }]);
});

const toast = () => {
  const { unknown, ...s } = readToastExports(Object.entries(toastFixture({})).map(([name, text]) => ({ name, text })));
  void unknown;
  return JSON.parse(JSON.stringify(s));
};

describe('the week API', () => {
  it('on a sample copy, matches the browser: packets, the saved plan hours, the room scope', async () => {
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    const owner = { orgId: org.id, userId: 'u1', role: 'owner' as const, rooms: null };
    await saveAction(db, owner, { roomId: 'oakland', key: 'plan', value: { hours: 1 } });
    const res = await weekSummary(db, owner, 'oakland');
    expect(res.view.real).toBe(false);
    expect(res.view.banked.source).toBe('packets');
    expect(res.view.plan.hours).toBe(1);
    expect(res.view.plan.used).toBeLessThanOrEqual(1);
    expect(res.view.period?.label).toBe('Oct 19 – 25');
    expect(res.digest.body).toMatch(/^Contribution/);
    expect(res.view.comparator?.id).toBe('matched');
    expect(res.plan.committed).toBeNull();
    await expect(weekSummary(db, { orgId: org.id, rooms: ['berkeley'] }, 'oakland')).rejects.toThrow(/not one of yours/);
    await expect(weekSummary(db, owner, 'nowhere')).rejects.toThrow(/no room/);
    await expect(weekSummary(db, owner, undefined)).rejects.toThrow(/room is required/);
  });

  it('marks a week reviewed through the actions API, refuses junk, and says who reviewed it', async () => {
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    const owner = { orgId: org.id, userId: 'u1', role: 'owner' as const, rooms: null };
    const gm = { orgId: org.id, userId: 'u2', role: 'gm' as const, rooms: ['oakland'] };
    await saveAction(db, owner, { roomId: 'oakland', key: 'week.review', value: { '2026-10-19': { at: '2026-10-27T15:00:00.000Z', note: 'Salmon goes to $30 Tuesday.' } } });
    await saveAction(db, gm, { roomId: 'oakland', key: 'week.review', value: { '2026-10-19': { at: '2026-10-27T15:00:00.000Z', note: 'Salmon goes to $30 Tuesday.' }, '2026-10-12': { at: '2026-10-28T09:00:00.000Z' } } });
    const { reviews } = await weekSummary(db, owner, 'oakland');
    expect(reviews).toEqual([
      { week: '2026-10-19', at: '2026-10-27T15:00:00.000Z', note: 'Salmon goes to $30 Tuesday.', by: 'Maria' },
      { week: '2026-10-12', at: '2026-10-28T09:00:00.000Z', note: null, by: 'Gina' },
    ]);
    await expect(saveAction(db, owner, { roomId: 'oakland', key: 'week.review', value: { 'last week': { at: 'x' } } })).rejects.toThrow(/invalid week.review/);
    await expect(saveAction(db, owner, { roomId: 'oakland', key: 'week.review', value: { '2026-10-19': { at: 'x', note: 'n'.repeat(1001) } } })).rejects.toThrow(/invalid week.review/);
    const many = Object.fromEntries(Array.from({ length: 27 }, (_, i) => [new Date(Date.UTC(2026, 0, 1 + 7 * i)).toISOString().slice(0, 10), { at: 'x' }]));
    await expect(saveAction(db, owner, { roomId: 'oakland', key: 'week.review', value: many })).rejects.toThrow(/26 weeks/);
    await expect(saveAction(db, gm, { roomId: 'berkeley', key: 'week.review', value: {} })).rejects.toThrow(/not one of yours/);
  });
});

describe('a real group', () => {
  it('banks from its own windows; a new room waits for its data', async () => {
    const org = await createOwnOrg(db, 'u1', { name: 'Harbor Hospitality', rooms: [{ name: 'Harbor Grill', seats: 90 }, { name: 'Pier Nine', seats: 40 }] });
    const owner = { orgId: org.id, userId: 'u1', role: 'owner' as const, rooms: null };
    await db.insert(testWindows).values({
      orgId: org.id, roomId: 'harbor-grill', lever: 'overtime', metric: 'otMinutes', title: 'Kitchen overtime', direction: 'down', baseline: 240, centsPerUnitWeek: 15,
      startedAt: '2026-08-08', guard: { avgCheckBase: 30, turnBase: 70 }, status: 'verified', bookedCents: 2800, lowCents: 2800, pointCents: 3500, closedAt: new Date('2026-09-05T12:00:00Z'),
    });
    const res = await weekSummary(db, owner, 'harbor-grill', new Date('2026-10-01T12:00:00Z'));
    expect(res.view.real).toBe(true);
    expect(res.view.awaiting).toBe(true);
    expect(res.view.banked).toMatchObject({ source: 'windows', week: 28, toDate: 104, liveCount: 1 }); // Sep 6 through Oct 1: 26 days × $4
    expect(res.view.attention.some((a: { id: string }) => a.id.startsWith('alarm:') || a.id.startsWith('paused:'))).toBe(false);

    // The Monday digest skips rooms with no data of their own, and sends the rest once per data week.
    expect(await runWeekDigest(db, org.id)).toMatchObject({ sent: [], waiting: ['harbor-grill', 'pier-nine'] });
    await commitInput(db, { orgId: org.id, userId: 'u1', roomId: 'harbor-grill', kind: 'toast', rows: [toast()] });
    const first = await runWeekDigest(db, org.id);
    expect(first).toMatchObject({ sent: ['harbor-grill'], waiting: ['pier-nine'] });
    expect((await runWeekDigest(db, org.id)).sent).toEqual([]);
    const notes = await db.select().from(notifications).where(eq(notifications.orgId, org.id));
    const week = notes.filter((n) => n.kind === 'week');
    expect(week).toHaveLength(1);
    expect(week[0]).toMatchObject({ roomId: 'harbor-grill', link: '/' });
    expect(week[0]!.title).toMatch(/^Harbor Grill: the week of /);
    expect(week[0]!.body).toMatch(/Verified run-rate \$28\.00\/wk from 1 verified change/);
  });

  it('the scheduled job runs for real groups only', async () => {
    const sample = await createSampleOrg(db, { ownerId: 'u1' });
    expect(await runWeekDigest(db, sample.id)).toEqual({ skipped: 'sample group' });
    await createOwnOrg(db, 'u1', { name: 'Harbor Hospitality', rooms: [{ name: 'Harbor Grill', seats: 90 }] });
    const results = await runJob(db, 'week');
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
  });
});

describe('committing the week’s plan', () => {
  it('commits with owners and dates, refuses blocked or foreign actions, keeps history, and survives new data', async () => {
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    const owner = { orgId: org.id, userId: 'u1', role: 'owner' as const, rooms: null };
    const gm = { orgId: org.id, userId: 'u2', role: 'gm' as const, rooms: ['oakland'] };
    const items = [{ id: 'ribeye', owner: 'Gina', due: '2026-10-30' }, { id: 'vendor', owner: 'Maria', due: '2026-11-02' }];
    const now = new Date('2026-10-27T12:00:00Z');
    // A blocked recommendation can't be approved: salmon needs current recipe costs.
    await expect(commitWeekPlan(db, owner, { roomId: 'oakland', week: '2026-10-19', items: [{ id: 'salmon', owner: 'Gina', due: '2026-10-30' }] }, now)).rejects.toThrow(/can’t be committed/);
    await expect(commitWeekPlan(db, gm, { roomId: 'berkeley', week: '2026-10-19', items }, now)).rejects.toThrow(/not one of yours/);
    await expect(commitWeekPlan(db, owner, { roomId: 'oakland', week: '2026-10-12', items }, now)).rejects.toThrow(/another week/);

    const res = await commitWeekPlan(db, gm, { roomId: 'oakland', week: '2026-10-19', items }, now);
    expect(res.plan.committed).toMatchObject({ week: '2026-10-19', revision: 1 });
    expect(res.plan.committedBy).toBe('Gina');
    expect(res.plan.items.map((i: { id: string; owner: string; status: string }) => [i.id, i.owner, i.status])).toEqual([['ribeye', 'Gina', 'planned'], ['vendor', 'Maria', 'planned']]);

    const moved = await updateWeekPlanItem(db, owner, { roomId: 'oakland', week: '2026-10-19', id: 'vendor', status: 'doing' }, now);
    expect(moved.plan.items.find((i: { id: string }) => i.id === 'vendor')!.status).toBe('doing');
    await expect(updateWeekPlanItem(db, owner, { roomId: 'oakland', week: '2026-10-19', id: 'vendor', status: 'finished' }, now)).rejects.toThrow(/Unknown status/);

    // New data (ribeye set aside): the committed plan stays; the change is a revision to review.
    await saveAction(db, owner, { roomId: 'oakland', key: 'findings', value: { ribeye: '2027-01-01T00:00:00.000Z' } });
    const after = await weekSummary(db, owner, 'oakland', now);
    expect(after.plan.items.map((i: { id: string }) => i.id)).toEqual(['ribeye', 'vendor']);
    expect(after.plan.revisions?.dropped.map((i: { id: string }) => i.id)).toEqual(['ribeye']);
    expect(after.plan.history.length).toBe(2);

    // The plan isn't writable through the generic actions API.
    await expect(saveAction(db, owner, { roomId: 'oakland', key: 'week.plan', value: { week: '2026-10-19', items: [] } })).rejects.toThrow(/unknown action/);
    const rows = await db.select().from(actions).where(and(eq(actions.orgId, org.id), eq(actions.key, 'week.plan')));
    expect(rows).toHaveLength(2); // append-only
  });
});

