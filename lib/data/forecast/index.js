/**
 * Covercast for one room, as the pages and the server both ask for it:
 * covers and sales ahead, plus how accurate it has been on this room.
 * The accuracy report is the slow part (about a tenth of a second a figure),
 * so it's kept per room and data day.
 */
import { measuredServiceRate } from '../levers.js';
import { addDays } from './calendar.js';
import { backtestDays, backtestHours, dayContext, ENGINE, forecast, normalizeSignals, reforecast, TUNING, VERSION } from './engine.js';
import { seriesFromOrders, seriesFromSample, withManualDays } from './series.js';
import { pilotReport, prepPlan, staffingCost } from './decisions.js';
import { arrivalsForecast, backtestArrivals, learnArrivals } from './live.js';
import { pickModels } from './select.js';
import { backtestShiftPulse, livePace, liveTuning, quarterCurve, servicePlanOf, shiftPulseDay } from './shift-pulse.js';

export { backtestShiftPulse, livePace, liveTuning, quarterCurve, servicePlanOf, shiftPulseDay };
export { arrivalsForecast, backtestArrivals, learnArrivals, pickModels, pilotReport, prepPlan, staffingCost };
export { ENGINE, VERSION, TUNING, forecast, reforecast, backtestDays, backtestHours, seriesFromOrders, seriesFromSample, withManualDays, normalizeSignals };

