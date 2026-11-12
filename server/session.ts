// Who is asking, and which org they're looking at. Better Auth says who; our
// memberships say what they can see. A "try the sample" visitor (anonymous)
// with no org yet gets a private copy of the sample group on first load.
import { asc, eq, sql } from 'drizzle-orm';

import { getAuth } from './auth';
import { getDb, type Db } from './db/client';
import { memberships } from './db/schema';
import { createSampleOrg } from './org';

export type Viewer = { userId: string; anonymous: boolean; orgId: string; role: 'owner' | 'gm' | 'admin'; rooms: string[] | null };

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

export async function viewerFor(headers: Headers, db: Db = getDb()): Promise<Viewer> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) throw new AuthError(401, 'Sign in to see Coversight.');
  const userId = session.user.id;
  const all = await db.select().from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.createdAt));
  // The group picked in the switcher (cookie), if this person still belongs to it; else their first.
  const want = orgCookie(headers);
  let m = all.find((x) => x.orgId === want) ?? all[0];
  if (!m) {
    // Every new account starts on its own copy of the sample group, so every
    // page works on day one; connecting Toast replaces it with real data.
    // Serialised per user so two first loads at once can't make two orgs.
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
      const [again] = await tx.select().from(memberships).where(eq(memberships.userId, userId));
      if (!again) await createSampleOrg(tx as unknown as Db, { ownerId: userId, inTx: true });
    });
    [m] = await db.select().from(memberships).where(eq(memberships.userId, userId));
    if (!m) throw new AuthError(403, 'No organization for this account.');
  }
  return { userId, anonymous: !!(session.user as { isAnonymous?: boolean }).isAnonymous, orgId: m.orgId, role: m.role, rooms: m.rooms ?? null };
}

export const ORG_COOKIE = 'cv-org';
export function orgCookie(headers: Headers) {
  const m = /(?:^|;\s*)cv-org=([0-9a-f-]{36})/.exec(headers.get('cookie') ?? '');
  return m ? m[1] : null;
}
/** Set-Cookie for the group switcher (or clear it with null). */
export function setOrgCookie(orgId: string | null) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return orgId ? `${ORG_COOKIE}=${orgId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}` : `${ORG_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** Turn a thrown error into a JSON response. */
export function errorResponse(err: unknown) {
  if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
  const e = err as { name?: string; message?: string };
  if (e?.name === 'InputError') return Response.json({ error: e.message }, { status: 400 });
  console.error(err);
  return Response.json({ error: 'Something went wrong on our side.' }, { status: 500 });
}
