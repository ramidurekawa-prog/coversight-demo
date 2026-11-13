// All rooms (Portfolio): which restaurant needs the owner most, why, and what
// to do about it. Pure, so the browser and the server (server/page/portfolio.ts)
// compute the same thing from the same dataset.
//
// Two sources of truth, never mixed:
//  - the sample group (a demo visitor, or "try the sample"): the model's own
//    figures, alarms and feeds for each room, all labelled sample;
//  - a real group: money in and out only from weeks of the room's own Toast
//    data, verified savings only from its own test windows. A room without its
//    own data, or with a period it doesn't fully cover, is left out of group
//    totals and the coverage says so. It is never counted as zero.
//
// Every material number is a metric: { value, unit, status, source, dataThrough,
// coverage, limitations, drill }. Status is one of observed, calculated,
// estimated, verified, unavailable (the page's claim chip follows it).
import { money, tmpl } from '../model.js';
import { bookedBetween, utcDay } from '../billing.js';

/** Days without a new week of data before a room counts as stale; past OFFLINE_DAYS it's offline. */
export const STALE_AFTER_DAYS = 8;
export const OFFLINE_DAYS = 28;
/** How long a reversal stays on the attention list. */
export const REVERSAL_DAYS = 28;
/** Weeks before the period that make a room's own baseline, and the fewest that count as one. */
export const BASELINE_WEEKS = 8;
export const MIN_BASELINE_WEEKS = 4;
/** The saved decision key: items acknowledged or snoozed, per room. */
export const HANDLED_KEY = 'portfolio.handled';
export const HANDLED_MAX = 50;
export const SNOOZE_DAYS = 7;

export const PERIODS = { week: { label: 'Latest week', weeks: 1 }, '4w': { label: 'Last 4 weeks', weeks: 4 } };
export const COMPARISONS = {
  own: { label: 'vs its own last 8 weeks' },
  ly: { label: 'vs same weeks last year' },
  budget: { label: 'vs budget' },
};

const TONE_RANK = { bad: 0, warn: 1, info: 2 };
const STATUS_RANK = { verified: 0, observed: 1, calculated: 2, estimated: 3, unavailable: 4 };
const weakest = (...s) => s.reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a), 'observed');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const DAY = 864e5;
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
export const dayLabel = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

/** Whole days from the end of a data day (YYYY-MM-DD) to `now`. */
export function daysSince(end, now) {
  const t = Date.parse(`${end}T23:59:59Z`);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / DAY)) : null;
}

function metric(id, label, value, unit, status, rest = {}) {
  return { id, label, value: status === 'unavailable' ? null : value, unit, status, source: '', dataThrough: null, coverage: null, limitations: [], drill: null, ...rest };
}

