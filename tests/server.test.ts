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
