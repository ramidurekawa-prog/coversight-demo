// Notifications and the outbox. Something worth knowing becomes an in-app
// notification for everyone who can see that room; anyone whose alert
// settings ask for email gets an email queued. The outbox sends through
// Resend when RESEND_API_KEY and MAIL_FROM are set; otherwise each email is
// kept as "skipped: no provider", visible on the System screen, so turning
// email on later is one setting and nothing is lost silently.
import { and, desc, eq, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from './db/client';
import { actions, auditLog, memberships, notificationReads, notifications, outbox, users } from './db/schema';
import { InputError } from './org';
import { AuthError, type Viewer } from './session';

export type Note = { orgId: string; roomId?: string | null; kind: string; severity?: 'info' | 'good' | 'warn'; title: string; body?: string; link?: string; dedupe?: string };

type Alerts = { push: boolean; sms: boolean; email: boolean; onePerService: boolean; quiet: boolean };
const DEFAULT_ALERTS: Alerts = { push: true, sms: true, email: false, onePerService: true, quiet: true };
const TZ = 'America/Los_Angeles';
const appUrl = (path: string) => {
  const base = process.env.BETTER_AUTH_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');
  return new URL(path, base).toString();
};

/** Alert settings for a room (the Fences & alerts screen), newest saved value. */
async function alertsFor(db: Db, orgId: string, roomId: string | null): Promise<Alerts> {
  if (!roomId) return DEFAULT_ALERTS;
  const [row] = await db.select({ value: actions.value }).from(actions)
    .where(and(eq(actions.orgId, orgId), eq(actions.roomId, roomId), eq(actions.key, 'fences'))).orderBy(desc(actions.at)).limit(1);
  return { ...DEFAULT_ALERTS, ...((row?.value as { al?: Partial<Alerts> } | null)?.al ?? {}) };
}

/** Members who can see this room, with a real (non-guest) email. */
async function recipients(db: Db, orgId: string, roomId: string | null) {
  const rows = await db.select({ userId: memberships.userId, role: memberships.role, rooms: memberships.rooms, email: users.email, anonymous: users.isAnonymous })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, orgId));
  return rows.filter((r) => !r.anonymous && (r.role !== 'gm' || !roomId || !r.rooms || r.rooms.includes(roomId)));
}

/** Hours 10 pm – 7 am Pacific are quiet when the room asks for it. */
export function isQuiet(now = new Date()) {
  const h = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(now);
  return h >= 22 || h < 7;
}

export async function notify(db: Db, n: Note) {
  const [row] = await db.insert(notifications).values({
    orgId: n.orgId, roomId: n.roomId ?? null, kind: n.kind, severity: n.severity ?? 'info', title: n.title.slice(0, 200), body: (n.body ?? '').slice(0, 2000), link: n.link ?? null, dedupe: n.dedupe ?? null,
  }).onConflictDoNothing().returning();
  if (!row) return null; // already told
  const al = await alertsFor(db, n.orgId, n.roomId ?? null);
  if (al.email) {
    for (const r of await recipients(db, n.orgId, n.roomId ?? null)) {
      await db.insert(outbox).values({
        orgId: n.orgId, notificationId: row.id, channel: 'email', kind: n.kind, toAddress: r.email, toUserId: r.userId,
        subject: `Coversight: ${row.title}`, body: `${row.body}${row.link ? `\n\nOpen in Coversight: ${appUrl(row.link)}` : ''}`, status: al.quiet && isQuiet() ? 'held' : 'queued',
      });
    }
  }
  return row;
}