/* ------------------------------------------------------------------ one room's money */
/** Revenue, food, labour and contribution for a room over the period, with what each rests on. */
function roomMoney(r, { real, weeks, comparison }) {
  const d = r.d;
  const rows = d.hist.rows;
  const files = d.room.fromToast?.files || [];
  const own = !real || !!d.room.fromToast;
  const period = rows.slice(-weeks);
  const before = rows.slice(-(weeks + BASELINE_WEEKS), -weeks);
  /* A real room counts only weeks of its own data. */
  const usable = (w) => !real || w.own === true;
  const covered = period.filter(usable).length;
  const complete = own && covered === period.length;
  const base = before.filter(usable);
  const lim = [];
  let revS = 'observed', foodS = 'observed', labS = 'observed';
  if (real) {
    if (!own) revS = foodS = labS = 'unavailable';
    else {
      const ownCosts = !!d.inputs?.recipes && !d.room.menu.some((m) => m.costEstimated);
      foodS = ownCosts && weeks === 1 ? 'calculated' : 'estimated';
      if (foodS === 'estimated') lim.push(ownCosts ? 'Food cost before this week is at the room’s food-cost rate.' : 'Food cost is at a typical rate until recipe costs are entered.');
      labS = files.includes('time') ? 'calculated' : 'unavailable';
      if (labS === 'unavailable') lim.push('No payroll: add Toast time entries to see labour and contribution.');
      if (!complete) { revS = foodS = labS = 'unavailable'; lim.push(`Only ${covered} of ${period.length} weeks of this period are in its own data.`); }
    }
  }
  const revenue = sum(period, (w) => w.net);
  const food = sum(period, (w) => w.food);
  const labour = sum(period, (w) => w.labour);
  const contribution = revenue - food - labour;
  const conS = weakest(revS, foodS, labS) === 'observed' ? 'calculated' : weakest(revS, foodS, labS);
  /* Change against a justified comparable period: per week, against the room's own baseline. */
  let change = null;
  if (comparison === 'own' && conS !== 'unavailable') {
    if (base.length >= MIN_BASELINE_WEEKS) {
      const perWk = (a, f) => sum(a, f) / a.length;
      const bRev = perWk(base, (w) => w.net), bCon = perWk(base, (w) => w.net - w.food - w.labour);
      const margins = base.map((w) => (w.net - w.food - w.labour) / w.net);
      const mMean = sum(margins) / margins.length;
      const mSd = Math.sqrt(sum(margins, (m) => (m - mMean) ** 2) / Math.max(1, margins.length - 1));
      const margin = revenue ? contribution / revenue : 0;
      change = {
        weeks: base.length,
        revenuePct: bRev ? (revenue / weeks - bRev) / bRev : null,
        contributionPct: bCon ? (contribution / weeks - bCon) / Math.abs(bCon) : null,
        marginPts: (margin - bCon / bRev) * 100,
        z: mSd > 1e-9 ? (margin - mMean) / mSd : 0,
      };
    } else change = { unavailable: `Not enough history yet: ${base.length} of ${MIN_BASELINE_WEEKS} weeks before this period.` };
  }
  if (comparison === 'ly') change = { unavailable: rows.length > 52 ? null : `Needs 53 weeks of history; this room has ${rows.length}.` };
  if (comparison === 'budget') change = { unavailable: 'No budget has been entered for this group.' };
  const through = real ? d.room.fromToast?.end || null : null;
  const src = real ? 'Toast' : 'Sample registers';
  return {
    own, complete, covered, weeks: period.length, limitations: lim, change,
    revenue: metric('revenue', 'Revenue', revenue, 'USD', revS, { source: `${src}: net sales`, dataThrough: through }),
    food: metric('food', 'Food cost', food, 'USD', foodS, { source: real ? 'Recipe costs × items sold' : 'Sample recipe costs' }),
    labour: metric('labour', 'Labour cost', labour, 'USD', labS, { source: real ? 'Toast time entries × wage' : 'Sample payroll' }),
    contribution: metric('contribution', 'Contribution after food and labour', contribution, 'USD', conS, { source: 'Revenue − food cost − labour cost', dataThrough: through, limitations: lim }),
    foodPct: foodS === 'unavailable' || !revenue ? null : food / revenue,
    labourPct: labS === 'unavailable' || !revenue ? null : labour / revenue,
  };
}

/* ------------------------------------------------------------------ verified savings */
/** Run-rate, accrued in the period, to date, suspended and reversed: never added to anything estimated. */
function roomSavings(r, { real, windows, now, weeks }) {
  const days = weeks * 7;
  if (!real) {
    const b = r.d.banked;
    return {
      runRate: b.week, accrued: sum(b.live, (p) => (p.bookable / 7) * Math.min(days, p.accrualDays || 0)), toDate: b.toDate, suspended: b.paused,
      reversed: b.reversed.map((p) => ({ id: p.id, title: p.title, weekly: p.bookable || p.lo || 0 })), proofs: b.live.length, drill: 'ledger',
    };
  }
  const ws = windows.filter((w) => w.roomId === r.id).map((w) => ({ ...w, bookedCentsBeforeReversal: Math.max(0, w.lowCents ?? 0) }));
  const today = utcDay(now) + 1;
  const ver = ws.filter((w) => w.status === 'verified');
  const rev = ws.filter((w) => w.status === 'reversed' && recent(w.reversedAt, now));
  return {
    runRate: sum(ver, (w) => w.bookedCents || 0) / 100,
    accrued: sum(ws, (w) => bookedBetween(w, today - days, today).cents) / 100,
    toDate: sum(ws, (w) => bookedBetween(w, 0, today).cents) / 100,
    suspended: 0,
    reversed: rev.map((w) => ({ id: w.id, title: w.title, weekly: (w.lowCents || 0) / 100 })),
    proofs: ver.length, drill: 'windows',
  };
}

