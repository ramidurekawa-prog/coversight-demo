import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { SEED } from '../lib/data/seed.js';
import { deriveRoom } from '../lib/data/model.js';
import {
  actionProgress, buildAgenda, finalizeMeeting as finalizePure, finalizeProblems, nextMeeting, readiness, setOutcome, slotLabel, startState, summaryText,
} from '../lib/data/page/meeting.js';
import type { Db } from '../server/db/client';
import { actions, meetingActions, notifications, users } from '../server/db/schema';
import { createSampleOrg } from '../server/org';
import { loadActions, saveAction } from '../server/actions';
import { discardMeeting, finalizeMeeting, loadMeeting, runMeetingReminders, saveMeeting, startMeeting, updateAction } from '../server/page/meeting';
import { freshDb } from './helpers/db';

type Item = { id: string; seg: string; title: string; mins: number; follow?: string; findingId?: string; recommend: string; options: string[]; action?: { sourceKey: string; title: string } };
type Agenda = { roomId: string; week: string; dataThrough: string | null; items: Item[]; more: { issues: number; follow: number } };
type Act = { id: string; roomId: string; sourceKey: string; status: string; owner: string; due: string; reason?: string | null; findingId?: string | null; title: string };
const NOW = new Date('2026-11-10T17:00:00Z');
const agendaFor = (room: string, ctx: Record<string, unknown> = {}) => buildAgenda(deriveRoom(SEED, room), { sample: true, now: NOW, ...ctx }) as unknown as Agenda;
const ids = (a: Agenda) => a.items.map((x) => x.id);

describe('the agenda is built from the room’s own data', () => {
  it('uses the selected room and week, and every room gets its own', () => {
    const oak = agendaFor('oakland');
    const bk = agendaFor('berkeley');
    expect(oak.roomId).toBe('oakland');
    expect(bk.roomId).toBe('berkeley');
    expect(oak.week).toBe('2026-11-09');
    expect(oak.dataThrough).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ids(oak)).not.toEqual(ids(bk));
    for (const room of Object.keys(SEED.rooms)) {
      const a = agendaFor(room);
      expect(a.items[0]!.seg, room).toBe('A');
      expect(a.items.at(-1)!.id, room).toBe('confirm');
      const segs = a.items.map((x) => x.seg).join('');
      expect(segs, room).toMatch(/^A+B*C*D*E$/);
      expect(a.items.reduce((s, x) => s + x.mins, 0), room).toBeLessThanOrEqual(15.1);
    }
  });

  it('puts urgent problems before bigger speculative dollars, and one topic gets one item', () => {
    const bk = agendaFor('berkeley');
    expect(bk.items.find((x) => x.seg === 'B')!.id).toBe('issue:reversed:bk-friday'); // a guardrail breach outranks a stale feed
    const wc = agendaFor('walnut');
    // The comps decision covers the comps alarm: it isn't raised twice.
    expect(ids(wc)).toContain('dec:wc-comps');
    expect(ids(wc).some((x) => x.startsWith('issue:alarm:'))).toBe(false);
    // Oakland's recipe-cost feed covers the salmon move it blocks.
    const oak = agendaFor('oakland');
    expect(ids(oak)).toContain('issue:feed:recipe-costs');
    expect(ids(oak).some((x) => x.includes('salmon'))).toBe(false);
  });

  it('adapts when there is less to discuss, and never invents a narrative without data', () => {
    const real = buildAgenda(deriveRoom(SEED, 'oakland'), { sample: false, now: NOW }) as unknown as Agenda & { items: (Item & { missing?: boolean })[] };
    expect(ids(real)).toEqual(['fin', 'issue:feed:toast', 'confirm']);
    expect(real.items[0]!.missing).toBe(true);
    expect(real.dataThrough).toBeNull();
    expect(real.items.reduce((s, x) => s + x.mins, 0)).toBeLessThan(15);
  });

  it('shows an unresolved action once, in follow-up, and never as a new decision', () => {
    const open: Act = { id: 'a1', roomId: 'oakland', sourceKey: 'finding:ribeye', findingId: 'ribeye', status: 'open', owner: 'Marcus', due: '2026-11-05', title: 'Raise the ribeye' };
    const a = agendaFor('oakland', { actions: [open] });
    expect(ids(a).filter((x) => x.includes('ribeye') || x === 'follow:a1')).toEqual(['follow:a1']);
    expect(readiness(a as never, [open], 'oakland', NOW)).toMatchObject({ unfinished: 1, overdue: 1 });
  });

  it('keeps a deferred item away until its date, then brings it back', () => {
    const def: Act = { id: 'd1', roomId: 'oakland', sourceKey: 'finding:ribeye', findingId: 'ribeye', status: 'deferred', owner: '', due: '2026-11-24', reason: 'After the menu reprint', title: 'Raise the ribeye' };
    expect(ids(agendaFor('oakland', { actions: [def] }))).not.toContain('dec:ribeye');
    expect(ids(agendaFor('oakland', { actions: [def], now: new Date('2026-11-25T17:00:00Z') }))).toContain('dec:ribeye');
  });

  it('a task completed elsewhere shows in follow-through: a running test is monitoring, then verified', () => {
    const a = { id: 'a1', roomId: 'oakland', findingId: 'ribeye', status: 'open', due: '2026-11-20' };
    const cands = deriveRoom(SEED, 'oakland').candidates;
    expect(actionProgress(a, { candidates: cands, now: NOW }).state).toBe('assigned');
    const w = { roomId: 'oakland', lever: 'menu_margin', dish: 'ribeye', startedAt: '2026-11-11', status: 'running' };
    expect(actionProgress(a, { candidates: cands, windows: [w], now: NOW }).state).toBe('monitoring');
    expect(actionProgress(a, { candidates: cands, windows: [{ ...w, status: 'verified' }], now: NOW }).state).toBe('verified');
    expect(actionProgress({ ...a, due: '2026-11-01' }, { candidates: cands, now: NOW }).state).toBe('overdue');
    const ag = agendaFor('oakland', { actions: [{ ...a, sourceKey: 'finding:ribeye', owner: 'M', title: 'T' }], windows: [w] });
    expect(ag.items.find((x) => x.id === 'follow:a1')!.recommend).toBe('done');
  });
});

