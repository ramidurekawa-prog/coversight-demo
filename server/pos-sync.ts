// Lane 1: the POS data channel. Pulls each connected restaurant's Toast data
// one business day at a time (Standard API: orders, time entries and the
// reference lists that name them), keeps the mapped rows per day in pos_days,
// and rebuilds the room's Toast summary from them with the same reader an
// uploaded export goes through (lib/data/toast.js). Nothing the browser can't
// also compute is computed here.
//
// First run backfills 13 weeks, newest first, a few weeks per run so a run
// never outlasts the serverless limit; after that each run refreshes the last
// two days plus today. Credentials stay sealed; the token lives for one run.
import { and, desc, eq, gte, lt } from 'drizzle-orm';

import { daysToFiles, localStamp, mapToastDay, toBusinessDate } from '../lib/data/toast-api.js';
import { summarizeToast } from '../lib/data/toast.js';
import type { Db } from './db/client';
import { auditLog, inputs, posDays, toastConnections } from './db/schema';
import { notify } from './notify';
import { TOAST_MSG, unseal } from './toast-conn';
import { toastSummary } from './toast-schema';

export const SYNC = {
  /** Days of history kept and backfilled (13 weeks). */
  backfillDays: 91,
  /** Days re-pulled every run besides today: late voids, tips and clock-outs land after close. */
  refreshDays: 2,
  /** Days fetched per restaurant per run, so a backfill spreads over a few runs. */
  maxDaysPerRun: 35,
  pageSize: 100,
  /** Stop starting new days after this long; the next run carries on. */
  budgetMs: 240_000,
  /** Kept for the year-on-year history the summary reads; older days are pruned. */
  keepDays: 371,
} as const;

const DEFAULT_TZ = 'America/Los_Angeles';
type Fetch = typeof fetch;
type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SyncError extends Error {
  override name = 'SyncError';
}