function recent(at, now) {
  if (!at) return true;
  const t = typeof at === 'string' ? Date.parse(at) : at instanceof Date ? at.getTime() : NaN;
  return !Number.isFinite(t) || now - t <= REVERSAL_DAYS * DAY;
}

/** Item ids carry the state they're about, so an acknowledged item comes back when it changes. */
function item(roomId, kind, key, rest) {
  return { id: `${roomId}:${kind}:${key}`.slice(0, 120), roomId, kind, ...rest };
}

/* ------------------------------------------------------------------ what needs attention */
function sampleItems(r) {
  const d = r.d, out = [];
  for (const a of d.alarms) {
    out.push(item(r.id, 'alarm', slug(a.title), { tone: 'bad', icon: 'Siren', title: a.title, body: tmpl(a.body, d.tokens), go: a.go || 'controls', cta: 'See the issue' }));
  }
  for (const f of d.feeds.filter((x) => x.state === 'stale')) {
    out.push(item(r.id, 'feed', `${slug(f.name)}-${slug(f.last)}`, { tone: 'warn', icon: 'Clock', title: `${f.name} feed is stale`, body: `Last update ${f.last}. ${f.note || ''}`.trim(), go: 'sources', cta: f.fix || 'Open sources' }));
  }
  return out;
}

function realItems(r, room, windows, now) {
  const out = [];
  const ws = windows.filter((w) => w.roomId === r.id);
  for (const w of ws.filter((x) => x.status === 'reversed' && recent(x.reversedAt, now))) {
    out.push(item(r.id, 'reversed', w.id, { tone: 'bad', icon: 'Undo2', title: `${w.title} reversed`, body: 'A guardrail broke after this test verified. It no longer books, and nothing more is billed for it. The window shows which guardrail and when.', go: 'windows', cta: 'See the window' }));
  }
  for (const w of ws.filter((x) => x.status === 'waiting')) {
    out.push(item(r.id, 'waiting', `${w.id}-${room.dataThrough || 'none'}`, { tone: 'warn', icon: 'CirclePause', title: `${w.title} is waiting for data`, body: `No new week of data${room.dataAge != null ? ` for ${room.dataAge} days` : ''}, so the test waits rather than fails. It picks up as soon as a fresh week lands.`, go: 'connect', cta: 'Check the feed' }));
  }
  if (room.state === 'offline') {
    out.push(item(r.id, 'offline', room.dataThrough, { tone: 'bad', icon: 'Unplug', title: `No data from ${room.short} for ${room.dataAge} days`, body: `Its data stops at ${dayLabel(room.dataThrough)}, so it's left out of every group total. If it's open, the Toast connection needs fixing; if it has closed, remove it on Team & groups.`, go: 'connect', cta: 'Check the connection' }));
  } else if (room.state === 'stale') {
    out.push(item(r.id, 'stale', room.dataThrough, { tone: 'warn', icon: 'Clock', title: `${room.short}'s Toast data is ${room.dataAge} days old`, body: `It runs to ${dayLabel(room.dataThrough)}. Figures and tests wait for a fresh week: check the connection, or upload the latest export.`, go: 'connect', cta: 'Check the feed' }));
  }
  if (room.state === 'sample') {
    out.push(item(r.id, 'sample', 'toast', { tone: 'info', icon: 'PlugZap', title: `Connect ${room.short}'s Toast`, body: 'This room still shows sample numbers, so nothing from it counts toward your totals until its own data is in.', go: 'connect', cta: 'Connect Toast' }));
  } else if (room.state !== 'offline' && !room.money.complete) {
    out.push(item(r.id, 'incomplete', `${room.period}-${room.dataThrough || 'none'}`, { tone: 'warn', icon: 'CalendarRange', title: `${room.short}'s data doesn't cover this period`, body: `Only ${room.money.covered} of ${room.money.weeks} week${room.money.weeks === 1 ? '' : 's'} are in its own data, so it's left out of group totals rather than counted as zero. Bring in the missing weeks to include it.`, go: 'connect', cta: 'Check the data' }));
  } else {
    if (room.money.labour.status === 'unavailable' && room.money.complete) {
      out.push(item(r.id, 'payroll', 'time', { tone: 'warn', icon: 'Users', title: `${room.short} has no payroll data`, body: 'Without Toast time entries there is no labour cost, so its contribution can’t be calculated and it stays out of the group total.', go: 'connect', cta: 'Add time entries' }));
    }
    if (room.money.food.status === 'estimated' && !r.d.inputs?.recipes) {
      out.push(item(r.id, 'costs', 'recipes', { tone: 'info', icon: 'FileSpreadsheet', title: `Enter ${room.short}'s recipe costs`, body: 'Food cost is at a typical rate until plate costs are entered, so its contribution is an estimate.', go: 'inputs', params: { kind: 'recipes' }, cta: 'Enter recipe costs' }));
    }
  }
  return out;
}

