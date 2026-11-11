// Guided write-back tasks: created when a change is approved, ticked off by the
// manager, confirmed by the next data upload where the data can show it.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { checkExpect, expectFor, stepsFor } from '../lib/data/writebacks.js';
import type { Db } from './db/client';
import { auditLog, rooms, tasks } from './db/schema';
import { loadDataset } from './dataset';
import { InputError } from './org';
import { startWindow } from './proof';
import { AuthError, type Viewer } from './session';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;

const cell = z.string().trim().max(120);
const body = z.object({
  roomId: z.string().min(1).max(60),
  approvalId: z.string().min(1).max(120).regex(/^[\w:.-]+$/),
  title: z.string().trim().min(1).max(200),
  system: z.string().trim().min(1).max(60),
  diff: z.array(z.tuple([cell, cell, cell])).max(12),
});

export async function createTask(db: Db, v: V, input: unknown) {
  const p = body.safeParse(input);
  if (!p.success) throw new InputError(`invalid task: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const { roomId, approvalId, title, system, diff } = p.data;
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const [room] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.orgId, v.orgId), eq(rooms.id, roomId)));
  if (!room) throw new InputError(`no room '${roomId}' in this org`);
  // One open task per approval per room: approving twice doesn't duplicate the work.
  const [dup] = await db.select().from(tasks).where(and(eq(tasks.orgId, v.orgId), eq(tasks.roomId, roomId), eq(tasks.approvalId, approvalId), inArray(tasks.status, ['open', 'done'])));
  if (dup) return dup;
  const [row] = await db.insert(tasks).values({ orgId: v.orgId, roomId, approvalId, title, system, steps: stepsFor(system, diff), expect: expectFor(approvalId), createdBy: v.userId }).returning();
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'task.created', detail: { id: row!.id, roomId, approvalId } });
  return row!;
}

export async function listTasks(db: Db, orgId: string, roomScope: string[] | null = null) {
  const rows = await db.select().from(tasks).where(roomScope ? and(eq(tasks.orgId, orgId), inArray(tasks.roomId, roomScope)) : eq(tasks.orgId, orgId)).orderBy(desc(tasks.createdAt)).limit(200);
  return rows;
}

export async function updateTask(db: Db, v: V, id: string, action: unknown) {
  if (action !== 'done' && action !== 'reopen' && action !== 'cancel') throw new InputError('action must be done, reopen or cancel');
  const [t] = await db.select().from(tasks).where(and(eq(tasks.orgId, v.orgId), eq(tasks.id, id)));
  if (!t) throw new InputError('no such task');
  if (v.rooms && !v.rooms.includes(t.roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const set =
    action === 'done' ? { status: 'done' as const, doneAt: new Date(), doneBy: v.userId } :
    action === 'reopen' ? { status: 'open' as const, doneAt: null, doneBy: null, note: null } :
    { status: 'cancelled' as const };
  if (action === 'done' && t.status !== 'open' && t.status !== 'mismatch') throw new InputError('Only an open task can be marked done.');
  await db.update(tasks).set(set).where(eq(tasks.id, id));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: `task.${action}`, detail: { id } });
  // A price confirmed by the data already, the moment it's ticked off.
  if (action === 'done') await verifyTasks(db, v.orgId);
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row!;
}

const GRACE_DAYS = 7;

/**
 * Check done tasks against the data (run nightly, and when a task is ticked off).
 * Verified: the data shows the change. Mismatch: a full week of data after Done
 * still doesn't. A verified price change opens a test window on that dish.
 */
export async function verifyTasks(db: Db, orgId: string) {
  const open = await db.select().from(tasks).where(and(eq(tasks.orgId, orgId), inArray(tasks.status, ['done', 'mismatch'])));
  if (!open.length) return { checked: 0, verified: [], mismatched: [] };
  const loaded = await loadDataset(db, orgId);
  const verified: string[] = [], mismatched: string[] = [];
  for (const t of open) {
    const room = loaded?.ds.rooms[t.roomId];
    const ok = checkExpect(t.expect, room);
    if (ok === null) continue;
    const dataEnd = room?.fromToast?.end ? Date.parse(`${room.fromToast.end}T23:59:59Z`) : 0;
    if (ok) {
      verified.push(t.id);
      await db.update(tasks).set({ status: 'verified', checkedAt: new Date(), note: `Toast data to ${room.fromToast.end} shows the new price.` }).where(eq(tasks.id, t.id));
      await db.insert(auditLog).values({ orgId, userId: null, action: 'task.verified', detail: { id: t.id } });
      const e = t.expect as { type: string; dish?: string };
      if (e.type === 'price' && e.dish) {
        await startWindow(db, { orgId, userId: t.doneBy ?? t.createdBy ?? null, rooms: null }, { roomId: t.roomId, lever: 'menu_margin', dish: e.dish }).catch(() => null);
      }
    } else if (t.doneAt && dataEnd >= t.doneAt.getTime() + GRACE_DAYS * 864e5 && t.status !== 'mismatch') {
      mismatched.push(t.id);
      await db.update(tasks).set({ status: 'mismatch', checkedAt: new Date(), note: `Toast data to ${room.fromToast.end} still shows the old price. Check it was published.` }).where(eq(tasks.id, t.id));
      await db.insert(auditLog).values({ orgId, userId: null, action: 'task.mismatch', detail: { id: t.id } });
    }
  }
  return { checked: open.length, verified, mismatched };
}
