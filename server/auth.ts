// Logins. Better Auth owns users, sessions and passwords; which org a person
// can see and what they can do there is ours (server/session.ts).
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous } from 'better-auth/plugins/anonymous';

import { getDb } from './db/client';
import { accounts, sessions, users, verifications } from './db/schema';

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
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true },
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
