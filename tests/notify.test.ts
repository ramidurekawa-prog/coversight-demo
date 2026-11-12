import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, afterEach } from 'vitest';

import { readToastExports } from '../lib/data/toast.js';
import type { Db } from '../server/db/client';
import { actions, memberships, notifications, outbox, users } from '../server/db/schema';
import { commitInput, createSampleOrg } from '../server/org';
import { deliverOutbox, draftEmail, isQuiet, listNotifications, listOutbox, markRead, notify } from '../server/notify';
import { runProofLoop, startWindow } from '../server/proof';
import { freshDb } from './helpers/db';
import { toastFixture } from './helpers/toast-fixture.js';

let db: Db;
let orgId: string;
const owner = { userId: 'u1', role: 'owner' as const, rooms: null };
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'Owner', email: 'owner@example.com' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
afterEach(() => { delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM; });

const emailOn = (roomId: string, quiet = false) => db.insert(actions).values({ orgId, roomId, key: 'fences', value: { version: 4, f: {}, al: { push: true, sms: false, email: true, onePerService: true, quiet } } });
const daytime = new Date('2026-11-10T20:00:00Z'); // noon Pacific

describe('notifications', () => {
  it('reach everyone who can see the room, once per event, with read state per person', async () => {
    await db.insert(users).values({ id: 'gm-b', name: 'GM', email: 'gm@example.com' });
    await db.insert(memberships).values({ orgId, userId: 'gm-b', role: 'gm', rooms: ['berkeley'] });
    await notify(db, { orgId, roomId: 'oakland', kind: 'x', title: 'Oakland thing', dedupe: 'a' });
    await notify(db, { orgId, roomId: 'oakland', kind: 'x', title: 'Oakland thing', dedupe: 'a' }); // same event again
    await notify(db, { orgId, roomId: 'berkeley', kind: 'x', title: 'Berkeley thing' });
    const o = await listNotifications(db, { orgId, ...owner });
    expect(o.items.map((i) => i.title)).toEqual(['Berkeley thing', 'Oakland thing']);
    expect(o.unread).toBe(2);
    const g = await listNotifications(db, { orgId, userId: 'gm-b', rooms: ['berkeley'] });
    expect(g.items.map((i) => i.title)).toEqual(['Berkeley thing']);
    await markRead(db, { orgId, ...owner }, 'all');
    expect((await listNotifications(db, { orgId, ...owner })).unread).toBe(0);
    expect((await listNotifications(db, { orgId, userId: 'gm-b', rooms: ['berkeley'] })).unread).toBe(1);
    // A GM can't mark another room's notification read.
    expect(await markRead(db, { orgId, userId: 'gm-b', rooms: ['berkeley'] }, o.items.map((i) => i.id))).toBe(1);
  });

  it('a closed test window notifies, and emails when the room asks for email', async () => {
    await emailOn('oakland');
    const files = (o: Parameters<typeof toastFixture>[0]) => { const { unknown, ...s } = readToastExports(Object.entries(toastFixture(o)).map(([name, text]) => ({ name, text }))); return JSON.parse(JSON.stringify(s)); };
    await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'toast', rows: [files({})] });
    await startWindow(db, { orgId, userId: 'u1', rooms: null }, { roomId: 'oakland', lever: 'overtime' });
    await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'toast', rows: [files({ weeks: 17, end: Date.UTC(2026, 10, 22), otCut: Date.UTC(2026, 9, 25) })] });
    await runProofLoop(db, orgId, new Date('2026-11-23T12:00:00Z'));
    const { items } = await listNotifications(db, { orgId, ...owner });
    expect(items[0]!.kind).toBe('window.verified');
    expect(items[0]!.title).toMatch(/^Verified: Overtime/);
    const mail = await db.select().from(outbox).where(eq(outbox.orgId, orgId));
    expect(mail).toHaveLength(1);
    expect(mail[0]!.toAddress).toBe('owner@example.com');
    expect(mail[0]!.body).toMatch(/Open in Coversight: http/);
  });
});

