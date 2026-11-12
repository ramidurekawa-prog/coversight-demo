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
    reversedAt: at('reversed_at'),
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

/** A guided write-back: an approved change the manager makes in another
 * system, ticks off here, and the next data upload confirms where it can. */
export const taskStatus = pgEnum('task_status', ['open', 'done', 'verified', 'mismatch', 'cancelled']);
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull(),
    approvalId: text('approval_id').notNull(),
    title: text('title').notNull(),
    system: text('system').notNull(),
    steps: jsonb('steps').$type<string[]>().notNull(),
    expect: jsonb('expect').notNull(),
    status: taskStatus('status').notNull().default('open'),
    note: text('note'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    doneBy: text('done_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull().defaultNow(),
    doneAt: at('done_at'),
    checkedAt: at('checked_at'),
  },
  (t) => [index('tasks_org_status_idx').on(t.orgId, t.status)],
);

/** In-app notifications: what changed that someone should know (a test
 * closed, a guardrail reversed a result, a change didn't show up in the data). */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    roomId: text('room_id'),
    kind: text('kind').notNull(),
    severity: text('severity').notNull().default('info'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    dedupe: text('dedupe'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('notifications_org_idx').on(t.orgId, t.createdAt), unique('notifications_dedupe').on(t.orgId, t.dedupe)],
);

export const notificationReads = pgTable(
  'notification_reads',
  {
    notificationId: uuid('notification_id').notNull().references(() => notifications.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);

/** Every email or text Coversight would send, and whether it went: queued,
 * sent, held (quiet hours), draft (no address: the operator sends it), skipped
 * (no provider configured) or failed. */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    notificationId: uuid('notification_id').references(() => notifications.id, { onDelete: 'set null' }),
    channel: text('channel').notNull(),
    kind: text('kind').notNull(),
    toAddress: text('to_address'),
    toUserId: text('to_user_id').references(() => users.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('queued'),
    providerId: text('provider_id'),
    error: text('error'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull().defaultNow(),
    sentAt: at('sent_at'),
  },
  (t) => [index('outbox_status_idx').on(t.status, t.createdAt), index('outbox_org_idx').on(t.orgId, t.createdAt)],
);

/** An invite link to join an org as owner, GM (with rooms) or admin. Only a
 * hash of the token is stored; the link is shown once. */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull(),
    rooms: jsonb('rooms').$type<string[] | null>(),
    email: text('email'),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull().defaultNow(),
    expiresAt: at('expires_at').notNull(),
    acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: at('accepted_at'),
    revokedAt: at('revoked_at'),
  },
  (t) => [index('invites_org_idx').on(t.orgId)],
);

