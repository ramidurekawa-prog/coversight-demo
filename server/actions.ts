// Operator decisions, saved per org. Each key has a schema and a scope: a room
// key belongs to one room (a GM can write only their rooms); a group key
// belongs to the whole group (owner or admin only); a person key belongs to
// the one signed-in person (stored under room 'user:<id>', returned only to them
// as the ME bucket). Entries are append-only:
// the newest per room and key is the current value.
import { and, desc, eq, inArray, notLike, or } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from './db/client';
import { kitchenSchemas } from './page/kitchen';
import { meetingSchemas } from './page/meeting';
import { actions, auditLog, rooms } from './db/schema';
import { InputError } from './org';
import { AuthError, roomLevel, type Viewer } from './session';
import { CAUSES as TRENDS_CAUSES, NOTE_KEY_RE as TRENDS_NOTE_KEY } from '../lib/data/page/trends.js';

const id = z.string().min(1).max(120);
const isoDate = z.string().max(40);
const flags = z.record(id, isoDate);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const forecastSignals = z.object({
  events: z.array(z.object({ date: day, name: z.string().trim().min(1).max(80), lift: z.number().min(-100).max(500).nullable().optional(), by: z.string().max(80).optional() })).max(100).optional(),
  closures: z.array(day).max(120).optional(),
  weather: z.array(z.object({ date: day, rainIn: z.number().min(0).max(20), tempF: z.number().min(-60).max(140).nullable().optional() })).max(250).optional(),
  reservations: z.array(z.object({ date: day, covers: z.number().int().min(0).max(5000), asOf: day })).max(250).optional(),
  days: z.array(z.object({ date: day, covers: z.number().int().min(0).max(20_000).optional(), net: z.number().min(0).max(5_000_000).optional() })).max(250).optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable().optional(),
  /** Sold-out services and guests turned away, so a full house reads as demand, not a quiet night. */
  capacity: z.array(z.object({ date: day, service: z.enum(['lunch', 'dinner']).nullable().optional(), soldOut: z.boolean(), turnedAway: z.number().int().min(0).max(5000).nullable().optional() })).max(250).optional(),
});

const count = z.number().int().min(0).max(5000);
/** Services logged with the host's counts: bookings and plan as they stood at forecast time, counts at each check, the final covers. */
const forecastLive = z.object({
  services: z.array(z.object({
    date: day, service: z.enum(['lunch', 'dinner']),
    booked: count, asOf: z.string().max(40).optional(),
    cuts: z.array(z.object({
      at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), seated: count, walkIns: count,
      bookedSeated: count.nullable().optional(), bookedBefore: count.nullable().optional(), bookedRest: count.nullable().optional(),
      planSoFar: z.number().min(0).max(5000), planRest: z.number().min(0).max(5000),
    })).max(12),
    final: z.object({ covers: count, walkIns: count.nullable().optional(), bookedSeated: count.nullable().optional() }).nullable().optional(),
  })).max(400),
});

const money = z.number().min(0).max(1_000_000);
/** Costs to size by, and the pilot ledger: what was recommended, what was done, what happened. */
const forecastDecisions = z.object({
  costs: z.object({ shortHour: money.nullable().optional(), idleHour: money.nullable().optional() }).optional(),
  entries: z.array(z.object({
    date: day, service: z.enum(['lunch', 'dinner']).optional(), kind: z.enum(['staff', 'prep']),
    recommended: z.number().min(0).max(100_000).nullable().optional(), usual: z.number().min(0).max(100_000).nullable().optional(), did: z.number().min(0).max(100_000).nullable().optional(),
    followed: z.boolean(),
    outcome: z.object({ waste: money.optional(), stockouts: count.optional(), laborCost: money.optional(), covers: count.optional(), ticketMin: z.number().min(0).max(300).optional(), guestIssues: count.optional() }).optional(),
  })).max(500).optional(),
});

const layoutRole = z.object({ metrics: z.array(z.string().max(20)).max(6), widgets: z.array(z.string().max(20)).max(6) });