/** A Toast API client for one run. Retries 429 and 5xx with Retry-After; never puts the token in an error. */
export function toastClient(host: string, token: string, fetchImpl: Fetch = fetch, sleep: Sleep = realSleep) {
  async function get(path: string, guid: string): Promise<{ body: unknown; next: string | null }> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(`https://${host}${path}`, { headers: { authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': guid } });
      } catch {
        if (attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
        throw new SyncError(TOAST_MSG.host);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const wait = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401) throw new SyncError(TOAST_MSG.secret);
      if (res.status === 403) throw new SyncError(`${TOAST_MSG.guid} (${path.split('?')[0]})`);
      if (!res.ok) throw new SyncError(`Toast answered ${res.status} for ${path.split('?')[0]}.`);
      return { body: await res.json().catch(() => null), next: res.headers.get('toast-next-page-token') };
    }
  }
  /** A config list that pages by token (config/v2, labor/v1). */
  async function list(path: string, guid: string) {
    const out: unknown[] = [];
    let token: string | null = null;
    for (let i = 0; i < 20; i++) {
      const sep = path.includes('?') ? '&' : '?';
      const { body, next } = await get(token ? `${path}${sep}pageToken=${encodeURIComponent(token)}` : path, guid);
      if (Array.isArray(body)) out.push(...body);
      if (!next || next === token) break;
      token = next;
    }
    return out;
  }
  /** Every order of one business day (ordersBulk pages by number). */
  async function orders(guid: string, day: string) {
    const out: unknown[] = [];
    for (let page = 1; page <= 200; page++) {
      const { body } = await get(`/orders/v2/ordersBulk?businessDate=${toBusinessDate(day)}&pageSize=${SYNC.pageSize}&page=${page}`, guid);
      const rows = Array.isArray(body) ? body : [];
      out.push(...rows);
      if (rows.length < SYNC.pageSize) break;
    }
    return out;
  }
  return { get, list, orders };
}

/** Log in with the sealed credentials. Returns the bearer token for this run only. */
export async function toastLogin(host: string, clientId: string, secret: string, fetchImpl: Fetch = fetch) {
  let res: Response;
  try {
    res = await fetchImpl(`https://${host}/authentication/v1/authentication/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret: secret, userAccessType: 'TOAST_MACHINE_CLIENT' }) });
  } catch {
    throw new SyncError(TOAST_MSG.host);
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new SyncError(TOAST_MSG.secret);
  if (!res.ok) throw new SyncError(`Toast answered ${res.status} at login. The next run will try again.`);
  const token = ((await res.json().catch(() => ({}))) as { token?: { accessToken?: string } }).token?.accessToken;
  if (!token) throw new SyncError(TOAST_MSG.secret);
  return token;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** The days this run should pull: today and the refresh window always, then the newest missing days. */
export function planDays(today: string, have: Set<string>, max: number = SYNC.maxDaysPerRun) {
  const refresh = Array.from({ length: SYNC.refreshDays + 1 }, (_, i) => addDays(today, -i));
  const missing: string[] = [];
  for (let i = SYNC.refreshDays + 1; i < SYNC.backfillDays; i++) {
    const d = addDays(today, -i);
    if (!have.has(d)) missing.push(d);
  }
  return { days: [...refresh, ...missing].slice(0, Math.max(max, refresh.length)), missingAfter: Math.max(0, missing.length - Math.max(0, max - refresh.length)) };
}

/**
 * Rebuild one room's Toast summary from its stored days and keep it as the
 * room's 'toast' input. A sync input is updated in place (one row per room,
 * not one per hour); a manual upload made since is left alone and the sync
 * starts a fresh row on top of it.
 */
export async function rebuildRoom(db: Db, orgId: string, roomId: string, today: string) {
  const days = await db.select().from(posDays).where(and(eq(posDays.orgId, orgId), eq(posDays.roomId, roomId), gte(posDays.day, addDays(today, -SYNC.keepDays)))).orderBy(posDays.day);
  if (!days.length) return { ok: false as const, why: 'no days yet' };
  const summary = summarizeToast(daysToFiles(days)) as { ok: boolean; error?: string };
  if (!summary.ok) return { ok: false as const, why: summary.error ?? 'nothing to summarise' };
  const parsed = toastSummary.safeParse(summary);
  if (!parsed.success) return { ok: false as const, why: `${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}` };
  const label = `Toast sync · ${days.length} days to ${days.at(-1)!.day}`;
  const [last] = await db.select().from(inputs).where(and(eq(inputs.orgId, orgId), eq(inputs.roomId, roomId), eq(inputs.kind, 'toast'), eq(inputs.undone, false))).orderBy(desc(inputs.createdAt)).limit(1);
  if (last && last.userId == null && last.summary.startsWith('Toast sync')) {
    if (JSON.stringify(last.rows) === JSON.stringify([parsed.data])) return { ok: true as const, changed: false, label };
    await db.update(inputs).set({ rows: [parsed.data], summary: label, updatedAt: new Date() }).where(eq(inputs.id, last.id));
  } else {
    await db.insert(inputs).values({ orgId, roomId, kind: 'toast', rows: [parsed.data], summary: label, userId: null });
  }
  return { ok: true as const, changed: true, label };
}

/** One run of the live sync for one group. */
export async function syncToast(db: Db, orgId: string, { fetchImpl = fetch, now = new Date(), sleep = realSleep, maxDays = SYNC.maxDaysPerRun as number }: { fetchImpl?: Fetch; now?: Date; sleep?: Sleep; maxDays?: number } = {}) {
  const [c] = await db.select().from(toastConnections).where(eq(toastConnections.orgId, orgId));
  if (!c) return { skipped: 'Toast isn’t connected.' };
  const started = Date.now();
  const detail: Record<string, { days: number; missing: number; newest: string | null; orders: number; shifts: number }> = {};
  const fail = async (message: string) => {
    const was = c.syncState;
    await db.update(toastConnections).set({ syncState: 'failing', status: 'failing', lastError: message, syncedAt: new Date() }).where(eq(toastConnections.orgId, orgId));
    if (was !== 'failing') {
      await notify(db, { orgId, kind: 'toast.sync', severity: 'warn', title: 'Toast sync stopped', body: `${message} Figures stay on the last data that came in until it's fixed.`, link: '/connect', dedupe: `toast-sync-failing:${now.toISOString().slice(0, 10)}` }).catch(() => null);
    }
    return { ok: false as const, error: message };
  };

  let token: string;
  try {
    token = await toastLogin(c.host, c.clientId, unseal(c.secretSealed), fetchImpl);
  } catch (e) {
    return fail(e instanceof SyncError ? e.message : 'The stored credentials can’t be read. Reconnect Toast.');
  }
  const api = toastClient(c.host, token, fetchImpl, sleep);
  const restaurants = [...c.restaurants];

  try {
    for (const r of restaurants) {
      if (!r.tz) {
        const { body } = await api.get(`/restaurants/v1/restaurants/${r.guid}`, r.guid);
        r.tz = (body as { general?: { timeZone?: string } } | null)?.general?.timeZone || DEFAULT_TZ;
      }
      const tz = r.tz;
      const today = localStamp(now.toISOString(), tz).slice(0, 10);
      const have = new Set((await db.select({ day: posDays.day }).from(posDays).where(and(eq(posDays.orgId, orgId), eq(posDays.roomId, r.roomId)))).map((x) => x.day));
      const plan = planDays(today, have, maxDays);
      const [employees, jobs, diningOptions, salesCategories, tables, menuGroups] = await Promise.all([
        api.list('/labor/v1/employees', r.guid), api.list('/labor/v1/jobs', r.guid), api.list('/config/v2/diningOptions', r.guid),
        api.list('/config/v2/salesCategories', r.guid), api.list('/config/v2/tables', r.guid), api.list('/config/v2/menuGroups', r.guid),
      ]);
      const refs = { employees, jobs, diningOptions, salesCategories, tables, menuGroups };
      let pulledOrders = 0, pulledShifts = 0, skipped = 0;
      for (const day of plan.days) {
        if (Date.now() - started > SYNC.budgetMs) { skipped++; continue; }
        const [orders, timeEntries] = await Promise.all([api.orders(r.guid, day), api.list(`/labor/v1/timeEntries?businessDate=${toBusinessDate(day)}`, r.guid)]);
        const m = mapToastDay({ orders: orders as never[], timeEntries: timeEntries as never[], refs: refs as never, tz });
        pulledOrders += m.orders.length; pulledShifts += m.time.length;
        const row = { orgId, roomId: r.roomId, day, source: 'toast-api', items: m.items, orders: m.orders, time: m.time, payments: m.payments, fetchedAt: new Date() };
        await db.insert(posDays).values(row).onConflictDoUpdate({ target: [posDays.orgId, posDays.roomId, posDays.day], set: row });
        have.add(day);
      }
      await rebuildRoom(db, orgId, r.roomId, today);
      const held = [...have].filter((d) => d > addDays(today, -SYNC.backfillDays)).sort();
      detail[r.roomId] = { days: held.length, missing: plan.missingAfter + skipped, newest: held.at(-1) ?? null, orders: pulledOrders, shifts: pulledShifts };
      await db.delete(posDays).where(and(eq(posDays.orgId, orgId), eq(posDays.roomId, r.roomId), lt(posDays.day, addDays(today, -SYNC.keepDays))));
    }
  } catch (e) {
    return fail(e instanceof SyncError ? e.message : 'The sync hit an unexpected error. The next run will try again.');
  }

  const state = Object.values(detail).some((d) => d.missing > 0) ? 'backfilling' : 'live';
  await db.update(toastConnections).set({ restaurants, syncState: state, syncedAt: new Date(), syncDetail: detail, status: 'connected', lastError: null }).where(eq(toastConnections.orgId, orgId));
  if (c.syncState === 'off' || (c.syncState === 'backfilling' && state === 'live')) {
    await notify(db, { orgId, kind: 'toast.sync', title: state === 'live' ? 'Toast history is in' : 'Toast sync started', body: state === 'live' ? '13 weeks of Toast data are loaded. Every figure now reads your own data, refreshed every hour.' : 'Coversight is pulling 13 weeks of Toast history, newest first. Figures update as each run lands.', link: '/connect', dedupe: `toast-sync-${state}` }).catch(() => null);
  }
  await db.insert(auditLog).values({ orgId, userId: null, action: 'toast.synced', detail: { state, rooms: Object.keys(detail).length } });
  return { ok: true as const, state, rooms: detail };
}
