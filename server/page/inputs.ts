// Data inputs page, server side. Every commit is checked again here with the
// same rules the review panel used (lib/data/page/inputs.js → ingest.validate),
// against the room as the group's own data has it now, so a request that skips
// the screen can't land rows the screen would refuse. Undo and the history are
// scoped to the viewer's rooms.
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';

import { cleanOpts, commitSummary, currentIds, recheck, roomFor } from '../../lib/data/page/inputs.js';
import { INPUT_KINDS } from '../../lib/data/apply.js';
import type { Db } from '../db/client';
import { inputs, users } from '../db/schema';
import { InputError, commitInput, loadBase, loadInputs, undoInput } from '../org';
import { AuthError, type Viewer } from '../session';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
type Json = Record<string, unknown>;

/** A whole request body is capped well under the serverless limit. */
const MAX_JSON = 2_000_000;

const commitBody = z.object({
  roomId: z.string().min(1).max(60),
  kind: z.enum(INPUT_KINDS as [string, ...string[]]),
  rows: z.array(z.record(z.string(), z.unknown())).min(1, 'No rows to commit').max(5_000, 'At most 5,000 rows'),
  opts: z.unknown().optional(),
  summary: z.string().max(2_000).optional(),
});

const canSee = (v: V, roomId: string) => !v.rooms || v.rooms.includes(roomId);

/** Inputs and log as the engine wants them, trimmed to the viewer's rooms. */
export async function scopedInputs(db: Db, v: V) {
  const { inputs: all, log } = await loadInputs(db, v.orgId);
  const mine = Object.fromEntries(Object.entries(all).filter(([room]) => canSee(v, room)));
  return { inputs: mine, log: log.filter((e) => canSee(v, e.room)) };
}

/** Check a commit like the screen does, then save it. Returns the new entry's id. */
export async function commitChecked(db: Db, v: V, raw: unknown) {
  if (JSON.stringify(raw ?? null).length > MAX_JSON) throw new InputError('That is too much to commit at once. Split it into smaller files.');
  const p = commitBody.safeParse(raw);
  if (!p.success) throw new InputError(p.error.issues[0]?.message ?? 'invalid input');
  const { roomId, kind, rows } = p.data;
  if (!canSee(v, roomId)) throw new AuthError(403, 'That room is not one of yours.');
  if (kind === 'toast') {
    // Shape-checked by commitInput (server/toast-schema.ts); the summary is the screen's one line.
    return commitInput(db, { orgId: v.orgId, userId: v.userId, roomId, kind, rows, summary: String(p.data.summary ?? '').slice(0, 400) });
  }
  const loaded = await loadBase(db, v.orgId);
  if (!loaded) throw new InputError('Organization not found.');
  const base = loaded.base as Json & { rooms: Record<string, Json> };
  if (!base.rooms[roomId]) throw new InputError(`no room '${roomId}' in this group`);
  const { inputs: live } = await loadInputs(db, v.orgId);
  const opts = cleanOpts(kind, p.data.opts);
  const checked = recheck(kind, rows, roomFor(base, live, roomId), opts);
  if (!checked.ok) throw new InputError(`Not saved: ${checked.error}`);
  const summary = commitSummary(base, live, roomId, kind, checked.rows, opts);
  return commitInput(db, { orgId: v.orgId, userId: v.userId, roomId, kind, rows: checked.rows, opts, summary });
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
 * who made it (a person, or a linked sheet's morning read) and whether it is
 * what the room holds now. Paged by `before` (the last entry's `createdAt`).
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
  const live = await db.select({ id: inputs.id, roomId: inputs.roomId, kind: inputs.kind, createdAt: inputs.createdAt }).from(inputs)
    .where(and(eq(inputs.orgId, v.orgId), eq(inputs.undone, false), rooms ? inArray(inputs.roomId, rooms) : undefined)).orderBy(desc(inputs.createdAt));
  const current = currentIds(live.map((r) => ({ id: r.id, room: r.roomId, kind: r.kind })));
  return {
    entries: page.map((r) => ({
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
    })),
    more: rows.length > limit,
    canReset: v.role !== 'gm',
  };
}
