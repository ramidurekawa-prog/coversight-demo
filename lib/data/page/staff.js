// Staff page: every person on the team, from the restaurant's own POS rows.
//
// Pure JS, shared by the browser and the server (server/page/staff.ts), so a
// ranking can never differ between the two. What it does:
//   1. reads each person's POS rows (by week and service) from the room's
//      Toast data, or from the sample's rows on a room that has no Toast yet;
//   2. measures each seller against people in the same job, on the same kind
//      of shifts (weekday lunch, Mon–Thu dinner, Fri–Sat dinner, weekend), so a
//      lunch server is never compared raw with a Saturday server;
//   3. places each person in their job (top, middle or bottom third), with the
//      period and the shifts it rests on, and holds back anyone with too few;
//   4. writes the coaching read: a strength to use, a habit to train, or a
//      pattern worth a private conversation, plus what the team might be
//      missing and where it might be over-correcting.
//
// Giveaways and cancellations reuse the Giveaways page's own limits
// (`staffStats` in model.js), never a second method. Nothing here ever says to
// fire anyone: the strongest read is "needs a closer look", with the evidence.
import { SEED } from '../seed.js';
import { staffStats } from '../model.js';

export const RECENT_WEEKS = 4;
export const TREND_WEEKS = 13;
/** Fewer shifts than this in the last 4 weeks: "too early to tell", never ranked. */
export const MIN_SHIFTS = 8;
/** Fewer ranked peers than this in the room: compare with the same job in every room. */
export const MIN_PEERS = 4;
export const SLOT_LABEL = ['Weekday lunch', 'Mon–Thu dinner', 'Fri–Sat dinner', 'Weekend day'];
export const SLOT_SHORT = ['Lunch', 'Weeknight', 'Fri–Sat', 'Weekend'];

const sum = (a) => a.reduce((s, v) => s + v, 0);
const r1 = (n) => Math.round(n * 10) / 10;
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'person';
const norm = (s) => String(s || '').trim().toLowerCase();

/* ------------------------------------------------------------------ source */
/**
 * The room's per-person POS rows. A room on its own Toast data uses only its
 * Toast rows (never the sample's); a room without Toast uses the sample's rows
 * for the sample's people. Returns null when there is nothing to read.
 */
export function staffSource(ds, roomId) {
  const room = ds.rooms?.[roomId];
  if (!room) return null;
  if (room.fromToast) {
    const t = ds.inputs?.[roomId]?.toast?.rows?.[0]?.toast?.staffShifts;
    if (!t?.rows?.length) return null;
    return { ...t, from: 'toast', end: room.fromToast.end, labels: weekLabelsFromEnd(room.fromToast.end, t.weeks || TREND_WEEKS), lastDay: dayLabel(Date.parse(`${room.fromToast.end}T00:00:00Z`)) };
  }
  const t = room.staffShifts || SEED.rooms[roomId]?.staffShifts;
  if (!t?.rows?.length) return null;
  const weeks = (ds.weeks || SEED.weeks).slice(-(t.weeks || TREND_WEEKS));
  const lastIso = weeks[weeks.length - 1]?.iso;
  return { ...t, from: 'sample', labels: weeks.map((w) => w.label), end: null, lastDay: lastIso ? dayLabel(Date.parse(`${lastIso}T00:00:00Z`) + 6 * 864e5) : null };
}

const dayLabel = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
function weekLabelsFromEnd(end, n) {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(endMs - (6 + 7 * (n - 1 - i)) * 864e5);
    return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  });
}

/** Rows → cells: { name, job, w, slot, shifts, hours, sales, … }. */
function cellsOf(src) {
  const ix = Object.fromEntries(src.cols.map((k, i) => [k, i]));
  return src.rows.map((r) => {
    const c = {};
    for (const k of src.cols) c[k] = r[ix[k]];
    const [name, job] = src.names[c.p] || ['', ''];
    return { ...c, name, job };
  });
}

/* ------------------------------------------------------------------ metrics */
/**
 * Each measure: what it is, in everyday words, which way is better, and how
 * it is built (numerator / denominator, so it can be judged on the same shifts).
 */
