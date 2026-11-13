// Data inputs page: spec 8.14 acceptance, server and shared rules.
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../server/db/client';
import { auditLog, inputs, linkedSources, memberships, notifications, testWindows, users } from '../server/db/schema';
import { addLink } from '../server/links';
import { createSampleOrg, loadBase, loadInputs } from '../server/org';
import { commitChecked, inputHistory, scopedInputs, undoChecked } from '../server/page/inputs';
import { analyze, attention, checkRows, cleanOpts, commitSummary, currentIds, extraChecks, fingerprint, mappingReview, mergeRows, parseDay, safeCSV, sourceOf } from '../lib/data/page/inputs.js';
import { applyInputs } from '../lib/data/apply.js';
import { mapColumns } from '../lib/data/ingest.js';
import { deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';
import { freshDb } from './helpers/db';

let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
const gm = () => ({ orgId, userId: 'u2', role: 'gm' as const, rooms: ['berkeley'] });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = SEED as any;
const NOW = new Date('2026-10-27T18:00:00Z');

beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'm@example.com' }, { id: 'u2', name: 'Sam', email: 's@example.com' }]);
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  await db.insert(memberships).values({ orgId, userId: 'u2', role: 'gm', rooms: ['berkeley'] });
});

const today = new Date().toISOString().slice(0, 10);
const waste = (qty: number | string, date = today) => ({ item: 'Salmon fillet', qty, reason: 'trim', date });
const salmonCost = (cost: number) => ({ dish: 'Grilled Salmon', price: 28, cost, units: 142 });

describe('shared rules', () => {
  it('only keeps a replace flag on kinds that can replace', () => {
    expect(cleanOpts('recipes', { replace: true })).toEqual({ replace: true });
    expect(cleanOpts('recipes', { replace: 'yes', evil: 1 })).toBeUndefined();
    expect(cleanOpts('counts', { replace: true })).toBeUndefined();
  });

  it('fingerprints content, not key order', () => {
    expect(fingerprint([{ a: 1, b: 2 }])).toBe(fingerprint([{ b: 2, a: 1 }]));
    expect(fingerprint([{ a: 1 }])).not.toBe(fingerprint([{ a: 2 }]));
  });

  it('a repeated waste upload does not double-count', () => {
    const once = mergeRows('waste', [], [waste(2), waste(3)]);
    const twice = mergeRows('waste', once.rows, [waste(2), waste(3)]);
    expect(twice.rows).toHaveLength(2);
    expect(twice.duplicates).toBe(2);
    expect(mergeRows('counts', [{ a: 1 }], [{ b: 2 }]).rows).toEqual([{ b: 2 }]);
  });

  it('marks the newest live entry per room and kind as current', () => {
    const ids = currentIds([{ id: 'c', room: 'a', kind: 'waste' }, { id: 'b', room: 'a', kind: 'waste' }, { id: 'x', room: 'a', kind: 'counts', undone: true }, { id: 'y', room: 'a', kind: 'counts' }]);
    expect([...ids]).toEqual(['c', 'y']);
  });

  it('names where data comes from', () => {
    expect(sourceOf({ entry: { n: 1 }, feed: null, linked: false }).key).toBe('hand');
    expect(sourceOf({ entry: { n: 1 }, feed: null, linked: true }).key).toBe('linked');
    expect(sourceOf({ entry: null, feed: { state: 'stale' }, linked: false }).key).toBe('stale');
  });

  it('ambiguous unit and money mappings need confirmation', () => {
    const headers = ['Product', 'Price', 'Quantity', 'Unit'];
    const r = mappingReview(headers, 'invoices', mapColumns(headers, 'invoices').map);
    expect(r.needsConfirm).toBe(true);
    expect(r.rows.find((x) => x.header === 'Price')!.risk).toMatch(/case/);
    const g = mappingReview(['Channel', 'Gross', 'Orders'], 'channels', mapColumns(['Channel', 'Gross', 'Orders'], 'channels').map);
    expect(g.rows.find((x) => x.header === 'Gross')!.risk).toMatch(/net/);
    const exact = ['item', 'unit_price', 'qty', 'unit'];
    expect(mappingReview(exact, 'invoices', mapColumns(exact, 'invoices').map).needsConfirm).toBe(false);
  });

  it('import errors name the exact row and column', () => {
    const room = S.rooms.oakland;
    const r = checkRows('waste', [waste(1), waste('lots'), { ...waste(1), date: '13/45' }], room, undefined, { now: NOW });
    expect(r.ok).toBe(false);
    expect(r.issues.find((x: { level: string }) => x.level === 'error')).toMatchObject({ row: 2, col: 'qty' });
    const d = checkRows('waste', [waste(1, '2026-10-20'), { ...waste(1), date: '13/45' }], room, undefined, { now: NOW });
    expect(d.issues.find((x: { level: string }) => x.level === 'error')).toMatchObject({ row: 2, col: 'date' });
    expect(checkRows('waste', [waste(1, '2027-01-01')], room, undefined, { now: NOW }).error).toMatch(/future/);
  });

  it('reads hand-written dates', () => {
    expect(parseDay('2026-10-03')?.toISOString().slice(0, 10)).toBe('2026-10-03');
    expect(parseDay('10/3', NOW)?.toISOString().slice(0, 10)).toBe('2026-10-03');
    expect(parseDay('Oct 3', NOW)?.toISOString().slice(0, 10)).toBe('2026-10-03');
    expect(parseDay('2/30/2026')).toBeNull();
  });

  it('look-alike names and changed units are flagged for a yes, never matched silently', () => {
    const room = S.rooms.oakland;
    const x = extraChecks('recipes', [{ dish: 'Grilled Salmn', price: 20, cost: 5, units: 10 }], room);
    expect(x[0]).toMatchObject({ level: 'warn', confirm: true });
    const inv = room.invoices[0];
    const u = extraChecks('invoices', [{ item: inv.item, unit: inv.unit === 'case' ? 'lb' : 'case', unit_price: 10, qty: 1 }], room);
    expect(u.some((i: { confirm?: boolean; col: string }) => i.confirm && i.col === 'unit')).toBe(true);
  });

  it('neutralises formula cells in CSV exports', () => {
    const out = safeCSV(['a', 'b', 'c'], [{ a: '=HYPERLINK("x")', b: '-12.5', c: '@SUM(A1)' }]);
    expect(out.split('\n')[1]).toBe(`"'=HYPERLINK(""x"")",-12.5,'@SUM(A1)`);
  });

  it('preview and commit summary come from the same computation', () => {
    const rows = [salmonCost(9)];
    const a = analyze({ base: S, inputs: {}, roomId: 'oakland', kind: 'recipes', rows });
    const changed = a.moves.filter((m: { changed: boolean }) => m.changed).map((m: { label: string; before: string; after: string }) => `${m.label}: ${m.before} → ${m.after}`).join('; ');
    expect(commitSummary(S, {}, 'oakland', 'recipes', rows)).toBe(changed);
    expect(a.diff).toMatchObject({ matched: 1, updated: 1, added: 0 });
    expect(a.moves.some((m: { label: string }) => /Contribution after food and labour/.test(m.label))).toBe(true);
  });

  it('missing data ranks first, and the warning clears once it is entered (blocked finding re-evaluated)', () => {
    const before = applyInputs(S, {});
    const items = attention(deriveRoom(before, 'oakland'), before.rooms.oakland);
    expect(items[0]!.kind).toBe('recipes');
    expect(items[0]!.blocked.map((b: { id: string }) => b.id)).toContain('salmon');
    const a = analyze({ base: S, inputs: {}, roomId: 'oakland', kind: 'recipes', rows: [salmonCost(9.5)] });
    expect(a.findings.unblocked.map((f: { id: string }) => f.id)).toContain('salmon');
    const inputsAfter = { oakland: { recipes: { rows: [salmonCost(9.5)], date: 'now', n: 1 } } };
    const after = applyInputs(S, inputsAfter);
    expect(attention(deriveRoom(after, 'oakland'), after.rooms.oakland).map((i: { kind: string }) => i.kind)).not.toContain('recipes');
  });
});

