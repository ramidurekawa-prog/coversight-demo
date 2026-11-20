// Covercast on the server: one room's forecast from what's stored for it.
// History comes from the Toast days the sync keeps (pos_days); a sample room
// with none uses the sample's own days. A manager's hand-entered signals
// (`forecast.signals`) and any feed with a key add to it. Every number comes
// from lib/data/forecast, the same code the browser runs.
import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import { addDays } from '../lib/data/forecast/calendar.js';
import { arrivalsForecast, covercastRoom, reforecast, seriesFromOrders, seriesFromSample } from '../lib/data/forecast/index.js';
import { localDay } from '../lib/data/page/today.js';
import type { Db } from './db/client';
import { actions, posDays, serviceLive } from './db/schema';
import { loadDataset } from './dataset';
import { arrivalsFeed, eventsFeed, reservationsFeed, weatherFeed } from './forecast-feeds';
import { InputError } from './org';
import { AuthError, type Viewer } from './session';

type V = Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>;
type Fetch = typeof fetch;
const DEFAULT_TZ = 'America/Los_Angeles';
const roomId = z.string().min(1).max(60);
/** Days of stored Toast history read (the sync keeps 371). */
const HISTORY_DAYS = 371;

type Signals = {
  events?: { date: string; name: string; lift?: number | null; by?: string }[];
  closures?: string[];
  weather?: { date: string; rainIn: number; tempF?: number | null; source?: string }[];
  reservations?: { date: string; covers: number; asOf: string; source?: string }[];
  days?: { date: string; covers?: number; net?: number }[];
  location?: { lat: number; lon: number } | null;
};

/** The room's covers so far today by hour, from tonight's pull (slots from 5 pm). */
function hoursFromSlots(slots: number[]) {
  const by = new Map<number, number>();
  slots.forEach((c, i) => { const h = 17 + Math.floor(i / 4); by.set(h, (by.get(h) ?? 0) + (c || 0)); });
  return by;
}

export async function loadForecast(db: Db, v: V, room: unknown, { now = new Date(), fetchImpl = fetch, days = 14 }: { now?: Date; fetchImpl?: Fetch; days?: number } = {}) {
  const p = roomId.safeParse(room);
  if (!p.success) throw new InputError('room is required');
  if (v.rooms && !v.rooms.includes(p.data)) throw new AuthError(403, 'That room is not one of yours.');
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  const r = loaded?.ds.rooms[p.data];
  if (!loaded || !r) throw new InputError(`no room '${p.data}' in this group`);
  const tz: string = r.tz || DEFAULT_TZ;
  const local = localDay(now, tz);
  const [saved] = await db.select({ value: actions.value }).from(actions)
    .where(and(eq(actions.orgId, v.orgId), eq(actions.roomId, p.data), eq(actions.key, 'forecast.signals'))).orderBy(desc(actions.at), desc(actions.id)).limit(1);
  const own = (saved?.value ?? {}) as Signals;
  const latest = async (key: string) => {
    const [row] = await db.select({ value: actions.value }).from(actions)
      .where(and(eq(actions.orgId, v.orgId), eq(actions.roomId, p.data), eq(actions.key, key))).orderBy(desc(actions.at), desc(actions.id)).limit(1);
    return (row?.value ?? null) as any;
  };
  const liveLog = await latest('forecast.live');
  const decisions = await latest('forecast.decisions');
  const stored = await db.select({ day: posDays.day, orders: posDays.orders, items: posDays.items }).from(posDays)
    .where(and(eq(posDays.orgId, v.orgId), eq(posDays.roomId, p.data), gte(posDays.day, addDays(local, -HISTORY_DAYS))));
  const fromPos = stored.length ? seriesFromOrders(stored) : null;
  const series = fromPos?.days.length ? fromPos : r.fromToast ? null : seriesFromSample(r);
  const source = fromPos?.days.length ? 'toast' : series ? 'sample' : (own.days?.length ? 'manual' : 'none');
  // A sample room's "today" is the day after its data; a real room's is its own local day.
  const today = source === 'sample' && series ? addDays(series.days.at(-1)!.iso, 1) : local;

  // Feeds (never for the sample group: nothing is sent for it).
  const loc = own.location ?? null;
  const sample = !!loaded.org.sample;
  const wx = sample ? null : await weatherFeed(loc, { fetchImpl, now: now.getTime() });
  const ev = sample ? null : await eventsFeed(loc, today, addDays(today, days), { fetchImpl, now: now.getTime() });
  const rs = reservationsFeed();
  const manualWx = new Set((own.weather ?? []).map((w) => w.date));
  const manualEv = new Set((own.events ?? []).map((e) => `${e.date}|${e.name.toLowerCase()}`));
  const signals = {
    ...own,
    weather: [...(own.weather ?? []).map((w) => ({ ...w, source: 'manual' })), ...(wx?.days ?? []).filter((w) => !manualWx.has(w.date))],
    events: [...(own.events ?? []), ...(ev?.events ?? []).filter((e) => !manualEv.has(`${e.date}|${e.name.toLowerCase()}`))],
    reservations: (own.reservations ?? []).map((x) => ({ ...x, source: 'manual' })),
  };
  const f = covercastRoom(r, { series: series ?? undefined, today, days, signals, models: true, live: liveLog, decisions });
  const arrivalsStatus = arrivalsFeed().status;
  // Tonight from the host's counts, when the latest check is logged for today.
  let arrivals = null;
  const todayLog = (liveLog?.services ?? []).filter((x: any) => x.date === local && x.cuts?.length).at(-1);
  if (todayLog && f.ready && f.covers?.days?.[0]?.iso === local) {
    const cut = todayLog.cuts.at(-1);
    arrivals = { service: todayLog.service, at: cut.at, ...arrivalsForecast({ ...cut, planTotal: cut.planSoFar + cut.planRest, learned: f.live!.learned, q: (f.live!.validation as any)?.q ?? null }) };
  }

  // During service: the rest of today, re-forecast from covers so far.
  let intraday = null;
  const first = f.ready ? f.covers?.days?.[0] : null;
  if (first?.iso === local && source !== 'sample') {
    const [live] = await db.select().from(serviceLive).where(and(eq(serviceLive.orgId, v.orgId), eq(serviceLive.roomId, p.data), eq(serviceLive.day, local)));
    const stamp = now.toLocaleTimeString('en-GB', { timeZone: tz, hour12: false });
    const nowHour = +stamp.slice(0, 2);
    const cut = nowHour >= 19 ? 19 : 18;
    const tuned = f.accuracy?.covers?.hours?.intraday?.[cut];
    const opt = { nowHour, fromHour: 17, kappa: tuned?.kappa ?? 0.1, q: tuned?.q ?? null };
    if (live?.manual?.covers != null && (!live.pulledAt || Date.parse(live.manual.at) > live.pulledAt.getTime())) {
      intraday = { from: 'manual', ...reforecast(first, live.manual.covers, opt) };
    } else if (live?.slots?.length && nowHour >= 17) {
      intraday = { from: 'toast', ...reforecast(first, hoursFromSlots(live.slots), opt) };
    }
  }
  return {
    roomId: p.data, today, tz, source, sample,
    feeds: [wx?.status ?? { key: 'weather', label: 'Weather', status: 'off', note: 'Not used for the sample group.' }, ev?.status ?? { key: 'events', label: 'Events nearby', status: 'off', note: 'Not used for the sample group.' }, rs.status, arrivalsStatus],
    location: loc,
    forecast: f,
    intraday,
    arrivals,
  };
}