/** A contribution margin well below the room's own normal is worth a look, whatever the room's size. */
function dropItem(r, room) {
  const c = room.money.change;
  if (!c || c.unavailable || c.marginPts == null || c.marginPts > -1.5 || c.z > -1.5) return null;
  return item(r.id, 'drop', `${room.period}-${Math.round(c.marginPts * 10)}`, {
    tone: 'warn', icon: 'TrendingDown', title: `${room.short}'s contribution margin is down ${Math.abs(c.marginPts).toFixed(1)} pts`,
    body: `Against its own last ${c.weeks} weeks, not the other rooms. Food is ${pct(room.money.foodPct)} and labour ${pct(room.money.labourPct)} of sales this period.`,
    go: 'trends', cta: 'See the trend',
  });
}
const pct = (x) => (x == null ? 'unknown' : `${(x * 100).toFixed(1)}%`);

/** The room's best open move, sized against its own sales so a small room isn't outranked by size alone. */
function opportunityOf(r, room, real) {
  if (real && room.state === 'sample') return null;
  const c = r.d.plan.sorted.find((x) => x.value > 0.5 && !x.prevent);
  if (!c) return null;
  const weekly = room.money.revenue.value != null ? room.money.revenue.value / room.money.weeks : r.d.week.net;
  return { id: c.id, title: c.title, value: c.value, p: c.p ?? 0.5, claim: c.claim, share: weekly ? c.value / weekly : 0 };
}

/* ------------------------------------------------------------------ priority */
/**
 * A transparent score: each part says what it is and how many points it adds.
 * Urgent operating risks (an alarm, a reversal, a room gone dark) put a room in
 * the urgent tier, ahead of any financial opportunity. Every financial part is
 * relative to the room's own sales or its own history, never its size.
 */
export function priorityOf({ open, change, state, opportunity, moneyStatus }) {
  const parts = [];
  const bad = open.filter((x) => x.tone === 'bad');
  const warn = open.filter((x) => x.tone === 'warn' && x.kind !== 'drop');
  if (bad.length) parts.push({ k: 'risk', points: 40 * bad.length, why: bad.length === 1 ? bad[0].title : `${bad.length} urgent issues` });
  if (change && !change.unavailable && change.marginPts != null && change.marginPts < 0) {
    const pts = Math.min(30, Math.round(-change.marginPts * 5));
    if (pts >= 3) parts.push({ k: 'drop', points: pts, why: `Contribution margin ${change.marginPts.toFixed(1)} pts against its own last ${change.weeks} weeks` });
    if (change.z <= -2) parts.push({ k: 'unusual', points: 10, why: 'Further below its normal range than it has been in its baseline weeks' });
  }
  if (warn.length) parts.push({ k: 'problems', points: Math.min(20, 10 * warn.length), why: warn.length === 1 ? warn[0].title : `${warn.length} open problems` });
  if (state === 'sample' || moneyStatus === 'unavailable') parts.push({ k: 'data', points: 8, why: state === 'sample' ? 'No own data yet' : 'Important data missing' });
  if (opportunity && opportunity.share > 0) {
    const pts = Math.min(15, Math.round(opportunity.share * 100 * 3 * opportunity.p));
    if (pts >= 1) parts.push({ k: 'opportunity', points: pts, why: `${opportunity.title}: about ${(opportunity.share * 100).toFixed(1)}% of its weekly sales, ${Math.round(opportunity.p * 100)}% chance it verifies` });
  }
  const score = sum(parts, (p) => p.points);
  const tier = bad.length ? 'urgent' : warn.length || score >= 20 ? 'watch' : 'steady';
  return { score, tier, parts };
}

