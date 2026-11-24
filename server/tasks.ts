// Guided write-back tasks: created when a change is approved, ticked off by the
// manager, confirmed by the next data upload where the data can show it.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { findingBlocked } from '../lib/data/findings.js';
import { deriveRoom } from '../lib/data/model.js';
import { checkExpect, expectFor, stepsFor } from '../lib/data/writebacks.js';
import { foodCostChecks, itemSlug, vendorAsk, vendorCheck } from '../lib/data/page/purchasing.js';
import { shiftCheck, staffingOutcome } from '../lib/data/page/staffing.js';
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

type CreateOpts = { now?: Date; fetchImpl?: typeof fetch; checked?: boolean };

/**
 * One approval becomes one task. Every path that creates one comes here, so
 * the server's checks can't be skipped by calling /api/tasks directly:
 *  - price:<dish>:<price>  refusePrice (estimated cost, the room's price fence)
 *  - cut:<date>:<hh:mm>    refuseCut (tonight's live call or plan, the fences)
 *  - shift:<date>:<meal>:… refuseShift (the staffing call as the data has it
 *    now, who may approve). The title, steps and evidence come from the
 *    server's own decision; what the browser sent is ignored.
 * `checked` is for a caller that has just run the same check (approveCut).
 */
export async function createTask(db: Db, v: V, input: unknown, opts: CreateOpts = {}) {
  const p = body.safeParse(input);
  if (!p.success) throw new InputError(`invalid task: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const { roomId, approvalId } = p.data;
  let { title, system, diff } = p.data;
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const [room] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.orgId, v.orgId), eq(rooms.id, roomId)));
  if (!room) throw new InputError(`no room '${roomId}' in this org`);
  const live = () => db.select().from(tasks).where(and(eq(tasks.orgId, v.orgId), eq(tasks.roomId, roomId), eq(tasks.approvalId, approvalId), inArray(tasks.status, ['open', 'done'])));
  // A retry, a double tap or a second manager on the same change resolves to the task already there.
  const [early] = await live();
  if (early) return early;
  let evidence: unknown = null;
  if (/^shift:/.test(approvalId)) {
    const { refuseShift } = await import('./page/staffing');
    const ok = await refuseShift(db, v, { roomId, approvalId }, opts);
    ({ title, system, diff } = ok);
    evidence = ok.evidence;
  } else if (/^vendor:/.test(approvalId)) {
    // A vendor ask must be one the room's invoices show right now; its title and email come from the server's own check.
    const loaded = await loadDataset(db, v.orgId, v.rooms);
    const r = loaded?.ds.rooms[roomId];
    const check = r ? foodCostChecks(r).find((c: { approvalId: string | null }) => c.approvalId === approvalId) : null;
    if (!check) throw new InputError('This changed since it was shown: the invoices no longer show it. Look again before approving.');
    const ask = vendorAsk(check, { room: r.profile?.name ?? roomId, from: r.profile?.gm ?? 'Purchasing' });
    title = check.title; system = 'Your vendor';
    diff = check.kind === 'price' ? [[`${check.item}, per ${check.unit}`, `$${(check.now ?? 0).toFixed(2)}`, `$${(check.before ?? 0).toFixed(2)}`]] : [[`${check.item}, per ${check.unit}`, `${check.pack1} ${check.packUnit}`, `${check.pack0} ${check.packUnit}`]];
    evidence = { check: { kind: check.kind, item: check.item, vendor: check.vendor, cents: check.cents, before: check.before, now: check.now, pack0: check.pack0 ?? null, pack1: check.pack1 ?? null, claim: 'obs' }, email: ask };
  } else if (/^cut:/.test(approvalId) && !opts.checked) {
    const m = /^cut:(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/.exec(approvalId);
    if (!m) throw new InputError('That isn’t a send-home approval.');
    const { refuseCut } = await import('./page/service');
    await refuseCut(db, v, { roomId, date: m[1]!, at: m[2]! }, opts);
  }
  // One open task per approval per room: approving twice, or from two screens at once
  // (the approval sheet and Today both ask), doesn't duplicate the work.
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`task:${v.orgId}:${roomId}:${approvalId}`}))`);
    const [dup] = await t.select().from(tasks).where(and(eq(tasks.orgId, v.orgId), eq(tasks.roomId, roomId), eq(tasks.approvalId, approvalId), inArray(tasks.status, ['open', 'done'])));
    if (dup) return dup;
    // One staffing change per service: a second manager approving a different change at the same moment waits here and is refused.
    const sh = /^shift:(\d{4}-\d{2}-\d{2}):(lunch|dinner):/.exec(approvalId);
    if (sh) {
      await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`shift:${v.orgId}:${roomId}:${sh[1]}:${sh[2]}`}))`);
      const other = (await t.select({ approvalId: tasks.approvalId, title: tasks.title }).from(tasks).where(and(eq(tasks.orgId, v.orgId), eq(tasks.roomId, roomId), inArray(tasks.status, ['open', 'done', 'verified', 'mismatch']))))
        .find((x) => x.approvalId.startsWith(sh[0]) && x.approvalId !== approvalId);
      if (other) throw new InputError(`This service already has an approved staffing change: “${other.title}”.`);
    }
    await refusePrice(t, v.orgId, roomId, approvalId);
    const [row] = await t.insert(tasks).values({ orgId: v.orgId, roomId, approvalId, title, system, steps: stepsFor(system, diff), expect: expectFor(approvalId), createdBy: v.userId, evidence }).returning();
    await t.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'task.created', detail: { id: row!.id, roomId, approvalId, ...(evidence ? { evidence: true, version: (evidence as { version?: string }).version } : {}) } });
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
  // Open staffing changes are read too: clock-ins can show a change was made before anyone ticks it off.
  const open = (await db.select().from(tasks).where(and(eq(tasks.orgId, orgId), inArray(tasks.status, ['open', 'done', 'mismatch']))))
    .filter((t) => t.status !== 'open' || ['shift', 'vendor'].includes((t.expect as { type?: string } | null)?.type ?? ''));
  if (!open.length) return { checked: 0, verified: [], mismatched: [] };
  const loaded = await loadDataset(db, orgId);
  const verified: string[] = [], mismatched: string[] = [];
  for (const t of open) {
    const room = loaded?.ds.rooms[t.roomId];
    if ((t.expect as { type?: string } | null)?.type === 'shift') {
      // A staffing change is confirmed from the clock-ins entered for that shift, as soon as they're in.
      const outcome = staffingOutcome(t, room);
      const chk = shiftCheck(t, room);
      const brief = outcome ? { result: outcome.result, clock: outcome.clock, observed: outcome.observed, guard: outcome.guard, qualified: outcome.qualified, at: new Date().toISOString() } : null;
      if (!chk) { if (brief) await db.update(tasks).set({ outcome: brief }).where(eq(tasks.id, t.id)); continue; }
      const status = chk.ok ? 'verified' as const : 'mismatch' as const;
      if (status === t.status) { await db.update(tasks).set({ outcome: brief, note: chk.note }).where(eq(tasks.id, t.id)); continue; }
      (chk.ok ? verified : mismatched).push(t.id);
      await db.update(tasks).set({ status, checkedAt: new Date(), note: chk.note, outcome: brief }).where(eq(tasks.id, t.id));
      await db.insert(auditLog).values({ orgId, userId: null, action: `task.${chk.ok ? 'verified' : 'mismatch'}`, detail: { id: t.id, from: 'clock-ins' } });
      await notify(db, { orgId, roomId: t.roomId, kind: chk.ok ? 'task.verified' : 'task.mismatch', severity: chk.ok ? 'good' : 'warn', link: '/today/', dedupe: `task.${status}:${t.id}`,
        title: chk.ok ? `Clock-ins match: ${t.title}` : `Clock-ins don’t match yet: ${t.title}`, body: chk.note });
      continue;
    }
    if ((t.expect as { type?: string } | null)?.type === 'vendor') {
      // A vendor ask is confirmed by the room's next invoice: the money back is Observed at the latest quantity, never booked.
      const chk = vendorCheck(t.expect, room);
      if (!chk?.ok) continue;
      const ev = (t.evidence as { check?: { kind: string; before?: number; now?: number; cents?: number } } | null)?.check;
      const line = (room?.invoices ?? []).find((x: { item: string }) => itemSlug(x.item) === (t.expect as { item: string }).item);
      const backCents = ev?.kind === 'price' && ev.now != null && line ? Math.max(0, Math.round((ev.now - line.p1) * line.q1 * 100)) : ev?.cents ?? null;
      verified.push(t.id);
      await db.update(tasks).set({ status: 'verified', checkedAt: new Date(), note: chk.note, outcome: { result: 'fixed', backCents, claim: 'obs', at: new Date().toISOString() } }).where(eq(tasks.id, t.id));
      await db.insert(auditLog).values({ orgId, userId: null, action: 'task.verified', detail: { id: t.id, from: 'invoice' } });
      await notify(db, { orgId, roomId: t.roomId, kind: 'task.verified', severity: 'good', link: '/purchasing/', dedupe: `task.verified:${t.id}`, title: `Fixed on the invoice: ${t.title}`, body: `${chk.note}${backCents ? ` That's about $${Math.round(backCents / 100).toLocaleString('en-US')} back every 28 days at what you buy now.` : ''}` });
      continue;
    }
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
