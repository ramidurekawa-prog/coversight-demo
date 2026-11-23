/**
 * Scoreboard: the one page that blends All rooms (every restaurant, ranked)
 * and Daily detail (one restaurant, day by day). Pure, so the browser and the
 * tests read the same marks.
 *
 * Every mark is computed from figures the other two modules already make:
 * a room's tier comes from portfolioView's priority, a day's mark from its net
 * sales against the comparison Daily detail uses. Nothing is typed in, and a
 * day with nothing to compare against gets no mark rather than a guess.
 */
import { addDays, change, compareDay, ratio } from './daily.js';

/** A day's mark against the comparison: at least +2% is good, worse than −5% is bad, between is mid. */
export const DAY_MARK = { good: 0.02, bad: -0.05 };

/** The three marks, in plain words, with the tone the kit colours them by and an icon (never colour alone). */
export const MARKS = {
  good: { tone: 'good', icon: 'TrendingUp', room: 'In the green', day: 'Beat usual' },
  mid: { tone: 'warn', icon: 'ArrowRight', room: 'Worth a look', day: 'Close to usual' },
  bad: { tone: 'bad', icon: 'TrendingDown', room: 'Needs you', day: 'Below usual' },
  none: { tone: '', icon: 'Minus', room: 'No data yet', day: 'Nothing to compare' },
};

/** A room's mark from its priority tier: steady → good, watch → mid, urgent → bad. */
export const roomMark = (r) => (r?.priority?.tier === 'urgent' ? 'bad' : r?.priority?.tier === 'watch' ? 'mid' : r?.priority ? 'good' : 'none');

/** A day's mark from its fractional change against the comparison, or none. */
export function dayMark(vs) {
  if (vs == null) return 'none';
  return vs >= DAY_MARK.good ? 'good' : vs < DAY_MARK.bad ? 'bad' : 'mid';
}

/**
 * The last `n` days held to `end`, each with its net sales against the same
 * comparison Daily detail uses (default: the last 4 same weekdays), a mark, and
 * its rank by net sales among these days (1 = best). Days the data doesn't hold
 * are left out, never counted as zero.
 */
