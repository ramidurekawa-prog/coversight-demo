import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { applyInputs } from '../lib/data/apply.js';
import { deriveRoom } from '../lib/data/model.js';
import { getAuth } from '../server/auth';
import type { Db } from '../server/db/client';
import { auditLog, memberships, orgs } from '../server/db/schema';
import { commitInput, createSampleOrg, InputError, loadBase, loadInputs, resetInputs, undoInput } from '../server/org';
import { viewerFor } from '../server/session';
import { loadActions, saveAction } from '../server/actions';
import { freshDb } from './helpers/db';

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});

/** Sign up through Better Auth and return the session cookie as request headers. */
async function signUp(email = 'owner@example.com') {
  const res = await getAuth().api.signUpEmail({ body: { email, password: 'correct horse battery', name: 'Owner' }, asResponse: true });
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  return new Headers({ cookie });
}

describe('the sample org in the database', () => {
  it('round-trips the sample group exactly: every figure computes the same from the database', async () => {
    const { users } = await import('../server/db/schema');
    await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    const loaded = await loadBase(db, org.id);
    expect(loaded!.org.sample).toBe(true);
    expect(JSON.parse(JSON.stringify(loaded!.base))).toEqual(JSON.parse(JSON.stringify(SEED)));
    expect(Object.keys(loaded!.base.rooms)).toEqual(Object.keys(SEED.rooms));
    for (const id of ['oakland', 'berkeley', 'walnut']) {
      expect(deriveRoom(loaded!.base, id).exposure).toEqual(deriveRoom(SEED, id).exposure);
    }
  });

  it('scopes rooms for a GM', async () => {
    const { users } = await import('../server/db/schema');
    await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    const loaded = await loadBase(db, org.id, ['berkeley']);
    expect(Object.keys(loaded!.base.rooms)).toEqual(['berkeley']);
    expect((loaded!.base.locs as { id: string }[]).map((l) => l.id)).toEqual(['berkeley']);
  });
});

describe('inputs', () => {
  async function org() {
    const { users } = await import('../server/db/schema');
    await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
    return (await createSampleOrg(db, { ownerId: 'u1' })).id;
  }

  it('commit, undo and reset, with the latest live entry applying', async () => {
    const orgId = await org();
    const a = await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'waste', rows: [{ item: 'Salmon', qty: 2 }], summary: 'first' });
    await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'waste', rows: [{ item: 'Salmon', qty: 5 }, { item: 'Lettuce', qty: 1 }], summary: 'second' });
    let s = await loadInputs(db, orgId);
    expect(s.inputs.oakland!.waste!.n).toBe(2);
    expect(s.log.map((e) => e.summary)).toEqual(['second', 'first']);
    const second = s.log[0]!.id;
    await undoInput(db, { orgId, userId: 'u1', id: second });
    s = await loadInputs(db, orgId);
    expect(s.inputs.oakland!.waste!.n).toBe(1); // back to the first
    await resetInputs(db, { orgId, userId: 'u1' });
    expect((await loadInputs(db, orgId)).inputs).toEqual({});
    void a;
    const actions = (await db.select().from(auditLog).where(eq(auditLog.orgId, orgId))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['org.created', 'input.committed', 'input.undone', 'input.reset']));
  });

  it('refuses unknown kinds, other rooms and non-record rows', async () => {
    const orgId = await org();
    await expect(commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'payroll', rows: [] })).rejects.toBeInstanceOf(InputError);
    await expect(commitInput(db, { orgId, userId: 'u1', roomId: 'paris', kind: 'waste', rows: [] })).rejects.toThrow(/no room/);
    await expect(commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'waste', rows: [1, 2] })).rejects.toThrow(/records/);
  });

  it('inputs from the database feed the same model as the browser engine', async () => {
    const orgId = await org();
    const rows = [{ item: 'Grilled Salmon', cost: 13.4 }];
    await commitInput(db, { orgId, userId: 'u1', roomId: 'oakland', kind: 'recipes', rows });
    const { base } = (await loadBase(db, orgId))!;
    const { inputs } = await loadInputs(db, orgId);
    const fromDb = applyInputs(base, inputs);
    const fromBrowser = applyInputs(SEED, { oakland: { recipes: { rows } } });
    expect(deriveRoom(fromDb, 'oakland').exposure).toEqual(deriveRoom(fromBrowser, 'oakland').exposure);
  });
});

