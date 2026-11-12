import { beforeEach, describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { deriveRoom } from '../lib/data/model.js';
import {
  agendaFor, choiceKind, decisionUntil, MEETING_LIMITS, meetingRecord, meetingStats, meetingSummary, nextMeeting, openFollowups, slotLabel, trimDone,
} from '../lib/data/page/meeting.js';
import type { Db } from '../server/db/client';
import { users } from '../server/db/schema';
import { createSampleOrg } from '../server/org';
import { loadActions, saveAction } from '../server/actions';
import { meetingHistory } from '../server/page/meeting';
import { freshDb } from './helpers/db';

const rooms = Object.keys(SEED.rooms);
type Item = { key: string; k: string; decision?: string[]; cand: { id: string; title: string } | null };
const agendaOf = (d: unknown) => agendaFor(d) as Item[];

describe('the agenda', () => {
  it('every room has one decision slot tied to a real finding, and a plan item', () => {
    for (const id of rooms) {
      const d = deriveRoom(SEED, id);
      const agenda = agendaOf(d);
      const decisions = agenda.filter((a) => a.decision);
      expect(decisions.length, id).toBe(1);
      expect(decisions[0]!.cand, id).not.toBeNull();
      expect(d.candidates.some((c: { id: string }) => c.id === decisions[0]!.cand!.id), id).toBe(true);
      expect(new Set(agenda.map((a) => a.key)).size, id).toBe(agenda.length);
    }
  });

  it('reads what each option does', () => {
    expect(choiceKind('Approve $30 after recipes upload', 0)).toBe('approve');
    expect(choiceKind('Hold for two weeks', 1)).toBe('hold');
    expect(choiceKind('Not for us', 2)).toBe('dismiss');
    expect(choiceKind('Reprint the menu this week', 0)).toBe('approve');
    const now = new Date('2026-11-10T17:00:00Z');
    expect(decisionUntil('hold', now)).toBe('2026-11-24T17:00:00.000Z');
    expect(decisionUntil('dismiss', now)).toBe('2027-02-08T17:00:00.000Z');
    expect(decisionUntil('approve', now)).toBeNull();
  });
});

describe('a finished meeting', () => {
  const d = deriveRoom(SEED, 'oakland');
  const agenda = agendaOf(d);
  const dKey = agenda.find((a) => a.decision)!;
  const draft = {
    startedAt: '2026-11-10T17:00:00.000Z',
    notes: { [agenda[0]!.key]: '  Thursday prep still holding.  ' },
    choice: dKey.decision![1]!,
    followups: [{ id: 'f-1', text: 'Upload recipe costs', owner: 'Marcus' }, { id: '', text: 'dropped' }],
    plan: ['Raise the ribeye'],
  };
  const rec = meetingRecord(draft, agenda, new Date('2026-11-10T17:14:30.000Z'));

  it('records length, decision, notes, plan and follow-ups', () => {
    expect(rec.mins).toBe(15);
    expect(rec.decision).toMatchObject({ id: dKey.cand!.id, choice: dKey.decision![1], kind: 'hold' });
    expect(rec.items![0]).toEqual({ k: agenda[0]!.k, note: 'Thursday prep still holding.' });
    expect(rec.followups).toEqual([{ id: 'f-1', text: 'Upload recipe costs', owner: 'Marcus' }]);
    expect(rec.plan).toEqual(['Raise the ribeye']);
    expect(rec.log).toContain(`${dKey.k}: ${dKey.decision![1]}`);
  });

  it('logs an unanswered decision as deferred', () => {
    const r = meetingRecord({ ...draft, choice: null }, agenda, new Date('2026-11-10T17:10:00.000Z'));
    expect(r.decision).toMatchObject({ choice: 'Deferred', kind: 'deferred' });
  });

  it('writes a summary email that names the decision and follow-ups, and reads older records', () => {
    const m = meetingSummary(rec, 'Rosewood Oakland');
    expect(m.subject).toMatch(/^Rosewood Oakland: weekly meeting, /);
    expect(m.body).toContain(`Decision: ${dKey.cand!.title}: ${dKey.decision![1]}.`);
    expect(m.body).toContain('• Upload recipe costs (Marcus)');
    expect(meetingSummary({ log: ['Plan: committed'], at: '2026-11-03T17:15:00.000Z' }, 'X').body).toContain('• Plan: committed');
  });

  it('carries follow-ups until ticked off, and keeps the done marks bounded', () => {
    const older = { at: '2026-11-03T17:00:00.000Z', followups: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };
    const newer = { at: '2026-11-10T17:00:00.000Z', followups: [{ id: 'c', text: 'C' }] };
    expect(openFollowups([newer, older], { b: '2026-11-05' }).map((f) => f.id)).toEqual(['a', 'c']);
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, n) => [`f${n}`, new Date(Date.UTC(2026, 0, 1) + n * 6e4).toISOString()]));
    const kept = trimDone(many);
    expect(Object.keys(kept)).toHaveLength(MEETING_LIMITS.done);
    expect(kept.f199).toBeDefined();
    expect(kept.f0).toBeUndefined();
  });

  it('counts the record honestly: weeks met, length, decisions', () => {
    const now = new Date('2026-11-12T12:00:00');
    expect(meetingStats([], now)).toMatchObject({ held: 0, avgMins: null, decisions: null });
    const st = meetingStats([
      { at: '2026-11-10T09:15:00', mins: 14, decision: { kind: 'hold' }, items: [] },
      { at: '2026-11-03T09:15:00', mins: 16, decision: { kind: 'deferred' }, items: [] },
      { at: '2026-11-04T09:15:00', mins: 12, items: [] }, // same week twice counts once
      { at: '2026-06-02T09:15:00', mins: 30, decision: { kind: 'approve' }, items: [] }, // too old
    ], now);
    expect(st).toMatchObject({ held: 2, of: 8, avgMins: 14 });
    expect(st.decisions).toBeCloseTo(1 / 3);
  });

  it('finds the next slot', () => {
    const tue = { day: 2, time: '09:00' };
    expect(nextMeeting(tue, new Date('2026-11-12T10:00:00')).toDateString()).toBe(new Date('2026-11-17T09:00:00').toDateString());
    expect(nextMeeting(tue, new Date('2026-11-17T09:30:00')).getDate()).toBe(17); // in the hour after it starts, it's today
    expect(nextMeeting(tue, new Date('2026-11-17T11:00:00')).getDate()).toBe(24);
    expect(slotLabel({ day: 4, time: '14:30' })).toBe('Thursdays at 2:30 pm');
  });
});