/* ------------------------------------------------------------------ the view */
/**
 * @param {{ rows: any[] }} group  deriveGroup(ds)
 * @param {{ real?: boolean, windows?: any[], now?: number, handled?: Record<string, Record<string, any>>, period?: 'week'|'4w', comparison?: 'own'|'ly'|'budget' }} opts
 */
export function portfolioView(group, { real = false, windows = [], now = Date.now(), handled = {}, period = 'week', comparison = 'own' } = {}) {
  const weeks = PERIODS[period]?.weeks ?? 1;
  const rooms = group.rows.map((r) => {
    const d = r.d;
    const t = d.room.fromToast;
    const age = real && t ? daysSince(t.end, now) : null;
    const state = !real ? 'sample-group' : !t ? 'sample' : age > OFFLINE_DAYS ? 'offline' : age > STALE_AFTER_DAYS ? 'stale' : 'live';
    const m = roomMoney(r, { real, weeks, comparison });
    if (state === 'offline') {
      for (const k of ['revenue', 'food', 'labour', 'contribution']) Object.assign(m[k], { status: 'unavailable', value: null });
      m.foodPct = m.labourPct = null; m.change = null;
      m.limitations.push(`No data for ${age} days.`);
    }
    const ws = windows.filter((w) => w.roomId === r.id);
    const running = real ? ws.filter((w) => w.status === 'running' || w.status === 'waiting').length : r.tests;
    return {
      id: r.id, name: d.profile.name, short: d.profile.short, seats: d.profile.seats ?? null, gm: d.profile.gm ?? null,
      state, period, dataThrough: real ? t?.end ?? null : null, dataAge: age,
      counted: m.contribution.status !== 'unavailable', money: m,
      savings: roomSavings(r, { real, windows, now, weeks }),
      tests: running,
      stale: real ? (state === 'stale' || state === 'offline' ? 1 : 0) : r.stale,
    };
  });
  /* Period alignment: a real room counts toward group totals only if its latest week of data is the group's latest week. */
  if (real) {
    const end = rooms.map((r) => r.dataThrough).filter(Boolean).sort().at(-1);
    for (const r of rooms) {
      r.aligned = !r.dataThrough || !end || Date.parse(`${end}T00:00:00Z`) - Date.parse(`${r.dataThrough}T00:00:00Z`) < 7 * DAY;
      if (!r.aligned && r.counted) {
        r.counted = false;
        r.money.limitations.push(`Its data ends ${dayLabel(r.dataThrough)}, a different week from the group’s (${dayLabel(end)}), so it’s left out of group totals.`);
      }
    }
  } else rooms.forEach((r) => { r.aligned = true; });
  const rawItems = [];
  rooms.forEach((room, i) => {
    const r = group.rows[i];
    rawItems.push(...(real ? realItems(r, room, windows, now) : sampleItems(r)));
    const drop = dropItem(r, room);
    if (drop) rawItems.push(drop);
    room.opportunity = opportunityOf(r, room, real);
  });
  const items = rawItems.map((x) => {
    const h = readHandled(handled[x.roomId]?.[x.id], now);
    return { ...x, room: rooms.find((r) => r.id === x.roomId)?.short || x.roomId, handled: h };
  });
  const open = items.filter((x) => !x.handled);
  for (const room of rooms) {
    const mine = open.filter((x) => x.roomId === room.id);
    room.priority = priorityOf({ open: mine, change: room.money.change, state: room.state, opportunity: room.opportunity, moneyStatus: room.money.contribution.status });
    room.open = mine.length;
    room.critical = mine.filter((x) => x.tone === 'bad').length;
    const top = [...mine].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])[0];
    room.mainIssue = top ? top.title : room.priority.parts.find((p) => p.k === 'drop')?.why || null;
    room.next = top ? { label: top.cta, go: top.go, params: top.params, itemId: top.id }
      : room.opportunity ? { label: 'Open its top move', go: 'finding', params: { id: room.opportunity.id } }
        : null;
    room.summary = summaryOf(room, real);
  }
  /* Most urgent first; within a tier, the higher score. Ties keep the group's own order. */
  const TIER = { urgent: 0, watch: 1, steady: 2 };
  const ranked = rooms.map((r, i) => ({ r, i })).sort((a, b) => TIER[a.r.priority.tier] - TIER[b.r.priority.tier] || b.r.priority.score - a.r.priority.score || a.i - b.i).map((x) => x.r);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const rankOf = (id) => rooms.find((r) => r.id === id)?.rank ?? 99;
  const sortedOpen = open.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || rankOf(a.roomId) - rankOf(b.roomId));
  const done = items.filter((x) => x.handled).sort((a, b) => String(b.handled.at).localeCompare(String(a.handled.at)));
  return { rooms, ranked, totals: groupTotals(rooms, real, weeks), open: sortedOpen, handled: done, real, period, comparison, weeks };
}

