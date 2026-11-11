// Groups and people: start your own group, switch between groups, invite an
// owner/GM/admin by link, change roles and rooms, remove someone, export
// everything, delete the group.
import { createHash, randomBytes } from 'node:crypto';

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { SEED } from '../lib/data/seed.js';
import type { Db } from './db/client';
import {
  actions, auditLog, checkpoints, inputs, invites, memberships, notifications, orgs, outbox, roomData, rooms, snapshots, tasks, testWindows, users,
} from './db/schema';
import { notify } from './notify';
import { InputError } from './org';
import { AuthError, type Viewer } from './session';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
const manage = (v: V) => { if (v.role === 'gm') throw new AuthError(403, 'Only an owner or admin can manage the team.'); };
const ownerOnly = (v: V) => { if (v.role !== 'owner') throw new AuthError(403, 'Only an owner can do this.'); };
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'room';

/* ------------------------------------------------------------------ groups */
const newGroup = z.object({
  name: z.string().trim().min(2).max(80),
  rooms: z.array(z.object({ name: z.string().trim().min(1).max(60), seats: z.number().int().min(1).max(2000) })).min(1).max(12),
});

/**
 * Your own group. Each room starts from a sample room's structure, renamed,
 * so every page works on day one; it's marked as waiting for its own data,
 * and loading its Toast exports replaces the numbers with its own.
 */
export async function createOwnOrg(db: Db, userId: string, input: unknown) {
  const p = newGroup.safeParse(input);
  if (!p.success) throw new InputError(`invalid group: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  const seed = SEED as unknown as { rooms: Record<string, Record<string, unknown>>; locs: { id: string; name: string; short: string }[] } & Record<string, unknown>;
  const { rooms: seedRooms, locs, ...meta } = seed;
  const templates = Object.keys(seedRooms);
  const used = new Set<string>(['all']);
  const ids = p.data.rooms.map((r) => { let id = slug(r.name); while (used.has(id)) id += '-2'; used.add(id); return id; });
  return db.transaction(async (tx) => {
    // No verified results yet: the sample's packets belong to the sample's rooms.
    const [org] = await tx.insert(orgs).values({ name: p.data.name, sample: false, meta: { ...meta, proof: [], own: true } }).returning();
    await tx.insert(memberships).values({ orgId: org!.id, userId, role: 'owner', rooms: null });
    const allLoc = locs.find((l) => l.id === 'all');
    const locRows = [
      ...(allLoc ? [{ ...allLoc, name: `All of ${p.data.name}`, short: 'All rooms' }] : []),
      ...p.data.rooms.map((r, i) => ({ ...(locs.find((l) => l.id === templates[i % templates.length]) ?? {}), id: ids[i], name: r.name, short: r.name.split(/\s+/).slice(0, 2).join(' ') })),
    ];
    await tx.insert(rooms).values(locRows.map((loc, i) => ({ orgId: org!.id, id: String(loc.id), position: i, loc })));
    const data = p.data.rooms.flatMap((r, i) => {
      const tpl = seedRooms[templates[i % templates.length]!]!;
      return Object.entries(tpl).filter(([k]) => k !== 'id').map(([kind, d]) => ({
        orgId: org!.id, roomId: ids[i]!, kind,
        data: (kind === 'profile' ? { ...(d as object), id: ids[i], name: r.name, short: r.name.split(/\s+/).slice(0, 2).join(' '), seats: r.seats, gm: '', awaitingData: true } : d) as object,
      }));
    });
    await tx.insert(roomData).values(data);
    await tx.insert(auditLog).values({ orgId: org!.id, userId, action: 'org.created', detail: { sample: false, rooms: ids } });
    return org!;
  });
}

export async function listOrgs(db: Db, userId: string) {
  return db.select({ id: orgs.id, name: orgs.name, sample: orgs.sample, role: memberships.role })
    .from(memberships).innerJoin(orgs, eq(orgs.id, memberships.orgId)).where(eq(memberships.userId, userId)).orderBy(asc(orgs.createdAt));
}

/* ------------------------------------------------------------------ people */
export async function listMembers(db: Db, v: V) {
  const people = await db.select({ userId: memberships.userId, role: memberships.role, rooms: memberships.rooms, name: users.name, email: users.email, guest: users.isAnonymous, since: memberships.createdAt })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, v.orgId)).orderBy(asc(memberships.createdAt));
  const pending = v.role === 'gm' ? [] : await db.select({ id: invites.id, role: invites.role, rooms: invites.rooms, email: invites.email, createdAt: invites.createdAt, expiresAt: invites.expiresAt })
    .from(invites).where(and(eq(invites.orgId, v.orgId), isNull(invites.acceptedAt), isNull(invites.revokedAt))).orderBy(asc(invites.createdAt));
  return { people: people.map((p) => ({ ...p, email: p.guest ? null : p.email, you: p.userId === v.userId })), invites: pending.filter((i) => i.expiresAt > new Date()) };
}

const roleBody = z.object({ role: z.enum(['owner', 'gm', 'admin']), rooms: z.array(z.string().min(1).max(60)).max(50).nullable().optional() });

async function checkRooms(db: Db, orgId: string, role: string, list: string[] | null | undefined) {
  if (role !== 'gm') return null;
  if (!list?.length) throw new InputError('A GM needs at least one room.');
  const have = (await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.orgId, orgId))).map((r) => r.id).filter((id) => id !== 'all');
  const bad = list.filter((r) => !have.includes(r));
  if (bad.length) throw new InputError(`no room '${bad[0]}' in this group`);
  return [...new Set(list)];
}

export async function createInvite(db: Db, v: V, input: unknown) {
  manage(v);
  const p = roleBody.extend({ email: z.string().trim().email().max(200).nullable().optional() }).safeParse(input);
  if (!p.success) throw new InputError(`invalid invite: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
  if (p.data.role === 'owner' && v.role !== 'owner') throw new AuthError(403, 'Only an owner can invite another owner.');
  const roomList = await checkRooms(db, v.orgId, p.data.role, p.data.rooms);
  const token = randomBytes(24).toString('base64url');
  const [row] = await db.insert(invites).values({
    orgId: v.orgId, role: p.data.role, rooms: roomList, email: p.data.email ?? null, tokenHash: hash(token), createdBy: v.userId, expiresAt: new Date(Date.now() + 14 * 864e5),
  }).returning();
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'invite.created', detail: { id: row!.id, role: p.data.role, rooms: roomList } });
  if (p.data.email) {
    const [org] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, v.orgId));
    await db.insert(outbox).values({ orgId: v.orgId, channel: 'email', kind: 'invite', toAddress: p.data.email, subject: `You're invited to ${org!.name} on Coversight`, body: `Join as ${p.data.role === 'gm' ? 'GM' : p.data.role}: ${linkFor(token)}\n\nThe link works once and expires in 14 days.`, createdBy: v.userId });
  }
  return { invite: row!, token, link: linkFor(token) };
}

