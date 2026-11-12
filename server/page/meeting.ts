// The weekly meeting's backend: what a saved meeting may hold (the schemas
// ACTION_KEYS uses), and the room's meeting record. Every finished meeting is
// one append-only `meeting` action, so the record is those entries, newest
// first, back to the last time the record was cleared (a null entry).
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { MEETING_LIMITS as ML } from '../../lib/data/page/meeting.js';
import type { Db } from '../db/client';
import { actions, users } from '../db/schema';
import { InputError } from '../org';
import { AuthError, type Viewer } from '../session';

const isoDate = z.string().max(40);
const text = (n: number) => z.string().trim().max(n);

const meeting = z.object({
  at: isoDate,
  startedAt: isoDate.optional(),
  mins: z.number().int().min(0).max(600).optional(),
  log: z.array(text(ML.logLine)).max(ML.log),
  items: z.array(z.object({ k: text(80).min(1), decision: text(ML.choice).optional(), note: text(ML.note).optional() })).max(ML.items).optional(),
  decision: z.object({
    id: z.string().min(1).max(120).optional(),
    title: text(ML.title).optional(),
    choice: text(ML.choice).min(1),
    kind: z.enum(['approve', 'hold', 'dismiss', 'other', 'deferred']),
  }).optional(),
  plan: z.array(text(ML.title).min(1)).max(ML.plan).optional(),
  followups: z.array(z.object({ id: z.string().min(1).max(40), text: text(ML.followupText).min(1), owner: text(ML.owner).optional() })).max(ML.followups).optional(),
});

export const meetingSchemas = {
  meeting,
  /** Follow-ups ticked off: id → when. */
  followups: z.record(z.string().min(1).max(40), isoDate).refine((o) => Object.keys(o).length <= ML.done, `at most ${ML.done} follow-ups`),
  /** The room's slot: day of week (0 = Sunday) and local time. */
  schedule: z.object({ day: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM') }),
};

export type MeetingEntry = { id: string; at: string; by: string | null; value: z.infer<typeof meeting> };

/** The room's finished meetings, newest first, for someone who may see the room. */
export async function meetingHistory(db: Db, v: Pick<Viewer, 'orgId' | 'rooms'>, roomId: unknown, limit: number = ML.history): Promise<MeetingEntry[]> {
  if (typeof roomId !== 'string' || !roomId || roomId.length > 120) throw new InputError('room is required');
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const rows = await db
    .select({ id: actions.id, at: actions.at, value: actions.value, name: users.name, anon: users.isAnonymous })
    .from(actions)
    .leftJoin(users, eq(users.id, actions.userId))
    .where(and(eq(actions.orgId, v.orgId), eq(actions.roomId, roomId), eq(actions.key, 'meeting')))
    .orderBy(desc(actions.at), desc(actions.id))
    .limit(200);
  const out: MeetingEntry[] = [];
  for (const r of rows) {
    if (r.value === null) break; // cleared: nothing older is part of the record
    const p = meeting.safeParse(r.value);
    if (!p.success) continue;
    out.push({ id: r.id, at: r.at.toISOString(), by: r.anon ? null : (r.name ?? null), value: p.data });
    if (out.length >= Math.max(1, Math.min(limit, 100))) break;
  }
  return out;
}