function summaryOf(room, real) {
  if (room.state === 'sample') return 'Sample numbers until its own Toast data is in.';
  if (room.state === 'offline') return `No data for ${room.dataAge} days.`;
  const c = room.money.change;
  const bits = [];
  if (room.critical) bits.push(`${room.critical} urgent issue${room.critical === 1 ? '' : 's'}`);
  if (c && !c.unavailable && c.marginPts != null) bits.push(Math.abs(c.marginPts) < 1 ? 'margin in line with its normal' : `margin ${c.marginPts > 0 ? 'up' : 'down'} ${Math.abs(c.marginPts).toFixed(1)} pts on its normal`);
  else if (c?.unavailable) bits.push('no baseline yet');
  if (room.savings.runRate > 0) bits.push(`${money(Math.round(room.savings.runRate))}/wk verified`);
  else if (room.tests) bits.push(`${room.tests} test${room.tests === 1 ? '' : 's'} running`);
  if (!bits.length) return real ? 'Steady. Nothing open.' : 'Quiet week.';
  const s = bits.join(', ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** Group figures: sums of the eligible rooms only; rates from group numerators and denominators. */
export function groupTotals(rooms, real, weeks = 1) {
  const n = rooms.length;
  const counted = rooms.filter((r) => r.counted);
  const withRev = rooms.filter((r) => r.aligned && r.money.revenue.status !== 'unavailable');
  const withFood = withRev.filter((r) => r.money.food.status !== 'unavailable');
  const withLab = withRev.filter((r) => r.money.labour.status !== 'unavailable');
  const conStatus = counted.length ? weakest(...counted.map((r) => r.money.contribution.status)) : 'unavailable';
  const through = rooms.map((r) => r.dataThrough).filter(Boolean).sort();
  const partial = counted.length < n;
  const contribution = metric('group-contribution', 'Contribution after food and labour', sum(counted, (r) => r.money.contribution.value), 'USD', conStatus, {
    source: 'Sum of each eligible room’s revenue − food − labour',
    dataThrough: through[0] || null,
    coverage: { rooms: counted.length, of: n },
    limitations: [...(partial ? [`${n - counted.length} of ${n} room${n - counted.length === 1 ? '' : 's'} left out: no complete data for this period.`] : []), ...(conStatus === 'estimated' ? ['Includes estimated food cost.'] : [])],
  });
  const revenue = sum(withRev, (r) => r.money.revenue.value);
  const savings = {
    runRate: sum(rooms, (r) => r.savings.runRate),
    accrued: sum(rooms, (r) => r.savings.accrued),
    toDate: sum(rooms, (r) => r.savings.toDate),
    suspended: sum(rooms, (r) => r.savings.suspended),
    reversed: rooms.flatMap((r) => r.savings.reversed.map((x) => ({ ...x, roomId: r.id }))),
  };
  const attention = rooms.filter((r) => r.priority?.tier !== 'steady');
  return {
    rooms: n, counted: counted.length, weeks,
    contribution,
    revenue: withRev.length ? revenue : null,
    revenueRooms: withRev.length,
    foodPct: withFood.length ? sum(withFood, (r) => r.money.food.value) / sum(withFood, (r) => r.money.revenue.value) : null,
    labourPct: withLab.length ? sum(withLab, (r) => r.money.labour.value) / sum(withLab, (r) => r.money.revenue.value) : null,
    savings,
    attention: attention.length,
    urgent: rooms.filter((r) => r.priority?.tier === 'urgent').length,
    tests: sum(rooms, (r) => r.tests),
    coverage: { complete: counted.length, of: n, stale: rooms.filter((r) => r.state === 'stale').length, offline: rooms.filter((r) => r.state === 'offline').length, sample: real ? rooms.filter((r) => r.state === 'sample').length : 0 },
    dataThrough: through.at(-1) || null,
    oldestThrough: through[0] || null,
  };
}

/* ------------------------------------------------------------------ acknowledged and snoozed */
/** A saved entry is { s: 'ack' | 'snooze', at, until? }. A snooze past its date no longer hides the item. */
export function readHandled(v, now) {
  if (!v || typeof v !== 'object') return null;
  if (v.s === 'snooze') return Date.parse(v.until) > now ? { state: 'snoozed', at: v.at, until: v.until } : null;
  if (v.s === 'ack') return { state: 'acknowledged', at: v.at };
  return null;
}

/**
 * The next saved value for one room after acknowledging, snoozing, or putting back an item.
 * Keeps only ids that are still on the list, newest first, so the record stays small.
 */
export function nextHandled(saved, roomId, itemId, action, liveIds, at = new Date().toISOString()) {
  const cur = { ...(saved || {}) };
  if (action === 'ack') cur[itemId] = { s: 'ack', at };
  else if (action === 'snooze') cur[itemId] = { s: 'snooze', at, until: new Date(Date.parse(at) + SNOOZE_DAYS * DAY).toISOString() };
  else delete cur[itemId];
  const live = new Set(liveIds);
  return Object.fromEntries(Object.entries(cur)
    .filter(([id, v]) => id.startsWith(`${roomId}:`) && live.has(id) && v && typeof v === 'object')
    .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))
    .slice(0, HANDLED_MAX));
}

