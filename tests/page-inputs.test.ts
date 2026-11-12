import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../server/db/client';
import { inputs, linkedSources, memberships, users } from '../server/db/schema';
import { addLink } from '../server/links';
import { createSampleOrg, loadInputs } from '../server/org';
import { commitChecked, inputHistory, scopedInputs, undoChecked } from '../server/page/inputs';
import { cleanOpts, currentIds, mergeRows, recheck, sourceOf } from '../lib/data/page/inputs.js';
import { SEED } from '../lib/data/seed.js';
import { freshDb } from './helpers/db';

let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
const gm = () => ({ orgId, userId: 'u2', role: 'gm' as const, rooms: ['berkeley'] });

beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'm@example.com' }, { id: 'u2', name: 'Sam', email: 's@example.com' }]);
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  await db.insert(memberships).values({ orgId, userId: 'u2', role: 'gm', rooms: ['berkeley'] });
});

const salmon = (qty: number | string) => ({ item: 'Salmon fillet', qty, reason: 'trim' });

describe('pure helpers', () => {
  it('only keeps a replace flag on kinds that can replace', () => {
    expect(cleanOpts('recipes', { replace: true })).toEqual({ replace: true });
    expect(cleanOpts('recipes', { replace: 'yes', evil: 1 })).toBeUndefined();
    expect(cleanOpts('counts', { replace: true })).toBeUndefined();
  });
  it('appends waste, replaces everything else', () => {
    expect(mergeRows('waste', [1], [2])).toEqual([1, 2]);
    expect(mergeRows('counts', [1], [2])).toEqual([2]);
  });
  it('marks the newest live entry per room and kind as current', () => {
    const ids = currentIds([{ id: 'c', room: 'a', kind: 'waste' }, { id: 'b', room: 'a', kind: 'waste' }, { id: 'x', room: 'a', kind: 'counts', undone: true }, { id: 'y', room: 'a', kind: 'counts' }]);
    expect([...ids]).toEqual(['c', 'y']);
  });
  it('rechecks with the screen rules', () => {
    const room = (SEED as unknown as { rooms: Record<string, unknown> }).rooms.oakland;
    expect(recheck('waste', [salmon(2)], room, undefined).ok).toBe(true);
    expect(recheck('waste', [salmon(-1)], room, undefined).error).toMatch(/negative/);
    expect(recheck('waste', [{ item: 'Unicorn', qty: 1, reason: 'trim' }], room, undefined).error).toMatch(/counted item/);
  });
  it('names where data comes from', () => {
    expect(sourceOf({ entry: { n: 1 }, feed: null, linked: false }).key).toBe('hand');
    expect(sourceOf({ entry: { n: 1 }, feed: null, linked: true }).key).toBe('linked');
    expect(sourceOf({ entry: null, feed: { state: 'stale' }, linked: false }).key).toBe('stale');
    expect(sourceOf({ entry: null, feed: { state: 'healthy' }, linked: false }).key).toBe('sample');
  });
});

describe('commit on the server', () => {
  it('re-checks rows and refuses what the screen would refuse', async () => {
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [salmon('lots')] })).rejects.toThrow(/Not saved: Row 1.*isn't a number/);
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'profile', rows: [{ name: 'X', seats: 0, covers: 10 }] })).rejects.toThrow(/Seats must be above 0/);
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'recipes', rows: [{ dish: '=HYPERLINK("x")', price: 10, cost: 2, units: 3 }] })).rejects.toThrow(/formula/);
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'payroll', rows: [{}] })).rejects.toThrow();
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [] })).rejects.toThrow(/No rows/);
    expect((await db.select().from(inputs)).length).toBe(0);
  });

  it('stores normalised rows, cleans opts, and writes its own summary', async () => {
    await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [salmon('2')], opts: { replace: true }, summary: 'I say nothing moved' });
    const [row] = await db.select().from(inputs);
    expect(row!.rows).toEqual([{ item: 'Salmon fillet', qty: 2, reason: 'trim', date: null }]);
    expect(row!.opts).toBeNull();
    expect(row!.summary).toMatch(/Logged waste, per week: \$\d+ → \$\d+/);
  });

  it('keeps a GM to their rooms', async () => {
    await expect(commitChecked(db, gm(), { roomId: 'oakland', kind: 'waste', rows: [salmon(1)] })).rejects.toThrow(/not one of yours/);
    await commitChecked(db, gm(), { roomId: 'berkeley', kind: 'profile', rows: [{ name: 'Berkeley Two', seats: 60, covers: 900 }] });
    await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [salmon(1)] });
    const scoped = await scopedInputs(db, gm());
    expect(Object.keys(scoped.inputs)).toEqual(['berkeley']);
    expect(scoped.log.every((e) => e.room === 'berkeley')).toBe(true);
  });
});

