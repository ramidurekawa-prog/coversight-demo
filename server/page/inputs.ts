// Data inputs page, server side. Every commit is checked again here with the
// same rules the review panel used (lib/data/page/inputs.js), against the room
// as the group's own data has it now, so a request that skips the screen
// can't land rows the screen would refuse. Then (spec 8.4):
//  - Confirm: replacing a list, overriding Toast, look-alike names or changed
//    units need `confirm: true`, re-derived here, not trusted from the client.
//  - Process: idempotent. Rows identical to what's in use, or waste rows
//    already logged, add nothing, so a retry or a repeat upload can't double.
//  - Verify: the stored rows are read back and fingerprinted against what was
//    checked; a mismatch is reported, never hidden.
//  - Provenance: one `inputs.import` audit row per commit (source, file print,
//    mapping, counts, effects, the entry it replaced).
//  - Propagation: running tests on a lever this kind feeds get a notification.
// Undo and the history are scoped to the viewer's rooms.
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';

import { analyze as analyzeJs, checkRows, cleanOpts, commitSummary, currentIds, fingerprint, roomFor } from '../../lib/data/page/inputs.js';
import { INPUT_KINDS } from '../../lib/data/apply.js';
import type { Db } from '../db/client';
import { auditLog, inputs, testWindows, users } from '../db/schema';
import { notify } from '../notify';
import { InputError, commitInput, loadBase, loadInputs, undoInput } from '../org';
import { AuthError, type Viewer } from '../session';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
type Json = Record<string, unknown>;

/** A whole request body is capped well under the serverless limit. */
const MAX_JSON = 2_000_000;
export const SOURCES = ['grid', 'csv', 'file', 'paste', 'link', 'photo', 'toast'] as const;

const provenance = z.object({
  source: z.enum(SOURCES).default('grid'),
  file: z.string().max(300).optional(),
  filePrint: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  mapping: z.record(z.string().max(120), z.string().max(40)).optional(),
  rejected: z.number().int().min(0).max(100_000).optional(),
}).partial().optional();

const commitBody = z.object({
  roomId: z.string().min(1).max(60),
  kind: z.enum(INPUT_KINDS as [string, ...string[]]),
  rows: z.array(z.record(z.string(), z.unknown())).min(1, 'No rows to commit').max(5_000, 'At most 5,000 rows'),
  opts: z.unknown().optional(),
  summary: z.string().max(2_000).optional(),
  confirm: z.boolean().optional(),
  mappingConfirmed: z.boolean().optional(),
  provenance,
});

type Analysis = {
  rows: unknown[]; duplicates: number; unchanged: boolean; fingerprint: string;
  moves: { label: string; before: string; after: string; changed: boolean }[];
  diff: { matched: number; added: number; updated: number; unchanged: number; removed: string[] };
  findings: { unblocked: { title: string }[] };
  tests: { id: string; title: string }[];
  confirm: string[];
};
const analyze = analyzeJs as unknown as (a: Record<string, unknown>) => Analysis;

const canSee = (v: V, roomId: string) => !v.rooms || v.rooms.includes(roomId);

/** Inputs and log as the engine wants them, trimmed to the viewer's rooms. */
export async function scopedInputs(db: Db, v: V) {
  const { inputs: all, log } = await loadInputs(db, v.orgId);
  const mine = Object.fromEntries(Object.entries(all).filter(([room]) => canSee(v, room)));
  return { inputs: mine, log: log.filter((e) => canSee(v, e.room)) };
}

export type CommitResult = {
  id: string;
  unchanged: boolean;
  duplicates: number;
  verify: { ok: boolean; rows: number; fingerprint: string; expected: string };
  effects: { moved: number; unblocked: string[]; tests: string[] };
};