/* ------------------------------------------------------------------ the owner's weekly summary */
/** Plain text for the owner's weekly note: the room that needs them most, and the group's numbers. */
export function weeklySummary(v, groupName = 'Your group') {
  const t = v.totals;
  const top = v.ranked[0];
  const lines = [];
  if (top && top.priority.tier !== 'steady') lines.push(`${top.name} needs you most: ${top.priority.parts[0]?.why ?? top.mainIssue}.${top.next ? ` Next: ${top.next.label.toLowerCase()}.` : ''}`);
  else lines.push(`Every room is steady. Nothing needs you this week.`);
  if (t.contribution.status !== 'unavailable') lines.push(`Contribution after food and labour: ${money(Math.round(t.contribution.value))} from ${t.counted} of ${t.rooms} rooms (${t.contribution.status}).`);
  else lines.push('Contribution: not available until a room has a complete week of its own data.');
  lines.push(`Verified savings: ${money(Math.round(t.savings.runRate))}/wk run-rate, ${money(Math.round(t.savings.accrued))} accrued this period.${t.savings.reversed.length ? ` ${t.savings.reversed.length} reversed.` : ''}`);
  if (v.open.length) lines.push(`${v.open.length} open item${v.open.length === 1 ? '' : 's'}, ${v.open.filter((x) => x.tone === 'bad').length} urgent.`);
  return { title: `${groupName}: ${top && top.priority.tier !== 'steady' ? `${top.short} needs you most` : 'a steady week'}`, body: lines.join('\n') };
}
