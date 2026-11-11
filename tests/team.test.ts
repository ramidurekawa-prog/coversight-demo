import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import * as core from '../components/screens/core.jsx';
import { deriveRoom } from '../lib/data/model.js';
import { getAuth } from '../server/auth';
import type { Db } from '../server/db/client';
import { auditLog, inputs, invites, memberships, orgs, outbox, roomData, users } from '../server/db/schema';
import { loadDataset } from '../server/dataset';
import { commitInput, createSampleOrg } from '../server/org';
import { orgCookie, setOrgCookie, viewerFor } from '../server/session';
import { acceptInvite, createInvite, createOwnOrg, deleteOrg, exportOrg, listMembers, listOrgs, peekInvite, removeMember, revokeInvite, updateMember } from '../server/team';
import { freshDb } from './helpers/db';

let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values([{ id: 'u1', name: 'Owner', email: 'owner@example.com' }, { id: 'u2', name: 'Gina', email: 'gina@example.com' }, { id: 'u3', name: 'Al', email: 'al@example.com' }]);
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
const group = { name: 'Harbor Hospitality', rooms: [{ name: 'Harbor Grill', seats: 90 }, { name: 'Pier 9 Café', seats: 40 }] };

describe('your own group', () => {
  it('creates rooms from your names, works on every figure today, and holds no sample verifications', async () => {
    const org = await createOwnOrg(db, 'u1', group);
    expect(org.sample).toBe(false);
    const { ds } = (await loadDataset(db, org.id))!;
    expect(Object.keys(ds.rooms)).toEqual(['harbor-grill', 'pier-9-caf']);
    expect(ds.rooms['harbor-grill'].profile).toMatchObject({ name: 'Harbor Grill', seats: 90, awaitingData: true });
    expect(ds.proof).toEqual([]);
    expect(deriveRoom(ds, 'pier-9-caf').week.net).toBeGreaterThan(0);
    // The screens' loader runs on it too.
    core.cvLoad(ds, 'harbor-grill');
    const c = core as unknown as { CV_D: { profile: { name: string } }; CV_GROUP: unknown };
    expect(c.CV_D.profile.name).toBe('Harbor Grill');
    expect(c.CV_GROUP).toBeTruthy();
    expect((await listOrgs(db, 'u1')).map((o) => o.name)).toEqual(['Rosewood Restaurant Group (sample)', 'Harbor Hospitality']);
  });

  it('refuses a group with no rooms or junk names', async () => {
    await expect(createOwnOrg(db, 'u1', { name: 'X', rooms: [] })).rejects.toThrow(/invalid group/);
    await expect(createOwnOrg(db, 'u1', { name: 'Fine', rooms: Array.from({ length: 13 }, (_, i) => ({ name: `R${i}`, seats: 10 })) })).rejects.toThrow(/invalid group/);
  });

  it('the switcher cookie picks which group you see, and only yours', async () => {
    const own = await createOwnOrg(db, 'u1', group);
    const res = await getAuth().api.signUpEmail({ body: { email: 'z@example.com', password: 'correct horse battery', name: 'Z' }, asResponse: true });
    const session = res.headers.get('set-cookie')!.split(';')[0]!;
    const first = await viewerFor(new Headers({ cookie: session }), db);
    expect(first.orgId).not.toBe(own.id); // Z isn't in Harbor
    expect(orgCookie(new Headers({ cookie: `a=b; cv-org=${own.id}` }))).toBe(own.id);
    expect(setOrgCookie(own.id)).toMatch(/^cv-org=.*HttpOnly; SameSite=Lax/);
    const tricked = await viewerFor(new Headers({ cookie: `${session}; cv-org=${own.id}` }), db);
    expect(tricked.orgId).toBe(first.orgId);
  });
});