/** A month's invoice: subscription + fee on reconciled (verified, lower-bound)
 * savings − credits. Drafts recalculate; a final invoice is frozen. */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    status: text('status').notNull().default('draft'),
    lines: jsonb('lines').notNull(),
    accruals: jsonb('accruals').notNull(),
    pricing: jsonb('pricing').notNull(),
    reconciledCents: integer('reconciled_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    stripeInvoiceId: text('stripe_invoice_id'),
    stripeUrl: text('stripe_url'),
    // Stripe delivery, separate from finalizing: a final invoice is final
    // whether or not Stripe has it. none (no Stripe) | pending | sent | failed.
    delivery: text('delivery').notNull().default('none'),
    deliveryAttempts: integer('delivery_attempts').notNull().default(0),
    deliveryError: text('delivery_error'),
    // When the next attempt may run; also a 10-minute lease while one is running.
    nextDeliveryAt: at('next_delivery_at'),
    // Which Stripe objects exist already, so a retry resumes rather than repeats.
    deliveryProgress: jsonb('delivery_progress').notNull().default({}),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
    finalizedAt: at('finalized_at'),
    finalizedBy: text('finalized_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [unique('invoices_org_period').on(t.orgId, t.period)],
);

/** A group's Toast API credentials: the secret is sealed with CREDENTIALS_KEY
 * (AES-256-GCM) and never returned or exported. One per group. */
export const toastConnections = pgTable('toast_connections', {
  orgId: uuid('org_id').primaryKey().references(() => orgs.id, { onDelete: 'cascade' }),
  host: text('host').notNull(),
  clientId: text('client_id').notNull(),
  secretSealed: text('secret_sealed').notNull(),
  restaurants: jsonb('restaurants').$type<{ guid: string; roomId: string; name: string; tz?: string }[]>().notNull(),
  status: text('status').notNull().default('connected'),
  lastError: text('last_error'),
  checkedAt: at('checked_at').notNull().defaultNow(),
  /** The live sync: 'off' until the first run, then 'backfilling' → 'live', or 'failing'. */
  syncState: text('sync_state').notNull().default('off'),
  syncedAt: at('synced_at'),
  /** Per room: days held, days still to backfill, newest business day, rows last pulled. */
  syncDetail: jsonb('sync_detail').$type<Record<string, { days: number; missing: number; newest: string | null; orders: number; shifts: number }>>(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: at('created_at').notNull().defaultNow(),
});

/**
 * One business day of a room's POS data, already mapped to Toast export rows
 * (lib/data/toast-api.js). The sync fills missing days and refreshes the last
 * two (late tips, voids and clock-outs land after close); the summary every
 * figure reads is rebuilt from these rows, the same way an upload is.
 */
export const posDays = pgTable(
  'pos_days',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull(),
    day: text('day').notNull(),
    source: text('source').notNull().default('toast-api'),
    items: jsonb('items').$type<Record<string, string>[]>().notNull(),
    orders: jsonb('orders').$type<Record<string, string>[]>().notNull(),
    time: jsonb('time').$type<Record<string, string>[]>().notNull(),
    payments: jsonb('payments').$type<Record<string, string>[]>().notNull(),
    fetchedAt: at('fetched_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.roomId, t.day] })],
);

/**
 * A Google Sheet or Dropbox file kept linked to a room: re-read every
 * morning, each picked tab validated and committed like a hand upload
 * (server/links.ts).
 */
export const linkedSources = pgTable(
  'linked_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull(),
    url: text('url').notNull(),
    picks: jsonb('picks').$type<{ source: string; kind: string }[]>().notNull(),
    pulledAt: at('pulled_at'),
    lastError: text('last_error'),
    lastResult: jsonb('last_result'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('linked_sources_org_idx').on(t.orgId)],
);

/* ---------------------------------------------------------------- the crew */
/** One run of the agent crew for a group: what started it and what came of it. */
export const agentCycles = pgTable(
  'agent_cycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(),
    startedAt: at('started_at').notNull().defaultNow(),
    finishedAt: at('finished_at'),
    summary: jsonb('summary'),
  },
  (t) => [index('agent_cycles_org_idx').on(t.orgId, t.startedAt)],
);

/** Each handoff on the crew's bus: who raised it, who it went to. */
export const agentEvents = pgTable(
  'agent_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').notNull().references(() => agentCycles.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    from: text('from_agent').notNull(),
    to: jsonb('to_agents').$type<string[]>().notNull(),
    roomId: text('room_id'),
    payload: jsonb('payload').notNull(),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [index('agent_events_cycle_idx').on(t.cycleId, t.seq)],
);

/** One agent handling one event: what it applied, what policy refused. */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').notNull().references(() => agentCycles.id, { onDelete: 'cascade' }),
    agent: text('agent').notNull(),
    trigger: text('trigger').notNull(),
    roomId: text('room_id'),
    ms: integer('ms').notNull(),
    ok: boolean('ok').notNull(),
    error: text('error'),
    applied: jsonb('applied').notNull(),
    refused: jsonb('refused').notNull(),
    notes: jsonb('notes').$type<string[]>().notNull(),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [index('agent_runs_org_agent_idx').on(t.orgId, t.agent, t.at)],
);

/** What the crew puts in front of a person. One row per key; a decision is final for 14 days. */
export const agentProposals = pgTable(
  'agent_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    agent: text('agent').notNull(),
    kind: text('kind').notNull(),
    roomId: text('room_id'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    needs: text('needs').notNull().default('human'),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('open'),
    decidedBy: text('decided_by'),
    decidedAt: at('decided_at'),
    note: text('note'),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('agent_proposals_org_key').on(t.orgId, t.key), index('agent_proposals_org_status_idx').on(t.orgId, t.status)],
);

export const orgRelations = relations(orgs, ({ many }) => ({ rooms: many(rooms), memberships: many(memberships) }));

export const schema = { users, sessions, accounts, verifications, orgs, memberships, rooms, roomData, inputs, actions, auditLog, memberRole, windowStatus, testWindows, checkpoints, jobRuns, snapshots, taskStatus, tasks, notifications, notificationReads, outbox, invites, invoices, toastConnections, posDays, linkedSources, agentCycles, agentEvents, agentRuns, agentProposals };

