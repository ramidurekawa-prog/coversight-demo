/**
 * Covercast for one room, as the pages and the server both ask for it:
 * covers and sales ahead, plus how accurate it has been on this room.
 * The accuracy report is the slow part (about a tenth of a second a figure),
 * so it's kept per room and data day.
 */
import { measuredServiceRate } from '../levers.js';
import { addDays } from './calendar.js';
import { backtestDays, backtestHours, ENGINE, forecast, normalizeSignals, reforecast, TUNING, VERSION } from './engine.js';
import { seriesFromOrders, seriesFromSample, withManualDays } from './series.js';
import { backtestShiftPulse, livePace, liveTuning, quarterCurve, servicePlanOf, shiftPulseDay } from './shift-pulse.js';

export { backtestShiftPulse, livePace, liveTuning, quarterCurve, servicePlanOf, shiftPulseDay };
export { ENGINE, VERSION, TUNING, forecast, reforecast, backtestDays, backtestHours, seriesFromOrders, seriesFromSample, withManualDays, normalizeSignals };

const CACHE = new Map();

/** Accuracy for a room's series: day, week, service, hour and intraday, Covercast against the current method. */
export function accuracyOf(series, { key, signals } = {}) {
  const through = series.days.at(-1)?.iso;
  const k = key ? `${key}|${through}|${series.days.length}` : null;
  if (k && CACHE.has(k)) return CACHE.get(k);
  const sig = normalizeSignals(signals);
  const special = new Map(sig.events.map((e) => [e.date, { kind: 'event', key: `event:${e.name.toLowerCase()}`, label: e.name }]));
  const closed = new Set(sig.closures);
  const out = {};
  for (const m of /** @type {const} */ (['covers', 'net'])) {
    out[m] = { days: backtestDays(series.days, m, { special, closed }), hours: series.hours?.length ? backtestHours(series.days, series.hours, m, { special, closed }) : null };
  }
  if (k) { if (CACHE.size > 50) CACHE.clear(); CACHE.set(k, out); }
  return out;
}

/** The Service page's record on a room (per service: hours, staffing, live), kept per room and data day. */
export function shiftPulseOf(series, { key, rate, signals } = {}) {
  if (!series?.hours?.length) return null;
  const k = key ? `sp|${key}|${series.days.at(-1)?.iso}|${series.days.length}|${rate}` : null;
  if (k && CACHE.has(k)) return CACHE.get(k);
  const sig = normalizeSignals(signals);
  const special = new Map(sig.events.map((e) => [e.date, { kind: 'event', key: `event:${e.name.toLowerCase()}`, label: e.name }]));
  const out = backtestShiftPulse(series, { rate, special, closed: new Set(sig.closures) });
  if (k) { if (CACHE.size > 50) CACHE.clear(); CACHE.set(k, out); }
  return out;
}

/** The covers-per-server-hour a room has shown it can handle, if measured. */
export const serverRate = (room) => measuredServiceRate(room?.levers?.serviceHours || [])?.coversPerServerHour ?? null;

/**
 * Covercast for a room in the browser (sample rooms, or any series handed in).
 * @param {any} room
 * @param {{ series?: any, today?: string, days?: number, signals?: any, accuracy?: boolean }} [opt]
 */
export function covercastRoom(room, { series, today, days = 14, signals = {}, accuracy = true } = {}) {
  const sig = signals || {};
  const s = withManualDays(series ?? seriesFromSample(room), sig.days || []);
  if (!s?.days?.length) return { engine: ENGINE, ready: false, why: 'No days on file yet.' };
  const day = today ?? addDays(s.days.at(-1).iso, 1);
  const rate = serverRate(room);
  return {
    engine: ENGINE, version: VERSION, ready: true, today: day, rate,
    covers: forecast(s, 'covers', { today: day, days, signals: sig, rate }),
    sales: forecast(s, 'net', { today: day, days, signals: sig }),
    accuracy: accuracy ? accuracyOf(s, { key: room?.profile?.id, signals: sig }) : null,
    shiftPulse: shiftPulseOf(s, { key: room?.profile?.id, rate, signals: sig }),
  };
}