describe('invites and roles', () => {
  it('a GM invite link works once, joins with the right rooms, and only a hash is stored', async () => {
    const { token, link } = await createInvite(db, owner(), { role: 'gm', rooms: ['berkeley'], email: 'gina@example.com' });
    expect(link).toBe(`/join/${token}/`);
    const [row] = await db.select().from(invites);
    expect(row!.tokenHash).not.toContain(token);
    expect(await peekInvite(db, token)).toEqual({ org: 'Rosewood Restaurant Group (sample)', role: 'gm', rooms: ['berkeley'] });
    expect((await db.select().from(outbox).where(eq(outbox.kind, 'invite')))[0]!.toAddress).toBe('gina@example.com');
    await expect(acceptInvite(db, 'u2', true, token)).rejects.toThrow(/Create an account/);
    expect(await acceptInvite(db, 'u2', false, token)).toEqual({ orgId });
    await expect(acceptInvite(db, 'u3', false, token)).rejects.toThrow(/expired or was already used/);
    expect(await peekInvite(db, token)).toBeNull();
    const m = (await listMembers(db, owner())).people.find((p) => p.userId === 'u2')!;
    expect(m).toMatchObject({ role: 'gm', rooms: ['berkeley'] });
    // The GM sees only Berkeley.
    const { ds } = (await loadDataset(db, orgId, ['berkeley']))!;
    expect(Object.keys(ds.rooms)).toEqual(['berkeley']);
  });

  it('who can invite and change what', async () => {
    const gm = { orgId, userId: 'u2', role: 'gm' as const, rooms: ['berkeley'] };
    const admin = { orgId, userId: 'u3', role: 'admin' as const, rooms: null };
    await expect(createInvite(db, gm, { role: 'gm', rooms: ['berkeley'] })).rejects.toThrow(/owner or admin/);
    await expect(createInvite(db, admin, { role: 'owner' })).rejects.toThrow(/Only an owner can invite another owner/);
    await expect(createInvite(db, owner(), { role: 'gm', rooms: [] })).rejects.toThrow(/at least one room/);
    await expect(createInvite(db, owner(), { role: 'gm', rooms: ['paris'] })).rejects.toThrow(/no room 'paris'/);
    const { invite } = await createInvite(db, admin, { role: 'admin' });
    await revokeInvite(db, admin, invite.id);
    expect((await listMembers(db, owner())).invites).toEqual([]);
  });

  it('roles change, the last owner can’t be demoted or removed, and removing keeps the login', async () => {
    await db.insert(memberships).values({ orgId, userId: 'u2', role: 'admin', rooms: null });
    await updateMember(db, owner(), 'u2', { role: 'gm', rooms: ['walnut'] });
    expect((await listMembers(db, owner())).people.find((p) => p.userId === 'u2')).toMatchObject({ role: 'gm', rooms: ['walnut'] });
    await expect(updateMember(db, owner(), 'u1', { role: 'admin' })).rejects.toThrow(/at least one owner/);
    await expect(removeMember(db, owner(), 'u1')).rejects.toThrow(/at least one owner/);
    await expect(updateMember(db, { orgId, userId: 'u2', role: 'gm', rooms: ['walnut'] }, 'u1', { role: 'gm', rooms: ['walnut'] })).rejects.toThrow(/owner or admin/);
    await removeMember(db, owner(), 'u2');
    expect((await listMembers(db, owner())).people.map((p) => p.userId)).toEqual(['u1']);
    expect(await db.select().from(users).where(eq(users.id, 'u2'))).toHaveLength(1);
  });
});

describe('export and delete', () => {
  it('exports everything the group owns, and nothing secret', async () => {
    await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'waste', rows: [{ item: 'Salmon', qty: 2, reason: 'spoiled' }] });
    await createInvite(db, owner(), { role: 'admin' });
    const out = await exportOrg(db, owner());
    expect(out.format).toBe('coversight-export/v2');
    expect(out.rooms.length).toBe(4);
    expect(out.roomData.length).toBeGreaterThan(50);
    expect(out.inputs).toHaveLength(1);
    expect(out.members).toEqual([expect.objectContaining({ email: 'owner@example.com', role: 'owner' })]);
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/token_?hash|password|tokenHash/i);
    await expect(exportOrg(db, { ...owner(), role: 'admin' })).rejects.toThrow(/Only an owner/);
  });

  it('deletes the group and everything in it after typing its name; logins stay', async () => {
    await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'waste', rows: [{ item: 'Salmon', qty: 2, reason: 'spoiled' }] });
    await expect(deleteOrg(db, owner(), 'wrong')).rejects.toThrow(/exact name/);
    expect(await deleteOrg(db, owner(), 'Rosewood Restaurant Group (sample)')).toEqual({ deleted: 'Rosewood Restaurant Group (sample)' });
    for (const t of [orgs, memberships, roomData, inputs, auditLog]) expect(await db.select().from(t)).toEqual([]);
    expect((await db.select().from(users)).length).toBe(3);
  });
});
