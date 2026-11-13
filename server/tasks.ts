// Guided write-back tasks: created when a change is approved, ticked off by the
// manager, confirmed by the next data upload where the data can show it.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { findingBlocked } from '../lib/data/findings.js';
import { deriveRoom } from '../lib/data/model.js';
import { checkExpect, expectFor, stepsFor } from '../lib/data/writebacks.js';
import type { Db } from './db/client';
import { actions, auditLog, rooms, tasks } from './db/schema';
import { loadDataset } from './dataset';
import { InputError } from './org';
import { startWindow } from './proof';
import { notify } from './notify';
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

/**
 * A price change is checked here, not only on screen: refused when the dish's
 * cost is only estimated, when the move is past the room's price fence, or
 * when the dish moved inside the fence's gap. No screen or API call skips it.
 */
async function refusePrice(db: Db, orgId: string, roomId: string, approvalId: string) {
  const m = /^price:([\w-]+):([\d.]+)$/.exec(approvalId);
  if (!m) return;
  const loaded = await loadDataset(db, orgId);
  const room = loaded?.ds.rooms[roomId];
  const item = room?.menu.find((x: { key: string }) => x.key === m[1]);
  if (!room || !item) throw new InputError(`no dish '${m[1]}' in this room`);
  const cand = deriveRoom(loaded!.ds, roomId).candidates.find((c: { kind: string; item?: string }) => c.kind === 'price' && c.item === m[1]);
  const why = findingBlocked(cand ?? { kind: 'price', item: m[1] }, room);
  if (why) throw new InputError(why);
  const [fr] = await db.select({ value: actions.value }).from(actions)
    .where(and(eq(actions.orgId, orgId), eq(actions.roomId, roomId), eq(actions.key, 'fences'))).orderBy(desc(actions.at)).limit(1);
  const f = (fr?.value as { f?: { maxPrice?: number; priceGap?: number } } | null)?.f ?? {};
  const maxPrice = f.maxPrice ?? 8, gap = f.priceGap ?? 6;
  const pct = ((+m[2] - item.price) / item.price) * 100;
  if (Math.abs(pct) > maxPrice + 1e-9) throw new InputError(`A ${pct.toFixed(1)}% move is past this room's fence of ${maxPrice}%.`);
  const last = (await db.select({ at: tasks.createdAt, approvalId: tasks.approvalId }).from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.roomId, roomId), inArray(tasks.status, ['open', 'done', 'verified', 'mismatch']))).orderBy(desc(tasks.createdAt)))
    .find((t) => t.approvalId.startsWith(`price:${m[1]}:`));
  if (last && Date.now() - last.at.getTime() < gap * 7 * 864e5) throw new InputError(`This dish was repriced ${Math.round((Date.now() - last.at.getTime()) / 864e5)} days ago; the fence allows one move every ${gap} weeks.`);
}

export async function createTask(db: Db, v: V, input: unknown) {
  const p = body.safeParse(input);
  if (!p.success) throw new InputError(`invalid task: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const { roomId, approvalId, title, system, diff } = p.data;
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const [room] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.orgId, v.orgId), eq(rooms.id, roomId)));
  if (!room) throw new InputError(`no room '${roomId}' in this org`);
  // One open task per approval per room: approving twice, or from two screens at once
  // (the approval sheet and Today both ask), doesn't duplicate the work.
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`task:${v.orgId}:${roomId}:${approvalId}`}))`);
    const [dup] = await t.select().from(tasks).where(and(eq(tasks.orgId, v.orgId), eq(tasks.roomId, roomId), eq(tasks.approvalId, approvalId), inArray(tasks.status, ['open', 'done'])));
    if (dup) return dup;
    await refusePrice(t, v.orgId, roomId, approvalId);
    const [row] = await t.insert(tasks).values({ orgId: v.orgId, roomId, approvalId, title, system, steps: stepsFor(system, diff), expect: expectFor(approvalId), createdBy: v.userId }).returning();
    await t.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'task.created', detail: { id: row!.id, roomId, approvalId } });
    return row!;
  });
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
      await notify(db, { orgId, roomId: t.roomId, kind: 'task.verified', severity: 'good', link: '/windows/', dedupe: `task.verified:${t.id}`, title: `Confirmed in Toast: ${t.title}`, body: 'Guests are paying the new price. Its 28-day test has started.' });
      const e = t.expect as { type: string; dish?: string };
      if (e.type === 'price' && e.dish) {
        await startWindow(db, { orgId, userId: t.doneBy ?? t.createdBy ?? null, rooms: null }, { roomId: t.roomId, lever: 'menu_margin', dish: e.dish }).catch(() => null);
      }
    } else if (t.doneAt && dataEnd >= t.doneAt.getTime() + GRACE_DAYS * 864e5 && t.status !== 'mismatch') {
      mismatched.push(t.id);
      await db.update(tasks).set({ status: 'mismatch', checkedAt: new Date(), note: `Toast data to ${room.fromToast.end} still shows the old price. Check it was published.` }).where(eq(tasks.id, t.id));
      await db.insert(auditLog).values({ orgId, userId: null, action: 'task.mismatch', detail: { id: t.id } });
      await notify(db, { orgId, roomId: t.roomId, kind: 'task.mismatch', severity: 'warn', link: '/today/', dedupe: `task.mismatch:${t.id}`, title: `Not showing in Toast yet: ${t.title}`, body: `It was marked done, but a week of Toast data later guests still pay the old price. Check the change was published in ${t.system}.` });
    }
  }
  return { checked: open.length, verified, mismatched };
}
