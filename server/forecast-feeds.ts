// Covercast's outside feeds. Each one switches on when its key is in the
// environment and stays off (never an error) without it; a manager's own
// entries on the forecast cover the same ground either way, and always win
// over a feed on the same day. Keys live in Vercel env only and are never
// logged or returned.
//
//  - Weather: OpenWeather One Call 3.0 daily forecast (OPENWEATHER_API_KEY),
//    for the room's location (saved with the forecast signals).
//  - Events nearby: Ticketmaster Discovery (TICKETMASTER_API_KEY), within two
//    miles of the room.
//  - Reservations: OpenTable and Resy only open their APIs to partners. The
//    slot is here (OPENTABLE_API_KEY / RESY_API_KEY) and reports "waiting on
//    partner access" when a key is set; bookings are entered by hand until then.

type Fetch = typeof fetch;
export type FeedStatus = { key: 'weather' | 'events' | 'reservations'; label: string; status: 'off' | 'ok' | 'down' | 'waiting' | 'needs-location'; note: string; at?: string };
export type WeatherDay = { date: string; rainIn: number; tempF: number | null; source: 'openweather' };
export type EventDay = { date: string; name: string; lift: null; by: 'Ticketmaster' };

const HOUR = 36e5;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>, now: number): Promise<T> {
  const hit = cache.get(key);
  if (hit && now - hit.at < ms) return hit.value as T;
  const value = await fn();
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: now, value });
  return value;
}
/** For tests: forget cached feed answers. */
export const clearFeedCache = () => cache.clear();

const toDate = (unix: number, offsetSec: number) => new Date((unix + offsetSec) * 1000).toISOString().slice(0, 10);

/** The next eight days of weather at a place, or the reason there isn't any. */
export async function weatherFeed(loc: { lat: number; lon: number } | null, { fetchImpl = fetch, now = Date.now() }: { fetchImpl?: Fetch; now?: number } = {}) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return { status: { key: 'weather', label: 'Weather', status: 'off', note: 'Add OPENWEATHER_API_KEY to switch on. Until then, enter rain on the forecast by hand.' } as FeedStatus, days: [] as WeatherDay[] };
  if (!loc) return { status: { key: 'weather', label: 'Weather', status: 'needs-location', note: 'Set the room’s location on the forecast to switch weather on.' } as FeedStatus, days: [] as WeatherDay[] };
  try {
    const days = await cached(`wx:${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`, 3 * HOUR, async () => {
      const u = `https://api.openweathermap.org/data/3.0/onecall?lat=${loc.lat}&lon=${loc.lon}&exclude=current,minutely,hourly,alerts&units=imperial&appid=${encodeURIComponent(key)}`;
      const res = await fetchImpl(u, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`weather answered ${res.status}`);
      const j = (await res.json()) as { timezone_offset?: number; daily?: { dt: number; rain?: number; temp?: { max?: number } }[] };
      return (j.daily || []).map((d) => ({ date: toDate(d.dt, j.timezone_offset ?? 0), rainIn: Math.round(((d.rain ?? 0) / 25.4) * 100) / 100, tempF: typeof d.temp?.max === 'number' ? Math.round(d.temp.max) : null, source: 'openweather' as const }));
    }, now);
    return { status: { key: 'weather', label: 'Weather', status: 'ok', note: `${days.length} days from OpenWeather.`, at: new Date(now).toISOString() } as FeedStatus, days };
  } catch (e) {
    return { status: { key: 'weather', label: 'Weather', status: 'down', note: `Weather feed is down (${e instanceof Error ? e.message : 'no answer'}). Enter rain by hand if it matters.` } as FeedStatus, days: [] as WeatherDay[] };
  }
}

/** Ticketed events within two miles over the next two weeks. */
export async function eventsFeed(loc: { lat: number; lon: number } | null, from: string, to: string, { fetchImpl = fetch, now = Date.now() }: { fetchImpl?: Fetch; now?: number } = {}) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return { status: { key: 'events', label: 'Events nearby', status: 'off', note: 'Add TICKETMASTER_API_KEY to switch on. Until then, add events on the forecast by hand.' } as FeedStatus, events: [] as EventDay[] };
  if (!loc) return { status: { key: 'events', label: 'Events nearby', status: 'needs-location', note: 'Set the room’s location on the forecast to switch events on.' } as FeedStatus, events: [] as EventDay[] };
  try {
    const events = await cached(`ev:${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}:${from}`, 6 * HOUR, async () => {
      const u = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(key)}&latlong=${loc.lat},${loc.lon}&radius=2&unit=miles&size=100&sort=date,asc&startDateTime=${from}T00:00:00Z&endDateTime=${to}T23:59:59Z`;
      const res = await fetchImpl(u, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`events answered ${res.status}`);
      const j = (await res.json()) as { _embedded?: { events?: { name?: string; dates?: { start?: { localDate?: string } } }[] } };
      return (j._embedded?.events || []).filter((e) => e.name && e.dates?.start?.localDate)
        .map((e) => ({ date: e.dates!.start!.localDate!, name: String(e.name).slice(0, 80), lift: null, by: 'Ticketmaster' as const }));
    }, now);
    return { status: { key: 'events', label: 'Events nearby', status: 'ok', note: `${events.length} events within two miles.`, at: new Date(now).toISOString() } as FeedStatus, events };
  } catch (e) {
    return { status: { key: 'events', label: 'Events nearby', status: 'down', note: `Events feed is down (${e instanceof Error ? e.message : 'no answer'}). Add events by hand if one matters.` } as FeedStatus, events: [] as EventDay[] };
  }
}

/** Reservations: a slot for a partner feed; bookings come in by hand until one exists. */
export function reservationsFeed(): { status: FeedStatus } {
  const has = !!(process.env.OPENTABLE_API_KEY || process.env.RESY_API_KEY);
  return {
    status: has
      ? { key: 'reservations', label: 'Reservations', status: 'waiting', note: 'A reservation key is set. OpenTable and Resy share bookings with approved partners only, so this switches on once access is granted. Enter bookings by hand meanwhile.' }
      : { key: 'reservations', label: 'Reservations', status: 'off', note: 'No reservation feed. Enter covers on the books by hand; Covercast learns how bookings turn into covers.' },
  };
}
