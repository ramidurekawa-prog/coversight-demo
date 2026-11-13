// The weekly meeting's backend. A meeting is a server-side session: started
// with the agenda the person sees (built by lib/data/page/meeting.js, the same
// code everywhere), saved as it goes so a refresh loses nothing, edited by one
// person at a time (a lease other people can see), and finalized in one
// transaction into the room's record plus meeting actions: owner, due date,
// definition of done, one live action per source so nothing duplicates.
import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  DEFAULT_SCHEDULE, finalizeMeeting as finalizePure, isoDay, MEETING_LIMITS as ML, OUTCOMES, PRIORITIES, SEGMENTS, weekOf,
} from '../../lib/data/page/meeting.js';
import type { Db } from '../db/client';
import { actions, auditLog, meetingActions, meetingSessions, rooms, users } from '../db/schema';
import { notify } from '../notify';
import { InputError } from '../org';
import { AuthError, type Viewer } from '../session';

/** How long an editor holds the meeting without saving before someone else may pick it up. */
export const LEASE_MS = 3 * 60_000;

export class ConflictError extends Error {
  override name = 'ConflictError';
  constructor(message: string, public detail: unknown = null) { super(message); }
}

/* ------------------------------------------------------------------ what may be saved */
const isoDate = z.string().max(40);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD');
const text = (n: number) => z.string().trim().max(n);
const key = z.string().min(1).max(160);
const outcomeKind = z.enum(Object.keys(OUTCOMES) as [string, ...string[]]);
const priority = z.enum(PRIORITIES as [string, ...string[]]);

const actionTemplate = z.object({
  sourceKey: key, findingId: z.string().max(120).optional(), title: text(ML.title).min(1), doneWhen: text(ML.doneWhen), approval: text(ML.approval),
  priority, dueDays: z.number().int().min(0).max(60),
});
const agendaItem = z.object({
  id: key, seg: z.enum(Object.keys(SEGMENTS) as [string, ...string[]]), icon: z.string().max(40), title: text(ML.title).min(1), body: text(ML.body),
  mins: z.number().min(0).max(30),
  figures: z.array(z.object({ label: text(80), value: text(60), claim: z.string().max(10).optional() })).max(ML.figures),
  risks: z.array(text(300)).max(4),
  recommend: outcomeKind, options: z.array(outcomeKind).min(1).max(ML.options),
  go: z.string().max(40).optional(), goId: z.string().max(120).optional(), findingId: z.string().max(120).optional(),
  follow: z.string().max(120).optional(), missing: z.boolean().optional(), overdue: z.boolean().optional(),
  action: actionTemplate.optional(),
});
export const agendaSchema = z.object({
  version: z.string().max(40), roomId: z.string().min(1).max(120), week: day, dataThrough: day.nullable(), sample: z.boolean(),
  items: z.array(agendaItem).max(ML.items),
  more: z.object({ issues: z.number().int().min(0).max(999), follow: z.number().int().min(0).max(999) }),
});
const actionEdit = z.object({ title: text(ML.title).optional(), owner: text(ML.owner).optional(), due: day.optional(), priority: priority.optional(), doneWhen: text(ML.doneWhen).optional(), approval: text(ML.approval).optional() });
export const stateSchema = z.object({
  i: z.number().int().min(0).max(ML.items),
  itemAt: isoDate,
  outcomes: z.record(key, z.object({ status: outcomeKind, reason: text(ML.reason).optional(), action: actionEdit.optional(), at: isoDate })).refine((o) => Object.keys(o).length <= ML.items, 'too many outcomes'),
  notes: z.record(key, text(ML.note)).refine((o) => Object.keys(o).length <= ML.items, 'too many notes'),
  attendees: z.array(text(ML.owner).min(1)).max(ML.attendees),
  events: z.array(z.object({ at: isoDate, item: key, status: z.string().max(20), reason: text(ML.reason).optional() })).max(ML.events),
});

