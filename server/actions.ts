// Operator decisions, saved per org. Each key has a schema and a scope: a room
// key belongs to one room (a GM can write only their rooms); a group key
// belongs to the whole group (owner or admin only). Entries are append-only:
// the newest per room and key is the current value.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from './db/client';
import { actions, auditLog, rooms } from './db/schema';
import { InputError } from './org';
import { AuthError, type Viewer } from './session';

const id = z.string().min(1).max(120);
const isoDate = z.string().max(40);
const flags = z.record(id, isoDate);

export const ACTION_KEYS = {
  /** Today's work queue: cards cleared or refused, with when. */
  queue: { scope: 'room', schema: z.object({ done: flags, refused: flags }) },
  /** Tonight's one labour suggestion on the Service screen. */
  service: { scope: 'room', schema: z.enum(['ask', 'yes', 'no']) },
  /** Approvals written back, by approval id. */
  approvals: { scope: 'room', schema: z.record(id, z.object({ at: isoDate })) },
  /** The last weekly meeting: what was logged and when it finished. */
  meeting: { scope: 'room', schema: z.object({ log: z.array(z.string().max(200)).max(20), at: isoDate }).nullable() },
  /** Findings dismissed ("Not for us"), with the date they may come back. */
  findings: { scope: 'room', schema: z.record(id, isoDate) },
  /** Fences and alert settings, versioned. */
  fences: {
    scope: 'room',
    schema: z.object({
      version: z.number().int().min(1).max(10_000),
      f: z.object({
        minDinner: z.number().min(0).max(50), minAny: z.number().min(0).max(50), cutBy: z.string().max(20),
        lockHours: z.number().min(0).max(168), maxPrice: z.number().min(0).max(100), priceGap: z.number().min(0).max(52), maxPar: z.number().min(0).max(100),
      }),
      al: z.object({ push: z.boolean(), sms: z.boolean(), email: z.boolean(), onePerService: z.boolean(), quiet: z.boolean() }),
    }),
  },
  /** The plan: manager hours available this week. */
  plan: { scope: 'room', schema: z.object({ hours: z.number().min(0.5).max(5) }) },
  /** The accountant's period package. */
  billing: { scope: 'group', schema: z.object({ status: z.enum(['open', 'approved', 'disputed']), note: z.string().max(2000).optional(), at: isoDate.optional(), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }) },
  /** Where each lever's savings land in the group's chart of accounts, confirmed by a named person. */
  glmap: { scope: 'group', schema: z.record(z.string().min(1).max(40), z.object({ account: z.string().trim().min(1).max(80), by: z.string().max(80), at: isoDate })) },
  /** Autonomy level per lever (0 observes … 4 holds the line), set on System. */
  autonomy: { scope: 'room', schema: z.record(z.string().min(1).max(40), z.number().int().min(0).max(4)) },
  /** Pricing on the invoice: per room per month, and the fee on reconciled savings. */
  pricing: { scope: 'group', schema: z.object({ perRoomMonthlyCents: z.number().int().min(0).max(1_000_000), feePct: z.number().min(0).max(50) }) },
} as const;

export type ActionKey = keyof typeof ACTION_KEYS;
const MAX_BYTES = 20_000;
export const GROUP = '';

/** Current values: { [roomId | '']: { [key]: value } }, limited to the viewer's rooms. */
export async function loadActions(db: Db, orgId: string, roomScope: string[] | null = null) {
  const where = roomScope ? and(eq(actions.orgId, orgId), inArray(actions.roomId, [GROUP, ...roomScope])) : eq(actions.orgId, orgId);
  const rows = await db
    .selectDistinctOn([actions.roomId, actions.key], { roomId: actions.roomId, key: actions.key, value: actions.value })
    .from(actions)
    .where(where)
    .orderBy(actions.roomId, actions.key, desc(actions.at), desc(actions.id));
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    if (!(r.key in ACTION_KEYS)) continue;
    (out[r.roomId] ??= {})[r.key] = r.value;
  }
  return out;
}

export async function saveAction(
  db: Db,
  v: Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>,
  { roomId, key, value, summary }: { roomId?: unknown; key?: unknown; value?: unknown; summary?: unknown },
) {
  if (typeof key !== 'string' || !(key in ACTION_KEYS)) throw new InputError(`unknown action '${String(key)}'`);
  const spec = ACTION_KEYS[key as ActionKey];
  const room = spec.scope === 'group' ? GROUP : roomId;
  if (typeof room !== 'string') throw new InputError('roomId is required');
  if (spec.scope === 'group' && v.role === 'gm') throw new AuthError(403, 'Only an owner or admin can change this.');
  if (spec.scope === 'room') {
    if (v.rooms && !v.rooms.includes(room)) throw new AuthError(403, 'That room is not one of yours.');
    const [r] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.orgId, v.orgId), eq(rooms.id, room)));
    if (!r) throw new InputError(`no room '${room}' in this org`);
  }
  const parsed = spec.schema.safeParse(value);
  if (!parsed.success) throw new InputError(`invalid ${key}: ${parsed.error.issues[0]?.message ?? 'bad value'}`);
  if (JSON.stringify(parsed.data ?? null).length > MAX_BYTES) throw new InputError(`${key} is too large`);
  const note = String(summary ?? '').slice(0, 400);
  const [row] = await db
    .insert(actions)
    .values({ orgId: v.orgId, roomId: room, key, value: parsed.data ?? null, summary: note, userId: v.userId })
    .returning({ id: actions.id, at: actions.at });
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: `action.${key}`, detail: { roomId: room, summary: note } });
  return { id: row!.id, at: row!.at.toISOString(), value: parsed.data ?? null };
}
