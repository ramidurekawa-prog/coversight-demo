// This week, on the server: the same weekView() the screen draws, for one
// room the viewer can see; who marked each week reviewed; and the committed
// improvement plan. The plan is stored append-only in `actions` under
// week.plan, but it is NOT an ACTION_KEYS entry: /api/actions can't write it,
// because committing has to be checked against the week computed here
// (a blocked recommendation can't be committed, titles and figures come from
// the server). The Monday digest (the `week` job) sends each real group's
// rooms their week in review.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { deriveRoom } from '../../lib/data/model.js';
import { awaitingData, buildCommit, PLAN_KEY, planState, REVIEW_KEY, setItemStatus, weekDigest, weekView } from '../../lib/data/page/week.js';
import type { Db } from '../db/client';
import { actions, auditLog, orgs, users } from '../db/schema';
import { loadActions } from '../actions';
import { loadDataset } from '../dataset';
import { notify } from '../notify';
import { InputError } from '../org';
import { listWindows } from '../proof';
import { listTasks } from '../tasks';
import { AuthError, type Viewer } from '../session';

type Review = { week: string; at: string; note: string | null; by: string | null };
type Plan = { week: string; committedAt: string; revision: number; items: ReturnType<typeof buildCommit> };
type V = Pick<Viewer, 'orgId' | 'rooms'> & Partial<Pick<Viewer, 'userId' | 'role'>>;

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

/** The room's latest committed plan, with who committed it and its history of revisions. */
export async function loadWeekPlan(db: Db, orgId: string, roomId: string) {
  const rows = await db.select({ value: actions.value, at: actions.at, summary: actions.summary, name: users.name, anonymous: users.isAnonymous })
    .from(actions).leftJoin(users, eq(users.id, actions.userId))
    .where(and(eq(actions.orgId, orgId), eq(actions.roomId, roomId), eq(actions.key, PLAN_KEY)))
    .orderBy(desc(actions.at), desc(actions.id)).limit(40);
  const latest = rows[0];
  const plan = (latest?.value ?? null) as Plan | null;
  const commit = plan ? rows.find((r) => (r.value as Plan | null)?.week === plan.week && (r.value as Plan | null)?.revision === plan.revision && r.summary.startsWith('commit')) : null;
  return {
    plan,
    committedBy: commit ? (commit.anonymous ? 'A guest' : commit.name || null) : null,
    history: rows.map((r) => ({ at: r.at.toISOString(), summary: r.summary, by: r.anonymous ? 'A guest' : r.name || null })).slice(0, 20),
  };
}

async function roomContext(db: Db, v: V, roomId: unknown, now: Date) {
  if (typeof roomId !== 'string' || !roomId) throw new InputError('room is required');
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  if (!loaded?.ds.rooms[roomId]) throw new InputError(`no room '${roomId}' in this group`);
  const sample = !!loaded.org.sample;
  const windows = sample ? null : await withOwners(db, await listWindows(db, v.orgId, v.rooms, now));
  const tasks = (await listTasks(db, v.orgId, [roomId])).map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));
  const acts = (await loadActions(db, v.orgId, [roomId]))[roomId] ?? {};
  const d = deriveRoom(loaded.ds, roomId);
  const view = weekView(d, {
    windows: windows as never,
    hours: (acts.plan as { hours?: number } | undefined)?.hours,
    dismissed: (acts.findings as Record<string, string> | undefined) ?? {},
    matchedWeeks: loaded.ds.matchedWeeks ?? [],
    tasks,
    now,
  });
  return { view, tasks, sample };
}

/** Who started each window, for "responsible manager" on tests in flight. */
async function withOwners<T extends { userId: string | null }>(db: Db, ws: T[]) {
  const ids = [...new Set(ws.map((w) => w.userId).filter((x): x is string => !!x))];
  const names = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  return ws.map((w) => ({ ...w, ownerName: names.find((n) => n.id === w.userId)?.name ?? null }));
}