describe('commit on the server', () => {
  it('invalid files cannot commit', async () => {
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [waste('lots')] })).rejects.toThrow(/Not saved: Row 1.*isn't a number/);
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'profile', rows: [{ name: 'X', seats: 0, covers: 10 }] })).rejects.toThrow(/Seats must be above 0/);
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'recipes', rows: [{ dish: '=HYPERLINK("x")', price: 10, cost: 2, units: 3 }] })).rejects.toThrow(/formula/);
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'payroll', rows: [{}] })).rejects.toThrow();
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [] })).rejects.toThrow(/No rows/);
    expect((await db.select().from(inputs)).length).toBe(0);
  });

  it('stores normalised rows, cleans opts, writes its own summary, and verifies what it stored', async () => {
    const r = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [waste('2')], opts: { replace: true }, summary: 'I say nothing moved' });
    const [row] = await db.select().from(inputs);
    expect(row!.rows).toEqual([{ item: 'Salmon fillet', qty: 2, reason: 'trim', date: today }]);
    expect(row!.opts).toBeNull();
    expect(row!.summary).toMatch(/Logged waste, per week: \$\d+ → \$\d+/);
    expect(r.verify.ok).toBe(true);
    expect(r.verify.rows).toBe(1);
  });

  it('duplicate uploads and retries do not double-count', async () => {
    const a = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [waste(2), waste(3)] });
    const b = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [waste(2), waste(3)] });
    expect(b.unchanged).toBe(true);
    expect(b.id).toBe(a.id);
    const c = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [waste(3), waste(4)] });
    expect(c.duplicates).toBe(1);
    expect((await loadInputs(db, orgId)).inputs.oakland!.waste!.n).toBe(3);
    const p1 = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'profile', rows: [{ name: 'Oak', seats: 80, covers: 1200 }] });
    const p2 = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'profile', rows: [{ name: 'Oak', seats: '80', covers: '1,200' }] });
    expect(p2).toMatchObject({ unchanged: true, id: p1.id });
    expect((await db.select().from(inputs)).length).toBe(3);
  });

  it('material changes need an explicit confirmation, re-derived on the server', async () => {
    const menu = S.rooms.oakland.menu.filter((m: { balancing?: boolean }) => !m.balancing).slice(0, 3).map((m: { name: string; price: number; cost: number; units: number }) => ({ dish: m.name, price: m.price, cost: m.cost, units: m.units }));
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'recipes', rows: menu, opts: { replace: true } })).rejects.toThrow(/Needs your confirmation: Replaces the sample menu/);
    await expect(commitChecked(db, owner(), { roomId: 'oakland', kind: 'recipes', rows: [{ dish: 'Grilled Salmn', price: 20, cost: 5, units: 10 }] })).rejects.toThrow(/second look/);
    const ok = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'recipes', rows: menu, opts: { replace: true }, confirm: true });
    expect(ok.verify.ok).toBe(true);
  });

  it('keeps a GM to their rooms, and one group can never touch another', async () => {
    await expect(commitChecked(db, gm(), { roomId: 'oakland', kind: 'waste', rows: [waste(1)] })).rejects.toThrow(/not one of yours/);
    await commitChecked(db, gm(), { roomId: 'berkeley', kind: 'profile', rows: [{ name: 'Berkeley Two', seats: 60, covers: 900 }] });
    const mine = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [waste(1)] });
    const scoped = await scopedInputs(db, gm());
    expect(Object.keys(scoped.inputs)).toEqual(['berkeley']);
    expect(scoped.log.every((e) => e.room === 'berkeley')).toBe(true);

    await db.insert(users).values({ id: 'u3', name: 'Other', email: 'x@example.com' });
    const other = (await createSampleOrg(db, { ownerId: 'u3' })).id;
    const them = { orgId: other, userId: 'u3', role: 'owner' as const, rooms: null };
    await commitChecked(db, them, { roomId: 'oakland', kind: 'waste', rows: [waste(9)] });
    expect((await loadInputs(db, orgId)).inputs.oakland!.waste!.rows).toEqual([{ item: 'Salmon fillet', qty: 1, reason: 'trim', date: today }]);
    await expect(undoChecked(db, them, mine.id)).rejects.toThrow(/no such entry/);
    expect((await inputHistory(db, them, {})).entries.every((e) => e.id !== mine.id)).toBe(true);
  });

  it('records provenance and flags running tests on the data', async () => {
    await db.insert(testWindows).values({ orgId, roomId: 'oakland', lever: 'menu_margin', metric: 'dishMargin', dish: 'salmon', title: 'Salmon to $30', direction: 'up', baseline: 1, centsPerUnitWeek: 100, startedAt: '2026-10-01', guard: {} } as never);
    const r = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'recipes', rows: [salmonCost(9)], provenance: { source: 'file', file: 'costs.csv', filePrint: 'abcdef0123456789', mapping: { Dish: 'dish' }, rejected: 1 }, mappingConfirmed: true });
    expect(r.effects.tests).toEqual(['Salmon to $30']);
    const [p] = await db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, 'inputs.import')));
    expect(p!.detail).toMatchObject({ inputId: r.id, source: 'file', file: 'costs.csv', filePrint: 'abcdef0123456789', mappingVersion: 1, counts: { accepted: 1, matched: 1, updated: 1 }, validation: { rejected: 1 }, prior: null });
    const notes = await db.select().from(notifications).where(eq(notifications.orgId, orgId));
    expect(notes.some((n) => n.kind === 'inputs.test-data')).toBe(true);
    const h = await inputHistory(db, owner(), {});
    expect(h.entries[0]).toMatchObject({ source: 'file', file: 'costs.csv', verified: true });
  });

  it('a commit is reflected in the data every page reads', async () => {
    await commitChecked(db, owner(), { roomId: 'oakland', kind: 'recipes', rows: [salmonCost(9)] });
    const loaded = await loadBase(db, orgId);
    const { inputs: live } = await loadInputs(db, orgId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ds = applyInputs(loaded!.base as any, live as any);
    expect(ds.rooms.oakland.menu.find((m: { name: string }) => m.name === 'Grilled Salmon').cost).toBe(9);
  });
});

describe('undo and history', () => {
  it('undo cannot silently erase later valid changes', async () => {
    const a = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [waste(1)] });
    const b = await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [waste(2)] });
    await expect(undoChecked(db, owner(), a.id)).rejects.toThrow(/later entry/);
    await expect(undoChecked(db, gm(), b.id)).rejects.toThrow(/not one of yours/);
    await expect(undoChecked(db, owner(), 'not-a-uuid')).rejects.toThrow(/no such entry/);
    await undoChecked(db, owner(), b.id);
    await expect(undoChecked(db, owner(), b.id)).rejects.toThrow(/Already undone/);
    expect((await loadInputs(db, orgId)).inputs.oakland!.waste!.n).toBe(1);
    await undoChecked(db, owner(), a.id); // now a is current
  });

  it('lists who did what, pages, filters and scopes', async () => {
    await commitChecked(db, owner(), { roomId: 'oakland', kind: 'waste', rows: [waste(1)] });
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