describe('finalizing a meeting (pure)', () => {
  const agenda = agendaFor('oakland');
  const dec = agenda.items.find((x) => x.id === 'dec:ribeye')!;
  const vendor = agenda.items.find((x) => x.id === 'dec:vendor')!;
  const feed = agenda.items.find((x) => x.id === 'issue:feed:7shifts')!;
  let st = startState(['Maria', 'Marcus'], NOW);
  st = setOutcome(st, dec, { status: 'accepted', action: { title: dec.title, owner: 'Marcus', due: '2026-11-13', priority: 'high', doneWhen: 'Live in Toast', approval: 'Owner approves the price change' } }, NOW);
  st = setOutcome(st, vendor, { status: 'deferred' }, NOW);

  it('refuses to finish an accepted action without an owner, or a deferral without a reason', () => {
    const noOwner = setOutcome(st, feed, { status: 'accepted', action: { title: 'Fix', owner: ' ', due: '2026-11-12' } }, NOW);
    expect(finalizeProblems(agenda as never, noOwner).map((p: { id: string }) => p.id).sort()).toEqual(['dec:vendor', 'issue:feed:7shifts']);
  });

  it('produces a structured record, with the real elapsed time even when it runs long', () => {
    const ok = setOutcome(st, vendor, { status: 'deferred', reason: 'Wait for the new contract' }, NOW);
    const f = finalizePure(agenda as never, ok, { now: new Date(NOW.getTime() + 22 * 60_000), startedAt: NOW.toISOString(), roomName: 'Rosewood Oakland' });
    expect(f.record.mins).toBe(22);
    expect(f.record.plannedMins).toBeLessThanOrEqual(15.1);
    expect(f.record.actions).toEqual([expect.objectContaining({ title: dec.title, owner: 'Marcus', due: '2026-11-13' })]);
    expect(f.record.deferred).toEqual([{ title: vendor.title, reason: 'Wait for the new contract' }]);
    expect(f.upserts.map((u: { sourceKey?: string; status: string }) => `${u.sourceKey}:${u.status}`)).toEqual(['finding:ribeye:open', 'finding:vendor:deferred']);
    const text = summaryText(f.record, 'Rosewood Oakland');
    expect(text).toContain('Owner: Marcus. Due 2026-11-13.');
    expect(text).toContain('## Deferred');
    expect(text).toContain('Agreement in a meeting is not proof');
  });
});