export const ACTION_KEYS = {
  /** Today's layout for one person, per role they view it as: which numbers and extras show. Never changes a figure. */
  'today.layout': { scope: 'person', schema: z.object({ owner: layoutRole.optional(), gm: layoutRole.optional(), floor: layoutRole.optional() }) },
  /** Today's work queue: cards done or declined (with when, and why declined), snoozed (until which day) and assigned (to which role). Written by /api/page/today. */
  queue: { scope: 'room', schema: z.object({ done: flags, refused: flags, snoozed: flags.optional(), assigned: z.record(id, z.object({ to: z.union([z.enum(['gm', 'kitchen', 'bar', 'owner']), z.string().regex(/^user:[\w-]{1,80}$/)]), at: isoDate, name: z.string().max(80).optional(), from: z.string().max(80).optional(), ack: z.object({ at: isoDate, by: z.string().max(80).optional() }).optional() })).optional(), meta: z.record(id, z.object({ reason: z.enum(['not_relevant', 'handled', 'disagree', 'not_now']).optional(), worth: z.number().min(0).max(1e7).optional() })).optional() }).refine((q) => Object.keys(q.done).length + Object.keys(q.refused).length + Object.keys(q.snoozed ?? {}).length + Object.keys(q.assigned ?? {}).length <= 300, 'too many cards') },
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
  /** What the room has told Sous about things it noticed: handled (checked again after two weeks) or set aside (until the numbers change). */
  sous: { scope: 'room', schema: z.record(z.string().min(1).max(80).regex(/^[\w:.-]+$/), z.object({ at: isoDate, how: z.enum(['handled', 'dismissed']), sig: z.string().max(40), title: z.string().max(200).optional() })).refine((r) => Object.keys(r).length <= 100, 'too many') },
  /** The room's notebook: what people told Sous to remember. Read as records in every answer. */
  'sous.notes': { scope: 'room', schema: z.array(z.object({ id: z.string().min(1).max(40).regex(/^[\w-]+$/), text: z.string().trim().min(3).max(240), at: isoDate, by: z.string().max(80).optional() })).max(50) },
  /** Suggestions this room acted on, by area, so Sous learns what gets used here. */
  'sous.learn': { scope: 'room', schema: z.array(z.object({ topic: z.string().min(1).max(40).regex(/^[\w-]+$/), id: z.string().max(120), at: isoDate })).max(100) },
  /** What this person asks Sous about, by area, so their usual questions are offered first. */
  'sous.me': { scope: 'person', schema: z.object({ asked: z.record(z.string().min(1).max(40).regex(/^[\w-]+$/), z.number().int().min(0).max(999)).refine((r) => Object.keys(r).length <= 40, 'too many') }) },
  /** What each page's agent last told this person, by "room:page", so it only speaks up when something is new. */
  'sous.seen': { scope: 'person', schema: z.record(z.string().min(1).max(110), z.string().max(40)).refine((r) => Object.keys(r).length <= 300, 'too many') },
  /** Ideas to test later that can't be valued yet (no data source for them). */
  ideas: { scope: 'room', schema: z.array(z.object({ id: id, title: z.string().trim().min(1).max(200), why: z.string().max(400).optional(), at: isoDate })).max(50) },
  /** Autonomy level per lever (0 observes … 4 holds the line), set on System. */
  autonomy: { scope: 'room', schema: z.record(z.string().min(1).max(40), z.number().int().min(0).max(4)) },
  /** Pricing on the invoice: per room per month, and the fee on reconciled savings. */
  pricing: { scope: 'group', schema: z.object({ perRoomMonthlyCents: z.number().int().min(0).max(1_000_000), feePct: z.number().min(0).max(50) }) },
  /** Service: tonight's answer to the one staffing call, per night (the room's local date). */
  'service.night': { scope: 'room', schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), answer: z.enum(['ask', 'yes', 'no', 'later']), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(), approvalId: z.string().max(120).optional(), meal: z.enum(['lunch', 'dinner']).optional(), until: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), to: z.enum(['gm', 'floor']).optional(),
    /** The last decisions, newest first, so the page can show what was decided and what came of it. */
    past: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), meal: z.enum(['lunch', 'dinner']).optional(), answer: z.enum(['yes', 'no', 'later', 'ask']), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(), approvalId: z.string().max(120).optional(), to: z.enum(['gm', 'floor']).optional(), when: z.string().max(40) })).max(30).optional() }) },
  /**
   * Covercast's hand-entered signals for a room: events (with the lift the
   * manager expects, if any), closures, rain, reservations on the books, past
   * days typed in where no feed has them, and where the room is (for the
   * weather feed). Feeds add to these; a hand entry is never overwritten.
   */
  'forecast.signals': { scope: 'room', schema: forecastSignals },
  /** Covercast live: services logged with the host's counts (arrivals, walk-ins, bookings as they stood). */
  'forecast.live': { scope: 'room', schema: forecastLive },
  /** Covercast decisions: what a short server-hour costs, and the pilot ledger. */
  'forecast.decisions': { scope: 'room', schema: forecastDecisions },
  /**
   * Pre-shift staffing: the manager's own changes to the guests expected in
   * an hour of one service (a large party, an event, a closure), each with its
   * reason, who and when. The forecast they change is kept as it was; the
   * staffing call is worked out again on the changed hours (lib/data/page/staffing.js).
   */
  'staffing.adjust': { scope: 'room', schema: z.object({ list: z.array(z.object({
    id: z.string().min(1).max(40).regex(/^[\w-]+$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), meal: z.enum(['lunch', 'dinner']),
    hour: z.number().int().min(0).max(23), guests: z.number().int().min(-500).max(500).refine((n) => n !== 0, 'a change of 0 guests'),
    reason: z.enum(['party', 'event', 'weather', 'closure', 'other']), note: z.string().trim().max(80).optional(), at: isoDate, by: z.string().max(80).optional(),
  })).max(60) }) },
  /** Pre-shift staffing: the last call each service showed that needed a decision, so one that's covered later is kept as history, not lost. */
  'staffing.seen': { scope: 'room', schema: z.record(z.string().regex(/^staff:\d{4}-\d{2}-\d{2}:(lunch|dinner)$/), z.object({
    title: z.string().max(200), kind: z.enum(['add', 'start', 'end']).optional(), version: z.string().max(20), at: isoDate, approvalId: z.string().max(120).optional(),
  })).refine((r) => Object.keys(r).length <= 30, 'too many') },
  /** Weekly meeting: the room's slot (day of week, 0 = Sunday, local time, length) and who usually attends. */
  'meeting.schedule': { scope: 'room', schema: meetingSchemas.schedule },
  /** Labor: days entered by hand (cost and hours), for when no schedule or payroll feed is connected or one is down. One entry per date. */
  'labour.entries': { scope: 'room', schema: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cost: z.number().min(0).max(200_000).optional(), hours: z.number().min(0).max(5000).optional(), sched: z.number().min(0).max(5000).optional() })).max(120) },
  /** Labor: which view one person opens the page in (GM, owner or operations). Never changes a figure. */
  'labour.view': { scope: 'person', schema: z.enum(['gm', 'owner', 'ops']) },
  /** Labor: what the operator said about each suggested move (planned or not for us). Advice only: never changes a schedule. */
  'labour.moves': { scope: 'room', schema: z.record(id, z.object({ s: z.enum(['planned', 'skipped']), at: isoDate, t: z.string().max(160).optional() })) },
  /** Labor: cooks on the line by hour for each weekday, entered by hand when no schedule feed carries kitchen roles. Read-only analysis: never changes a schedule. */
  'labour.crew': { scope: 'room', schema: z.record(z.string().regex(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/), z.record(z.string().regex(/^([01]?\d|2[0-3])$/), z.number().min(0).max(40))) },
  /** Trends: why a week or a run of weeks was unusual, per "<week start>:<metric>". */
  'trends.notes': { scope: 'room', schema: z.record(z.string().regex(TRENDS_NOTE_KEY), z.object({ cause: z.enum(TRENDS_CAUSES.map((c: { value: string }) => c.value) as [string, ...string[]]), text: z.string().trim().max(280), at: isoDate })).refine((r) => Object.keys(r).length <= 300, 'too many notes') },
  /** Service: tonight's count entered by hand when no live feed is on (covers so far, servers on), per night. */
  'service.manual': { scope: 'room', schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), entries: z.array(z.object({ meal: z.enum(['lunch', 'dinner']), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), covers: z.number().int().min(0).max(5000), servers: z.number().int().min(0).max(200).nullable(), saved: z.string().max(40) })).max(24) }) },
  /** This week: weeks marked reviewed, keyed by the data week's first day, with an optional note. Who reviewed comes from the row's user. */
  'week.review': { scope: 'room', schema: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.object({ at: isoDate, note: z.string().trim().max(1000).optional() })).refine((r) => Object.keys(r).length <= 26, 'keeps at most 26 weeks') },
  /** Kitchen: Line Trials, one change on the line at a time, measured on matched nights. Recording one never changes a kitchen screen. */
  'kitchen.trials': { scope: 'room', schema: kitchenSchemas.trials },
  /**
   * Staff: a manager's own notes on a person (a note, praise, training done, a
   * talk held, or "I disagree with this read"), newest first, keyed by the
   * person's id on the Staff page. Hand-entered and labelled so; never a
   * statistic. Owners, admins and GMs only: other roles neither read nor write it.
   */
  'staff.notes': { scope: 'room', roles: ['owner', 'admin', 'gm'], schema: z.record(z.string().regex(/^[\w-]{1,60}$/), z.array(z.object({ at: isoDate, kind: z.enum(['note', 'praise', 'training', 'talk', 'disagree']), text: z.string().trim().max(400), by: z.string().max(80).optional() })).max(40)).refine((r) => Object.keys(r).length <= 200, 'too many people') },
  /** All rooms: attention items acknowledged or snoozed in this room, by item id (`<roomId>:<kind>:<key>`). */
  'portfolio.handled': { scope: 'room', schema: z.record(z.string().regex(/^[^:\s]{1,60}:[a-z]+:\S{1,100}$/).max(120), z.object({ s: z.enum(['ack', 'snooze']), at: isoDate, until: isoDate.optional() })).refine((v) => Object.keys(v).length <= 50, 'at most 50 handled items') },
  /** Daily detail: this room's day parts, whole hours on the service clock (4 = 4 am … 28 = 4 am next day), no overlaps. */
  'daily.dayparts': { scope: 'room', schema: z.array(z.object({ name: z.string().trim().min(1).max(30), from: z.number().int().min(4).max(27), to: z.number().int().min(5).max(28) })).min(1).max(8).refine((a) => a.every((p) => p.to > p.from) && [...a].sort((x, y) => x.from - y.from).every((p, i, s) => !i || s[i - 1]!.to <= p.from), 'day parts must run forward and not overlap') },
  /** Menu prices: the Balanced menu's limit, the least share of a dish's orders a price move may keep. */
  'menu.lab': { scope: 'room', schema: z.object({ keepOrders: z.number().min(0.5).max(1) }) },
  /** Menu prices: each approved price change's rollout steps, ticked with the time (toast, apps, print, staff, check). */
  /** Menu prices: specials and deals (draft, live, ended) with the weekly redemption counts entered by hand. */
  'menu.deals': { scope: 'room', schema: z.array(z.object({
    id: id, kind: z.enum(['bundle', 'threshold', 'comeback']), status: z.enum(['draft', 'live', 'ended']),
    dish: z.string().max(80).optional(), buy: z.number().int().min(1).max(12).optional(), free: z.string().max(80).optional(),
    threshold: z.number().min(1).max(2000).optional(), checks: z.number().min(0).max(100_000).optional(), takeUp: z.number().min(0).max(1).optional(),
    cards: z.number().min(0).max(100_000).optional(), days: z.number().int().min(1).max(365).optional(), at: isoDate, liveAt: isoDate.optional(),
    counts: z.array(z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), redeemed: z.number().int().min(0).max(100_000), given: z.number().int().min(0).max(100_000).optional() })).max(104).optional(),
  })).max(40) },
  'menu.rollout': { scope: 'room', schema: z.record(z.string().regex(/^price:[\w-]+:[\d.]+$/).max(120), z.partialRecord(z.enum(['toast', 'apps', 'print', 'staff', 'check']), isoDate)).refine((r) => Object.keys(r).length <= 300, 'too many changes') },
} as const;

