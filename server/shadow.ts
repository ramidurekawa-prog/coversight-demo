// Shadow mode on the server. Each morning the `shadow` job logs, for every
// room, the staffing call Coversight would make for today's and tomorrow's
// services (the same staffingDecision Today and Service show), frozen with
// what it read. Once a service is over it grades the call against the guests
// who came and the schedule the manager ran. Nothing is sent, approved or
// booked: it is the record a pilot reads before trusting the calls.
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';

import { addDays } from '../lib/data/page/service.js';
import { gradeShadow, shadowEntry, staffingDecision } from '../lib/data/page/staffing.js';
import { dataEnd } from '../lib/data/readers.js';
import { shadowLatest, shadowReport } from '../lib/data/shadow.js';
import type { Db } from './db/client';
import { shadowCalls } from './db/schema';
import { loadSeries } from './forecast';
import { InputError } from './org';
import { staffingContext } from './page/staffing';
import { AuthError, type Viewer } from './session';
import { loadDataset } from './dataset';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
type Fetch = typeof fetch;
const MEALS = ['lunch', 'dinner'] as const;
/** How far back an ungraded call is still graded (a late upload of guests by hour). */
const GRADE_DAYS = 21;

/** Guests by hour on a date from the room's own POS days (or the sample's), for grading. */
async function posGuests(db: Db, orgId: string, roomId: string, room: { fromToast?: unknown; tz?: string }, date: string, now: Date) {
  const series = await loadSeries(db, orgId, roomId, room, now).catch(() => null);
  const hs = (series?.hours ?? []).filter((h: { iso: string }) => h.iso === date);
  return hs.length ? new Map<number, number>(hs.map((h: { hour: number; covers: number }) => [h.hour, h.covers] as [number, number])) : null;
}

/** The nightly run for one group: log today's and tomorrow's calls, grade the ones that are over. */
export async function runShadow(db: Db, orgId: string, { now = new Date(), fetchImpl }: { now?: Date; fetchImpl?: Fetch } = {}) {
  const loaded = await loadDataset(db, orgId);
  if (!loaded) return { rooms: 0, logged: 0, graded: 0 };
  const v: V = { orgId, userId: null as unknown as string, role: 'owner', rooms: null };
  let logged = 0, graded = 0;
  for (const roomId of Object.keys(loaded.ds.rooms)) {
    const c = await staffingContext(db, v, roomId, { now, ...(fetchImpl ? { fetchImpl } : {}) });
    const issuedAt = now.toISOString();
    for (const date of [c.clock.date, addDays(c.clock.date, 1)]) {
      for (const meal of MEALS) {
        const d = staffingDecision(c.room, { date, meal, today: c.clock.date, nowMin: c.clock.minutes, fences: c.fences, cc: c.cc, tasks: c.tasks, entries: c.entries, adjust: c.adjust });
        const entry = shadowEntry(d, { issuedAt, dataEnd: dataEnd(c.room) });
        if (!entry) continue;
        const res = await db.insert(shadowCalls).values({ orgId, roomId, date, meal, state: entry.state, entry, issuedAt: now })
          .onConflictDoNothing().returning({ id: shadowCalls.id });
        logged += res.length;
      }
    }
    // Grade services before today that aren't graded yet (or are still waiting on guests).
    const open = await db.select().from(shadowCalls).where(and(eq(shadowCalls.orgId, orgId), eq(shadowCalls.roomId, roomId), lt(shadowCalls.date, c.clock.date), gte(shadowCalls.date, addDays(c.clock.date, -GRADE_DAYS)), isNull(shadowCalls.gradedAt)));
    for (const row of open) {
      const guests = await posGuests(db, orgId, roomId, c.room, row.date, now);
      const g = gradeShadow(row.entry, c.room, { guests, tasks: c.tasks });
      const done = g.state === 'graded' || g.state === 'none';
      await db.update(shadowCalls).set({ graded: g, ...(done ? { gradedAt: now } : {}) }).where(eq(shadowCalls.id, row.id));
      if (g.state === 'graded') graded++;
    }
  }
  return { rooms: Object.keys(loaded.ds.rooms).length, logged, graded };
}

const query = z.object({ roomId: z.string().min(1).max(60) });

/** One room's shadow record: the report and the latest graded services. */
export async function loadShadow(db: Db, v: V, raw: unknown) {
  const p = query.safeParse(raw);
  if (!p.success) throw new InputError('roomId is required');
  if (v.rooms && !v.rooms.includes(p.data.roomId)) throw new AuthError(403, 'That room is not one of yours.');
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  const room = loaded?.ds.rooms[p.data.roomId];
  if (!room) throw new InputError(`no room '${p.data.roomId}' in this group`);
  const rows = await db.select().from(shadowCalls).where(and(eq(shadowCalls.orgId, v.orgId), eq(shadowCalls.roomId, p.data.roomId))).orderBy(asc(shadowCalls.date), asc(shadowCalls.meal));
  const entries = rows.map((r) => ({ ...(r.entry as object), date: r.date, meal: r.meal, state: r.state, graded: r.graded, issuedAt: r.issuedAt.toISOString() })) as { date: string; meal: string; state: string; graded?: unknown }[];
  const wage = room.levers?.wage;
  return {
    roomId: p.data.roomId,
    since: rows[0]?.date ?? null,
    report: shadowReport(entries, { wageCents: wage ? Math.round(wage * 100) : null }),
    latest: shadowLatest(entries, 7),
  };
}