/** Check a commit like the screen does, then save it. */
export async function commitChecked(db: Db, v: V, raw: unknown): Promise<CommitResult> {
  if (JSON.stringify(raw ?? null).length > MAX_JSON) throw new InputError('That is too much to commit at once. Split it into smaller files.');
  const p = commitBody.safeParse(raw);
  if (!p.success) throw new InputError(p.error.issues[0]?.message ?? 'invalid input');
  const { roomId, kind, rows } = p.data;
  if (!canSee(v, roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const { inputs: live } = await loadInputs(db, v.orgId);
  const prior = (live[roomId]?.[kind] as { rows?: unknown[] } | undefined);
  const [priorEntry] = await db.select({ id: inputs.id }).from(inputs).where(and(eq(inputs.orgId, v.orgId), eq(inputs.roomId, roomId), eq(inputs.kind, kind), eq(inputs.undone, false))).orderBy(desc(inputs.createdAt)).limit(1);

  if (kind === 'toast') {
    // Shape-checked by commitInput (server/toast-schema.ts); the summary is the screen's one line.
    if (prior?.rows && fingerprint(prior.rows) === fingerprint(rows)) return unchangedResult(priorEntry!.id, rows);
    const id = await commitInput(db, { orgId: v.orgId, userId: v.userId, roomId, kind, rows, summary: String(p.data.summary ?? '').slice(0, 400) });
    return { id, unchanged: false, duplicates: 0, verify: await verifyStored(db, id, rows), effects: { moved: 0, unblocked: [], tests: [] } };
  }

  const loaded = await loadBase(db, v.orgId);
  if (!loaded) throw new InputError('Organization not found.');
  const base = loaded.base as Json & { rooms: Record<string, Json> };
  if (!base.rooms[roomId]) throw new InputError(`no room '${roomId}' in this group`);
  const opts = cleanOpts(kind, p.data.opts);
  // Waste rows are checked as the new rows; what's already logged was checked when it came in.
  const checked = checkRows(kind, rows, roomFor(base, live, roomId), opts);
  if (!checked.ok) throw new InputError(`Not saved: ${checked.error}`);
  const windows = await db.select({ id: testWindows.id, roomId: testWindows.roomId, lever: testWindows.lever, status: testWindows.status, title: testWindows.title, dish: testWindows.dish, startedAt: testWindows.startedAt })
    .from(testWindows).where(and(eq(testWindows.orgId, v.orgId), eq(testWindows.roomId, roomId)));
  const a = analyze({ base, inputs: live, roomId, kind, rows: checked.rows, opts, windows, issues: checked.issues, mappingNeedsConfirm: !!p.data.provenance?.mapping && p.data.mappingConfirmed === false });
  if (a.confirm.length && p.data.confirm !== true) throw new InputError(`Needs your confirmation: ${a.confirm.join(' ')}`);
  if (a.unchanged) return { ...unchangedResult(priorEntry!.id, a.rows), duplicates: a.duplicates };

  const summary = `${commitSummary(base, live, roomId, kind, a.rows, opts)}${a.duplicates ? ` (${a.duplicates} already logged, skipped)` : ''}`.slice(0, 400);
  const id = await commitInput(db, { orgId: v.orgId, userId: v.userId, roomId, kind, rows: a.rows, opts, summary });
  const verify = await verifyStored(db, id, a.rows);
  const effects = { moved: a.moves.filter((m) => m.changed).length, unblocked: a.findings.unblocked.map((f) => f.title), tests: a.tests.map((t) => t.title) };
  const pv = p.data.provenance ?? {};
  await db.insert(auditLog).values({
    orgId: v.orgId, userId: v.userId, action: 'inputs.import',
    detail: {
      inputId: id, roomId, kind, source: pv.source ?? 'grid', file: pv.file ?? null, filePrint: pv.filePrint ?? null, rowsPrint: a.fingerprint,
      mapping: pv.mapping ?? null, mappingVersion: 1, confirmed: a.confirm,
      validation: { warnings: checked.warnings, rejected: pv.rejected ?? 0 },
      counts: { accepted: checked.rows.length, matched: a.diff.matched, added: a.diff.added, updated: a.diff.updated, unchanged: a.diff.unchanged, removed: a.diff.removed.length, duplicates: a.duplicates },
      effects: { moves: a.moves.filter((m) => m.changed).map((m) => `${m.label}: ${m.before} → ${m.after}`), ...effects },
      prior: priorEntry?.id ?? null, verify,
    },
  });
  for (const t of a.tests) {
    await notify(db, { orgId: v.orgId, roomId, kind: 'inputs.test-data', severity: 'warn', title: `New ${kind === 'exceptions' ? 'register' : kind} data under a running test`, body: `“${t.title}” reads data that just changed on Data inputs. Its readout uses the new data from here on; check it on Windows.`, link: '/windows', dedupe: `inputs-test:${t.id}:${id}` }).catch(() => null);
  }
  return { id, unchanged: false, duplicates: a.duplicates, verify, effects };
}

function unchangedResult(id: string, rows: unknown): CommitResult {
  const f = fingerprint(rows);
  return { id, unchanged: true, duplicates: 0, verify: { ok: true, rows: Array.isArray(rows) ? rows.length : 0, fingerprint: f, expected: f }, effects: { moved: 0, unblocked: [], tests: [] } };
}

/** Read the stored entry back and compare it with what was checked. */
async function verifyStored(db: Db, id: string, expectedRows: unknown) {
  const [row] = await db.select({ rows: inputs.rows }).from(inputs).where(eq(inputs.id, id));
  const expected = fingerprint(expectedRows);
  const got = row ? fingerprint(row.rows) : '';
  return { ok: got === expected, rows: Array.isArray(row?.rows) ? row.rows.length : 0, fingerprint: got, expected };
}

/** Undo one entry: only one in the viewer's rooms, still live, and still what the room holds. */
export async function undoChecked(db: Db, v: V, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new InputError('no such entry');
  const [row] = await db.select({ id: inputs.id, roomId: inputs.roomId, kind: inputs.kind, undone: inputs.undone }).from(inputs).where(and(eq(inputs.orgId, v.orgId), eq(inputs.id, id)));
  if (!row) throw new InputError('no such entry');
  if (!canSee(v, row.roomId)) throw new AuthError(403, 'That room is not one of yours.');
  if (row.undone) throw new InputError('Already undone.');
  const [latest] = await db.select({ id: inputs.id }).from(inputs)
    .where(and(eq(inputs.orgId, v.orgId), eq(inputs.roomId, row.roomId), eq(inputs.kind, row.kind), eq(inputs.undone, false)))
    .orderBy(desc(inputs.createdAt)).limit(1);
  if (latest?.id !== row.id) throw new InputError('A later entry already replaced this one. Undo that one first.');
  await undoInput(db, { orgId: v.orgId, userId: v.userId, id });
}

const historyQuery = z.object({
  roomId: z.string().min(1).max(60).optional(),
  kind: z.enum(INPUT_KINDS as [string, ...string[]]).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const stamp = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });

/**
 * The page's history: every commit in the viewer's rooms, newest first, with
 * who made it (a person, or a linked sheet's morning read), where it came
 * from, and whether it is what the room holds now. Paged by `before`.
 */
export async function inputHistory(db: Db, v: V, raw: Record<string, string | undefined>) {
  const p = historyQuery.safeParse(raw);
  if (!p.success) throw new InputError(p.error.issues[0]?.message ?? 'invalid query');
  const { roomId, kind, before, limit } = p.data;
  if (roomId && !canSee(v, roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const rooms = roomId ? [roomId] : v.rooms;
  if (rooms && !rooms.length) return { entries: [], more: false, canReset: false };
  const where = and(
    eq(inputs.orgId, v.orgId),
    rooms ? inArray(inputs.roomId, rooms) : undefined,
    kind ? eq(inputs.kind, kind) : undefined,
    before ? lt(inputs.createdAt, new Date(before)) : undefined,
  );
  const rows = await db.select({ id: inputs.id, roomId: inputs.roomId, kind: inputs.kind, rows: inputs.rows, summary: inputs.summary, undone: inputs.undone, userId: inputs.userId, createdAt: inputs.createdAt, name: users.name, anonymous: users.isAnonymous })
    .from(inputs).leftJoin(users, eq(users.id, inputs.userId)).where(where).orderBy(desc(inputs.createdAt)).limit(limit + 1);
  const page = rows.slice(0, limit);
  // "Current" needs the newest live entry per room and kind, which may sit on an earlier page.
  const live = await db.select({ id: inputs.id, roomId: inputs.roomId, kind: inputs.kind }).from(inputs)
    .where(and(eq(inputs.orgId, v.orgId), eq(inputs.undone, false), rooms ? inArray(inputs.roomId, rooms) : undefined)).orderBy(desc(inputs.createdAt));
  const current = currentIds(live.map((r) => ({ id: r.id, room: r.roomId, kind: r.kind })));
  // Provenance rows for this page's entries.
  const ids = new Set(page.map((r) => r.id));
  const prov = page.length ? await db.select({ detail: auditLog.detail }).from(auditLog).where(and(eq(auditLog.orgId, v.orgId), eq(auditLog.action, 'inputs.import'), page.length ? gteAt(page[page.length - 1]!.createdAt) : undefined)) : [];
  const byId = new Map<string, Json>();
  for (const pr of prov) { const d = pr.detail as Json; if (typeof d.inputId === 'string' && ids.has(d.inputId)) byId.set(d.inputId, d); }
  return {
    entries: page.map((r) => {
      const d = byId.get(r.id);
      return {
        id: r.id,
        kind: r.kind,
        room: r.roomId,
        at: stamp(r.createdAt),
        createdAt: r.createdAt.toISOString(),
        rows: Array.isArray(r.rows) ? r.rows.length : 0,
        summary: r.summary,
        undone: r.undone,
        current: current.has(r.id),
        by: r.userId == null ? { kind: 'link' as const, name: 'Linked sheet' } : r.userId === v.userId ? { kind: 'you' as const, name: 'You' } : { kind: 'person' as const, name: r.anonymous ? 'A sample visitor' : (r.name || 'A teammate') },
        source: r.userId == null ? 'link' : ((d?.source as string | undefined) ?? null),
        file: (d?.file as string | null | undefined) ?? null,
        counts: (d?.counts as Json | undefined) ?? null,
        verified: d ? !!(d.verify as { ok?: boolean } | undefined)?.ok : null,
        replaces: (d?.prior as string | null | undefined) ?? null,
      };
    }),
    more: rows.length > limit,
    canReset: v.role !== 'gm',
  };
}

const gteAt = (d: Date) => gte(auditLog.at, new Date(d.getTime() - 60_000));
