/**
 * A synthetic restaurant with the things that trip up a plain "usual night"
 * forecast, each with a known size: growth, a step change halfway (a patio
 * opens), holidays that move demand, a closure, and day-to-day noise. Used to
 * check Covercast finds what's really there. Not a real restaurant.
 */
import { addDays, holidayOn, wdOf } from '../../lib/data/forecast/calendar.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** Sun..Sat covers on a normal week, before growth. */
export const WEEKDAY = [150, 95, 100, 115, 130, 190, 210];
export const HOLIDAY_EFFECT = { thanksgiving: 0.4, valentines: 1.45, mothers: 1.5, 'new-years-eve': 1.3, 'july-4': 0.7, 'super-bowl': 0.8 };
const HOUR_SHAPE = { 11: 0.05, 12: 0.1, 13: 0.08, 14: 0.035, 15: 0.02, 16: 0.04, 17: 0.1, 18: 0.17, 19: 0.18, 20: 0.13, 21: 0.07, 22: 0.025 };

export function stressRoom({ from = '2024-10-28', to = '2026-10-25', seed = 11, noise = 0.07, growth = 0.08, stepAt = '2025-11-03', step = 1.12, hours = true } = {}) {
  const r = rng(seed);
  const days = [], hrs = [];
  for (let iso = from, i = 0; iso <= to; iso = addDays(iso, 1), i++) {
    if (iso.slice(5) === '12-25') continue; // closed on Christmas: no row at all
    const h = holidayOn(iso);
    const mult = (1 + growth) ** (i / 365) * (iso >= stepAt ? step : 1) * (h ? HOLIDAY_EFFECT[h.key] ?? 1 : 1);
    const covers = Math.max(5, Math.round(WEEKDAY[wdOf(iso)] * mult * Math.exp(noise * gauss(r))));
    days.push({ iso, covers, net: Math.round(covers * (52 + 6 * r()) * 100) / 100, source: 'pos' });
    if (hours && iso >= addDays(to, -90)) {
      for (const [hh, s] of Object.entries(HOUR_SHAPE)) {
        const c = Math.round(covers * s * Math.exp(0.15 * gauss(r)));
        hrs.push({ iso, hour: +hh, covers: c, sales: Math.round(c * 55 * 100) / 100 });
      }
    }
  }
  return { days, hours: hrs, quarters: [], source: 'pos' };
}