describe('logins', () => {
  it('a new account gets its own copy of the sample group on first load, once', async () => {
    const headers = await signUp();
    const [v1, v2] = await Promise.all([viewerFor(headers, db), viewerFor(headers, db)]);
    expect(v1.orgId).toBe(v2.orgId);
    expect(v1.role).toBe('owner');
    expect((await db.select().from(orgs)).length).toBe(1);
    expect((await db.select().from(memberships)).length).toBe(1);
  });

  it('two accounts never see each other’s org', async () => {
    const a = await viewerFor(await signUp('a@example.com'), db);
    const b = await viewerFor(await signUp('b@example.com'), db);
    expect(a.orgId).not.toBe(b.orgId);
  });

  it('“try the sample” signs in without a password and gets a private sample', async () => {
    const res = await getAuth().api.signInAnonymous({ asResponse: true });
    const headers = new Headers({ cookie: res.headers.get('set-cookie')!.split(';')[0]! });
    const v = await viewerFor(headers, db);
    expect(v.anonymous).toBe(true);
    expect((await loadBase(db, v.orgId))!.org.sample).toBe(true);
  });

  it('no session → 401', async () => {
    await expect(viewerFor(new Headers(), db)).rejects.toMatchObject({ status: 401 });
  });
});

describe('operator decisions', () => {
  async function owner() {
    const { users } = await import('../server/db/schema');
    await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    return { orgId: org.id, userId: 'u1', role: 'owner' as const, rooms: null };
  }

  it('saves per room, the newest value wins, and every save is audited', async () => {
    const v = await owner();
    await saveAction(db, v, { roomId: 'oakland', key: 'plan', value: { hours: 2 } });
    await saveAction(db, v, { roomId: 'oakland', key: 'plan', value: { hours: 3.5 }, summary: 'more hours' });
    await saveAction(db, v, { roomId: 'berkeley', key: 'service', value: 'no' });
    await saveAction(db, v, { roomId: 'ignored', key: 'billing', value: { status: 'approved', at: '2026-10-27T00:00:00.000Z' } });
    const acts = await loadActions(db, v.orgId);
    expect(acts).toEqual({
      oakland: { plan: { hours: 3.5 } },
      berkeley: { service: 'no' },
      '': { billing: { status: 'approved', at: '2026-10-27T00:00:00.000Z' } },
    });
    const audit = await db.select().from(auditLog).where(eq(auditLog.orgId, v.orgId));
    expect(audit.filter((a) => a.action.startsWith('action.')).map((a) => a.action)).toEqual(['action.plan', 'action.plan', 'action.service', 'action.billing']);
  });

  it('a nullable decision can be cleared', async () => {
    const v = await owner();
    await saveAction(db, v, { roomId: 'oakland', key: 'meeting', value: { log: ['Plan: committed'], at: '2026-11-03T17:15:00.000Z' } });
    await saveAction(db, v, { roomId: 'oakland', key: 'meeting', value: null });
    expect((await loadActions(db, v.orgId)).oakland).toEqual({ meeting: null });
  });

  it('refuses unknown keys, bad values, unknown rooms, and oversize values', async () => {
    const v = await owner();
    await expect(saveAction(db, v, { roomId: 'oakland', key: 'nope', value: 1 })).rejects.toThrow(InputError);
    await expect(saveAction(db, v, { roomId: 'oakland', key: 'plan', value: { hours: 40 } })).rejects.toThrow(/invalid plan/);
    await expect(saveAction(db, v, { roomId: 'oakland', key: 'service', value: 'maybe' })).rejects.toThrow(/invalid service/);
    await expect(saveAction(db, v, { roomId: 'paris', key: 'plan', value: { hours: 2 } })).rejects.toThrow(/no room/);
    const big = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`card-${i}`, '2026-11-03T17:15:00.000Z']));
    await expect(saveAction(db, v, { roomId: 'oakland', key: 'findings', value: big })).rejects.toThrow(/too large/);
    expect(await loadActions(db, v.orgId)).toEqual({});
  });

  it('a GM writes only their rooms and never group decisions, and reads only their rooms', async () => {
    const v = await owner();
    await saveAction(db, v, { roomId: 'oakland', key: 'service', value: 'yes' });
    const gm = { ...v, userId: 'u1', role: 'gm' as const, rooms: ['berkeley'] };
    await expect(saveAction(db, gm, { roomId: 'oakland', key: 'service', value: 'no' })).rejects.toThrow(/not one of yours/);
    await expect(saveAction(db, gm, { roomId: 'berkeley', key: 'billing', value: { status: 'approved' } })).rejects.toThrow(/owner or admin/);
    await saveAction(db, gm, { roomId: 'berkeley', key: 'service', value: 'no' });
    expect(await loadActions(db, v.orgId, gm.rooms)).toEqual({ berkeley: { service: 'no' } });
  });

  it('/api/state carries the signed-in org’s decisions', async () => {
    const headers = await signUp();
    const v = await viewerFor(headers, db);
    await saveAction(db, v, { roomId: 'walnut', key: 'queue', value: { done: { q1: '2026-11-03T17:15:00.000Z' }, refused: {} } });
    const { GET } = await import('../app/api/state/route');
    const body = await (await GET(new Request('http://localhost/api/state', { headers }))).json();
    expect(body.actions).toEqual({ walnut: { queue: { done: { q1: '2026-11-03T17:15:00.000Z' }, refused: {} } } });
  });
});