/** The week for one room, scoped to the viewer. */
export async function weekSummary(db: Db, v: V, roomId: unknown, now = new Date()) {
  const { view, tasks } = await roomContext(db, v, roomId, now);
  const stored = await loadWeekPlan(db, v.orgId, roomId as string);
  return {
    view: toJson(view),
    digest: weekDigest(view),
    reviews: await reviewsFor(db, v.orgId, roomId as string),
    plan: { ...planState(view, stored.plan, tasks), committedBy: stored.committedBy, history: stored.history },
  };
}

/** Commit (or re-commit, after reviewing revisions) this week's plan. */
export async function commitWeekPlan(db: Db, v: V & { userId: string }, body: { roomId?: unknown; week?: unknown; items?: unknown }, now = new Date()) {
  const { view, tasks } = await roomContext(db, v, body.roomId, now);
  let items;
  try { items = buildCommit(view, body); } catch (err) { throw new InputError((err as Error).message); }
  const prev = (await loadWeekPlan(db, v.orgId, body.roomId as string)).plan;
  const plan: Plan = { week: view.period!.start, committedAt: now.toISOString(), revision: prev && prev.week === view.period!.start ? prev.revision + 1 : 1, items };
  await save(db, v, body.roomId as string, plan, `commit r${plan.revision}: ${items.map((i) => `${i.title} (${i.owner}, due ${i.due})`).join('; ')}`.slice(0, 400));
  return weekSummaryFrom(db, v, body.roomId as string, view, tasks);
}

/** Move one committed action along: planned, doing, done, dropped. */
export async function updateWeekPlanItem(db: Db, v: V & { userId: string }, body: { roomId?: unknown; week?: unknown; id?: unknown; status?: unknown }, now = new Date()) {
  const { view, tasks } = await roomContext(db, v, body.roomId, now);
  const prev = (await loadWeekPlan(db, v.orgId, body.roomId as string)).plan;
  if (!prev || prev.week !== body.week) throw new InputError('There is no committed plan for that week.');
  let next;
  try { next = setItemStatus(prev, String(body.id ?? ''), String(body.status ?? '')); } catch (err) { throw new InputError((err as Error).message); }
  const item = next.items.find((i: { id: string; title: string; status: string }) => i.id === body.id)!;
  await save(db, v, body.roomId as string, next, `status: ${item.title} → ${item.status}`);
  return weekSummaryFrom(db, v, body.roomId as string, view, tasks);
}

async function save(db: Db, v: V & { userId: string }, roomId: string, plan: Plan, summary: string) {
  await db.insert(actions).values({ orgId: v.orgId, roomId, key: PLAN_KEY, value: plan, summary, userId: v.userId });
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: `action.${PLAN_KEY}`, detail: { roomId, summary } });
}

async function weekSummaryFrom(db: Db, v: V, roomId: string, view: ReturnType<typeof weekView>, tasks: unknown[]) {
  const stored = await loadWeekPlan(db, v.orgId, roomId);
  return { plan: { ...planState(view, stored.plan, tasks as never[]), committedBy: stored.committedBy, history: stored.history } };
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
  const tasks = (await listTasks(db, orgId)).map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));
  const acts = await loadActions(db, orgId);
  const sent: string[] = [];
  const waiting: string[] = [];
  for (const id of Object.keys(loaded.ds.rooms)) {
    const room = loaded.ds.rooms[id];
    if (awaitingData(room)) { waiting.push(id); continue; }
    const d = deriveRoom(loaded.ds, id);
    const mine = acts[id] ?? {};
    const view = weekView(d, { windows: windows as never, hours: (mine.plan as { hours?: number } | undefined)?.hours, dismissed: (mine.findings as Record<string, string> | undefined) ?? {}, matchedWeeks: loaded.ds.matchedWeeks ?? [], tasks, now });
    if (!view.period) continue;
    const g = weekDigest(view);
    const row = await notify(db, { orgId, roomId: id, kind: 'week', severity: g.severity as 'info' | 'warn', title: g.title, body: g.body, link: '/', dedupe: `week:${id}:${view.period.start}` });
    if (row) sent.push(id);
  }
  return { rooms: Object.keys(loaded.ds.rooms).length, sent, waiting };
}
