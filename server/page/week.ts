// This week, on the server: the same weekView() the screen draws, for one
// room the viewer can see, plus who marked each week reviewed. The Monday
// digest (the `week` job) sends each real group's rooms their week in review.
import { and, asc, eq } from 'drizzle-orm';

import { deriveRoom } from '../../lib/data/model.js';
import { awaitingData, REVIEW_KEY, weekDigest, weekView } from '../../lib/data/page/week.js';
import type { Db } from '../db/client';
import { actions, orgs, users } from '../db/schema';
import { loadActions } from '../actions';
import { loadDataset } from '../dataset';
import { notify } from '../notify';
import { InputError } from '../org';
import { listWindows } from '../proof';
import { AuthError, type Viewer } from '../session';

type Review = { week: string; at: string; note: string | null; by: string | null };

/** Who marked each week reviewed: the person whose save first carried that week's current stamp. */
export async function reviewsFor(db: Db, orgId: string, roomId: string): Promise<Review[]> {
  const rows = await db.select({ value: actions.value, at: actions.at, name: users.name, anonymous: users.isAnonymous })
    .from(actions).leftJoin(users, eq(users.id, actions.userId))
    .where(and(eq(actions.orgId, orgId), eq(actions.roomId, roomId), eq(actions.key, REVIEW_KEY)))
    .orderBy(asc(actions.at), asc(actions.id));
  const current = (rows.at(-1)?.value ?? {}) as Record<string, { at: string; note?: string }>;
  return Object.entries(current).map(([week, r]) => {
    const first = rows.find((x) => (x.value as Record<string, { at?: string }> | null)?.[week]?.at === r.at);
    return { week, at: r.at, note: r.note ?? null, by: first ? (first.anonymous ? 'A guest' : first.name || null) : null };
  }).sort((a, b) => b.week.localeCompare(a.week));
}

/** The week for one room, scoped to the viewer. */
export async function weekSummary(db: Db, v: Pick<Viewer, 'orgId' | 'rooms'>, roomId: unknown, now = new Date()) {
  if (typeof roomId !== 'string' || !roomId) throw new InputError('room is required');
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  if (!loaded?.ds.rooms[roomId]) throw new InputError(`no room '${roomId}' in this group`);
  const sample = !!loaded.org.sample;
  const windows = sample ? null : await listWindows(db, v.orgId, v.rooms, now);
  const acts = await loadActions(db, v.orgId, [roomId]);
  const mine = acts[roomId] ?? {};
  const d = deriveRoom(loaded.ds, roomId);
  const view = weekView(d, {
    windows: windows as never,
    hours: (mine.plan as { hours?: number } | undefined)?.hours,
    dismissed: (mine.findings as Record<string, string> | undefined) ?? {},
    now,
  });
  return { view: toJson(view), digest: weekDigest(view), reviews: await reviewsFor(db, v.orgId, roomId) };
}

/** Plain JSON (the plan's chosen candidates carry nested objects we don't need over the wire). */
function toJson(view: ReturnType<typeof weekView>) {
  const slim = (c: { id: string; title: string; lever: string; hours: number; p: number; value: number; claim: string; prevent?: boolean } | null) =>
    c && { id: c.id, title: c.title, lever: c.lever, hours: c.hours, p: c.p, value: c.value, claim: c.claim, prevent: !!c.prevent };
  return { ...view, plan: { ...view.plan, chosen: view.plan.chosen.map(slim), next: slim(view.plan.next) } };
}

/** Monday digest for one group: each room's week in the bell (and email, where the room asks for it). Once per room per data week. */
export async function runWeekDigest(db: Db, orgId: string, now = new Date()) {
  const [org] = await db.select({ sample: orgs.sample }).from(orgs).where(eq(orgs.id, orgId));
  if (!org || org.sample) return { skipped: 'sample group' };
  const loaded = await loadDataset(db, orgId);
  if (!loaded) return { rooms: 0 };
  const windows = await listWindows(db, orgId, null, now);
  const acts = await loadActions(db, orgId);
  const sent: string[] = [];
  const waiting: string[] = [];
  for (const id of Object.keys(loaded.ds.rooms)) {
    const room = loaded.ds.rooms[id];
    if (awaitingData(room)) { waiting.push(id); continue; }
    const d = deriveRoom(loaded.ds, id);
    const mine = acts[id] ?? {};
    const view = weekView(d, { windows: windows as never, hours: (mine.plan as { hours?: number } | undefined)?.hours, dismissed: (mine.findings as Record<string, string> | undefined) ?? {}, now });
    if (!view.period) continue;
    const g = weekDigest(view);
    const row = await notify(db, { orgId, roomId: id, kind: 'week', severity: g.severity as 'info' | 'warn', title: g.title, body: g.body, link: '/', dedupe: `week:${id}:${view.period.start}` });
    if (row) sent.push(id);
  }
  return { rooms: Object.keys(loaded.ds.rooms).length, sent, waiting };
}