/** The legacy single-record `meeting` action (before meetings were sessions). */
const legacyMeeting = z.object({ log: z.array(text(ML.logLine)).max(ML.log), at: isoDate });

/** Schemas for the page's ACTION_KEYS entries (server/actions.ts). */
export const meetingSchemas = {
  schedule: z.object({
    day: z.number().int().min(0).max(6),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM'),
    mins: z.number().int().min(5).max(90).optional(),
    attendees: z.array(text(ML.owner).min(1)).max(ML.attendees).optional(),
  }),
};

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const p = schema.safeParse(value);
  if (!p.success) throw new InputError(`invalid ${what}: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  return p.data;
}

/* ------------------------------------------------------------------ scope */
type Who = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
async function roomFor(db: Db, v: Pick<Viewer, 'orgId' | 'rooms'>, roomId: unknown) {
  if (typeof roomId !== 'string' || !roomId || roomId.length > 120) throw new InputError('room is required');
  if (v.rooms && !v.rooms.includes(roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const [r] = await db.select({ id: rooms.id, loc: rooms.loc }).from(rooms).where(and(eq(rooms.orgId, v.orgId), eq(rooms.id, roomId)));
  if (!r) throw new InputError(`no room '${roomId}' in this group`);
  const loc = (r.loc ?? {}) as { name?: string; short?: string };
  return { id: r.id, name: loc.name || loc.short || r.id };
}
async function sessionFor(db: Db, v: Who, id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new InputError('meeting id is required');
  const [s] = await db.select().from(meetingSessions).where(and(eq(meetingSessions.id, id), eq(meetingSessions.orgId, v.orgId)));
  if (!s) throw new InputError('no such meeting');
  await roomFor(db, v, s.roomId);
  return s;
}
const nameOf = async (db: Db, userId: string | null) => {
  if (!userId) return null;
  const [u] = await db.select({ name: users.name, anon: users.isAnonymous }).from(users).where(eq(users.id, userId));
  return u ? (u.anon ? 'A guest' : u.name) : null;
};

/** Who may write: the editor holding the lease, anyone once it lapses, or an owner/admin taking over. */
function mayEdit(s: typeof meetingSessions.$inferSelect, v: Who, now: Date, takeover = false) {
  if (s.status !== 'live') return { ok: false, why: 'This meeting is already closed.' };
  if (!s.editorId || s.editorId === v.userId) return { ok: true };
  if (!s.lockedUntil || s.lockedUntil.getTime() < now.getTime()) return { ok: true };
  if (takeover && v.role !== 'gm') return { ok: true };
  return { ok: false, why: 'Someone else is running this meeting.' };
}

/* ------------------------------------------------------------------ reading */
function shapeSession(s: typeof meetingSessions.$inferSelect, editor: string | null, v: Who, now: Date) {
  return {
    id: s.id, roomId: s.roomId, week: s.week, status: s.status, version: s.version, agenda: s.agenda, state: s.state,
    startedAt: s.startedAt.toISOString(), editor, editorIsMe: !s.editorId || s.editorId === v.userId,
    lockedUntil: s.lockedUntil?.toISOString() ?? null, canEdit: mayEdit(s, v, now).ok, canTakeOver: v.role !== 'gm',
  };
}

/** Everything the page needs for one room: the live meeting, the record, and the actions. */
export async function loadMeeting(db: Db, v: Who, roomId: unknown, now = new Date()) {
  const room = await roomFor(db, v, roomId);
  const [live] = await db.select().from(meetingSessions).where(and(eq(meetingSessions.orgId, v.orgId), eq(meetingSessions.roomId, room.id), eq(meetingSessions.status, 'live')));
  const past = await db.select({ id: meetingSessions.id, record: meetingSessions.record, endedAt: meetingSessions.endedAt, by: users.name, anon: users.isAnonymous })
    .from(meetingSessions).leftJoin(users, eq(users.id, meetingSessions.startedBy))
    .where(and(eq(meetingSessions.orgId, v.orgId), eq(meetingSessions.roomId, room.id), eq(meetingSessions.status, 'finalized')))
    .orderBy(desc(meetingSessions.endedAt)).limit(ML.history);
  const history = [
    ...past.filter((p) => p.record).map((p) => ({ id: p.id, by: p.anon ? null : (p.by ?? null), ...(p.record as object) })),
    ...(await legacyHistory(db, v.orgId, room.id)),
  ].slice(0, ML.history) as unknown as { id: string; at: string }[];
  const acts = await listActions(db, v.orgId, room.id, now);
  return { live: live ? shapeSession(live, await nameOf(db, live.editorId), v, now) : null, history, actions: acts };
}

/** Meetings saved before sessions existed: the `meeting` action entries, back to the last clear. */
async function legacyHistory(db: Db, orgId: string, roomId: string) {
  const rows = await db.select({ id: actions.id, at: actions.at, value: actions.value }).from(actions)
    .where(and(eq(actions.orgId, orgId), eq(actions.roomId, roomId), eq(actions.key, 'meeting'))).orderBy(desc(actions.at)).limit(60);
  const out = [];
  for (const r of rows) {
    if (r.value === null) break;
    const p = legacyMeeting.safeParse(r.value);
    if (p.success) out.push({ id: r.id, by: null, at: p.data.at, log: p.data.log, legacy: true });
  }
  return out;
}

async function listActions(db: Db, orgId: string, roomId: string, now: Date) {
  const since = new Date(now.getTime() - 30 * 864e5);
  const rows = await db.select().from(meetingActions).where(and(eq(meetingActions.orgId, orgId), eq(meetingActions.roomId, roomId),
    or(inArray(meetingActions.status, ['open', 'deferred']), gte(meetingActions.updatedAt, since)))).orderBy(meetingActions.due, meetingActions.createdAt).limit(200);
  return rows.map((a) => ({ id: a.id, roomId: a.roomId, meetingId: a.meetingId, sourceKey: a.sourceKey, findingId: a.findingId, title: a.title, owner: a.owner, due: a.due, priority: a.priority, doneWhen: a.doneWhen, approval: a.approval, status: a.status, reason: a.reason, closedAt: a.closedAt?.toISOString() ?? null, updatedAt: a.updatedAt.toISOString() }));
}

/* ------------------------------------------------------------------ the meeting */
/** Start this week's meeting, or pick up the one already running (nothing is duplicated by starting twice). */
export async function startMeeting(db: Db, v: Who, body: { roomId?: unknown; agenda?: unknown; attendees?: unknown }, now = new Date()) {
  const room = await roomFor(db, v, body.roomId);
  const agenda = parse(agendaSchema, body.agenda, 'agenda');
  if (agenda.roomId !== room.id) throw new InputError('the agenda is for another room');
  const attendees = parse(z.array(text(ML.owner).min(1)).max(ML.attendees), body.attendees ?? [], 'attendees');
  const state = { i: 0, itemAt: now.toISOString(), outcomes: {}, notes: {}, attendees, events: [] };
  const [row] = await db.insert(meetingSessions).values({
    orgId: v.orgId, roomId: room.id, week: weekOf(now), agendaVersion: agenda.version, dataThrough: agenda.dataThrough, agenda, state,
    editorId: v.userId, lockedUntil: new Date(now.getTime() + LEASE_MS), startedBy: v.userId, startedAt: now,
  }).onConflictDoNothing().returning();
  if (row) await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'meeting.started', detail: { roomId: room.id, meetingId: row.id, items: agenda.items.length } });
  return loadMeeting(db, v, room.id, now);
}

/** Save progress. Version-checked, so two people can't overwrite each other. */
export async function saveMeeting(db: Db, v: Who, body: { id?: unknown; version?: unknown; state?: unknown; takeover?: unknown }, now = new Date()) {
  const s = await sessionFor(db, v, body.id);
  const takeover = body.takeover === true;
  const may = mayEdit(s, v, now, takeover);
  if (!may.ok) throw new ConflictError(may.why!, { editor: await nameOf(db, s.editorId) });
  const state = body.state === undefined ? s.state : parse(stateSchema, body.state, 'meeting');
  if (body.version !== s.version && !(takeover && body.state === undefined)) throw new ConflictError('This meeting changed somewhere else. Reload to see the latest.');
  const [row] = await db.update(meetingSessions)
    .set({ state, version: s.version + 1, editorId: v.userId, lockedUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now })
    .where(and(eq(meetingSessions.id, s.id), eq(meetingSessions.version, s.version), eq(meetingSessions.status, 'live'))).returning();
  if (!row) throw new ConflictError('This meeting changed somewhere else. Reload to see the latest.');
  if (s.editorId && s.editorId !== v.userId) await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'meeting.taken_over', detail: { meetingId: s.id, from: s.editorId } });
  return { version: row.version, lockedUntil: row.lockedUntil?.toISOString() ?? null };
}

export async function discardMeeting(db: Db, v: Who, body: { id?: unknown }, now = new Date()) {
  const s = await sessionFor(db, v, body.id);
  const may = mayEdit(s, v, now, true);
  if (!may.ok) throw new ConflictError(may.why!);
  await db.update(meetingSessions).set({ status: 'discarded', endedAt: now, editorId: null, updatedAt: now }).where(and(eq(meetingSessions.id, s.id), eq(meetingSessions.status, 'live')));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'meeting.discarded', detail: { meetingId: s.id, roomId: s.roomId } });
  return loadMeeting(db, v, s.roomId, now);
}

type History = { at: string; by: string; event: string; detail?: string }[];
type Upsert = { sourceKey: string; findingId?: string; title: string; owner: string; due: string; priority: string; doneWhen: string; approval: string; status: 'open' | 'deferred'; reason?: string };
type Finalized = { record: Record<string, unknown>; upserts: Upsert[]; updates: { id: string; status?: 'done' | 'cancelled'; owner?: string; due?: string }[]; dismiss: Record<string, string> };
const event = (h: unknown, e: History[number]) => [...((h as History) ?? []), e].slice(-50);

/** Finalize: the record, the actions (created or updated by source, never duplicated), last week's actions updated, findings held or dismissed. */
export async function finalizeMeeting(db: Db, v: Who, body: { id?: unknown; version?: unknown; state?: unknown }, now = new Date()) {
  const s = await sessionFor(db, v, body.id);
  const may = mayEdit(s, v, now);
  if (!may.ok) throw new ConflictError(may.why!);
  if (body.version !== s.version) throw new ConflictError('This meeting changed somewhere else. Reload to see the latest.');
  const state = parse(stateSchema, body.state ?? s.state, 'meeting');
  const agenda = parse(agendaSchema, s.agenda, 'agenda');
  const room = await roomFor(db, v, s.roomId);
  const by = (await nameOf(db, v.userId)) ?? 'Someone';
  const { record, upserts, updates, dismiss } = (finalizePure as unknown as (a: unknown, st: unknown, o: object) => Finalized)(agenda, state, { now, startedAt: s.startedAt.toISOString(), roomName: room.name, defaultOwner: v.role === 'gm' ? by : 'Owner' });
  const at = now.toISOString();
  await db.transaction(async (tx) => {
    const [claimed] = await tx.update(meetingSessions).set({ status: 'finalized', state, record, endedAt: now, version: s.version + 1, editorId: null, lockedUntil: null, updatedAt: now })
      .where(and(eq(meetingSessions.id, s.id), eq(meetingSessions.version, s.version), eq(meetingSessions.status, 'live'))).returning({ id: meetingSessions.id });
    if (!claimed) throw new ConflictError('This meeting changed somewhere else. Reload to see the latest.');
    for (const u of upserts) {
      const [cur] = await tx.select().from(meetingActions).where(and(eq(meetingActions.orgId, v.orgId), eq(meetingActions.roomId, room.id), eq(meetingActions.sourceKey, u.sourceKey), inArray(meetingActions.status, ['open', 'deferred'])));
      const fields = { title: u.title, owner: u.owner, due: u.due, priority: u.priority, doneWhen: u.doneWhen, approval: u.approval, status: u.status, reason: u.reason ?? null, findingId: u.findingId ?? null, meetingId: s.id, updatedAt: now };
      if (cur) await tx.update(meetingActions).set({ ...fields, history: event(cur.history, { at, by, event: cur.status === u.status ? 'updated in a meeting' : `${u.status === 'deferred' ? 'deferred' : 'reopened'} in a meeting`, detail: u.reason }) }).where(eq(meetingActions.id, cur.id));
      else await tx.insert(meetingActions).values({ ...fields, orgId: v.orgId, roomId: room.id, sourceKey: u.sourceKey, createdBy: v.userId, history: [{ at, by, event: u.status === 'deferred' ? 'deferred in a meeting' : 'assigned in a meeting', ...(u.reason ? { detail: u.reason } : {}) }] });
    }
    for (const u of updates) {
      const [cur] = await tx.select().from(meetingActions).where(and(eq(meetingActions.id, u.id), eq(meetingActions.orgId, v.orgId), eq(meetingActions.roomId, room.id)));
      if (!cur || cur.status !== 'open') continue;
      const closing = u.status === 'done' || u.status === 'cancelled';
      await tx.update(meetingActions).set({
        ...(u.status ? { status: u.status } : {}), ...(u.owner ? { owner: u.owner } : {}), ...(u.due ? { due: u.due } : {}),
        ...(closing ? { closedAt: now } : {}), updatedAt: now,
        history: event(cur.history, { at, by, event: closing ? `${u.status} (confirmed in a meeting)` : 'owner or date changed in a meeting' }),
      }).where(eq(meetingActions.id, cur.id));
    }
    if (Object.keys(dismiss).length) {
      const [cur] = await tx.select({ value: actions.value }).from(actions).where(and(eq(actions.orgId, v.orgId), eq(actions.roomId, room.id), eq(actions.key, 'findings'))).orderBy(desc(actions.at)).limit(1);
      const value = { ...((cur?.value as Record<string, string> | null) ?? {}), ...dismiss };
      await tx.insert(actions).values({ orgId: v.orgId, roomId: room.id, key: 'findings', value, summary: `Weekly meeting: ${Object.keys(dismiss).join(', ')} not for us`.slice(0, 400), userId: v.userId });
    }
    await tx.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'meeting.finalized', detail: { meetingId: s.id, roomId: room.id, actions: upserts.length, updated: updates.length, dismissed: Object.keys(dismiss) } });
  });
  return { record: { id: s.id, by, ...record }, ...(await loadMeeting(db, v, room.id, now)) };
}

/* ------------------------------------------------------------------ actions between meetings */
const actionPatch = z.object({ status: z.enum(['open', 'done', 'cancelled']).optional(), owner: text(ML.owner).min(1).optional(), due: day.optional(), reason: text(ML.reason).optional() });

/** Done, cancelled, reopened, or a new owner or date, from the follow-through list. */
export async function updateAction(db: Db, v: Who, body: { id?: unknown; patch?: unknown }, now = new Date()) {
  if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id)) throw new InputError('action id is required');
  const patch = parse(actionPatch, body.patch, 'action');
  const [cur] = await db.select().from(meetingActions).where(and(eq(meetingActions.id, body.id), eq(meetingActions.orgId, v.orgId)));
  if (!cur) throw new InputError('no such action');
  await roomFor(db, v, cur.roomId);
  if (patch.status === 'open' && cur.status !== 'open') {
    const [clash] = await db.select({ id: meetingActions.id }).from(meetingActions).where(and(eq(meetingActions.orgId, v.orgId), eq(meetingActions.roomId, cur.roomId), eq(meetingActions.sourceKey, cur.sourceKey), inArray(meetingActions.status, ['open', 'deferred'])));
    if (clash) throw new ConflictError('There is already a live action for this.');
  }
  const by = (await nameOf(db, v.userId)) ?? 'Someone';
  const closing = patch.status === 'done' || patch.status === 'cancelled';
  const what = patch.status ? (patch.status === 'open' ? 'reopened' : patch.status) : [patch.owner && `owner → ${patch.owner}`, patch.due && `due → ${patch.due}`].filter(Boolean).join(', ');
  await db.update(meetingActions).set({
    ...(patch.status ? { status: patch.status, closedAt: closing ? now : null } : {}), ...(patch.owner ? { owner: patch.owner } : {}), ...(patch.due ? { due: patch.due } : {}),
    updatedAt: now, history: event(cur.history, { at: now.toISOString(), by, event: what || 'updated', ...(patch.reason ? { detail: patch.reason } : {}) }),
  }).where(eq(meetingActions.id, cur.id));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'meeting.action', detail: { actionId: cur.id, roomId: cur.roomId, change: what } });
  return { actions: await listActions(db, v.orgId, cur.roomId, now) };
}

/* ------------------------------------------------------------------ reminders (the `meeting` job) */
const TZ = 'America/Los_Angeles';
const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const localDow = (d: Date) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d));

/** Daily: actions due tomorrow or overdue, and the meeting itself on its day. Deduped, so a re-run never repeats one. */
export async function runMeetingReminders(db: Db, orgId: string, now = new Date()) {
  const today = localDay(now);
  const tomorrow = localDay(new Date(now.getTime() + 864e5));
  const due = await db.select().from(meetingActions).where(and(eq(meetingActions.orgId, orgId), eq(meetingActions.status, 'open'), lte(meetingActions.due, tomorrow)));
  let sent = 0;
  for (const a of due) {
    const overdue = a.due < today;
    const stage = overdue ? `overdue:${weekOf(now)}` : `due:${a.due}`;
    const n = await notify(db, {
      orgId, roomId: a.roomId, kind: 'meeting-action', severity: overdue ? 'warn' : 'info',
      title: `${overdue ? 'Overdue' : a.due === today ? 'Due today' : 'Due tomorrow'}: ${a.title}`,
      body: `Owner: ${a.owner || 'nobody yet'}. Due ${a.due}.${a.doneWhen ? ` Done when: ${a.doneWhen}.` : ''} Agreed in the weekly meeting.`,
      link: '/meeting', dedupe: `meeting-action:${a.id}:${stage}`,
    });
    if (n) sent++;
  }
  const roomRows = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.orgId, orgId));
  const slots = await db.selectDistinctOn([actions.roomId], { roomId: actions.roomId, value: actions.value }).from(actions)
    .where(and(eq(actions.orgId, orgId), eq(actions.key, 'meeting.schedule'))).orderBy(actions.roomId, desc(actions.at));
  let meetings = 0;
  for (const r of roomRows) {
    const slot = { ...DEFAULT_SCHEDULE, ...((slots.find((x) => x.roomId === r.id)?.value as object | null) ?? {}) } as typeof DEFAULT_SCHEDULE;
    if (slot.day !== localDow(now)) continue;
    const open = await db.select({ n: sql<number>`count(*)::int` }).from(meetingActions).where(and(eq(meetingActions.orgId, orgId), eq(meetingActions.roomId, r.id), eq(meetingActions.status, 'open')));
    const n = await notify(db, {
      orgId, roomId: r.id, kind: 'meeting-day', title: `Weekly meeting today at ${slot.time}`,
      body: `The agenda is ready in Coversight.${open[0]?.n ? ` ${open[0].n} action${open[0].n === 1 ? '' : 's'} from earlier meetings still open.` : ''}`,
      link: '/meeting', dedupe: `meeting-day:${r.id}:${today}`,
    });
    if (n) meetings++;
  }
  return { reminders: sent, meetings, day: isoDay(now) };
}