/** Send what's due. Returns counts; never throws for a provider failure. */
export async function deliverOutbox(db: Db, { now = new Date(), fetchImpl = fetch }: { now?: Date; fetchImpl?: typeof fetch } = {}) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  const due = await db.select().from(outbox).where(and(eq(outbox.channel, 'email'), or(eq(outbox.status, 'queued'), isQuiet(now) ? sql`false` : eq(outbox.status, 'held')))).limit(100);
  let sent = 0, skipped = 0, failed = 0;
  for (const m of due) {
    if (!m.toAddress) continue;
    if (!key || !from) {
      await db.update(outbox).set({ status: 'skipped', error: 'No email provider configured (RESEND_API_KEY, MAIL_FROM).' }).where(eq(outbox.id, m.id));
      skipped++;
      continue;
    }
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [m.toAddress], subject: m.subject, text: m.body }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) throw new Error(body.message || `Resend ${res.status}`);
      await db.update(outbox).set({ status: 'sent', providerId: body.id ?? null, sentAt: new Date(), error: null }).where(eq(outbox.id, m.id));
      sent++;
    } catch (err) {
      await db.update(outbox).set({ status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 300) }).where(eq(outbox.id, m.id));
      failed++;
    }
  }
  return { due: due.length, sent, skipped, failed };
}

/** A viewer's notifications for the bell: newest first, with read state. */
export async function listNotifications(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'rooms'>, limit = 30) {
  const scope = v.rooms ? or(isNull(notifications.roomId), inArray(notifications.roomId, v.rooms)) : undefined;
  const rows = await db.select().from(notifications).where(scope ? and(eq(notifications.orgId, v.orgId), scope) : eq(notifications.orgId, v.orgId)).orderBy(desc(notifications.createdAt)).limit(limit);
  const reads = rows.length ? await db.select({ id: notificationReads.notificationId }).from(notificationReads).where(and(eq(notificationReads.userId, v.userId), inArray(notificationReads.notificationId, rows.map((r) => r.id)))) : [];
  const read = new Set(reads.map((r) => r.id));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(
    eq(notifications.orgId, v.orgId), ...(scope ? [scope] : []),
    notExists(db.select().from(notificationReads).where(and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, v.userId)))),
  ));
  return { items: rows.map((r) => ({ ...r, read: read.has(r.id) })), unread: n };
}

export async function markRead(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'rooms'>, ids: unknown) {
  const { items } = await listNotifications(db, v, 200);
  const want = ids === 'all' ? items.map((i) => i.id) : Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  const allowed = want.filter((id) => items.some((i) => i.id === id));
  if (allowed.length) await db.insert(notificationReads).values(allowed.map((id) => ({ notificationId: id, userId: v.userId }))).onConflictDoNothing();
  return allowed.length;
}

/** Owner/admin: what's been sent, drafted or held. */
export async function listOutbox(db: Db, v: Pick<Viewer, 'orgId' | 'role'>) {
  if (v.role === 'gm') throw new AuthError(403, 'Only an owner or admin can see the outbox.');
  return db.select({ id: outbox.id, channel: outbox.channel, kind: outbox.kind, toAddress: outbox.toAddress, subject: outbox.subject, body: outbox.body, status: outbox.status, error: outbox.error, createdAt: outbox.createdAt, sentAt: outbox.sentAt })
    .from(outbox).where(eq(outbox.orgId, v.orgId)).orderBy(desc(outbox.createdAt)).limit(100);
}

const draftBody = z.object({
  kind: z.enum(['vendor', 'gm-note']),
  toAddress: z.string().trim().email().max(200).nullable().optional(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

/**
 * An email the operator wrote with Coversight's help (a vendor credit request,
 * talking points for a GM). With an address and a provider it's queued; with
 * no address it's saved as a draft to send from their own mail app.
 */
export async function draftEmail(db: Db, v: Pick<Viewer, 'orgId' | 'userId'>, input: unknown) {
  const p = draftBody.safeParse(input);
  if (!p.success) throw new InputError(`invalid email: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const { kind, toAddress, subject, body } = p.data;
  const [row] = await db.insert(outbox).values({ orgId: v.orgId, channel: 'email', kind, toAddress: toAddress ?? null, subject, body, status: toAddress ? 'queued' : 'draft', createdBy: v.userId }).returning();
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'email.drafted', detail: { id: row!.id, kind, to: toAddress ? 'address given' : 'draft' } });
  return row!;
}