export const linkFor = (token: string) => `/join/${token}/`;

export async function revokeInvite(db: Db, v: V, id: string) {
  manage(v);
  const res = await db.update(invites).set({ revokedAt: new Date() }).where(and(eq(invites.orgId, v.orgId), eq(invites.id, id), isNull(invites.acceptedAt))).returning({ id: invites.id });
  if (!res.length) throw new InputError('no such open invite');
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'invite.revoked', detail: { id } });
}

/** What an invite link is for, before accepting (shown on /join). */
export async function peekInvite(db: Db, token: string) {
  const [i] = await db.select({ role: invites.role, rooms: invites.rooms, expiresAt: invites.expiresAt, acceptedAt: invites.acceptedAt, revokedAt: invites.revokedAt, org: orgs.name })
    .from(invites).innerJoin(orgs, eq(orgs.id, invites.orgId)).where(eq(invites.tokenHash, hash(token)));
  if (!i || i.revokedAt || i.acceptedAt || i.expiresAt < new Date()) return null;
  return { org: i.org, role: i.role, rooms: i.rooms };
}

export async function acceptInvite(db: Db, userId: string, anonymous: boolean, token: unknown) {
  if (typeof token !== 'string' || token.length < 20) throw new InputError('invalid invite link');
  if (anonymous) throw new AuthError(403, 'Create an account (or sign in) to join a group. Sample guests can’t.');
  return db.transaction(async (tx) => {
    const [i] = await tx.select().from(invites).where(eq(invites.tokenHash, hash(token))).for('update');
    if (!i || i.revokedAt || i.acceptedAt || i.expiresAt < new Date()) throw new InputError('This invite link has expired or was already used.');
    const [existing] = await tx.select().from(memberships).where(and(eq(memberships.orgId, i.orgId), eq(memberships.userId, userId)));
    if (!existing) await tx.insert(memberships).values({ orgId: i.orgId, userId, role: i.role, rooms: i.rooms ?? null });
    await tx.update(invites).set({ acceptedBy: userId, acceptedAt: new Date() }).where(eq(invites.id, i.id));
    await tx.insert(auditLog).values({ orgId: i.orgId, userId, action: 'invite.accepted', detail: { id: i.id, role: i.role, already: !!existing } });
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await notify(tx as unknown as Db, { orgId: i.orgId, kind: 'team.joined', title: `${u?.name ?? 'Someone'} joined as ${i.role === 'gm' ? 'GM' : i.role}`, link: '/team/', dedupe: `team.joined:${i.id}` });
    return { orgId: i.orgId };
  });
}

async function ownersLeft(db: Db, orgId: string, except: string) {
  const owners = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
  return owners.filter((o) => o.userId !== except).length;
}

