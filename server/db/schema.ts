// Coversight demo — the database. Two halves:
//  1. Better Auth's four tables (users, sessions, accounts, verifications).
//  2. Ours: orgs and memberships (who sees what), and the restaurant data
//     itself, stored per room and per kind in the same shape the model reads
//     (lib/data/seed.js), so every figure is still computed by lib/data/model.js.
import { relations, sql } from 'drizzle-orm';
import { boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = {
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
};

// ── Better Auth ──────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  /** A "try the sample" visitor: no password, gets a private copy of the sample group. */
  isAnonymous: boolean('is_anonymous').default(false),
  ...timestamps,
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    expiresAt: at('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: at('access_token_expires_at'),
    refreshTokenExpiresAt: at('refresh_token_expires_at'),
    scope: text('scope'),
    ...timestamps,
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: at('expires_at').notNull(),
    ...timestamps,
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

// ── Orgs and who can see them ────────────────────────────────────────────────
export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** A copy of the sample group (Rosewood). Never presented as a customer. */
  sample: boolean('sample').notNull().default(false),
  /** Group-level dataset parts (now, weeks, vendors, proof…), seed-shaped. */
  meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
  ...timestamps,
});

export const memberRole = pgEnum('member_role', ['owner', 'gm', 'admin']);

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull(),
    /** A GM's rooms; null means every room in the org. */
    rooms: jsonb('rooms').$type<string[] | null>(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index('memberships_user_idx').on(t.userId)],
);

// ── Restaurant data ──────────────────────────────────────────────────────────
export const rooms = pgTable(
  'rooms',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    /** Slug, e.g. 'oakland'. Stable: data and inputs key on it. */
    id: text('id').notNull(),
    position: integer('position').notNull().default(0),
    /** The location row the group view lists (name, short, tz…). */
    loc: jsonb('loc').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

/** One kind of a room's data (menu, staff, history…), seed-shaped. Written by the
 * sample copy now, and by the Toast sync later. */
export const roomData = pgTable(
  'room_data',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull(),
    kind: text('kind').notNull(),
    data: jsonb('data').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.orgId, t.roomId, t.kind] })],
);

/** Hand-entered data (recipes, counts, invoices…). Append-only: the latest
 * non-undone entry per room and kind applies; undo marks one undone. */
export const inputs = pgTable(
  'inputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull(),
    kind: text('kind').notNull(),
    rows: jsonb('rows').notNull(),
    opts: jsonb('opts'),
    summary: text('summary').notNull().default(''),
    undone: boolean('undone').notNull().default(false),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('inputs_org_room_kind_idx').on(t.orgId, t.roomId, t.kind)],
);

/** Operator decisions: queue cards cleared, approvals, meetings, fences, the
 * plan's hours, the period package. Append-only: the latest entry per room and
 * key is the current value, so every earlier value stays on record. roomId ''
 * is the whole group. */
export const actions = pgTable(
  'actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull().default(''),
    key: text('key').notNull(),
    value: jsonb('value'),
    summary: text('summary').notNull().default(''),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [index('actions_org_room_key_idx').on(t.orgId, t.roomId, t.key, t.at)],
);

/** Every change anyone makes, for the activity log and the accountant. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [index('audit_org_at_idx').on(t.orgId, t.at)],
);

/** A 28-day test of one lever in one room. Measured in weeks of the room's
 * data (startedAt is a data week-end), booked at the lower bound of the
 * effect (lib/data/pilot.js), reversed if a guardrail breaks afterwards. */
export const windowStatus = pgEnum('window_status', ['running', 'waiting', 'verified', 'rejected', 'reversed', 'stopped']);
export const testWindows = pgTable(
  'test_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull(),
    lever: text('lever').notNull(),
    metric: text('metric').notNull(),
    dish: text('dish'),
    title: text('title').notNull(),
    direction: text('direction').notNull(),
    baseline: doublePrecision('baseline').notNull(),
    centsPerUnitWeek: integer('cents_per_unit_week').notNull(),
    startedAt: text('started_at').notNull(),
    guard: jsonb('guard').notNull(),
    status: windowStatus('status').notNull().default('running'),
    bookedCents: integer('booked_cents').notNull().default(0),
    lowCents: integer('low_cents'),
    pointCents: integer('point_cents'),
    method: text('method'),
    day: integer('day').notNull().default(0),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull().defaultNow(),
    closedAt: at('closed_at'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('test_windows_org_idx').on(t.orgId, t.status)],
);

/** What the daily proof loop read at each 7-day checkpoint. */
export const checkpoints = pgTable(
  'checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    windowId: uuid('window_id').notNull().references(() => testWindows.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(),
    weekEnd: text('week_end').notNull(),
    observed: doublePrecision('observed').notNull(),
    controlDelta: doublePrecision('control_delta'),
    services: integer('services').notNull(),
    recordedAt: at('recorded_at').notNull().defaultNow(),
  },
  (t) => [unique('checkpoints_window_day').on(t.windowId, t.day)],
);

/** Every scheduled job run, per org: what ran, when, and what it found. */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    job: text('job').notNull(),
    orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull().default('schedule'),
    startedAt: at('started_at').notNull().defaultNow(),
    finishedAt: at('finished_at'),
    ok: boolean('ok'),
    detail: jsonb('detail'),
  },
  (t) => [index('job_runs_org_idx').on(t.orgId, t.startedAt)],
);

/** The nightly detection's latest output per room (levers, findings, the week). */
export const snapshots = pgTable(
  'snapshots',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull(),
    kind: text('kind').notNull(),
    data: jsonb('data').notNull(),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.roomId, t.kind] })],
);

export const orgRelations = relations(orgs, ({ many }) => ({ rooms: many(rooms), memberships: many(memberships) }));

export const schema = { users, sessions, accounts, verifications, orgs, memberships, rooms, roomData, inputs, actions, auditLog, memberRole, windowStatus, testWindows, checkpoints, jobRuns, snapshots };