/** Keys only some roles may read or write (people notes). */
const rolesFor = (key: string): readonly string[] | null => {
  const spec = ACTION_KEYS[key as ActionKey] as { roles?: readonly string[] } | undefined;
  return spec?.roles ?? null;
};

export type ActionKey = keyof typeof ACTION_KEYS;
const MAX_BYTES = 20_000;
export const GROUP = '';
/** The client's bucket for the viewer's own person-scoped keys. */
export const ME = '@me';

/** Current values: { [roomId | '']: { [key]: value } }, limited to the viewer's rooms. */
export async function loadActions(db: Db, orgId: string, roomScope: string[] | null = null, userId: string | null = null, role: string | null = null) {
  // Person rows are the viewer's own only; agents and jobs (no userId) never see them.
  const own = userId ? or(notLike(actions.roomId, 'user:%'), eq(actions.roomId, `user:${userId}`)) : notLike(actions.roomId, 'user:%');
  const where = roomScope
    ? and(eq(actions.orgId, orgId), inArray(actions.roomId, [GROUP, ...roomScope, ...(userId ? [`user:${userId}`] : [])]))
    : and(eq(actions.orgId, orgId), own);
  const rows = await db
    .selectDistinctOn([actions.roomId, actions.key], { roomId: actions.roomId, key: actions.key, value: actions.value })
    .from(actions)
    .where(where)
    .orderBy(actions.roomId, actions.key, desc(actions.at), desc(actions.id));
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    if (!(r.key in ACTION_KEYS)) continue;
    const only = role ? rolesFor(r.key) : null;
    if (only && !only.includes(role!)) continue;
    (out[r.roomId.startsWith('user:') ? ME : r.roomId] ??= {})[r.key] = r.value;
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
  const room = spec.scope === 'group' ? GROUP : spec.scope === 'person' ? `user:${v.userId}` : roomId;
  if (typeof room !== 'string') throw new InputError('roomId is required');
  if (spec.scope === 'group' && roomLevel(v.role)) throw new AuthError(403, 'Only an owner or admin can change this.');
  const only = rolesFor(key);
  if (only && !only.includes(v.role)) throw new AuthError(403, 'Only an owner, admin or GM can change this.');
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