export async function updateMember(db: Db, v: V, userId: string, input: unknown) {
  manage(v);
  const p = roleBody.safeParse(input);
  if (!p.success) throw new InputError(`invalid role: ${p.error.issues[0]?.message}`);
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, v.orgId), eq(memberships.userId, userId)));
  if (!m) throw new InputError('not a member of this group');
  if ((m.role === 'owner' || p.data.role === 'owner') && v.role !== 'owner') throw new AuthError(403, 'Only an owner can change an owner.');
  if (m.role === 'owner' && p.data.role !== 'owner' && !(await ownersLeft(db, v.orgId, userId))) throw new InputError('A group needs at least one owner.');
  const roomList = await checkRooms(db, v.orgId, p.data.role, p.data.rooms);
  await db.update(memberships).set({ role: p.data.role, rooms: roomList }).where(and(eq(memberships.orgId, v.orgId), eq(memberships.userId, userId)));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'member.updated', detail: { userId, role: p.data.role, rooms: roomList } });
}

export async function removeMember(db: Db, v: V, userId: string) {
  if (userId !== v.userId) manage(v);
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, v.orgId), eq(memberships.userId, userId)));
  if (!m) throw new InputError('not a member of this group');
  if (m.role === 'owner' && v.role !== 'owner') throw new AuthError(403, 'Only an owner can remove an owner.');
  if (m.role === 'owner' && !(await ownersLeft(db, v.orgId, userId))) throw new InputError('A group needs at least one owner. Delete the group instead.');
  await db.delete(memberships).where(and(eq(memberships.orgId, v.orgId), eq(memberships.userId, userId)));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'member.removed', detail: { userId } });
}

/* ------------------------------------------------------------------ export / delete */
/**
 * Everything the group owns, as plain JSON. Never: password hashes, sessions,
 * invite tokens (only their existence), other groups' data, or provider keys.
 */
export async function exportOrg(db: Db, v: V) {
  ownerOnly(v);
  const [org] = await db.select().from(orgs).where(eq(orgs.id, v.orgId));
  const w = await db.select().from(testWindows).where(eq(testWindows.orgId, v.orgId));
  const wIds = w.map((x) => x.id);
  const out = {
    format: 'coversight-export/v2',
    exportedAt: new Date().toISOString(),
    org: { id: org!.id, name: org!.name, sample: org!.sample, createdAt: org!.createdAt },
    members: (await listMembers(db, { ...v, role: 'owner' })).people.map(({ name, email, role, rooms: r, since }) => ({ name, email, role, rooms: r, since })),
    rooms: await db.select({ id: rooms.id, position: rooms.position, loc: rooms.loc }).from(rooms).where(eq(rooms.orgId, v.orgId)).orderBy(asc(rooms.position)),
    roomData: await db.select({ roomId: roomData.roomId, kind: roomData.kind, data: roomData.data }).from(roomData).where(eq(roomData.orgId, v.orgId)),
    inputs: await db.select({ id: inputs.id, roomId: inputs.roomId, kind: inputs.kind, rows: inputs.rows, opts: inputs.opts, summary: inputs.summary, undone: inputs.undone, createdAt: inputs.createdAt }).from(inputs).where(eq(inputs.orgId, v.orgId)),
    decisions: await db.select({ roomId: actions.roomId, key: actions.key, value: actions.value, summary: actions.summary, at: actions.at }).from(actions).where(eq(actions.orgId, v.orgId)),
    testWindows: w,
    checkpoints: wIds.length ? await db.select().from(checkpoints).where(inArray(checkpoints.windowId, wIds)) : [],
    tasks: await db.select().from(tasks).where(eq(tasks.orgId, v.orgId)),
    snapshots: await db.select().from(snapshots).where(eq(snapshots.orgId, v.orgId)),
    notifications: await db.select().from(notifications).where(eq(notifications.orgId, v.orgId)),
    emails: await db.select({ kind: outbox.kind, toAddress: outbox.toAddress, subject: outbox.subject, status: outbox.status, createdAt: outbox.createdAt, sentAt: outbox.sentAt }).from(outbox).where(eq(outbox.orgId, v.orgId)),
    auditLog: await db.select({ action: auditLog.action, detail: auditLog.detail, at: auditLog.at }).from(auditLog).where(eq(auditLog.orgId, v.orgId)).orderBy(asc(auditLog.at)),
  };
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'org.exported', detail: {} });
  return out;
}

/** Deletes the group and everything it owns (one statement; children cascade). Logins stay. */
export async function deleteOrg(db: Db, v: V, confirm: unknown) {
  ownerOnly(v);
  const [org] = await db.select().from(orgs).where(eq(orgs.id, v.orgId));
  if (!org) throw new InputError('no such group');
  if (confirm !== org.name) throw new InputError('Type the group’s exact name to confirm.');
  await db.delete(orgs).where(eq(orgs.id, v.orgId));
  return { deleted: org.name };
}
