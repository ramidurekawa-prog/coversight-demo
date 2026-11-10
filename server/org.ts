// Orgs and their data: copy the sample group into the database, read an org's
// dataset back in the exact shape the model reads, and keep hand-entered
// inputs with their history.
import { and, asc, desc, eq } from 'drizzle-orm';

import { SEED } from '../lib/data/seed.js';
import { KIND_LABEL } from '../lib/data/apply.js';
import { KINDS } from '../lib/data/ingest.js';
import type { Db } from './db/client';
import { auditLog, inputs, memberships, orgs, roomData, rooms } from './db/schema';

type Json = Record<string, unknown>;
const ROOM_SKIP = new Set(['id']);

/** Create an org holding a copy of the sample group, owned by `ownerId`. */
export async function createSampleOrg(db: Db, { name, ownerId, inTx = false }: { name?: string; ownerId: string; inTx?: boolean }) {
  const seed = SEED as unknown as Json & { rooms: Record<string, Json>; locs: Json[] };
  const { rooms: seedRooms, locs, ...meta } = seed;
  const run = async (tx: Db) => {
    const [org] = await tx.insert(orgs).values({ name: name ?? 'Rosewood Restaurant Group (sample)', sample: true, meta }).returning();
    await tx.insert(memberships).values({ orgId: org!.id, userId: ownerId, role: 'owner', rooms: null });
    await tx.insert(rooms).values(locs.map((loc, i) => ({ orgId: org!.id, id: String(loc.id), position: i, loc })));
    const rows = Object.entries(seedRooms).flatMap(([roomId, room]) =>
      Object.entries(room)
        .filter(([k]) => !ROOM_SKIP.has(k))
        .map(([kind, data]) => ({ orgId: org!.id, roomId, kind, data: data as object })),
    );
    await tx.insert(roomData).values(rows);
    await tx.insert(auditLog).values({ orgId: org!.id, userId: ownerId, action: 'org.created', detail: { sample: true } });
    return org!;
  };
  // Inside a caller's transaction already, or its own.
  return inTx ? run(db) : db.transaction((tx) => run(tx as unknown as Db));
}

/** The org's dataset, seed-shaped: what lib/data/model.js derives every figure from. */
export async function loadBase(db: Db, orgId: string, roomScope: string[] | null = null) {
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org) return null;
  const locRows = await db.select().from(rooms).where(eq(rooms.orgId, orgId)).orderBy(asc(rooms.position));
  // The group entry ('all') is a location row with no room data of its own.
  const visible = locRows.filter((r) => !roomScope || roomScope.includes(r.id));
  const dataRows = await db.select().from(roomData).where(eq(roomData.orgId, orgId));
  const byRoom: Record<string, Json> = {};
  for (const d of dataRows) {
    if (roomScope && !roomScope.includes(d.roomId)) continue;
    byRoom[d.roomId] ??= { id: d.roomId };
    byRoom[d.roomId]![d.kind] = d.data;
  }
  // Rooms in the group's own order (the first one is where a new viewer lands).
  const ordered: Record<string, Json> = {};
  for (const r of visible) if (byRoom[r.id]) ordered[r.id] = byRoom[r.id]!;
  return { org: { id: org.id, name: org.name, sample: org.sample }, base: { ...(org.meta as Json), locs: visible.map((r) => r.loc), rooms: ordered } };
}

/** Hand-entered inputs in the engine's shape: the latest live entry per room and kind, plus the log. */
export async function loadInputs(db: Db, orgId: string) {
  const rows = await db.select().from(inputs).where(eq(inputs.orgId, orgId)).orderBy(desc(inputs.createdAt));
  const current: Record<string, Record<string, Json>> = {};
  for (const r of [...rows].reverse()) {
    if (r.undone) continue;
    current[r.roomId] ??= {};
    current[r.roomId]![r.kind] = { rows: r.rows, date: dateLabel(r.createdAt), label: KIND_LABEL[r.kind as keyof typeof KIND_LABEL], n: (r.rows as unknown[]).length, ...(r.opts ? { opts: r.opts } : {}) };
  }
  const log = rows.slice(0, 50).map((r) => ({ id: r.id, kind: r.kind, room: r.roomId, at: stampLabel(r.createdAt), rows: (r.rows as unknown[]).length, summary: r.summary, undone: r.undone }));
  return { inputs: current, log };
}

export class InputError extends Error {
  override name = 'InputError';
}

export async function commitInput(
  db: Db,
  { orgId, userId, roomId, kind, rows, opts, summary }: { orgId: string; userId: string; roomId: string; kind: string; rows: unknown; opts?: unknown; summary?: string },
) {
  if (!(KINDS as string[]).includes(kind)) throw new InputError(`unknown kind '${kind}'`);
  if (!Array.isArray(rows) || rows.length > 5_000 || !rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) throw new InputError('rows must be a list of records (at most 5,000)');
  const [room] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.orgId, orgId), eq(rooms.id, roomId)));
  if (!room) throw new InputError(`no room '${roomId}' in this org`);
  const cleanOpts = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : null;
  const [row] = await db
    .insert(inputs)
    .values({ orgId, roomId, kind, rows, opts: cleanOpts, summary: String(summary ?? '').slice(0, 400), userId })
    .returning({ id: inputs.id });
  await db.insert(auditLog).values({ orgId, userId, action: 'input.committed', detail: { roomId, kind, rows: rows.length } });
  return row!.id;
}

export async function undoInput(db: Db, { orgId, userId, id }: { orgId: string; userId: string; id: string }) {
  const [row] = await db.update(inputs).set({ undone: true, updatedAt: new Date() }).where(and(eq(inputs.orgId, orgId), eq(inputs.id, id))).returning({ id: inputs.id, kind: inputs.kind, roomId: inputs.roomId });
  if (!row) throw new InputError('no such entry');
  await db.insert(auditLog).values({ orgId, userId, action: 'input.undone', detail: row });
}

export async function resetInputs(db: Db, { orgId, userId }: { orgId: string; userId: string }) {
  await db.update(inputs).set({ undone: true, updatedAt: new Date() }).where(eq(inputs.orgId, orgId));
  await db.insert(auditLog).values({ orgId, userId, action: 'input.reset', detail: {} });
}

const dateLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
const stampLabel = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