export const METRICS = [
  { k: 'fit', label: 'Sales per hour', plain: 'How much they sell in an hour, against people in the same job on the same kind of shifts', better: 'high', num: 'sales', den: 'hours', fmt: 'money', group: 'sell', headline: true },
  { k: 'guestsHr', label: 'Guests per hour', plain: 'Guests looked after in an hour', better: 'high', num: 'guests', den: 'hours', fmt: 'n1', group: 'sell' },
  { k: 'perGuest', label: 'Spend per guest', plain: 'What each guest spends', better: 'high', num: 'sales', den: 'guests', fmt: 'money2', group: 'sell' },
  { k: 'checkAvg', label: 'Check average', plain: 'What each table spends', better: 'high', num: 'sales', den: 'checks', fmt: 'money2', group: 'sell' },
  { k: 'items', label: 'Items per table', plain: 'Things ordered on each check', better: 'high', num: 'items', den: 'checks', fmt: 'n1', group: 'sell' },
  { k: 'starters', label: 'Starters', plain: 'Starters per 100 guests', better: 'high', num: 'starters', den: 'guests', per: 100, fmt: 'int', group: 'sell', habit: 'offers a starter' },
  { k: 'desserts', label: 'Desserts', plain: 'Desserts per 100 guests', better: 'high', num: 'desserts', den: 'guests', per: 100, fmt: 'int', group: 'sell', habit: 'offers dessert' },
  { k: 'drinks', label: 'Drinks', plain: 'Drinks per 100 guests', better: 'high', num: 'drinks', den: 'guests', per: 100, fmt: 'int', group: 'sell', habit: 'offers a drink or a second round' },
  { k: 'tipRate', label: 'Tips', plain: 'Tips as a share of sales (how guests rate the service)', better: 'high', num: 'tips', den: 'sales', per: 100, fmt: 'pct', group: 'sell', optional: true },
  { k: 'tableMin', label: 'Table time', plain: 'Minutes a table stays, open to paid', better: null, num: 'tableMin', den: 'checks', fmt: 'min', group: 'sell' },
  { k: 'give', label: 'Giveaways', plain: 'Comps and discounts per $100 sold', better: 'low', num: 'give', den: 'sales', per: 100, fmt: 'money2', group: 'register' },
  { k: 'voids', label: 'Cancelled after the kitchen', plain: 'Orders cancelled after they went to the kitchen, per $100 sold', better: 'low', num: 'voids', den: 'sales', per: 100, fmt: 'money2', group: 'register' },
  { k: 'blank', label: 'Giveaways with no reason', plain: 'Share of giveaway dollars with the reason left blank', better: 'low', num: 'noReason', den: 'give', per: 100, fmt: 'pct0', group: 'register', optional: true },
  { k: 'late', label: 'Late clock-ins', plain: 'Clock-ins more than 7 minutes after the scheduled start, per 10 shifts', better: 'low', num: 'late', den: 'shifts', per: 10, fmt: 'n1', group: 'time', optional: true },
];
const METRIC = Object.fromEntries(METRICS.map((m) => [m.k, m]));
export const SELL_JOBS = (job) => /server|bartender|waiter|waitress|captain|bar/i.test(job || '');
const isKitchen = (job) => /cook|chef|kitchen|line|prep|dish|sous|pastry|expo|porter/i.test(job || '');

function totals(cells) {
  const t = { shifts: 0, hours: 0, sales: 0, guests: 0, checks: 0, items: 0, starters: 0, desserts: 0, drinks: 0, tips: 0, tableMin: 0, comps: 0, disc: 0, voids: 0, refunds: 0, noReason: 0, late: 0, ot: 0, slotHours: [0, 0, 0, 0], slotShifts: [0, 0, 0, 0], hasTips: false, hasLate: false, hasReason: false };
  for (const c of cells) {
    for (const k of ['shifts', 'hours', 'sales', 'guests', 'checks', 'items', 'starters', 'desserts', 'drinks', 'tips', 'tableMin', 'comps', 'disc', 'voids', 'refunds', 'noReason', 'late', 'ot']) t[k] += +c[k] || 0;
    if (c.slot >= 0 && c.slot < 4) { t.slotHours[c.slot] += +c.hours || 0; t.slotShifts[c.slot] += +c.shifts || 0; }
    if (c.tips != null && c.tips !== '') t.hasTips = true;
    if (c.late != null && c.late !== '') t.hasLate = true;
    if (c.noReason != null && c.noReason !== '') t.hasReason = true;
  }
  t.give = t.comps + t.disc;
  return t;
}
const val = (o, k) => (k === 'give' ? (o.comps || 0) + (o.disc || 0) : +o[k] || 0);

/** Per slot rate of a metric for a set of cells: Σnum / Σden in each slot. */
function slotRates(cells, m) {
  const out = [0, 0, 0, 0].map(() => ({ num: 0, den: 0 }));
  for (const c of cells) if (c.slot >= 0 && c.slot < 4) { out[c.slot].num += val(c, m.num); out[c.slot].den += val(c, m.den); }
  const all = { num: sum(out.map((x) => x.num)), den: sum(out.map((x) => x.den)) };
  return out.map((x) => (x.den > 0 ? x.num / x.den : all.den > 0 ? all.num / all.den : 0));
}

/** Actual / expected for these cells, where expected uses the peers' rate in each slot. 100 = the same as peers on the same shifts. */
function sameShiftIndex(cells, m, rates) {
  let num = 0, exp = 0;
  for (const c of cells) { num += val(c, m.num); exp += val(c, m.den) * (rates[c.slot] ?? 0); }
  return exp > 0 ? (num / exp) * 100 : null;
}

