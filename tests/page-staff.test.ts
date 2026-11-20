import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../server/db/client';
import { users } from '../server/db/schema';
import { loadActions, saveAction } from '../server/actions';
import { createSampleOrg } from '../server/org';
import { redactStaff, staffCoach, staffSummary } from '../server/page/staff';
import { freshDb } from './helpers/db';
import { fakeClaude } from './helpers/fake-claude';

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'maria@example.com' }]);
  delete process.env.ANTHROPIC_API_KEY;
});

describe('the staff API', () => {
  it('gives names to owners and GMs, the team only to a floor manager, and scopes rooms', async () => {
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    const owner = { orgId: org.id, userId: 'u1', role: 'owner' as const, rooms: null };
    const res = await staffSummary(db, owner, 'oakland');
    expect(res.names).toBe(true);
    expect(res.view!.people.find((p: { name: string }) => p.name === 'Kayla P.')).toBeTruthy();
    const floor = await staffSummary(db, { orgId: org.id, role: 'floor', rooms: ['oakland'] }, 'oakland');
    expect(floor.names).toBe(false);
    expect(JSON.stringify(floor.view)).not.toContain('Kayla P.');
    await expect(staffSummary(db, { orgId: org.id, role: 'gm', rooms: ['berkeley'] }, 'oakland')).rejects.toThrow(/not one of yours/);
  });

  it('keeps people notes to owners, admins and GMs', async () => {
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    const gm = { orgId: org.id, userId: 'u1', role: 'gm' as const, rooms: ['oakland'] };
    const value = { 'kayla-p': [{ at: '2026-11-19T10:00:00Z', kind: 'talk', text: 'Talked before Friday.' }] };
    await saveAction(db, gm, { roomId: 'oakland', key: 'staff.notes', value });
    await expect(saveAction(db, { ...gm, role: 'floor' as const }, { roomId: 'oakland', key: 'staff.notes', value })).rejects.toThrow(/owner, admin or GM/);
    await expect(saveAction(db, gm, { roomId: 'oakland', key: 'staff.notes', value: { 'kayla-p': [{ at: 'x', kind: 'fire', text: '' }] } })).rejects.toThrow(/invalid/);
    expect((await loadActions(db, org.id, ['oakland'], 'u1', 'gm')).oakland?.['staff.notes']).toEqual(value);
    expect((await loadActions(db, org.id, ['oakland'], 'u1', 'floor')).oakland?.['staff.notes']).toBeUndefined();
  });

  it('strips per-person rows from the dataset for a floor manager', () => {
    const base = { rooms: { oakland: { staff: [], staffShifts: { rows: [[1]] } } } };
    expect(redactStaff(base, {}, 'floor').base.rooms.oakland).not.toHaveProperty('staffShifts');
    expect(redactStaff(base, {}, 'gm').base.rooms.oakland).toHaveProperty('staffShifts');
  });

  it('coach: Coversight’s own words without a key; Claude’s through the shared engine with one, never a firing call or a new number', async () => {
    const org = await createSampleOrg(db, { ownerId: 'u1' });
    const owner = { orgId: org.id, userId: 'u1', role: 'owner' as const, rooms: null };
    const plain = await staffCoach(db, owner, { room: 'oakland', person: 'kayla-p' });
    expect(plain.by).toBe('coversight');
    expect(plain.text).toMatch(/closer look/i);
    await expect(staffCoach(db, { ...owner, role: 'floor' as const }, { room: 'oakland' })).rejects.toThrow(/owner, admin or GM/);
    process.env.ANTHROPIC_API_KEY = 'test';
    const good = fakeClaude({ text: 'Worth a private word with Kayla before her next shift.' });
    const ai = await staffCoach(db, owner, { room: 'oakland', person: 'kayla-p' }, good.f);
    expect(ai.by).toBe('claude');
    expect(good.calls[0]!.body.model).toBe('claude-opus-5-5');
    expect(JSON.stringify(good.calls[0]!.body.messages)).toContain('Kayla P.');
    expect((await staffCoach(db, owner, { room: 'oakland', person: 'kayla-p' }, fakeClaude({ text: 'You should fire Kayla.' }).f)).by).toBe('coversight');
    expect((await staffCoach(db, owner, { room: 'oakland', person: 'kayla-p' }, fakeClaude({ text: 'She cost you $9,999 last month.' }).f)).by).toBe('coversight');
    expect((await staffCoach(db, owner, { room: 'oakland' }, fakeClaude({}, 529).f)).by).toBe('coversight');
  });
});
