/* Small, quiet additions borrowed from the competitor scan
 * (/mnt/project-files/competitors/restaurant-intelligence-scan.md). Pure:
 * every value is read from a derived room (`deriveRoom`), nothing is typed.
 * Each helper returns null when it has nothing worth saying, so the screen
 * shows nothing rather than an empty box. */

import { money } from './model.js';

/** The AI teammate's name, shown as a small "Spotted by" tag. */
export const TEAMMATE = 'Sous';

/** One short reason per room, for the All rooms list ("every room ranked, the why included"). */
export function roomReason(d) {
  const best = [...(d.candidates || [])].filter((c) => !c.prevent && c.value > 0.5).sort((a, b) => b.value - a.value)[0];
  if (!best) return null;
  return { tone: 'good', text: `Potential: ${best.title.charAt(0).toLowerCase()}${best.title.slice(1)}, about ${money(Math.round(best.value))}/wk` };
}

/** Last week's quick checks from the room's own data: the "mystery shop" a consultant would run once a quarter. */
export function serviceChecks(d) {
  const t = d.room.tickets;
  const peak = t ? Math.max(...(t.fri || []), ...(t.sat || [])) : null;
  const list = [
    t && peak != null && { k: 'tickets', label: 'Weekend tickets on time', ok: peak <= t.target + 1, detail: `Slowest hour ${peak.toFixed(1)} min, goal ${t.target} min` },
    { k: 'giveaways', label: 'Comps and voids inside limits', ok: d.staff.signalCount === 0, detail: d.staff.signalCount === 0 ? 'Everyone inside their limit' : `${d.staff.signalCount} over their limit` },
    { k: 'usage', label: 'Food used matches food sold', ok: d.usage.flagged.length === 0, detail: d.usage.flagged.length === 0 ? 'Every item inside its count tolerance' : `${d.usage.flagged.length} item${d.usage.flagged.length === 1 ? '' : 's'} off: ${d.usage.flagged.map((r) => (r.label || r.item).replace(/\s*\(.*\)$/, '').replace(/,.*$/, '')).join(', ')}` },
    { k: 'kept', label: 'Kept more than similar weeks', ok: d.hist.marginMove >= 0, detail: `${d.hist.marginMove >= 0 ? '+' : '−'}${money(Math.abs(Math.round(d.hist.marginMove)))} vs similar weeks` },
  ].filter(Boolean);
  return { list, good: list.filter((c) => c.ok).length, total: list.length };
}

/** How well a day's schedule matches the hours' need: a grade before it's posted. */
export function scheduleFit(day) {
  if (!day?.sched?.length || !day?.need?.length) return null;
  const need = day.need.reduce((s, v) => s + v, 0);
  if (!need) return null;
  const off = day.sched.reduce((s, v, i) => s + Math.abs(v - (day.need[i] ?? 0)), 0);
  const fit = Math.max(0, 1 - off / need);
  const grade = fit >= 0.9 ? 'A' : fit >= 0.8 ? 'B' : fit >= 0.7 ? 'C' : 'D';
  return { fit, grade, off, good: grade === 'A' || grade === 'B' };
}

/** A verified result explained in one plain line: what it was compared with, and what we count. */
export function proofPlain(p) {
  if (!p || !['verified', 'limited'].includes(p.outcome)) return null;
  const m = p.method || '';
  const vs = /vs\s+(\d+ [^,]+)/i.exec(m)?.[1] || (/^matched control services/i.test(m) ? 'matched services that kept the old way' : /^control chart/i.test(m) ? 'its own normal range (a control chart)' : null);
  const parts = [];
  if (vs) parts.push(`Compared with ${vs}, so a busy or slow week isn't counted as the change.`);
  if (p.bookable != null && p.point != null && p.point !== p.bookable) parts.push(`We count the cautious end: ${money(p.bookable)} of the ${money(p.point)} a week it measured.`);
  if (/^\d+ weeks?$/.test(p.held || '')) parts.push(`Still holding after ${p.held}.`);
  return parts.length ? parts.join(' ') : null;
}