/** Share of peers below (0 = lowest, 100 = highest). */
function percentile(v, list) {
  if (v == null || list.length < 2) return null;
  const below = list.filter((x) => x < v).length, same = list.filter((x) => x === v).length - 1;
  return Math.round(((below + same / 2) / (list.length - 1)) * 100);
}
export const tierOf = (pct, better = 'high') => {
  if (pct == null) return null;
  const p = better === 'low' ? 100 - pct : pct;
  return p >= 67 ? 'top' : p <= 33 ? 'bottom' : 'middle';
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

/* ------------------------------------------------------------------ the page */
/**
 * Everything the Staff page shows for one room.
 * @param ds the dataset (with inputs applied)
 * @param roomId the room in view
 */
export function staffPage(ds, roomId) {
  const room = ds.rooms?.[roomId];
  if (!room) return null;
  const src = staffSource(ds, roomId);
  const period = periodOf(src);
  const register = staffStats(room.staff); // the Giveaways page's own limits
  if (!src) return { roomId, source: null, period, people: [], sellers: [], others: [], team: emptyTeam(room), register, reconcile: null };

  const weeks = src.weeks || TREND_WEEKS;
  const first = weeks - RECENT_WEEKS;
  let cells = cellsOf(src);
  // On the sample, the room's own totals are the source of truth (a hand-entered
  // menu or profile rescales them): shape the rows to match, person by person.
  if (src.from === 'sample') cells = fitToStaff(cells, room.staff, first, weeks - 1);
  const staffByName = new Map(room.staff.map((s) => [norm(s.name), s]));
  const names = [...new Set(cells.map((c) => c.name))].filter((n) => src.from === 'toast' || staffByName.has(norm(n)));

  const people = names.map((name) => {
    const mine = cells.filter((c) => c.name === name);
    const job = mine[0]?.job || staffByName.get(norm(name))?.role || '';
    const recent = mine.filter((c) => c.w >= first);
    const before = mine.filter((c) => c.w < first);
    const R = totals(recent);
    const staffRow = staffByName.get(norm(name)) || null;
    const reg = register.people.find((p) => norm(p.name) === norm(name)) || null;
    const kind = R.sales > 0 || SELL_JOBS(job) ? 'sell' : isKitchen(job) ? 'kitchen' : 'floor';
    const weekly = Array.from({ length: weeks }, (_, w) => totals(mine.filter((c) => c.w === w)));
    return {
      id: slug(name), name, job, kind, recentCells: recent, beforeCells: before, weekly, R, B: totals(before),
      shifts: R.shifts, hours: R.hours, hoursThisWeek: staffRow?.hours ?? weekly[weeks - 1].hours, rate: staffRow?.rate ?? null,
      enough: R.shifts >= MIN_SHIFTS, startedWeek: mine.length ? Math.min(...mine.map((c) => c.w)) : null,
      mix: R.slotShifts.map((s) => (R.shifts ? s / R.shifts : 0)),
      reg,
    };
  });

  // Group-wide pools (same job, every room in view), for jobs too small to rank in one room.
  const pools = groupPools(ds, roomId);
  const sellers = people.filter((p) => p.kind === 'sell');
  const jobs = [...new Set(sellers.map((p) => p.job))];
  const midFit = new Map();
  for (const job of jobs) {
    const inRoom = sellers.filter((p) => p.job === job);
    const ranked = inRoom.filter((p) => p.enough);
    const pool = ranked.length >= MIN_PEERS ? null : (pools.get(norm(job)) || []).filter((p) => p.enough);
    const scope = pool && pool.length + ranked.length >= MIN_PEERS ? 'group' : 'room';
    const peerCells = scope === 'group' ? [...ranked, ...pool].flatMap((p) => p.recentCells) : ranked.flatMap((p) => p.recentCells);
    const peers = scope === 'group' ? [...ranked, ...pool] : ranked;
    for (const m of METRICS) {
      if (m.group === 'time' && m.k === 'late') continue;
      const rates = slotRates(peerCells, m);
      const score = (p) => {
        const T = p.R; if (val(T, m.den) <= 0) return null;
        if (m.optional && ((m.k === 'tipRate' && !T.hasTips) || (m.k === 'blank' && !T.hasReason))) return null;
        return m.better == null || m.group === 'register' ? (val(T, m.num) / val(T, m.den)) * (m.per || 1) : sameShiftIndex(p.recentCells, m, rates);
      };
      const list = peers.map(score).filter((v) => v != null);
      // 100 = the middle person in the job on the same kind of shifts (a few big sellers can't move "normal").
      const mid = m.better === 'high' && m.group !== 'register' ? median(list) || null : null;
      if (m.k === 'fit') midFit.set(job, mid);
      for (const p of inRoom) {
        const T = p.R;
        const raw = val(T, m.den) > 0 ? (val(T, m.num) / val(T, m.den)) * (m.per || 1) : null;
        const s = p.enough ? score(p) : null;
        const pct = p.enough && m.better ? percentile(s, list) : null;
        p.m ??= {};
        p.m[m.k] = { raw, index: m.better === 'high' && s != null && mid ? (s / mid) * 100 : null, pct, tier: tierOf(pct, m.better), peerMedian: list.length ? median(peers.map((q) => (val(q.R, m.den) > 0 ? (val(q.R, m.num) / val(q.R, m.den)) * (m.per || 1) : null)).filter((v) => v != null)) : null };
      }
    }
    for (const p of inRoom) { p.peers = { n: peers.length, scope, job, rooms: scope === 'group' ? new Set(peers.map((q) => q.roomId || roomId)).size : 1 }; }
    // Each seller's sales per hour, week by week, on the same-shift scale (the trend line).
    const rates = slotRates(peerCells, METRIC.fit);
    const k100 = 100 / (midFit.get(job) || 100);
    for (const p of inRoom) {
      p.trend = p.weekly.map((_, w) => { const wc = [...p.recentCells, ...p.beforeCells].filter((c) => c.w === w); return wc.length ? r1((sameShiftIndex(wc, METRIC.fit, rates) ?? 0) * k100) : null; });
      const now = sameShiftIndex(p.recentCells, METRIC.fit, rates), was = sameShiftIndex(p.beforeCells, METRIC.fit, rates);
      p.trendMove = now != null && was != null && p.B.shifts >= 12 && p.enough ? now / was - 1 : null;
      p.raw = { salesHr: p.R.hours ? p.R.sales / p.R.hours : null, peakShare: p.mix[2] };
    }
  }
  // Late clock-ins: everyone, in their job (or the whole room when the job is small).
  for (const p of people) {
    p.m ??= {};
    const T = p.R;
    const raw = T.hasLate && T.shifts ? (T.late / T.shifts) * 10 : null;
    p.m.late = { raw, pct: null, tier: raw != null && p.enough && raw >= 2.5 ? 'bottom' : null };
    p.m.ot = { raw: T.ot };
  }

  // Team checks first (habits can explain an individual's number), then each person's read.
  const team = teamRead(ds, roomId, room, sellers, people, register);
  for (const p of people) p.read = personRead(p, team, period);
  const order = { closer: 0, coach: 1, star: 2, solid: 3, early: 4, info: 5 };
  people.sort((a, b) => (a.kind === 'sell' ? 0 : 1) - (b.kind === 'sell' ? 0 : 1) || order[a.read.kind] - order[b.read.kind] || (b.m.fit?.pct ?? -1) - (a.m.fit?.pct ?? -1) || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(Object.keys(order).map((k) => [k, people.filter((p) => p.read.kind === k).length]));
  team.counts = counts;
  team.action = topAction(people, team, room);

  const reconcile = {
    sales: sum(people.map((p) => p.R.sales)), comps: sum(people.map((p) => p.R.comps)), disc: sum(people.map((p) => p.R.disc)), voids: sum(people.map((p) => p.R.voids)),
    hoursThisWeek: sum(people.map((p) => p.hoursThisWeek || 0)),
  };
  // Strip the working arrays the screen doesn't need.
  const out = people.map(({ recentCells, beforeCells, ...p }) => p);
  return { roomId, source: src.from, period, people: out, sellers: out.filter((p) => p.kind === 'sell'), others: out.filter((p) => p.kind !== 'sell'), team, register, reconcile, labels: src.labels };
}

function periodOf(src) {
  if (!src) return { label: 'Last 4 weeks', short: '4 weeks', trend: 'Last 13 weeks' };
  const L = src.labels || [];
  const n = L.length;
  const from = L[n - RECENT_WEEKS];
  const to = src.lastDay || null;
  return { label: from ? `Last 4 weeks, ${from} – ${to || `week of ${L[n - 1]}`}` : 'Last 4 weeks', short: '4 weeks', trend: L[0] ? `Last ${n} weeks, from ${L[0]}` : `Last ${n} weeks`, from, to };
}

/** Scale each sample person's rows so their last 4 weeks equal the room's own 28-day totals (and the latest week its hours). */
function fitToStaff(cells, staff, first, last) {
  const by = new Map(staff.map((s) => [norm(s.name), s]));
  const groups = new Map();
  for (const c of cells) { const k = norm(c.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  const out = [];
  for (const [k, list] of groups) {
    const s = by.get(k);
    if (!s) continue;
    const recent = list.filter((c) => c.w >= first);
    const k$ = (key, want) => { const have = sum(recent.map((c) => +c[key] || 0)); return have > 0 && want != null ? want / have : 1; };
    const ks = k$('sales', s.sales), kc = k$('comps', s.comps), kd = k$('disc', s.disc), kv = k$('voids', s.postVoid);
    const lastH = sum(list.filter((c) => c.w === last).map((c) => +c.hours || 0));
    const kh = lastH > 0 && s.hours != null ? s.hours / lastH : 1;
    const close = (x) => Math.abs(x - 1) < 1e-9;
    for (const c of list) {
      out.push(close(ks) && close(kc) && close(kd) && close(kv) && close(kh) ? c : {
        ...c, sales: c.sales * ks, tips: c.tips * ks, refunds: c.refunds * ks, comps: c.comps * kc, disc: c.disc * kd, voids: c.voids * kv,
        noReason: c.noReason * (c.comps + c.disc > 0 ? (c.comps * kc + c.disc * kd) / (c.comps + c.disc) : 1), hours: c.hours * kh, ot: c.ot * kh,
      });
    }
  }
  return out;
}

/** Same-job people in the other rooms in view (only their recent rows), keyed by job. */
function groupPools(ds, roomId) {
  const pools = new Map();
  for (const id of Object.keys(ds.rooms || {})) {
    if (id === roomId) continue;
    const src = staffSource(ds, id);
    if (!src) continue;
    const weeks = src.weeks || TREND_WEEKS;
    const first = weeks - RECENT_WEEKS;
    let cells = cellsOf(src).filter((c) => c.w >= first);
    if (src.from === 'sample') cells = fitToStaff(cells, ds.rooms[id].staff, first, weeks - 1);
    const by = new Map();
    for (const c of cells) { if (!by.has(c.name)) by.set(c.name, []); by.get(c.name).push(c); }
    for (const [name, list] of by) {
      const job = list[0].job;
      const R = totals(list);
      if (!(R.sales > 0)) continue;
      const k = norm(job);
      if (!pools.has(k)) pools.set(k, []);
      pools.get(k).push({ name, job, roomId: id, R, recentCells: list, enough: R.shifts >= MIN_SHIFTS });
    }
  }
  return pools;
}

/* ------------------------------------------------------------------ the coaching read */
const fmtN = (n, d = 0) => (n == null ? '—' : Number(n).toFixed(d));
const money0 = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const money2 = (n) => `$${Number(n).toFixed(2)}`;
export function fmtMetric(k, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const m = METRIC[k];
  switch (m?.fmt) {
    case 'money': return money0(v);
    case 'money2': return money2(v);
    case 'pct': return `${v.toFixed(1)}%`;
    case 'pct0': return `${Math.round(v)}%`;
    case 'min': return `${Math.round(v)} min`;
    case 'int': return `${Math.round(v)}`;
    default: return fmtN(v, 1);
  }
}
const EXC = { postVoid: 'orders cancelled after the kitchen started them', comps: 'comps', disc: 'discounts' };

function personRead(p, team, period) {
  const evidence = `${p.shifts} shift${p.shifts === 1 ? '' : 's'}, ${period.short}`;
  if (p.kind !== 'sell') {
    const late = p.m.late?.raw;
    if (late != null && p.enough && late >= 2.5) return { kind: 'coach', title: 'Coach: on time', line: `Late on about ${fmtN(late, 0)} of every 10 shifts.`, habit: 'clocks in on time', why: [`${p.R.late} late clock-ins in ${p.shifts} shifts (${period.short}).`], alt: ['Check the schedule matches what was agreed. A start time that moved, a bus line or a second job can explain a pattern.'], evidence };
    return { kind: 'info', title: p.kind === 'kitchen' ? 'Kitchen: hours only' : 'Hours only', line: p.kind === 'kitchen' ? 'The POS only sees their clock-ins. Ticket speed lives on Kitchen.' : 'The POS only sees their clock-ins.', why: [], alt: [], evidence };
  }
  if (!p.enough) {
    return { kind: 'early', title: 'Too early to tell', line: `${p.shifts} shift${p.shifts === 1 ? '' : 's'} in the last 4 weeks. Rankings start at ${MIN_SHIFTS}.`, why: [p.startedWeek != null && p.startedWeek >= p.weekly.length - RECENT_WEEKS ? 'New in the last month.' : 'Worked few shifts this month.'], alt: [], evidence };
  }
  const fit = p.m.fit;
  const why = [], alt = [];
  // A register pattern above its own limit (the Giveaways page's method) is the one "closer look".
  const sig = p.reg ? ['postVoid', 'comps', 'disc'].filter((k) => p.reg[`${k}Signal`]) : [];
  if (sig.length) {
    const k = sig[0];
    const rate = p.reg[`${k}Rate`] * 100, ucl = p.reg[`${k}Ucl`] * 100;
    const beforeRate = p.B.sales > 0 ? ((k === 'postVoid' ? p.B.voids : k === 'comps' ? p.B.comps : p.B.disc) / p.B.sales) * 100 : null;
    why.push(`${cap(EXC[k])}: $${(rate).toFixed(2)} per $100 sold, above the normal range for their volume (up to $${ucl.toFixed(2)}).`);
    if (beforeRate != null && beforeRate < rate * 0.6) why.push(`It started recently: $${beforeRate.toFixed(2)} per $100 in the 9 weeks before.`);
    if (p.m.blank?.raw != null && p.m.blank.raw >= 30) why.push(`${Math.round(p.m.blank.raw)}% of their giveaway dollars have no reason entered.`);
    alt.push('A regular’s birthday, a kitchen mistake or a manager’s instruction can all look like this. Ask first.');
    if (fit.tier === 'top') alt.push('They are also one of your best sellers. Keep the conversation about the register, not their selling.');
    return { kind: 'closer', title: 'Needs a closer look', line: `${cap(EXC[k])} above their normal range, ${period.short}.`, why, alt, evidence, signal: k, habit: k === 'postVoid' ? 'checks the order with the guest before sending it' : 'puts a reason on every giveaway' };
  }
  const trendNote = p.trendMove != null && Math.abs(p.trendMove) >= 0.12 ? (p.trendMove < 0 ? `Down ${Math.round(-p.trendMove * 100)}% against their own 9 weeks before.` : `Up ${Math.round(p.trendMove * 100)}% against their own 9 weeks before.`) : null;
  const behind = fit.tier === 'bottom' && fit.index != null && fit.index <= 85;
  if (behind || (p.trendMove != null && p.trendMove <= -0.15)) {
    const hab = weakestHabit(p, team);
    if (hab) why.push(hab.line);
    if (trendNote && p.trendMove < 0) why.push(trendNote);
    if (behind) why.push(`Sells ${Math.round(100 - fit.index)}% less per hour than ${plural(p.job)} on the same kind of shifts (bottom third of ${p.peers.n}).`);
    alt.push('Section and table count change what anyone can sell. Check their sections before coaching.');
    if (hab?.team) alt.push(`The whole team is light here too, so train everyone, not just ${p.name.split(' ')[0]}.`);
    return { kind: 'coach', title: hab ? `Coach: ${hab.short}` : p.trendMove < 0 ? 'Coach: back to their usual' : 'Coach', line: hab ? hab.line : behind ? `Sells ${Math.round(100 - fit.index)}% less per hour than peers on the same shifts.` : trendNote, habit: hab?.habit || null, habitKey: hab?.k || null, now: hab?.now, goal: hab?.goal, why, alt, evidence };
  }
  if (fit.tier === 'top') {
    const best = strongestHabit(p);
    why.push(`Sales per hour in the top third of ${p.peers.n} ${plural(p.job)} on the same kind of shifts.`);
    if (best) why.push(best);
    if (trendNote) why.push(trendNote);
    return { kind: 'star', title: 'Star', line: best || 'Sells more than peers on the same shifts.', why, alt, evidence };
  }
  if (trendNote) why.push(trendNote);
  return { kind: 'solid', title: 'Solid', line: trendNote || 'In line with peers on the same shifts.', why, alt, evidence };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (job) => `${String(job || 'people').toLowerCase()}s`.replace(/ss$/, 's');

/** The habit (starters, desserts, drinks) where they sit lowest against peers. */
function weakestHabit(p, team) {
  const opts = ['desserts', 'starters', 'drinks'].map((k) => ({ k, m: p.m[k] })).filter((x) => x.m?.pct != null && x.m.pct <= 33 && x.m.peerMedian > 0 && x.m.raw <= x.m.peerMedian * 0.8);
  if (!opts.length) return null;
  opts.sort((a, b) => a.m.pct - b.m.pct);
  const { k, m } = opts[0];
  const goal = m.peerMedian;
  const isTeam = team.habits?.some((h) => h.k === k);
  return { k, short: METRIC[k].habit.replace(/^offers /, 'offering '), habit: METRIC[k].habit, now: Math.round(m.raw), goal: Math.round(goal), team: isTeam, line: `Rarely ${METRIC[k].habit}: ${Math.round(m.raw)} ${k} per 100 guests, peers ${Math.round(goal)}.` };
}
function strongestHabit(p) {
  const opts = ['desserts', 'starters', 'drinks', 'perGuest'].map((k) => ({ k, m: p.m[k] })).filter((x) => x.m?.pct != null && x.m.pct >= 80 && x.m.peerMedian > 0 && x.m.raw >= x.m.peerMedian * 1.15);
  if (!opts.length) return null;
  opts.sort((a, b) => b.m.pct - a.m.pct);
  const { k, m } = opts[0];
  if (k === 'perGuest') return `Guests spend ${money2(m.raw)} each, peers ${money2(m.peerMedian)}.`;
  return `${cap(k)}: ${Math.round(m.raw)} per 100 guests, peers ${Math.round(m.peerMedian)}. Worth having them show the team.`;
}

/* ------------------------------------------------------------------ the team read */
function emptyTeam(room) { return { missing: [], overCorrect: [], habits: [], counts: {}, action: null, roomName: room?.profile?.short || '' }; }

function teamRead(ds, roomId, room, sellers, people, register) {
  const team = emptyTeam(room);
  const ranked = sellers.filter((p) => p.enough);
  // Team habits: a per-guest habit where the room's whole job runs well below the same job in the other rooms.
  const pools = groupPools(ds, roomId);
  for (const job of [...new Set(ranked.map((p) => p.job))]) {
    const mine = ranked.filter((p) => p.job === job);
    const others = (pools.get(norm(job)) || []).filter((p) => p.enough);
    if (mine.length < 3 || others.length < 3) continue;
    for (const k of ['desserts', 'starters', 'drinks']) {
      const m = METRIC[k];
      const rate = (list) => { const n = sum(list.map((p) => val(p.R, m.num))), d = sum(list.map((p) => val(p.R, m.den))); return d > 0 ? (n / d) * 100 : null; };
      const here = rate(mine), there = rate(others);
      if (here != null && there != null && here < there * 0.75) {
        const low = mine.filter((p) => (p.m[k]?.raw ?? 0) < there * 0.75).length;
        team.habits.push({ k, job, here: Math.round(here), there: Math.round(there), low, n: mine.length, line: `${low} of ${mine.length} ${plural(job)} here are light on ${k}: ${Math.round(here)} per 100 guests, against ${Math.round(there)} in your other rooms.` });
        team.overCorrect.push({ kind: 'team-habit', k, title: `Light on ${k} is a team habit`, line: `${low} of ${mine.length} ${plural(job)} sell few ${k} (${Math.round(here)} per 100 guests; ${Math.round(there)} in your other rooms). Train the whole team, don't single anyone out.` });
      }
    }
  }
  for (const p of ranked) {
    const fit = p.m.fit;
    const rawList = ranked.filter((q) => q.job === p.job).map((q) => q.raw.salesHr);
    const rawPct = percentile(p.raw.salesHr, rawList);
    const rawTier = tierOf(rawPct);
    const peakTeam = sum(ranked.filter((q) => q.job === p.job).map((q) => q.mix[2])) / Math.max(1, ranked.filter((q) => q.job === p.job).length);
    // Over-correcting: a low number in the POS report that the shifts explain.
    if (rawTier === 'bottom' && (fit.tier !== 'bottom' || (fit.index ?? 0) > 85)) {
      const main = p.mix.indexOf(Math.max(...p.mix));
      const where = fit.tier === 'top' ? 'in the top third' : fit.tier === 'middle' ? 'in the middle' : `only ${Math.max(0, Math.round(100 - fit.index))}% behind the middle`;
      team.overCorrect.push({ kind: 'shifts', person: p.id, name: p.name, title: `${p.name} isn't slow`, line: `Among the lowest sales per hour in the POS report, but ${Math.round(p.mix[main] * 100)}% of their shifts are ${SLOT_LABEL[main].toLowerCase()}s. On the same shifts they're ${where}.` });
    }
    // Missing: a good number resting on easy shifts.
    if (rawTier === 'top' && fit.tier !== 'top' && p.mix[2] >= peakTeam * 1.5) {
      team.missing.push({ kind: 'easy-shifts', person: p.id, name: p.name, title: `${p.name}'s number rests on busy nights`, line: `Top sales per hour in the POS report, but ${Math.round(p.mix[2] * 100)}% of their shifts are Friday and Saturday dinners. On the same shifts they're ${fit.tier === 'bottom' ? 'in the bottom third' : 'in the middle'}.` });
    }
    // Missing: a strong seller rarely on the busy nights.
    if (fit.tier === 'top' && p.mix[2] <= peakTeam * 0.5) {
      team.missing.push({ kind: 'not-scheduled', person: p.id, name: p.name, title: `${p.name} rarely gets Fri–Sat`, line: `One of your best sellers on the same shifts, but only ${Math.round(p.mix[2] * 100)}% of their shifts are Friday or Saturday dinners (team ${Math.round(peakTeam * 100)}%).`, schedule: true });
    }
    // Missing: a strong seller whose giveaways are also high.
    const sig = p.reg && ['comps', 'disc', 'postVoid'].some((k) => p.reg[`${k}Signal`]);
    if (fit.tier === 'top' && !sig && p.m.give?.tier === 'bottom') {
      team.missing.push({ kind: 'strong-but', person: p.id, name: p.name, title: `${p.name} sells a lot, and gives a lot away`, line: `Top third for sales per hour, and among the highest giveaways (${money2(p.m.give.raw)} per $100 sold), still inside their normal range. The totals hide it.` });
    }
    // Missing: a slide nobody's seen yet.
    if (p.trendMove != null && p.trendMove <= -0.15 && fit.tier !== 'bottom') {
      team.missing.push({ kind: 'slipping', person: p.id, name: p.name, title: `${p.name} is slipping`, line: `Still ${fit.tier === 'top' ? 'top third' : 'mid-pack'}, but sales per hour are down ${Math.round(-p.trendMove * 100)}% against their own 9 weeks before.` });
    }
  }
  // Over-correcting: the highest giveaways, still inside the normal range for their volume.
  const regRanked = ranked.filter((p) => p.reg);
  const topGive = [...regRanked].sort((a, b) => (b.m.give.raw ?? 0) - (a.m.give.raw ?? 0))[0];
  if (topGive && !['postVoid', 'comps', 'disc'].some((k) => topGive.reg[`${k}Signal`])) {
    team.overCorrect.push({ kind: 'inside-range', person: topGive.id, name: topGive.name, title: `${topGive.name}'s giveaways are inside the range`, line: `Highest giveaways on the team (${money2(topGive.m.give.raw)} per $100), but inside the normal range for their volume. Nothing to act on yet.` });
  }
  // Small samples that would look extreme in a report.
  for (const p of sellers.filter((q) => !q.enough && q.shifts > 0)) {
    team.overCorrect.push({ kind: 'early', person: p.id, name: p.name, title: `Too early to judge ${p.name}`, line: `${p.shifts} shift${p.shifts === 1 ? '' : 's'} in 4 weeks. Any number this early is mostly luck.` });
  }
  team.room = room.profile?.short || roomId;
  team.registerSignals = register.signalCount;
  team.registerBase = Object.fromEntries(Object.entries(register.types).map(([k, t]) => [k, t.base]));
  return team;
}

/** Average menu price of what a habit sells (desserts, drinks), from the room's own menu. null when the menu can't tell. */
export function habitPrice(room, k) {
  const re = k === 'desserts' ? /dessert|sweet|pastry/i : k === 'drinks' ? /alcohol|non-alc|drink|bev|wine|beer|cocktail|liquor/i : k === 'starters' ? /starter|appetizer|small plate|shareable/i : null;
  const items = (room.menu || []).filter((m) => !m.balancing && re && re.test(m.cat || ''));
  const units = sum(items.map((m) => m.units || 0));
  return units > 0 ? sum(items.map((m) => (m.units || 0) * m.price)) / units : null;
}

/** The one thing to do: a closer look first, then a team habit, then the biggest individual coaching gap. */
function topAction(people, team, room) {
  const closer = people.filter((p) => p.read.kind === 'closer');
  if (closer.length) {
    const p = closer[0];
    const base = (team.registerBase || {})[p.read.signal];
    const weekly = p.reg && base != null ? Math.max(0, (p.reg[`${p.read.signal}Rate`] - base) * p.reg.sales / 4) : null;
    return { kind: 'closer', person: p.id, title: `Have a private word with ${p.name}`, line: p.read.line, money: weekly, moneyNote: 'a week above the team’s normal rate, potential', cta: 'Add the talk to Today', approvalId: `staff:${p.id}:talk`, task: { title: `${room.profile?.short || ''}: a private word with ${p.name} about ${EXC[p.read.signal]}`.replace(/^: /, ''), system: 'Coaching', diff: [[`${p.name}: ${p.read.habit}`, 'Not yet', 'Talk before their next shift']] } };
  }
  const habit = team.habits[0];
  if (habit) {
    const goal = habit.there;
    const price = habitPrice(room, habit.k);
    const guests = sum(people.filter((p) => p.job === habit.job && p.kind === 'sell').map((p) => p.R.guests)) / RECENT_WEEKS;
    const money = price != null ? ((habit.there - habit.here) / 100) * guests * price * 0.5 : null;
    return { kind: 'team', money, moneyNote: 'a week if the team closes half the gap, potential', title: `Train the ${plural(habit.job)} on ${habit.k}`, line: habit.line, cta: 'Add the training to Today', approvalId: `staff:team:${habit.k}`, task: { title: `${room.profile?.short || ''}: 10-minute pre-shift on ${habit.k}`.replace(/^: /, ''), system: 'Coaching', diff: [[`${cap(habit.k)} per 100 guests`, String(habit.here), String(goal)]] } };
  }
  const coach = people.filter((p) => p.read.kind === 'coach' && p.read.habitKey).sort((a, b) => (a.m.fit?.pct ?? 50) - (b.m.fit?.pct ?? 50));
  if (coach.length) {
    const p = coach[0];
    const price = habitPrice(room, p.read.habitKey);
    const money = price != null ? ((p.read.goal - p.read.now) / 100) * (p.R.guests / RECENT_WEEKS) * price * 0.5 : null;
    return { kind: 'coach', money, moneyNote: 'a week if they close half the gap, potential', person: p.id, title: `Coach ${p.name} on ${p.read.habitKey}`, line: p.read.line, cta: 'Add the coaching to Today', approvalId: `staff:${p.id}:${p.read.habitKey}`, task: { title: `${room.profile?.short || ''}: coach ${p.name} on ${p.read.habitKey}`.replace(/^: /, ''), system: 'Coaching', diff: [[`${cap(p.read.habitKey)} per 100 guests`, String(p.read.now), String(p.read.goal)]] } };
  }
  const sched = team.missing.find((m) => m.kind === 'not-scheduled');
  if (sched) return { kind: 'schedule', person: sched.person, title: `Give ${sched.name} a Friday or Saturday`, line: sched.line, cta: 'Add to next week’s schedule', approvalId: `staff:${sched.person}:peak`, task: { title: `Schedule ${sched.name} on a Friday or Saturday dinner`, system: '7shifts', diff: [[`${sched.name}: Fri–Sat dinners`, 'Rarely', 'One a week']] } };
  return null;
}

/** For a coaching task: the person's evidence as plain lines (the server and the AI both use it). */
export function evidenceLines(p, period) {
  const out = [`${p.name}, ${p.job}: ${p.shifts} shifts, ${Math.round(p.hours)} hours, ${period.label}.`];
  if (p.kind === 'sell' && p.m?.fit) {
    out.push(`Sales per hour ${fmtMetric('fit', p.m.fit.raw)} (${p.m.fit.tier ? `${p.m.fit.tier} third` : 'not ranked'} of ${p.peers?.n ?? 0} on the same shifts).`);
    for (const k of ['desserts', 'starters', 'drinks']) if (p.m[k]?.raw != null) out.push(`${cap(k)}: ${Math.round(p.m[k].raw)} per 100 guests (peers ${Math.round(p.m[k].peerMedian ?? 0)}).`);
    out.push(`Giveaways ${fmtMetric('give', p.m.give?.raw)} per $100; cancelled after the kitchen ${fmtMetric('voids', p.m.voids?.raw)} per $100.`);
  }
  if (p.m?.late?.raw != null) out.push(`Late clock-ins: ${fmtN(p.m.late.raw, 1)} per 10 shifts.`);
  return out;
}

/** The read without any names: for roles that may not see who is who. */
export function anonymize(page) {
  if (!page) return page;
  const kinds = page.team?.counts || {};
  return { roomId: page.roomId, source: page.source, period: page.period, anonymous: true, team: { counts: kinds, habits: page.team.habits, registerSignals: page.team.registerSignals }, people: [], sellers: [], others: [], reconcile: page.reconcile };
}