describe('undo and history', () => {
  it('undoes only the entry in use, in your rooms', async () => {
    const a = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [salmon(1)] });
    const b = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [salmon(1), salmon(2)] });
    await expect(undoChecked(db, owner(), a)).rejects.toThrow(/later entry/);
    await expect(undoChecked(db, gm(), b)).rejects.toThrow(/not one of yours/);
    await expect(undoChecked(db, owner(), 'not-a-uuid')).rejects.toThrow(/no such entry/);
    await undoChecked(db, owner(), b);
    await expect(undoChecked(db, owner(), b)).rejects.toThrow(/Already undone/);
    expect((await loadInputs(db, orgId)).inputs.oakland!.waste!.n).toBe(1);
    await undoChecked(db, owner(), a); // now a is current
  });

  it('lists who did what, pages, filters and scopes', async () => {
    await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [salmon(1)] });
    await commitChecked(db, gm(), { roomId: 'berkeley', kind: 'profile', rows: [{ name: 'Berkeley Two', seats: 60, covers: 900 }] });
    await db.insert(inputs).values({ orgId, roomId: 'oakland', kind: 'counts', rows: [{ item: 'x' }], summary: 'Linked sheet · Counts · 1 rows', userId: null });

    const all = await inputHistory(db, owner(), {});
    expect(all.entries.map((e) => e.by.name)).toEqual(['Linked sheet', 'Sam', 'You']);
    expect(all.entries.every((e) => e.current)).toBe(true);
    expect(all.canReset).toBe(true);

    const mine = await inputHistory(db, gm(), {});
    expect(mine.entries.map((e) => e.room)).toEqual(['berkeley']);
    expect(mine.canReset).toBe(false);
    await expect(inputHistory(db, gm(), { roomId: 'oakland' })).rejects.toThrow(/not one of yours/);

    const page1 = await inputHistory(db, owner(), { limit: '1' });
    expect(page1.more).toBe(true);
    const page2 = await inputHistory(db, owner(), { limit: '1', before: page1.entries[0]!.createdAt });
    expect(page2.entries[0]!.id).not.toBe(page1.entries[0]!.id);
    expect((await inputHistory(db, owner(), { kind: 'waste' })).entries).toHaveLength(1);
    await expect(inputHistory(db, owner(), { kind: 'payroll' })).rejects.toThrow();
  });
});

describe('linked sheets', () => {
  const URL = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK_lmnop/edit#gid=0';
  it('updates a re-linked sheet instead of copying it, and refuses clashing kinds', async () => {
    const a = await addLink(db, owner(), { url: URL, roomId: 'oakland', picks: [{ source: 'x · Counts', kind: 'counts' }] });
    const b = await addLink(db, owner(), { url: `${URL}&again`, roomId: 'oakland', picks: [{ source: 'x · Waste', kind: 'waste' }] });
    expect(b.id).toBe(a.id);
    expect((await db.select().from(linkedSources).where(eq(linkedSources.orgId, orgId)))).toHaveLength(1);
    await expect(addLink(db, owner(), { url: URL, roomId: 'oakland', picks: [{ source: 'a', kind: 'counts' }, { source: 'b', kind: 'counts' }] })).rejects.toThrow(/one tab per kind/);
    await expect(addLink(db, owner(), { url: 'https://www.dropbox.com/scl/fi/abc/w.xlsx?dl=0', roomId: 'oakland', picks: [{ source: 'w', kind: 'waste' }] })).rejects.toThrow(/already feeds waste log/);
  });
});