const CACHE = new Map();
/** A short fingerprint of the signals that change a backtest (events, closures, sellouts). */
function sigKey(sig) {
  const txt = JSON.stringify([sig.events.map((e) => e.date + e.name), sig.closures, sig.capacity.map((c) => `${c.date}${c.soldOut ? 's' : ''}${c.turnedAway ?? ''}`)]);
  let h = 0;
  for (let i = 0; i < txt.length; i++) h = (Math.imul(h, 31) + txt.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Accuracy for a room's series: day, week, service, hour and intraday, Covercast against the current method. */
export function accuracyOf(series, { key, signals } = {}) {
  const through = series.days.at(-1)?.iso;
  const sig = normalizeSignals(signals);
  const k = key ? `${key}|${through}|${series.days.length}|${sigKey(sig)}` : null;
  if (k && CACHE.has(k)) return CACHE.get(k);
  const ctx = dayContext(sig);
  const out = {};
  for (const m of /** @type {const} */ (['covers', 'net'])) {
    out[m] = { days: backtestDays(series.days, m, ctx), hours: series.hours?.length ? backtestHours(series.days, series.hours, m, ctx) : null };
  }
  if (k) { if (CACHE.size > 50) CACHE.clear(); CACHE.set(k, out); }
  return out;
}

/** The Service page's record on a room (per service: hours, staffing, live), kept per room and data day. */
export function shiftPulseOf(series, { key, rate, signals } = {}) {
  if (!series?.hours?.length) return null;
  const sig = normalizeSignals(signals);
  const k = key ? `sp|${key}|${series.days.at(-1)?.iso}|${series.days.length}|${rate}|${sigKey(sig)}` : null;
  if (k && CACHE.has(k)) return CACHE.get(k);
  const { special, closed } = dayContext(sig);
  const out = backtestShiftPulse(series, { rate, special, closed });
  if (k) { if (CACHE.size > 50) CACHE.clear(); CACHE.set(k, out); }
  return out;
}

/** The covers-per-server-hour a room has shown it can handle, if measured. */
export const serverRate = (room) => measuredServiceRate(room?.levers?.serviceHours || [])?.coversPerServerHour ?? null;

const PICKS = new Map();
/** The per-task model pick for a room's series, kept per room and data day (it's the slow part). */
export function modelsOf(series, { key, signals } = {}) {
  const sig = normalizeSignals(signals);
  const k = key ? `pk|${key}|${series.days.at(-1)?.iso}|${series.days.length}|${sigKey(sig)}` : null;
  if (k && PICKS.has(k)) return PICKS.get(k);
  const out = pickModels(series, { signals: sig });
  if (k) { if (PICKS.size > 30) PICKS.clear(); PICKS.set(k, out); }
  return out;
}

/**
 * Prep for one forecast day: each item's units from the covers forecast × its
 * recent share of covers (4 same weekdays from daily counts, else 4 weeks),
 * sized by its own price and cost when the menu has them.
 */
export function prepFor(room, series, day, misses = []) {
  if (!day?.value) return [];
  const menu = new Map((room?.menu || []).map((m) => [m.name, m]));
  const share = new Map();
  if (series.items?.length) {
    const back = [1, 2, 3, 4].map((k) => addDays(day.iso, -7 * k));
    const cov = new Map(series.days.map((d) => [d.iso, d.covers]));
    const C = back.reduce((t, b) => t + (cov.get(b) ?? 0), 0);
    if (C > 0) for (const it of series.items) if (back.includes(it.iso)) share.set(it.item, (share.get(it.item) ?? 0) + it.qty / C);
  } else if (series.itemWeeks?.length) {
    const weeks = [...new Set(series.itemWeeks.map((w) => w.week))].sort().slice(-4);
    const cov = series.days.filter((d) => d.iso >= weeks[0] && d.iso < addDays(weeks.at(-1), 7)).reduce((t, d) => t + (d.covers ?? 0), 0);
    if (cov > 0) for (const w of series.itemWeeks) if (weeks.includes(w.week)) share.set(w.item, (share.get(w.item) ?? 0) + w.qty / cov);
  }
  // Kitchen prep only: drinks and other non-food lines are left out when the menu says so.
  const items = [...share].filter(([item, x]) => x > 0 && (!menu.get(item)?.cat || menu.get(item).cat === 'Food'))
    .map(([item, x]) => ({ item, forecast: day.value * x, price: menu.get(item)?.price ?? null, cost: menu.get(item)?.cost ?? null }));
  const from = series.items?.length ? 'days' : 'weeks';
  return prepPlan(items, misses).map((x) => ({ ...x, missesFrom: from })).sort((a, b) => b.forecast - a.forecast);
}

/**
 * Covercast for a room in the browser (sample rooms, or any series handed in).
 * models: pick the model per task (slower; the server always does).
 * live:   logged services with the host's counts ({ services: [...] }), costs and pilot from 'forecast.decisions'.
 * @param {any} room
 * @param {{ series?: any, today?: string, days?: number, signals?: any, accuracy?: boolean, models?: boolean, live?: any, decisions?: any }} [opt]
 */
export function covercastRoom(room, { series, today, days = 14, signals = {}, accuracy = true, models = false, live = null, decisions = null } = {}) {
  const sig = signals || {};
  const s = withManualDays(series ?? seriesFromSample(room), sig.days || []);
  if (!s?.days?.length) return { engine: ENGINE, ready: false, why: 'No days on file yet.' };
  const day = today ?? addDays(s.days.at(-1).iso, 1);
  const rate = serverRate(room);
  const key = room?.profile?.id;
  const picks = models ? modelsOf(s, { key, signals: sig }) : null;
  const covers = forecast(s, 'covers', { today: day, days, signals: sig, rate, model: picks?.uses?.day ?? 'v1' });
  const shiftPulse = shiftPulseOf(s, { key, rate, signals: sig });
  const wage = Number.isFinite(room?.levers?.wage) ? room.levers.wage : null;
  const costs = decisions?.costs?.shortHour > 0 ? { shortHour: decisions.costs.shortHour, idleHour: decisions.costs.idleHour ?? wage } : null;
  const logs = Array.isArray(live?.services) ? live.services : [];
  return {
    engine: ENGINE, version: VERSION, ready: true, today: day, rate, costs,
    covers,
    sales: forecast(s, 'net', { today: day, days, signals: sig }),
    accuracy: accuracy ? accuracyOf(s, { key, signals: sig }) : null,
    shiftPulse,
    models: picks,
    prep: covers.ready ? prepFor(room, s, covers.days[0], picks?.tasks?.prep?.misses ?? []) : [],
    live: { learned: learnArrivals(logs), validation: backtestArrivals(logs) },
    decisions: {
      costs: costs ?? { shortHour: null, idleHour: wage, note: 'Set what a short server-hour costs you to size staffing by cost.' },
      staffing: costs ? Object.fromEntries(['lunch', 'dinner'].map((sv) => [sv, staffingCost(shiftPulse?.staffing?.[sv], costs)])) : null,
      pilot: pilotReport(decisions?.entries ?? []),
    },
  };
}
