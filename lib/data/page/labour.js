/* Labor page: pure helpers shared by the browser and the tests.
 * Nothing here invents a number: every figure is read from the room's own
 * services (scheduled, needed and covers per hour), its findings and its
 * proof records. Hand-entered days are kept apart and labelled as such. */

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
export const dayName = (d) => DAY_NAMES[d] || d;
export const numWord = (n) => NUM_WORDS[n] ?? String(n);

/** "7 pm" or 19 → "7 PM". */
export function hourLabel(h) {
  if (typeof h === 'number') return `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
  return String(h).replace(/\s*([ap])m$/i, (_, x) => ` ${x.toUpperCase()}M`);
}

/** "7 PM", "7 PM and 8 PM", "6 PM, 7 PM and 8 PM". */
export function listOf(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * The sample room's services (seed `labour.tue`, `labour.sat`, …) as one shape.
 * @param {any} L room.labour
 */
export function sampleServices(L) {
  if (!L) return [];
  return Object.entries(L)
    .filter(([, v]) => v && Array.isArray(v.hours) && Array.isArray(v.sched) && Array.isArray(v.need))
    .map(([key, v]) => {
      const day = DAYS.find((d) => d.toLowerCase() === key.slice(0, 3).toLowerCase()) || key;
      return {
        key, day, label: v.label || dayName(day),
        hours: v.hours.map((h, i) => ({ label: hourLabel(h), sched: v.sched[i], need: v.need[i], covers: v.covers?.[i] ?? null })),
      };
    })
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
}

/**
 * A room on its own clock-ins: one service per weekday that has hourly rows.
 * @param {Record<string, { hours: { hour: number, covers: number, servers: number, need: number }[] } | null>} plans by weekday
 */
export function planServices(plans) {
  return DAYS.filter((d) => plans?.[d]?.hours?.length).map((d) => ({
    key: d, day: d, label: dayName(d),
    hours: plans[d].hours.map((h) => ({ label: hourLabel(h.hour), sched: Math.round(h.servers), need: h.need, covers: h.covers })),
  }));
}

/** Short and spare server-hours in one service, and which hours they fall in. */
export function coverage(svc) {
  const shortAt = [], spareAt = [];
  let short = 0, spare = 0;
  for (const h of svc.hours) {
    const gap = h.sched - h.need;
    if (gap < 0) { short += -gap; shortAt.push({ label: h.label, by: -gap }); }
    if (gap > 0) { spare += gap; spareAt.push({ label: h.label, by: gap }); }
  }
  return { short, spare, shortAt, spareAt };
}

/** The one service to look at first: the most short hours, else the most spare ones. */
export function topIssue(services) {
  let best = null;
  for (const svc of services) {
    const c = coverage(svc);
    const covers = svc.hours.reduce((t, h) => t + (h.covers || 0), 0);
    const score = c.short * 1000 + c.spare * 10 + covers / 1000;
    if ((c.short || c.spare) && (!best || score > best.score)) best = { svc, cov: c, kind: c.short ? 'short' : 'spare', score };
  }
  return best;
}

/** "one server short at 7 PM and 8 PM" / "short at 6 PM (1) and 7 PM (2)". */
export function shortPhrase(shortAt) {
  if (!shortAt.length) return '';
  const same = shortAt.every((x) => x.by === shortAt[0].by);
  if (same) return `${numWord(shortAt[0].by)} server short at ${listOf(shortAt.map((x) => x.label))}`;
  return `short at ${listOf(shortAt.map((x) => `${x.label} (${x.by})`))}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The next best moves, in the order to look at them. Each is advice: none of
 * them changes a live schedule.
 * @param {{ services: any[], candidates?: any[], draft?: { approval: string, note: string } | null }} p
 */
export function moves({ services, candidates = [], draft = null }) {
  const out = [];
  const top = topIssue(services);
  if (top && top.kind === 'short') {
    out.push({
      id: `cover:${top.svc.key}`, kind: 'cover', tone: 'risk', tag: 'Service risk', svc: top.svc.key,
      title: `${top.svc.label}: protect service`,
      body: `Add server coverage at ${listOf(top.cov.shortAt.map((x) => x.label))}. Fix the gap before considering a later cut.`,
      worth: `${plural(top.cov.short, 'short server-hour')}`, worthNote: 'No savings claimed',
    });
  }
  if (draft?.approval) {
    out.push({ id: `draft:${draft.approval}`, kind: 'draft', tone: 'ready', tag: 'Draft ready', approval: draft.approval, title: 'Next week’s schedule draft', body: draft.note });
  }
  for (const c of [...candidates].filter((x) => x.lever === 'Labour').sort((a, b) => (b.edv || 0) - (a.edv || 0))) {
    out.push({
      id: `cand:${c.id}`, kind: 'candidate', tone: c.prevent ? 'ready' : 'potential', tag: c.prevent ? 'Avoids a cost' : 'Potential', finding: c.id,
      title: c.title, body: c.why, value: c.value, lo: c.lo, hi: c.hi, claim: c.claim, prevent: !!c.prevent, minutes: Math.round((c.hours || 0) * 60),
    });
  }
  const spare = services.map((svc) => ({ svc, cov: coverage(svc) })).filter((x) => x.cov.spare).sort((a, b) => b.cov.spare - a.cov.spare)[0];
  if (spare) {
    out.push({
      id: `spare:${spare.svc.key}`, kind: 'spare', tone: 'check', tag: 'Verify duties', svc: spare.svc.key,
      title: `${spare.svc.label}: check the spare ${spare.cov.spare === 1 ? 'hour' : 'hours'}`,
      body: `${plural(spare.cov.spare, 'possible spare server-hour')} at ${listOf(spare.cov.spareAt.map((x) => x.label))}. Confirm side work, cleanup and guest demand before reducing.`,
      worth: `${plural(spare.cov.spare, 'candidate hour')}`, worthNote: 'Savings unknown',
    });
  }
  return out;
}

/** Moves split by what the operator has said about them. `saved` is { [id]: { s: 'planned' | 'skipped', at } }. */
export function splitMoves(list, saved = {}) {
  const open = [], planned = [], skipped = [];
  for (const m of list) {
    const s = saved?.[m.id]?.s;
    (s === 'planned' ? planned : s === 'skipped' ? skipped : open).push(m);
  }
  return { open, planned, skipped };
}

/**
 * Covers per server-hour as a weekday × hour grid. Cells with no reading are null.
 * @param {{ dow: string, cells: { hour: number, cps: number }[] }[]} grid from heat()
 */
export function loadGridFromHeat(grid) {
  const hours = (grid[0]?.cells || []).map((c) => c.hour).filter((hr) => grid.some((r) => r.cells.find((c) => c.hour === hr)?.cps > 0));
  return {
    hours: hours.map((h) => ({ hour: h, label: hourLabel(h) })),
    rows: grid.map((r) => ({ day: r.dow, cells: hours.map((hr) => { const v = r.cells.find((c) => c.hour === hr)?.cps; return v > 0 ? Math.round(v * 10) / 10 : null; }) })),
  };
}

/** The same grid for a room on its own clock-ins. */
export function loadGridFromPlans(plans) {
  const days = DAYS.filter((d) => plans?.[d]?.hours?.length);
  const hours = [...new Set(days.flatMap((d) => plans[d].hours.map((h) => h.hour)))].sort((a, b) => a - b);
  return {
    hours: hours.map((h) => ({ hour: h, label: hourLabel(h) })),
    rows: days.map((d) => ({ day: d, cells: hours.map((hr) => { const h = plans[d].hours.find((x) => x.hour === hr); return h && h.servers > 0 ? Math.round((h.covers / h.servers) * 10) / 10 : null; }) })),
  };
}

/** The busiest cell of a load grid, or null. */
export function peakCell(grid) {
  let top = null;
  grid.rows.forEach((r, ri) => r.cells.forEach((v, ci) => { if (v != null && (!top || v > top.v)) top = { ri, ci, v }; }));
  return top;
}

/* ---------------------------------------------------------------- hand-entered days */

export const MAX_ENTRIES = 120;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => (v === '' || v == null ? null : Number(v));

/**
 * One hand-entered day, checked. Returns { ok, entry } or { ok: false, error }.
 * A day needs a date and at least one of: labor cost, hours worked, hours scheduled.
 */
export function checkEntry(raw, { today } = {}) {
  const date = String(raw?.date || '');
  if (!ISO_DAY.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return { ok: false, error: 'Pick a date.' };
  if (today && date > today) return { ok: false, error: 'That date hasn’t happened yet.' };
  const entry = { date };
  for (const [k, label, max] of [['cost', 'Labor cost', 200000], ['hours', 'Hours worked', 5000], ['sched', 'Hours scheduled', 5000]]) {
    const v = num(raw?.[k]);
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 0 || v > max) return { ok: false, error: `${label} doesn’t look right.` };
    entry[k] = Math.round(v * 100) / 100;
  }
  if (entry.cost == null && entry.hours == null && entry.sched == null) return { ok: false, error: 'Enter a labor cost or hours for that day.' };
  return { ok: true, entry };
}

/** Add or replace a day (one entry per date), newest first, capped. */
export function withEntry(entries, entry) {
  return [entry, ...(entries || []).filter((e) => e.date !== entry.date)].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, MAX_ENTRIES);
}

/** Totals of hand-entered days from `from` to `to` (inclusive ISO days). Null where nothing was entered. */
export function entryTotals(entries, from, to) {
  const rows = (entries || []).filter((e) => e.date >= from && e.date <= to);
  const sum = (k) => { const xs = rows.filter((e) => e[k] != null); return xs.length ? Math.round(xs.reduce((t, e) => t + e[k], 0) * 100) / 100 : null; };
  return { days: rows.length, cost: sum('cost'), hours: sum('hours'), sched: sum('sched') };
}