describe('Toast export import', () => {
  it('saves a valid summary, rejects a tampered one, and the figures read it back', async () => {
    const { readToastExports } = await import('../lib/data/toast.js');
    const { toastFixture } = await import('./helpers/toast-fixture.js');
    const files = toastFixture();
    const { unknown, ...summary } = readToastExports(Object.entries(files).map(([name, text]) => ({ name, text })));
    const { users } = await import('../server/db/schema');
    await db.insert(users).values({ id: 'u1', name: 'U', email: 'u@x.co' });
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    const v = { orgId: org.id, userId: 'u1' };
    // Round-trip through JSON, as the browser sends it.
    const sent = JSON.parse(JSON.stringify(summary));
    await commitInput(db, { ...v, roomId: 'berkeley', kind: 'toast', rows: [sent] });
    const tampered = { ...sent, toast: { ...sent.toast, wage: 1e9 } };
    await expect(commitInput(db, { ...v, roomId: 'berkeley', kind: 'toast', rows: [tampered] })).rejects.toThrow(/invalid Toast summary: toast.wage/);
    await expect(commitInput(db, { ...v, roomId: 'berkeley', kind: 'toast', rows: [sent, sent] })).rejects.toThrow(/exactly one/);
    const { inputs } = await loadInputs(db, org.id);
    const base = (await loadBase(db, org.id))!.base;
    const room = applyInputs(base, inputs).rooms.berkeley;
    expect(room.fromToast.weeks).toBe(13);
    expect(room.staff.map((p: { name: string }) => p.name)).toContain('Ana P.');
    expect(deriveRoom(applyInputs(base, inputs), 'berkeley').week.net).toBeGreaterThan(0);
  });
});

describe('activity feed', () => {
  it('reads the audit log in plain words, scoped for a GM', async () => {
    const { activity } = await import('../server/activity');
    const { users } = await import('../server/db/schema');
    await db.insert(users).values({ id: 'u1', name: 'Maria', email: 'm@x.co' });
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    await commitInput(db, { orgId: org.id, userId: 'u1', roomId: 'oakland', kind: 'waste', rows: [{ item: 'Salmon', qty: 1, reason: 'spoiled' }] });
    await saveAction(db, { orgId: org.id, userId: 'u1', role: 'owner', rooms: null }, { roomId: 'berkeley', key: 'autonomy', value: { Labour: 2 }, summary: 'Autonomy changed' });
    const all = await activity(db, { orgId: org.id, rooms: null });
    expect(all.map((a) => a.what)).toEqual(['decided: Autonomy changed', 'entered data', 'created the group']);
    expect(all[0]!.who).toBe('Maria');
    const gm = await activity(db, { orgId: org.id, rooms: ['berkeley'] });
    expect(gm.map((a) => a.what)).toEqual(['decided: Autonomy changed', 'created the group']);
  });
});
