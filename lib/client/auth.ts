import { anonymousClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Browser side of the logins: same origin, /api/auth. */
export const authClient = createAuthClient({ basePath: '/api/auth', plugins: [anonymousClient()] });