describe('meetings on the server', () => {
  let db: Db;
  let orgId: string;
  const owner = () => ({ orgId, userId: 'u1', role: 'owner' as const, rooms: null });
  const gm = () => ({ orgId, userId: 'u2', role: 'gm' as const, rooms: ['berkeley'] });
  beforeEach(async () => {
    db = await freshDb();
    await db.insert(users).values([{ id: 'u1', name: 'Maria', email: 'u@x.co' }, { id: 'u2', name: 'Devon', email: 'd@x.co' }]);
    orgId = (await createSampleOrg(db, { ownerId: 'u1' })).id;
  });

  async function run(decide: (a: Agenda, st: ReturnType<typeof startState>) => ReturnType<typeof startState>, ctx: Record<string, unknown> = {}, at = NOW) {
    const before = await loadMeeting(db, owner(), 'oakland', at);
    const agenda = agendaFor('oakland', { actions: before.actions, now: at, ...ctx });
    const started = await startMeeting(db, owner(), { roomId: 'oakland', agenda, attendees: ['Maria'] }, at);
    const live = started.live!;
    const state = decide(agenda, live.state as ReturnType<typeof startState>);
    const saved = await saveMeeting(db, owner(), { id: live.id, version: live.version, state }, at);
    return finalizeMeeting(db, owner(), { id: live.id, version: saved.version, state }, new Date(at.getTime() + 14 * 60_000));
  }
  const accept = (sourceItem: string, who = 'Marcus') => (a: Agenda, st: ReturnType<typeof startState>) => {
    const it = a.items.find((x) => x.id === sourceItem)!;
    return setOutcome(st, it, { status: 'accepted', action: { title: it.title, owner: who, due: '2026-11-13', priority: 'high', doneWhen: 'Live', approval: 'None' } }, NOW);
  };

  it('keeps progress server-side: a refresh restores it, and starting twice resumes instead of duplicating', async () => {
    const agenda = agendaFor('oakland');
    const a = await startMeeting(db, owner(), { roomId: 'oakland', agenda, attendees: [] }, NOW);
    const state = { ...(a.live!.state as object), i: 3, notes: { fin: 'Strong week' } };
    await saveMeeting(db, owner(), { id: a.live!.id, version: a.live!.version, state }, NOW);
    const again = await startMeeting(db, owner(), { roomId: 'oakland', agenda, attendees: [] }, NOW);
    expect(again.live!.id).toBe(a.live!.id);
    const reloaded = await loadMeeting(db, owner(), 'oakland', NOW);
    expect(reloaded.live!.state).toMatchObject({ i: 3, notes: { fin: 'Strong week' } });
    expect(reloaded.live!.startedAt).toBe(NOW.toISOString());
  });

  it('one editor at a time: others wait, a stale version is refused, an owner can take over', async () => {
    await db.insert(users).values({ id: 'u3', name: 'Ana', email: 'a@x.co' });
    const a = await startMeeting(db, owner(), { roomId: 'oakland', agenda: agendaFor('oakland'), attendees: [] }, NOW);
    const id = a.live!.id;
    const other = { orgId, userId: 'u3', role: 'admin' as const, rooms: null };
    const seen = await loadMeeting(db, other, 'oakland', NOW);
    expect(seen.live).toMatchObject({ canEdit: false, editor: 'Maria' });
    await expect(saveMeeting(db, other, { id, version: a.live!.version, state: a.live!.state }, NOW)).rejects.toThrow(/Someone else/);
    const r = await saveMeeting(db, owner(), { id, version: a.live!.version, state: a.live!.state }, NOW);
    await expect(saveMeeting(db, owner(), { id, version: a.live!.version, state: a.live!.state }, NOW)).rejects.toThrow(/changed somewhere else/);
    await saveMeeting(db, other, { id, version: r.version, takeover: true }, NOW);
    expect((await loadMeeting(db, other, 'oakland', NOW)).live).toMatchObject({ canEdit: true });
    await expect(saveMeeting(db, owner(), { id, version: r.version + 1, state: a.live!.state }, NOW)).rejects.toThrow(/Someone else/);
  });

  it('finalizing creates real actions with owner and due date, and a second meeting updates rather than duplicates', async () => {
    const r1 = await run(accept('dec:ribeye'));
    expect(r1.actions).toEqual([expect.objectContaining({ sourceKey: 'finding:ribeye', owner: 'Marcus', due: '2026-11-13', status: 'open', findingId: 'ribeye' })]);
    expect(r1.history[0]).toMatchObject({ mins: 14, by: 'Maria' });
    // Discard a restarted meeting: nothing is created.
    const s2 = await startMeeting(db, owner(), { roomId: 'oakland', agenda: agendaFor('oakland', { actions: r1.actions }), attendees: [] }, NOW);
    await discardMeeting(db, owner(), { id: s2.live!.id }, NOW);
    // The next meeting reassigns it from follow-up: same row, new owner.
    const r3 = await run((a, st) => {
      const it = a.items.find((x) => x.follow)!;
      return setOutcome(st, it, { status: 'reassigned', action: { owner: 'Ana', due: '2026-11-20' } }, NOW);
    });
    const rows = await db.select().from(meetingActions).where(eq(meetingActions.orgId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner: 'Ana', due: '2026-11-20', status: 'open' });
    expect(r3.actions).toHaveLength(1);
  });

  it('a deferred decision stays deferred with its reason; a rejected one comes off the plan', async () => {
    await run((a, st) => {
      const v = a.items.find((x) => x.id === 'dec:vendor')!;
      const r = a.items.find((x) => x.id === 'dec:ribeye')!;
      return setOutcome(setOutcome(st, v, { status: 'deferred', reason: 'New contract in December' }, NOW), r, { status: 'rejected' }, NOW);
    });
    const [def] = await db.select().from(meetingActions).where(and(eq(meetingActions.orgId, orgId), eq(meetingActions.sourceKey, 'finding:vendor')));
    expect(def).toMatchObject({ status: 'deferred', reason: 'New contract in December', due: '2026-11-24' });
    const findings = (await loadActions(db, orgId)).oakland!.findings as Record<string, string>;
    expect(findings.ribeye! > '2027-02-01').toBe(true);
  });

  it('changing the owner between meetings updates the action, and done shows in follow-through', async () => {
    const r1 = await run(accept('dec:ribeye'));
    const id = r1.actions[0]!.id;
    await updateAction(db, owner(), { id, patch: { owner: 'Priya' } }, NOW);
    const after = await updateAction(db, owner(), { id, patch: { status: 'done' } }, NOW);
    expect(after.actions[0]).toMatchObject({ owner: 'Priya', status: 'done' });
    const next = agendaFor('oakland', { actions: after.actions });
    expect(ids(next).some((x) => x.startsWith('follow:'))).toBe(false);
    await expect(updateAction(db, owner(), { id, patch: { due: 'soon' } }, NOW)).rejects.toThrow(/invalid/);
  });

  it('a GM works only in their rooms and cannot take over another person’s meeting', async () => {
    await expect(startMeeting(db, gm(), { roomId: 'oakland', agenda: agendaFor('oakland'), attendees: [] }, NOW)).rejects.toThrow(/not one of yours/);
    await expect(startMeeting(db, gm(), { roomId: '', agenda: agendaFor('oakland'), attendees: [] }, NOW)).rejects.toThrow(/room is required/);
    await expect(startMeeting(db, gm(), { roomId: 'berkeley', agenda: agendaFor('oakland'), attendees: [] }, NOW)).rejects.toThrow(/another room/);
    await expect(loadMeeting(db, gm(), 'oakland', NOW)).rejects.toThrow(/not one of yours/);
    const s = await startMeeting(db, owner(), { roomId: 'berkeley', agenda: agendaFor('berkeley'), attendees: [] }, NOW);
    await expect(saveMeeting(db, gm(), { id: s.live!.id, version: s.live!.version, takeover: true }, NOW)).rejects.toThrow(/Someone else/);
    const r1 = await run(accept('dec:ribeye'));
    await expect(updateAction(db, gm(), { id: r1.actions[0]!.id, patch: { status: 'done' } }, NOW)).rejects.toThrow(/not one of yours/);
  });

  it('refuses an agenda or state that breaks the bounds', async () => {
    const agenda = agendaFor('oakland');
    const bad = { ...agenda, items: [{ ...agenda.items[0], body: 'x'.repeat(5000) }] };
    await expect(startMeeting(db, owner(), { roomId: 'oakland', agenda: bad, attendees: [] }, NOW)).rejects.toThrow(/invalid agenda/);
    const s = await startMeeting(db, owner(), { roomId: 'oakland', agenda, attendees: [] }, NOW);
    await expect(saveMeeting(db, owner(), { id: s.live!.id, version: s.live!.version, state: { ...(s.live!.state as object), outcomes: { fin: { status: 'approved-ish', at: 'x' } } } }, NOW)).rejects.toThrow(/invalid meeting/);
    await expect(saveAction(db, owner(), { roomId: 'oakland', key: 'meeting.schedule', value: { day: 7, time: '09:00' } })).rejects.toThrow(/invalid/);
  });

  it('reminds once about actions due tomorrow and on the meeting day', async () => {
    await run(accept('dec:ribeye'));
    await saveAction(db, owner(), { roomId: 'oakland', key: 'meeting.schedule', value: { day: 4, time: '09:00' } });
    const thu = new Date('2026-11-12T16:00:00Z'); // Thursday morning Pacific; ribeye is due Friday the 13th
    const a = await runMeetingReminders(db, orgId, thu);
    const b = await runMeetingReminders(db, orgId, thu);
    expect(a.reminders).toBe(1);
    expect(a.meetings).toBe(1);
    expect(b).toMatchObject({ reminders: 0, meetings: 0 });
    const notes = await db.select().from(notifications).where(eq(notifications.orgId, orgId));
    expect(notes.map((n) => n.title).sort()).toEqual(['Due tomorrow: Raise the ribeye steak from $42 to $44', 'Weekly meeting today at 09:00']);
  });

  it('still reads meetings saved the old way', async () => {
    await saveAction(db, owner(), { roomId: 'oakland', key: 'meeting', value: { log: ['Plan: committed'], at: '2026-11-03T17:15:00.000Z' } });
    const m = await loadMeeting(db, owner(), 'oakland', NOW);
    expect(m.history).toEqual([expect.objectContaining({ at: '2026-11-03T17:15:00.000Z', log: ['Plan: committed'] })]);
    expect(await db.select().from(actions).where(eq(actions.key, 'meeting'))).toHaveLength(1);
  });
});

describe('the slot', () => {
  it('finds the next one and names it', () => {
    const tue = { day: 2, time: '09:00' };
    expect(nextMeeting(tue, new Date('2026-11-12T10:00:00')).getDate()).toBe(17);
    expect(nextMeeting(tue, new Date('2026-11-17T09:30:00')).getDate()).toBe(17);
    expect(nextMeeting(tue, new Date('2026-11-17T11:00:00')).getDate()).toBe(24);
    expect(slotLabel({ day: 4, time: '14:30' })).toBe('Thursdays at 2:30 pm');
  });
});