describe('the outbox', () => {
  it('without a provider, keeps each email as skipped instead of losing it', async () => {
    await emailOn('walnut');
    await notify(db, { orgId, roomId: 'walnut', kind: 'x', title: 'Hello' });
    expect(await deliverOutbox(db, { now: daytime })).toMatchObject({ due: 1, skipped: 1, sent: 0 });
    expect((await listOutbox(db, { orgId, role: 'owner' }))[0]!.status).toBe('skipped');
  });

  it('sends through Resend when configured, and records failures', async () => {
    process.env.RESEND_API_KEY = 're_test'; process.env.MAIL_FROM = 'Coversight <alerts@example.com>';
    await emailOn('walnut');
    await notify(db, { orgId, roomId: 'walnut', kind: 'x', title: 'One' });
    const calls: { url: string; body: { to: string[]; subject: string } }[] = [];
    const ok = (async (url: string, init: { body: string }) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }); }) as unknown as typeof fetch;
    expect(await deliverOutbox(db, { now: daytime, fetchImpl: ok })).toMatchObject({ sent: 1 });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.body.to).toEqual(['owner@example.com']);
    expect(calls[0]!.body.subject).toBe('Coversight: One');
    await notify(db, { orgId, roomId: 'walnut', kind: 'x', title: 'Two' });
    const bad = (async () => new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 })) as unknown as typeof fetch;
    expect(await deliverOutbox(db, { now: daytime, fetchImpl: bad })).toMatchObject({ failed: 1 });
    const rows = await listOutbox(db, { orgId, role: 'owner' });
    expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'sent']);
    expect(rows.find((r) => r.status === 'failed')!.error).toBe('domain not verified');
  });

  it('holds email during quiet hours and sends it in the morning', async () => {
    process.env.RESEND_API_KEY = 're_test'; process.env.MAIL_FROM = 'a@example.com';
    expect(isQuiet(new Date('2026-11-11T07:00:00Z'))).toBe(true); // 11 pm Pacific
    expect(isQuiet(daytime)).toBe(false);
    await emailOn('walnut', true);
    await db.insert(outbox).values({ orgId, channel: 'email', kind: 'x', toAddress: 'owner@example.com', subject: 's', body: 'b', status: 'held' });
    const ok = (async () => new Response('{"id":"e"}', { status: 200 })) as unknown as typeof fetch;
    expect(await deliverOutbox(db, { now: new Date('2026-11-11T07:00:00Z'), fetchImpl: ok })).toMatchObject({ due: 0 });
    expect(await deliverOutbox(db, { now: new Date('2026-11-11T16:00:00Z'), fetchImpl: ok })).toMatchObject({ sent: 1 });
  });

  it('drafts an email with no address for the operator to send, and refuses junk', async () => {
    const d = await draftEmail(db, { orgId, userId: 'u1' }, { kind: 'vendor', subject: 'Credit request', body: 'Please credit…' });
    expect(d.status).toBe('draft');
    await expect(draftEmail(db, { orgId, userId: 'u1' }, { kind: 'vendor', toAddress: 'not-an-email', subject: 's', body: 'b' })).rejects.toThrow(/invalid email/);
    await expect(draftEmail(db, { orgId, userId: 'u1' }, { kind: 'spam', subject: 's', body: 'b' })).rejects.toThrow(/invalid email/);
    await expect(listOutbox(db, { orgId, role: 'gm' })).rejects.toThrow(/owner or admin/);
  });

  it('never emails a sample guest', async () => {
    await db.insert(users).values({ id: 'g', name: 'Guest', email: 'x@sample.coversight.local', isAnonymous: true });
    await db.insert(memberships).values({ orgId, userId: 'g', role: 'admin', rooms: null });
    await emailOn('oakland');
    await notify(db, { orgId, roomId: 'oakland', kind: 'x', title: 'T' });
    expect((await db.select().from(outbox)).map((m) => m.toAddress)).toEqual(['owner@example.com']);
    expect((await db.select().from(notifications)).length).toBe(1);
  });
});
