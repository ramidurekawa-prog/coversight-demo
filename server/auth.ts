// Logins. Better Auth owns users, sessions and passwords; which org a person
// can see and what they can do there is ours (server/session.ts).
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous } from 'better-auth/plugins/anonymous';

import { getDb } from './db/client';
import { accounts, memberships, outbox, sessions, users, verifications } from './db/schema';
import { eq } from 'drizzle-orm';

let cached: ReturnType<typeof makeAuth> | null = null;

function makeAuth() {
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET ?? (process.env.NODE_ENV === 'production' ? undefined : 'dev-only-secret-change-me-0123456789'),
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'http://localhost:3000',
    basePath: '/api/auth',
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    emailAndPassword: {
      enabled: true, minPasswordLength: 10, autoSignIn: true,
      // The reset link goes through the outbox, so it's sent when email is set up
      // (RESEND_API_KEY) and kept, never lost, when it isn't.
      sendResetPassword: async ({ user, url }) => {
        const db = getDb();
        const [m] = await db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, user.id)).limit(1);
        if (!m) return;
        await db.insert(outbox).values({ orgId: m.orgId, channel: 'email', kind: 'password-reset', toAddress: user.email, toUserId: user.id, subject: 'Reset your Coversight password', body: `Choose a new password: ${url}\n\nThe link works for an hour. If you didn't ask for this, ignore this email.` });
        const { deliverOutbox } = await import('./notify');
        await deliverOutbox(db).catch(() => null);
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { window: 60, max: 100, customRules: { '/sign-in/email': { window: 60, max: 5 } } },
    // "Try the sample": a visitor with no password gets a session and, on first
    // load, a private copy of the sample group (server/session.ts).
    plugins: [anonymous({ emailDomainName: 'sample.coversight.local' })],
  });
}

export function getAuth() {
  cached ??= makeAuth();
  return cached;
}

/** Tests build a fresh instance against their database. */
export function resetAuth() {
  cached = null;
}
