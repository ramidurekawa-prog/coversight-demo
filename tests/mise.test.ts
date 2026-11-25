import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BRAIN_MODEL } from '../server/ai/claude';
import { loadMise } from '../server/ai/mise';
import type { Db } from '../server/db/client';
import { auditLog, users } from '../server/db/schema';
import { createSampleOrg } from '../server/org';
import { freshDb } from './helpers/db';
import { fakeClaude } from './helpers/fake-claude';

const NOW = new Date('2026-10-28T03:15:00Z');
let db: Db;
let orgId: string;
const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });

beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values({ id: 'u1', name: 'Maria Reyes', email: 'maria@example.com' });
  orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
});
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });

const logged = async () => db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, 'mise.read')));

describe('Mise, the restaurant’s brain', () => {
  it('runs on one brain model setting', () => {
    expect(BRAIN_MODEL).toBe('claude-fable-5-2');
  });

  it('without a key, stands on its built-in reads and spends nothing', async () => {
    const m = await loadMise(db, owner(), 'oakland', { now: NOW });
    expect(m).toMatchObject({ roomId: 'oakland', ai: false, engine: 'builtin' });
    expect(await logged()).toHaveLength(0);
  });

  it('with a key, asks the brain model, keeps only grounded lines and caches them', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { f, calls } = fakeClaude({
      levels: [
        { id: 'location', read: 'Oakland does about $41,620 a week, and Tuesdays drag.' },
        { id: 'team', read: 'Your team brings in $999,999 a night.' }, // not in the records
      ],
      consultants: [{ page: 'labour', read: 'Roster Coach has the most results here.' }],
    });
    const m = await loadMise(db, owner(), 'oakland', { fetchImpl: f, now: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.model).toBe(BRAIN_MODEL);
    expect(m).toMatchObject({ ai: true, engine: 'ai', model: BRAIN_MODEL });
    expect(m.reads.levels.location).toMatch(/\$41,620/);
    expect(m.reads.levels.team).toBeUndefined(); // failed the figure check, discarded
    expect(m.reads.consultants.labour).toMatch(/Roster Coach/);
    expect(await logged()).toHaveLength(1);

    // The same room and records: read from the cache, no second call.
    const again = await loadMise(db, owner(), 'oakland', { fetchImpl: f, now: NOW });
    expect(calls).toHaveLength(1);
    expect(again.reads.levels.location).toBe(m.reads.levels.location);
  });

  it('falls back to the built-in reads when the provider is down', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { f } = fakeClaude({}, 500);
    const m = await loadMise(db, owner(), 'oakland', { fetchImpl: f, now: NOW });
    expect(m).toMatchObject({ engine: 'builtin', reads: { levels: {}, consultants: {} } });
  });

  it('only reads rooms the viewer can see', async () => {
    await expect(loadMise(db, { orgId, userId: 'u1', role: 'gm', rooms: ['berkeley'] }, 'oakland', { now: NOW })).rejects.toThrow(/not one of yours/);
  });
});