describe('the meeting record on the server', () => {
  let db: Db;
  let orgId: string;
  const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
  beforeEach(async () => {
    db = await freshDb();
    await db.insert(users).values({ id: 'u1', name: 'Maria', email: 'u@x.co' });
    orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  });

  const rec = (at: string, extra = {}) => ({ at, log: ['One decision: Hold'], mins: 14, items: [{ k: 'One decision', decision: 'Hold' }], decision: { id: 'salmon', choice: 'Hold', kind: 'hold' }, ...extra });

  it('keeps every finished meeting, newest first, back to the last clear', async () => {
    await saveAction(db, owner(), { roomId: 'oakland', key: 'meeting', value: rec('2026-10-27T16:15:00.000Z') });
    await saveAction(db, owner(), { roomId: 'oakland', key: 'meeting', value: null });
    await saveAction(db, owner(), { roomId: 'oakland', key: 'meeting', value: { log: ['Plan: committed'], at: '2026-11-03T17:15:00.000Z' } });
    await saveAction(db, owner(), { roomId: 'oakland', key: 'meeting', value: rec('2026-11-10T17:15:00.000Z', { followups: [{ id: 'f-1', text: 'Upload recipe costs', owner: 'Marcus' }] }) });
    await saveAction(db, owner(), { roomId: 'berkeley', key: 'meeting', value: rec('2026-11-10T18:15:00.000Z') });
    const h = await meetingHistory(db, owner(), 'oakland');
    expect(h.map((m) => m.value.at)).toEqual(['2026-11-10T17:15:00.000Z', '2026-11-03T17:15:00.000Z']);
    expect(h[0]!.by).toBe('Maria');
    expect(h[0]!.value.followups).toHaveLength(1);
    expect((await loadActions(db, orgId)).oakland!.meeting).toMatchObject({ at: '2026-11-10T17:15:00.000Z' });
  });

  it('refuses bad meetings, follow-ups and slots on the server', async () => {
    const bad = [
      { key: 'meeting', value: rec('x', { items: [{ k: 'A', note: 'n'.repeat(MEETING_LIMITS.note + 1) }] }) },
      { key: 'meeting', value: rec('x', { followups: Array.from({ length: MEETING_LIMITS.followups + 1 }, (_, n) => ({ id: `f${n}`, text: 't' })) }) },
      { key: 'meeting', value: rec('x', { decision: { choice: 'Hold', kind: 'maybe' } }) },
      { key: 'meeting', value: { at: 'x' } },
      { key: 'meeting.schedule', value: { day: 7, time: '09:00' } },
      { key: 'meeting.schedule', value: { day: 2, time: '9am' } },
      { key: 'meeting.followups', value: Object.fromEntries(Array.from({ length: MEETING_LIMITS.done + 1 }, (_, n) => [`f${n}`, '2026-11-10'])) },
    ];
    for (const b of bad) await expect(saveAction(db, owner(), { roomId: 'oakland', ...b }), b.key).rejects.toThrow(/invalid/);
    await saveAction(db, owner(), { roomId: 'oakland', key: 'meeting.schedule', value: { day: 4, time: '14:30' } });
    await saveAction(db, owner(), { roomId: 'oakland', key: 'meeting.followups', value: { 'f-1': '2026-11-12T10:00:00.000Z' } });
    expect((await loadActions(db, orgId)).oakland).toMatchObject({ 'meeting.schedule': { day: 4, time: '14:30' }, 'meeting.followups': { 'f-1': '2026-11-12T10:00:00.000Z' } });
  });

  it("a GM sees only their rooms' record, and only their own group's", async () => {
    await saveAction(db, owner(), { roomId: 'oakland', key: 'meeting', value: rec('2026-11-10T17:15:00.000Z') });
    const gm = { orgId, rooms: ['berkeley'] };
    await expect(meetingHistory(db, gm, 'oakland')).rejects.toThrow(/not one of yours/);
    expect(await meetingHistory(db, gm, 'berkeley')).toEqual([]);
    await expect(saveAction(db, { ...gm, userId: 'u1', role: 'gm' }, { roomId: 'oakland', key: 'meeting.schedule', value: { day: 1, time: '10:00' } })).rejects.toThrow(/not one of yours/);
    await db.insert(users).values({ id: 'u2', name: 'Other', email: 'o@x.co' });
    const other = (await createSampleOrg(db, { ownerId: 'u2' })).id;
    expect(await meetingHistory(db, { orgId: other, rooms: null }, 'oakland')).toEqual([]);
    await expect(meetingHistory(db, owner(), '')).rejects.toThrow(/room is required/);
  });
});