export function dayBoard(days, { n = 14, end = days.at(-1)?.iso, method = 'recent' } = {}) {
  if (!end) return [];
  const from = addDays(end, -n + 1);
  const win = days.filter((d) => d.iso >= from && d.iso <= end);
  const rows = win.map((d) => {
    const base = compareDay(days, d.iso, method);
    const vs = change(d.net, base?.net);
    const after = d.earned != null ? d.earned : d.labour != null ? d.net - d.labour : null;
    return {
      iso: d.iso, dow: d.dow, net: d.net, covers: d.covers, check: ratio(d.net, d.covers),
      labourPct: d.labour != null ? ratio(d.labour, d.net) : null, after,
      usual: base?.net ?? null, vs, mark: dayMark(vs), partial: d.complete === false,
    };
  });
  [...rows].sort((a, b) => b.net - a.net).forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** How many of a list sit in each mark. */
export function tally(rows, markOf = (r) => r.mark) {
  const t = { good: 0, mid: 0, bad: 0, none: 0 };
  for (const r of rows) t[markOf(r)]++;
  return t;
}

/** Sort rows by a key, either way. Unknown values always sort last, so a missing figure never ranks as best or worst. */
export function sortRows(rows, key, dir = 'desc') {
  const k = typeof key === 'function' ? key : (r) => r[key];
  return [...rows].sort((a, b) => {
    const x = k(a), y = k(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return dir === 'asc' ? c : -c;
  });
}

/**
 * Badges for the room cards, each won outright on a computed figure:
 * the best margin among rooms with a full period, and the biggest gain on
 * its own normal (only if it is a real gain of at least 1 point).
 */
export function roomBadges(rooms) {
  const out = {};
  const counted = rooms.filter((r) => r.money?.contribution?.value != null && r.money?.revenue?.value);
  if (counted.length > 1) {
    const best = sortRows(counted, (r) => r.money.contribution.value / r.money.revenue.value)[0];
    (out[best.id] ??= []).push({ k: 'margin', icon: 'Trophy', label: 'Best margin' });
  }
  const gains = rooms.filter((r) => r.money?.change?.marginPts != null && !r.money.change.unavailable && r.money.change.marginPts >= 1);
  if (gains.length && rooms.length > 1) {
    const up = sortRows(gains, (r) => r.money.change.marginPts)[0];
    (out[up.id] ??= []).push({ k: 'up', icon: 'Rocket', label: 'Most improved' });
  }
  return out;
}

/**
 * The answer-first headline for the rooms tab: what the group kept, then who
 * needs you first. `kept` is the group's contribution for the period (null
 * when it can't be counted); `top` is the first room in priority order.
 */
export function roomsHeadline(rooms, { period = 'this week', kept = null, top = rooms[0] } = {}) {
  const n = rooms.length;
  if (!n) return 'No restaurants yet.';
  const t = tally(rooms, roomMark);
  if (t.good === n) return n === 1 ? `Your restaurant is in the green ${period}.` : `All ${n} restaurants are in the green ${period}.`;
  const lead = kept != null ? `$${Math.round(kept).toLocaleString('en-US')} kept after food & labor ${period}.` : n > 1 && t.good ? `${t.good} of ${n} restaurants in the green ${period}.` : '';
  const who = n === 1 ? 'Your restaurant' : top.short || top.name;
  const tail = roomMark(top) === 'bad' ? `${who} has the most going wrong.` : `${who} is worth a look.`;
  return [lead, tail].filter(Boolean).join(' ');
}

/** The answer-first headline for the day tab: how the day did against usual. */
export function dayHeadline(day, vs) {
  const name = new Date(`${day.iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  if (vs == null) return `${name}: nothing to compare it with yet.`;
  const p = Math.round(Math.abs(vs) * 100);
  if (p < 1) return `${name} came in right on usual.`;
  return `${name} came in ${p}% ${vs > 0 ? 'above' : 'below'} usual.`;
}

const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

/**
 * One location's report card: what is going well and what isn't, for the
 * restaurant (sales and margin against its own normal) and for Coversight
 * (verified savings, changes being measured, reversals, paused savings, data
 * health). Read-only facts, each from a computed figure; nothing here is a
 * button to fix something. `items` are the room's open attention items from
 * portfolioView, shown as plain facts with their detail.
 */
export function locationReport(room, items = [], { badges = [] } = {}) {
  const good = [], bad = [];
  const m = room.money ?? {}, c = m.change, sv = room.savings ?? {};
  const margin = m.contribution?.value != null && m.revenue?.value ? m.contribution.value / m.revenue.value : null;
  const known = c && !c.unavailable;
  // The restaurant
  if (known && c.revenuePct != null) {
    const p = c.revenuePct * 100;
    if (p >= 2) good.push({ k: 'sales', icon: 'TrendingUp', text: `Sales up ${p.toFixed(1)}% on its normal` });
    else if (p <= -2) bad.push({ k: 'sales', tone: 'warn', icon: 'TrendingDown', text: `Sales down ${Math.abs(p).toFixed(1)}% on its normal` });
    else good.push({ k: 'sales', icon: 'ShieldCheck', text: 'Sales in line with its normal' });
  }
  if (known && c.marginPts != null && margin != null) {
    if (c.marginPts >= 1) good.push({ k: 'margin', icon: 'TrendingUp', text: `Margin up ${c.marginPts.toFixed(1)} pts to ${(margin * 100).toFixed(1)}%` });
    else if (c.marginPts <= -1) bad.push({ k: 'margin', tone: c.marginPts <= -3 ? 'bad' : 'warn', icon: 'TrendingDown', text: `Margin down ${Math.abs(c.marginPts).toFixed(1)} pts to ${(margin * 100).toFixed(1)}%` });
    else good.push({ k: 'margin', icon: 'ShieldCheck', text: `Margin holding at ${(margin * 100).toFixed(1)}% after food & labor` });
  }
  for (const b of badges) good.push({ k: `badge-${b.k}`, icon: b.icon, text: `${b.label} in the group` });
  // Coversight
  if (sv.runRate > 0) good.push({ k: 'saved', icon: 'BadgeCheck', text: `${usd(sv.runRate)}/wk in verified savings`, sub: sv.toDate > 0 ? `${usd(sv.toDate)} to date` : undefined });
  if (room.tests > 0) good.push({ k: 'tests', icon: 'Timer', text: `${room.tests} change${room.tests === 1 ? '' : 's'} being measured` });
  for (const r of sv.reversed ?? []) bad.push({ k: `rev-${r.id}`, tone: 'warn', icon: 'Undo2', text: `Reversed: ${r.title}`, sub: 'It stopped paying off, so it no longer counts.' });
  if (sv.suspended > 0) bad.push({ k: 'paused', tone: 'warn', icon: 'CirclePause', text: `${usd(sv.suspended)}/wk of savings paused until an issue clears` });
  // What Coversight is watching: alarms first, then data that's late.
  const order = { bad: 0, warn: 1, info: 2 };
  for (const x of [...items].sort((a, b) => (order[a.tone] ?? 3) - (order[b.tone] ?? 3))) {
    bad.push({ k: x.id, tone: x.tone === 'bad' ? 'bad' : 'warn', icon: x.icon, text: x.title, sub: x.body });
  }
  if (room.state === 'offline') bad.push({ k: 'offline', tone: 'bad', icon: 'Ban', text: `No data for ${room.dataAge} days` });
  else if (!items.some((x) => x.kind === 'feed') && room.counted) good.push({ k: 'data', icon: 'CircleCheck', text: 'Every data feed up to date' });
  // The most serious first; otherwise keep the order above.
  bad.sort((a, b) => (a.tone === 'bad' ? 0 : 1) - (b.tone === 'bad' ? 0 : 1));
  return { good, bad };
}
