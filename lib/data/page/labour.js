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

const HOUR_RE = /^(\d{1,2}) (AM|PM)$/;
const hour24 = (label) => { const m = HOUR_RE.exec(label); if (!m) return null; const h = Number(m[1]) % 12; return m[2] === 'PM' ? h + 12 : h; };
/** The hours as one run ("9 AM to 2 PM", end exclusive) when they follow each other, else null. */
function runOf(at) {
  const hrs = at.map((x) => hour24(x.label));
  if (!hrs.every((h, i) => h != null && (i === 0 || h === hrs[i - 1] + 1))) return null;
  return `${at[0].label} to ${hourLabel((hrs.at(-1) + 1) % 24)}`;
}

/** Hours split into stretches that follow each other: "11 AM to 3 PM and 5 PM to 9 PM". Null when an hour can't be read. */
function runsOf(at) {
  const groups = [];
  for (const x of at) { const h = hour24(x.label); if (h == null) return null; const g = groups.at(-1); if (g && h === g.end + 1) g.end = h; else groups.push({ from: x.label, end: h }); }
  return listOf(groups.map((g) => `${g.from} to ${hourLabel((g.end + 1) % 24)}`));
}

/** "one server short at 7 PM and 8 PM" / "up to 3 servers short, 9 AM to 2 PM" / "short at 5 PM (1) and 8 PM (2)". */
export function shortPhrase(shortAt) {
  if (!shortAt.length) return '';
  const same = shortAt.every((x) => x.by === shortAt[0].by);
  if (same) return `${numWord(shortAt[0].by)} server${shortAt[0].by === 1 ? '' : 's'} short at ${listOf(shortAt.map((x) => x.label))}`;
  const run = runOf(shortAt);
  if (run) return `up to ${Math.max(...shortAt.map((x) => x.by))} servers short, ${run}`;
  const runs = shortAt.length > 3 ? runsOf(shortAt) : null;
  if (runs) return `up to ${Math.max(...shortAt.map((x) => x.by))} servers short, ${runs}`;
  return `short at ${listOf(shortAt.map((x) => `${x.label} (${x.by})`))}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------------------------------------------------------------- the week */

export const STATUS = {
  short: { label: 'Understaffed', icon: 'TriangleAlert', tone: 'bad' },
  spare: { label: 'Overstaffed', icon: 'CircleAlert', tone: 'warn' },
  ok: { label: 'On track', icon: 'CircleCheck', tone: 'good' },
  missing: { label: 'Missing data', icon: 'CircleDashed', tone: 'mute' },
};

/** Mon to Sun, each with its service (or null), its short and spare hours, and one status. Short wins over spare. */
export function weekDays(services) {
  return DAYS.map((day) => {
    const svc = services.find((x) => x.day === day) || null;
    const cov = svc ? coverage(svc) : null;
    const status = !svc ? 'missing' : cov.short ? 'short' : cov.spare ? 'spare' : 'ok';
    return { day, svc, cov, status };
  });
}

/** Short and spare server-hours across the days that have data. */
export function weekTotals(days) {
  return days.reduce((t, d) => ({ short: t.short + (d.cov?.short || 0), spare: t.spare + (d.cov?.spare || 0) }), { short: 0, spare: 0 });
}

/** Which day is worst, which has the most spare, which is best matched, and which have no data. */
export function weekSummary(days) {
  const has = days.filter((d) => d.svc);
  const by = (f) => [...has].sort((a, b) => f(b) - f(a))[0] || null;
  const shortage = by((d) => d.cov.short);
  const excess = by((d) => d.cov.spare);
  const covers = (d) => d.svc.hours.reduce((t, h) => t + (h.covers || 0), 0);
  const matched = [...has].sort((a, b) => (a.cov.short + a.cov.spare) - (b.cov.short + b.cov.spare) || covers(b) - covers(a))[0] || null;
  return {
    shortage: shortage?.cov.short ? shortage : null,
    excess: excess?.cov.spare ? excess : null,
    matched: matched && matched.cov.short === 0 ? matched : null,
    missing: days.filter((d) => !d.svc).map((d) => d.day),
  };
}

/* ---------------------------------------------------------------- moves */

/** "Add 1 server, 7 PM to 9 PM"; "Add up to 3 servers, 9 AM to 2 PM" when the amount varies; else hour by hour. */
export function changeText(kind, at) {
  const run = runOf(at);
  const same = at.every((x) => x.by === at[0].by);
  const max = Math.max(...at.map((x) => x.by));
  const n = (by, upTo) => (kind === 'add' ? `Add ${upTo ? 'up to ' : ''}${plural(by, 'server')}` : `Schedule ${upTo ? 'up to ' : ''}${by} fewer ${by === 1 ? 'server' : 'servers'}`);
  if (run) return `${n(same ? at[0].by : max, !same)}, ${run}`;
  const runs = at.length > 3 ? runsOf(at) : null;
  if (runs) return `${n(same ? at[0].by : max, !same)}, ${runs}`;
  return `${kind === 'add' ? 'Add' : 'Schedule fewer servers:'} ${listOf(at.map((x) => `${x.by} at ${x.label}`))}`;
}

const DAY_RE = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;
/** The weekday a finding's title names, as "Mon" … "Sun", or null. */
export const dayOfTitle = (title) => { const m = DAY_RE.exec(title || ''); return m ? m[1].slice(0, 3) : null; };

/**
 * Every suggested move for the week. Each is advice: none changes a live
 * schedule. `wage` is the hourly server rate used for estimated labor cost.
 * @param {{ services: any[], candidates?: any[], draft?: { approval: string, note: string } | null, wage?: number | null }} p
 */
export function moves({ services, candidates = [], draft = null, wage = null }) {
  const out = [];
  const rows = services.map((svc) => ({ svc, cov: coverage(svc) }));
  for (const { svc, cov } of [...rows].filter((x) => x.cov.short).sort((a, b) => b.cov.short - a.cov.short)) {
    out.push({
      id: `cover:${svc.key}`, kind: 'cover', tone: 'risk', svc: svc.key, day: svc.day, group: 'Servers', stage: 'opportunity',
      title: changeText('add', cov.shortAt), where: svc.label,
      body: `${svc.label} runs ${shortPhrase(cov.shortAt)}.`,
      hours: cov.short, cost: wage ? Math.round(cov.short * wage) : null,
      outcome: 'Enough servers for the covers at the peak', risk: 'Low. It adds labor cost and protects service.',
    });
  }
  if (draft?.approval) {
    out.push({ id: `draft:${draft.approval}`, kind: 'draft', tone: 'ready', approval: draft.approval, day: dayOfTitle(draft.note), group: 'Schedule', stage: 'opportunity', title: 'Review next week’s schedule draft', where: 'Next week', body: draft.note });
  }
  for (const c of [...candidates].filter((x) => x.lever === 'Labour').sort((a, b) => (b.edv || 0) - (a.edv || 0))) {
    out.push({
      id: `cand:${c.id}`, kind: 'candidate', tone: 'potential', finding: c.id, day: dayOfTitle(c.title), group: c.who ? `One person (${c.who})` : 'Schedule', stage: 'opportunity',
      title: c.title, where: c.prevent ? 'This week' : 'Each week', body: c.why, value: c.value, lo: c.lo, hi: c.hi, claim: c.claim, prevent: !!c.prevent, p: c.p ?? null, minutes: Math.round((c.hours || 0) * 60),
      outcome: c.prevent ? 'Overtime pay avoided this week' : 'Lower labor cost or better service, if a test verifies it',
      risk: c.lo < 0 ? 'It could lose money. Test it before relying on it.' : c.p >= 0.8 ? 'Low.' : 'Medium. Not proven until a test verifies it.',
    });
  }
  for (const { svc, cov } of [...rows].filter((x) => x.cov.spare).sort((a, b) => b.cov.spare - a.cov.spare)) {
    out.push({
      id: `spare:${svc.key}`, kind: 'spare', tone: 'check', svc: svc.key, day: svc.day, group: 'Servers', stage: 'opportunity',
      title: changeText('cut', cov.spareAt), where: svc.label,
      body: `${svc.label} has ${plural(cov.spare, 'server-hour')} that the covers didn’t need, at ${listOf(cov.spareAt.map((x) => x.label))}.`,
      hours: cov.spare, cost: wage ? -Math.round(cov.spare * wage) : null,
      outcome: 'Lower labor cost in hours the covers don’t need', risk: 'Medium. Check side work, cleanup and breaks in that hour first.',
    });
  }
  return out;
}

/**
 * How much to trust a move, from the data behind it. Nothing here is typed per move.
 * @param {any} m a move
 * @param {{ weeks?: number | null, feed?: { state: string, last?: string } | null, rate?: number | null, own?: boolean }} ctx
 */
export function trustOf(m, { weeks = null, feed = null, rate = null, own = false } = {}) {
  const stale = !!feed && feed.state !== 'healthy' && feed.state !== 'off';
  const quality = stale ? 'Schedule feed is out of date' : !feed || feed.state === 'off' ? (own ? 'Clock-ins only; no schedule feed connected' : 'No schedule feed connected') : 'Complete';
  const updated = feed?.last || null;
  if (m.kind === 'cover' || m.kind === 'spare') {
    const confidence = stale || !weeks || weeks < 4 ? 'Low' : weeks < 8 ? 'Medium' : 'High';
    return {
      confidence, quality, updated,
      basis: weeks ? `${weeks} ${dayName(m.day)}s of covers and servers on the floor` : 'Recent services of covers and servers on the floor',
      inputs: `Covers by hour, servers on the floor${rate ? `, your measured pace of ${rate.toFixed(2)} covers per server-hour` : ''}`,
      observed: 'Covers and servers scheduled are observed. Servers needed is modeled.',
    };
  }
  if (m.kind === 'candidate') {
    const confidence = stale && !m.prevent ? 'Low' : m.p >= 0.8 ? 'High' : m.p >= 0.55 ? 'Medium' : 'Low';
    return {
      confidence, quality, updated,
      basis: m.p != null ? `${Math.round(m.p * 100)}% chance it holds up, from this location’s own history` : 'This location’s own history',
      inputs: m.prevent ? 'Hours worked so far this week, pay rates' : 'Covers by hour, servers on the floor, pay rates',
      observed: m.claim === 'obs' ? 'Hours and pay rates are observed.' : 'The dollar figure is modeled, not measured.',
    };
  }
  return { confidence: null, quality, updated, basis: 'This week’s schedule and the hours above', inputs: 'Schedule, covers by hour', observed: 'A draft. Nothing is published until you approve it.' };
}

/* ---------------------------------------------------------------- stages, roles, locations */

/** One vocabulary for where money stands, so potential is never read as saved. */
export const STAGES = {
  opportunity: { label: 'Opportunity', icon: 'CircleDashed', tone: 'mute' },
  projected: { label: 'Projected impact', icon: 'Sigma', tone: 'mute' },
  testing: { label: 'In test', icon: 'Hourglass', tone: 'info' },
  measured: { label: 'Measured result', icon: 'Eye', tone: 'info' },
  verified: { label: 'Verified savings', icon: 'BadgeCheck', tone: 'good' },
  reversed: { label: 'Reversed', icon: 'Undo2', tone: 'bad' },
};
/** A proof record's or a test window's stage. */
export function stageOf(outcome) {
  if (outcome === 'verified' || outcome === 'limited') return 'verified';
  if (outcome === 'reversed') return 'reversed';
  if (outcome === 'testing' || outcome === 'running') return 'testing';
  return 'measured';
}

const FOH = /server|bartend|host|buss|runner|cashier|barista|barback/i;
/** Hourly labor by role, largest first, each marked front of house or kitchen. */
export function costByRole(staff) {
  const by = new Map();
  for (const p of staff || []) {
    if (!(p.hours > 0) || !(p.rate > 0)) continue;
    const r = by.get(p.role) || { role: p.role, foh: FOH.test(p.role), hours: 0, cost: 0, people: 0 };
    r.hours += p.hours; r.cost += p.hours * p.rate; r.people += 1;
    by.set(p.role, r);
  }
  const roles = [...by.values()].sort((a, b) => b.cost - a.cost);
  const sum = (f) => roles.filter(f).reduce((t, r) => t + r.cost, 0);
  return { roles, foh: sum((r) => r.foh), boh: sum((r) => !r.foh), total: sum(() => true) };
}

/** Hours-weighted hourly rate of the servers, or null. */
export function serverWage(staff) {
  const xs = (staff || []).filter((p) => /server/i.test(p.role) && p.hours > 0 && p.rate > 0);
  const h = xs.reduce((t, p) => t + p.hours, 0);
  return h ? Math.round((xs.reduce((t, p) => t + p.hours * p.rate, 0) / h) * 100) / 100 : null;
}

/** Labor share across several locations: total labor over total net sales. */
export function groupShare(rows) {
  const net = rows.reduce((t, r) => t + (r.net || 0), 0);
  return net ? rows.reduce((t, r) => t + (r.labour || 0), 0) / net : null;
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

/** Sales per server-hour, weekday by hour, from the same hourly rows. */
export function salesGridFromHeat(grid) {
  const val = (c) => (c && c.covers > 0 && c.cps > 0 ? Math.round((c.sales * c.cps) / c.covers) : null);
  const hours = (grid[0]?.cells || []).map((c) => c.hour).filter((hr) => grid.some((r) => val(r.cells.find((c) => c.hour === hr)) != null));
  return { hours: hours.map((h) => ({ hour: h, label: hourLabel(h) })), rows: grid.map((r) => ({ day: r.dow, cells: hours.map((hr) => val(r.cells.find((c) => c.hour === hr))) })) };
}

/** Servers scheduled minus needed, day by hour: negative is short, positive is spare. */
export function gapGrid(services) {
  const hours = [...new Set(services.flatMap((x) => x.hours.map((h) => hour24(h.label))))].filter((h) => h != null).sort((a, b) => a - b);
  return {
    hours: hours.map((h) => ({ hour: h, label: hourLabel(h) })),
    rows: [...services].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day)).map((x) => ({ day: x.day, cells: hours.map((hr) => { const h = x.hours.find((y) => hour24(y.label) === hr); return h ? h.sched - h.need : null; }) })),
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

/* ---------------------------------------------------------------- one rule for "needed" */

/** Servers an hour needs: guests divided by the room's measured pace, rounded up, never fewer than one. */
export const needFor = (covers, rate) => (rate > 0 && covers != null ? Math.max(1, Math.ceil(covers / rate)) : null);

/** Guests per server, day by hour, from the same services the chart uses (so it can never disagree with it). */
export function loadGridFromServices(services) {
  const withCovers = services.filter((x) => x.hours.some((h) => h.covers != null));
  const hours = [...new Set(withCovers.flatMap((x) => x.hours.map((h) => hour24(h.label))))].filter((h) => h != null).sort((a, b) => a - b);
  return {
    hours: hours.map((h) => ({ hour: h, label: hourLabel(h) })),
    rows: [...withCovers].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day)).map((x) => ({ day: x.day, cells: hours.map((hr) => { const h = x.hours.find((y) => hour24(y.label) === hr); return h && h.sched > 0 && h.covers != null ? Math.round((h.covers / h.sched) * 10) / 10 : null; }) })),
  };
}

/**
 * The page checking its own working. Each check is { key, label, ok, detail };
 * `ok: null` means it could not be run. Nothing here is typed: every check
 * recomputes a figure the page shows from its inputs.
 * @param {any} [input]
 */
export function mathChecks({ services = [], rate = null, roles = null, weekLabour = null, totals = null, kpis = null, feed = null } = {}) {
  const out = [];
  const hours = services.flatMap((x) => x.hours.filter((h) => h.covers != null).map((h) => ({ ...h, where: `${x.day} ${h.label}` })));
  if (hours.length && rate > 0) {
    const off = hours.filter((h) => needFor(h.covers, rate) !== h.need);
    out.push({ key: 'need', label: 'Servers needed = guests ÷ your pace, rounded up', ok: off.length === 0, detail: off.length ? `${hours.length - off.length} of ${hours.length} hours agree. Check ${listOf(off.slice(0, 3).map((h) => h.where))}.` : `All ${hours.length} hours agree, at ${rate.toFixed(2)} guests per server an hour.` });
  } else out.push({ key: 'need', label: 'Servers needed = guests ÷ your pace, rounded up', ok: null, detail: 'Needs guests by the hour and a measured pace.' });
  if (totals && kpis && kpis.short != null) out.push({ key: 'week', label: 'The seven days add up to the week', ok: totals.short === kpis.short && totals.spare === kpis.idle, detail: `Days: ${totals.short} h short, ${totals.spare} h spare. Week: ${kpis.short} h short, ${kpis.idle} h spare.` });
  if (roles?.total > 0 && weekLabour > 0) {
    const gap = Math.abs(roles.total - weekLabour);
    out.push({ key: 'roles', label: 'Pay by role adds up to the week’s labor cost', ok: gap < 1, detail: gap < 1 ? `${roles.roles.length} roles, no difference.` : `Off by $${Math.round(gap)}. Some hours have no role or wage.` });
  }
  if (feed) out.push({ key: 'feed', label: 'The schedule is current', ok: feed.state === 'healthy' ? true : feed.state === 'off' ? null : false, detail: feed.state === 'off' ? 'No schedule feed connected. Hours come from uploads or hand entry.' : `7shifts updated ${feed.last}.` });
  return out;
}

/**
 * Plans the operator recorded, checked against the latest data: a plan whose
 * gap is still in the data is waiting; one whose gap is gone has closed.
 * `saved` is { [id]: { s, at, t? } }.
 */
export function followUps(saved = {}, list = []) {
  const byId = new Map(list.map((m) => [m.id, m]));
  const waiting = [], closed = [];
  for (const [id, v] of Object.entries(saved || {})) {
    if (v?.s !== 'planned') continue;
    const m = byId.get(id);
    if (m) waiting.push({ id, title: m.title, where: m.where, day: m.day, at: v.at });
    else closed.push({ id, title: v.t || 'A plan you recorded', at: v.at });
  }
  return { waiting, closed };
}

/* ---------------------------------------------------------------- front of house and kitchen */

const perOr = (a, b, dp = 2) => (b > 0 ? Math.round((a / b) * 10 ** dp) / 10 ** dp : null);

/**
 * Hourly labor split into front of house and kitchen, each with its roles.
 * @param staff the room's hourly staff ({ role, hours, rate })
 * @param week  { net, covers } for the same week
 * @param ot    overtime minutes by group, four weeks, latest last ({ boh, foh, bar })
 */
export function deptSplit(staff, { net = null, covers = null } = {}, ot = null) {
  const r = costByRole(staff);
  const lastOt = (keys) => { const xs = keys.map((k) => ot?.[k]?.at?.(-1)).filter((v) => v != null); return xs.length ? Math.round((xs.reduce((t, v) => t + v, 0) / 60) * 10) / 10 : null; };
  return [['foh', 'Front of house', true, ['foh', 'bar']], ['boh', 'Kitchen', false, ['boh']]].map(([key, label, foh, otKeys]) => {
    const roles = r.roles.filter((x) => x.foh === foh).map((x) => ({ ...x, wage: perOr(x.cost, x.hours) }));
    const hours = roles.reduce((t, x) => t + x.hours, 0), cost = roles.reduce((t, x) => t + x.cost, 0);
    return {
      key, label, roles, hours, cost, people: roles.reduce((t, x) => t + x.people, 0),
      wage: perOr(cost, hours), share: perOr(cost, r.total, 4), ofSales: perOr(cost, net, 4),
      perGuest: perOr(cost, covers), guestsPerHour: perOr(covers, hours, 1), otHours: lastOt(otKeys),
    };
  }).filter((x) => x.hours > 0);
}

/**
 * Kitchen speed by weekday and hour from the hourly rows: average tickets and
 * ticket minutes, with every hour over the target marked.
 * @param hours  [{ dow, hour, tickets, ticketMin }]
 * @param target ticket-time target in minutes
 */
export function kitchenLoad(hours, target) {
  if (!hours?.length || !(target > 0)) return null;
  const cell = new Map();
  for (const h of hours) {
    if (!(h.tickets > 0) || !(h.ticketMin > 0)) continue;
    const k = `${h.dow}|${h.hour}`, c = cell.get(k) || { n: 0, tickets: 0, min: 0 };
    c.n += 1; c.tickets += h.tickets; c.min += h.ticketMin; cell.set(k, c);
  }
  if (!cell.size) return null;
  const hrs = [...new Set([...cell.keys()].map((k) => Number(k.split('|')[1])))].sort((a, b) => a - b);
  const rows = DAYS.map((day) => ({ day, cells: hrs.map((hr) => {
    const c = cell.get(`${day}|${hr}`);
    if (!c) return null;
    const min = Math.round((c.min / c.n) * 10) / 10;
    return { hour: hr, label: hourLabel(hr), tickets: Math.round((c.tickets / c.n) * 10) / 10, min, over: Math.max(0, Math.round((min - target) * 10) / 10) };
  }) })).filter((r) => r.cells.some(Boolean));
  let worst = null;
  for (const r of rows) for (let i = 0; i < r.cells.length; i++) {
    if (!r.cells[i]?.over) continue;
    let j = i; while (r.cells[j + 1]?.over) j++;
    const run = r.cells.slice(i, j + 1), peak = Math.max(...run.map((c) => c.min));
    if (!worst || peak > worst.min) worst = { day: r.day, from: run[0].label, to: hourLabel(run.at(-1).hour + 1), hours: run.length, min: peak };
    i = j;
  }
  return { target, hours: hrs.map((h) => ({ hour: h, label: hourLabel(h) })), rows, lateHours: rows.reduce((t, r) => t + r.cells.filter((c) => c?.over).length, 0), worst };
}

export const MAX_COOKS = 40;
/** A hand-entered line crew for one day: { [hour]: cooks }. Keeps whole hours with a sane count. */
export function checkCrew(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (v === '' || v == null) continue;
    const hr = Number(k), n = Number(v);
    if (!Number.isInteger(hr) || hr < 0 || hr > 23) continue;
    if (!Number.isFinite(n) || n < 0 || n > MAX_COOKS) return { ok: false, error: 'Cooks on the line should be between 0 and 40.' };
    out[hr] = Math.round(n * 2) / 2;
  }
  return Object.keys(out).length ? { ok: true, crew: out } : { ok: false, error: 'Enter the cooks on the line for at least one hour.' };
}

/**
 * Is a slow hour a people problem or a station problem? With the cooks on the
 * line by hour, a late hour where each cook carries more tickets than the
 * day's usual load is "stretched"; a late hour at or under the usual load
 * points at a station or the pass, not at headcount.
 * @param {any[]} cells one day's cells from kitchenLoad()
 * @param {any} crew  { [hour]: cooks }
 */
export function lineCheck(cells, crew) {
  const rows = (cells || []).filter(Boolean).map((c) => { const cooks = crew?.[c.hour]; return { ...c, cooks: cooks ?? null, perCook: cooks > 0 ? Math.round((c.tickets / cooks) * 10) / 10 : null }; });
  const loads = rows.map((r) => r.perCook).filter((v) => v != null).sort((a, b) => a - b);
  if (!loads.length) return { rows, usual: null, stretched: [], station: [] };
  const usual = loads.length % 2 ? loads[(loads.length - 1) / 2] : Math.round(((loads[loads.length / 2 - 1] + loads[loads.length / 2]) / 2) * 10) / 10;
  const tagged = rows.map((r) => ({ ...r, read: !r.over || r.perCook == null ? null : r.perCook > usual ? 'stretched' : 'station' }));
  return { rows: tagged, usual, stretched: tagged.filter((r) => r.read === 'stretched'), station: tagged.filter((r) => r.read === 'station') };
}

/* ---------------------------------------------------------------- next week, from the forecast */

/**
 * The coming week from the shared forecast, held against the schedule the room
 * runs now. Only hours the schedule covers are compared, so a day is never
 * called short for an hour nobody planned to open.
 * @param {any[]} days     one per forecast day: { iso, weekday, hours: [{ hour, covers, low, high, serversPlan }] }
 * @param {any[]} services the page's services (this week's schedule by weekday and hour)
 */
export function forecastWeek(days, services) {
  const out = [];
  for (const d of days || []) {
    const day = String(d.weekday || '').slice(0, 3);
    const svc = services.find((x) => x.day === day);
    if (!svc) { out.push({ iso: d.iso, day, svc: null, hours: [], covers: null, low: null, high: null, peak: null, short: 0, spare: 0 }); continue; }
    const hours = svc.hours.map((h) => { const f = (d.hours || []).find((x) => x.hour === hour24(h.label)); return f ? { label: h.label, covers: f.covers, low: f.low, high: f.high, need: f.serversPlan, sched: h.sched } : null; }).filter(Boolean);
    const sum = (k) => hours.reduce((t, h) => t + h[k], 0);
    const peak = hours.reduce((b, h) => (!b || h.need > b.need ? h : b), null);
    out.push({
      iso: d.iso, day, svc: svc.label, hours, covers: sum('covers'), low: sum('low'), high: sum('high'), peak: peak && { label: peak.label, need: peak.need },
      short: hours.reduce((t, h) => t + Math.max(0, h.need - h.sched), 0), spare: hours.reduce((t, h) => t + Math.max(0, h.sched - h.need), 0),
    });
  }
  const ready = out.filter((x) => x.svc && x.hours.length);
  const worst = ready.reduce((b, x) => (x.short > (b?.short || 0) ? x : b), null);
  return { days: out, short: ready.reduce((t, x) => t + x.short, 0), spare: ready.reduce((t, x) => t + x.spare, 0), worst };
}
