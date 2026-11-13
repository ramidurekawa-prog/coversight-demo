import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { readToastExports } from '../lib/data/toast.js';
import { deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';
import { noteKey, signalKey, trendsFor } from '../lib/data/page/trends.js';
import type { Db } from '../server/db/client';
import { notifications, snapshots, users } from '../server/db/schema';
import { loadActions, saveAction } from '../server/actions';
import { runJob } from '../server/jobs';
import { commitInput, createSampleOrg } from '../server/org';
import { runTrendsWatch } from '../server/page/trends';
import { loadDataset } from '../server/dataset';
import { freshDb } from './helpers/db';
import { toastFixture } from './helpers/toast-fixture.js';

let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
const gm = (rooms: string[]) => ({ orgId, userId: 'u1', role: 'gm' as const, rooms });
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});

type Snap = { method: string; own: boolean; ready: boolean; signals: { key: string; metric: string; good: boolean; ongoing: boolean; explained: boolean; severity: string; title: string; expected: unknown; baselineWeeks: number }[] };
const snap = async (roomId: string) => (await db.select().from(snapshots).where(and(eq(snapshots.orgId, orgId), eq(snapshots.roomId, roomId), eq(snapshots.kind, 'trends'))))[0]?.data as Snap;
const berkeleyWcmKey = () => {
  const rows = deriveRoom(SEED, 'berkeley').hist.rows;
  const s = trendsFor(rows).signals.find((x: { metric: string }) => x.metric === 'wcm');
  return signalKey(s, rows) as string;
};

describe('Trends notes (trends.notes)', () => {
  it('saves a note per room and reads it back', async () => {
    const key = berkeleyWcmKey();
    await saveAction(db, owner(), { roomId: 'berkeley', key: 'trends.notes', value: { [key]: { cause: 'change', text: 'New menu', at: '2026-10-20T10:00:00Z' } } });
    const acts = await loadActions(db, orgId);
    expect(acts.berkeley!['trends.notes']).toEqual({ [key]: { cause: 'change', text: 'New menu', at: '2026-10-20T10:00:00Z' } });
  });

  it('refuses a bad week key, an unknown cause or an over-long note', async () => {
    const save = (value: unknown) => saveAction(db, owner(), { roomId: 'oakland', key: 'trends.notes', value });
    await expect(save({ 'oct-19:net': { cause: 'change', text: '', at: '' } })).rejects.toThrow(/invalid trends.notes/);
    await expect(save({ [noteKey('2026-10-19', 'rent')]: { cause: 'change', text: '', at: '' } })).rejects.toThrow(/invalid trends.notes/);
    await expect(save({ [noteKey('2026-10-19', 'net')]: { cause: 'aliens', text: '', at: '' } })).rejects.toThrow(/invalid trends.notes/);
    await expect(save({ [noteKey('2026-10-19', 'net')]: { cause: 'one-off', text: 'x'.repeat(281), at: '' } })).rejects.toThrow(/invalid trends.notes/);
  });

  it('lets a GM note only their own rooms', async () => {
    const value = { [noteKey('2026-10-19', 'net')]: { cause: 'one-off', text: 'Private party', at: '2026-10-20' } };
    await expect(saveAction(db, gm(['oakland']), { roomId: 'berkeley', key: 'trends.notes', value })).rejects.toThrow(/not one of yours/);
    await expect(saveAction(db, gm(['oakland']), { roomId: 'oakland', key: 'trends.notes', value })).resolves.toBeTruthy();
  });
});

describe('the nightly trends watch', () => {
  it('snapshots every room with the same signals the page shows', async () => {
    const [res] = await runJob(db, 'trends', { orgId });
    expect(res!.ok).toBe(true);
    for (const id of Object.keys(SEED.rooms)) {
      const s = await snap(id);
      const page = trendsFor(deriveRoom(SEED, id).hist.rows);
      expect(s.signals.map((x) => x.metric).sort()).toEqual(page.signals.map((x: { metric: string }) => x.metric).sort());
      expect(s.ready).toBe(true);
    }
  });

  it('tells the room once about an ongoing, unexplained signal in the wrong direction', async () => {
    const first = await runTrendsWatch(db, orgId);
    const notes = await db.select().from(notifications).where(eq(notifications.orgId, orgId));
    expect(first.told).toBe(notes.length);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.kind === 'trends.signal' && n.severity === 'warn' && n.link === '/trends/')).toBe(true);
    expect(notes.some((n) => n.roomId === 'berkeley' && n.title.includes('Weighted margin per dish'))).toBe(true);
    // Good news and episodes that already ended aren't sent.
    for (const id of Object.keys(SEED.rooms)) {
      const sent = (await snap(id)).signals.filter((x) => !x.good && x.ongoing && !x.explained && x.severity !== 'low').length;
      expect(notes.filter((n) => n.roomId === id)).toHaveLength(sent);
    }
    const again = await runTrendsWatch(db, orgId);
    expect(again.told).toBe(0);
    expect(await db.select().from(notifications).where(eq(notifications.orgId, orgId))).toHaveLength(notes.length);
  });

  it('stays quiet about a signal someone has explained', async () => {
    const key = berkeleyWcmKey();
    await saveAction(db, owner(), { roomId: 'berkeley', key: 'trends.notes', value: { [key]: { cause: 'change', text: 'Moved the burger', at: '2026-10-20' } } });
    await runTrendsWatch(db, orgId);
    const notes = await db.select().from(notifications).where(eq(notifications.orgId, orgId));
    expect(notes.some((n) => n.title.includes('Weighted margin per dish'))).toBe(false);
    expect((await snap('berkeley')).signals.find((x) => x.key === key)!.explained).toBe(true);
  });

  it('a "still looking" note keeps the alert coming', async () => {
    const key = berkeleyWcmKey();
    await saveAction(db, owner(), { roomId: 'berkeley', key: 'trends.notes', value: { [key]: { cause: 'looking', text: '', at: '2026-10-20' } } });
    await runTrendsWatch(db, orgId);
    const notes = await db.select().from(notifications).where(eq(notifications.orgId, orgId));
    expect(notes.some((n) => n.title.includes('Weighted margin per dish'))).toBe(true);
  });

  it('corrected source data updates the affected trend', async () => {
    const commit = async (seed: number) => {
      const files = toastFixture({ seed });
      const { unknown, ...sum } = readToastExports(Object.entries(files).map(([name, text]) => ({ name, text })));
      void unknown;
      await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'toast', rows: [JSON.parse(JSON.stringify(sum))] });
      const { ds } = (await loadDataset(db, orgId))!;
      return trendsFor(deriveRoom(ds, 'oakland').hist.rows);
    };
    const first = await commit(7);
    const corrected = await commit(8);
    expect(first.w.own).toBe(true);
    type T = { w: { from: number }; metrics: Record<string, { vals: (number | null)[] }> };
    const own = (t: unknown) => (t as T).metrics.net!.vals.slice((t as T).w.from);
    expect(own(corrected)).not.toEqual(own(first));
    expect(own(corrected).every((v) => v == null || v > 0)).toBe(true);
  });

  it('judges a room on its own Toast weeks only', async () => {
    const files = toastFixture({});
    const { unknown, ...s } = readToastExports(Object.entries(files).map(([name, text]) => ({ name, text })));
    void unknown;
    await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'toast', rows: [JSON.parse(JSON.stringify(s))] });
    await runTrendsWatch(db, orgId);
    const oak = await snap('oakland');
    expect(oak.own).toBe(true);
    expect((await snap('berkeley')).own).toBe(false);
  });
});
