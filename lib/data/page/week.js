// The This week page, as data. Pure: the screen, the week API and the Monday
// digest all call weekView(), so the browser and the server always say the
// same thing about a week.
//
// Two sources for what's been proven:
//  - the sample group: its verification packets (d.proofs, d.banked), and
//  - a real group: its own test windows (the server's test_windows rows),
//    passed in as `windows`. A real group never shows a sample packet.
// Every dollar comes from lib/data/model.js (deriveRoom) or a window row.

import { choosePlan, money } from '../model.js';
import { bookedBetween, utcDay } from '../billing.js';
import { weekBrief } from '../weekbrief.js';

export const REVIEW_KEY = 'week.review';
/** How many past reviews a room keeps (the rest drop off the oldest end). */
export const REVIEW_KEEP = 26;
const WINDOW_DAYS = 28;
const MS_DAY = 864e5;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const at = (d) => Date.parse(`${d}T00:00:00Z`);
const short = (d) => new Date(at(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The week the room's data ends on: its first day, last day and a label ("Oct 19 – 25"). */
export function weekOf(rows) {
  const last = rows?.[rows.length - 1];
  if (!last?.iso) return null;
  const end = iso(at(last.iso) + 6 * MS_DAY);
  const a = short(last.iso), b = short(end);
  const label = a.split(' ')[0] === b.split(' ')[0] ? `${a} – ${b.split(' ')[1]}` : `${a} – ${b}`;
  return { start: last.iso, end, label };
}

/** A room created for a real group shows the template's numbers until its own sales come in. */
export function awaitingData(room) {
  return !!room?.profile?.awaitingData && !room.fromToast;
}

/** Banked from a real group's own test windows: verified ones accrue their lower bound. */
export function bankedFromWindows(windows, roomId, now = new Date()) {
  const mine = (windows || []).filter((w) => w.roomId === roomId);
  const proven = mine.filter((w) => w.status === 'verified' || w.status === 'reversed')
    .map((w) => ({ ...w, bookedCentsBeforeReversal: w.bookedCentsBeforeReversal ?? Math.max(0, w.lowCents ?? 0) }));
  const live = proven.filter((w) => w.status === 'verified');
  const today = utcDay(now) + 1;
  const weekCents = live.reduce((t, w) => t + (w.bookedCents ?? 0), 0);
  const toDateCents = proven.reduce((t, w) => t + bookedBetween(w, 0, today).cents, 0);
  const lead = [...live].sort((a, b) => (b.bookedCents ?? 0) - (a.bookedCents ?? 0))[0] || null;
  return { week: weekCents / 100, toDate: toDateCents / 100, live, lead, running: mine.filter((w) => w.status === 'running' || w.status === 'waiting') };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything the This week page shows for one room.
 * @param {any} d deriveRoom(ds, roomId)
 * @param {{ windows?: any[] | null, hours?: number, dismissed?: Record<string, string>, now?: Date }} [opts]
 *   windows: the group's test windows (a real group), or null for the sample's packets.
 *   hours: manager hours saved on The plan. dismissed: findings set aside ("Not for us") until a date.
 */
export function weekView(d, { windows = null, hours, dismissed = {}, now = new Date() } = {}) {
  const real = Array.isArray(windows);
  const rows = d.hist.rows;
  const period = weekOf(rows);
  const brief = weekBrief(rows);

  /* The plan, exactly as The plan page chooses it. */
  const nowIso = now.toISOString();
  const planHours = Number.isFinite(hours) ? hours : d.room.managerHours;
  const cands = d.candidates.filter((c) => !(dismissed[c.id] && dismissed[c.id] > nowIso));
  const plan = choosePlan(cands, planHours);
  const chosen = plan.sorted.filter((c) => plan.chosen.has(c.id));
  const next = chosen.find((c) => !c.prevent) || chosen[0] || null;

  /* Banked: the sample's packets, or the group's own verified windows. */
  let banked;
  if (real) {
    const b = bankedFromWindows(windows, d.id, now);
    banked = {
      source: 'windows', week: b.week, toDate: b.toDate, liveCount: b.live.length, running: b.running.length,
      lead: b.lead ? { id: b.lead.id, title: b.lead.title, bookable: (b.lead.bookedCents ?? 0) / 100, point: b.lead.pointCents != null ? b.lead.pointCents / 100 : null } : null,
      coverage: null,
    };
  } else {
    const b = d.banked;
    banked = {
      source: 'packets', week: b.week, toDate: b.toDate, liveCount: b.live.length, running: d.proofs.filter((p) => p.outcome === 'testing').length,
      lead: b.lead ? { id: b.lead.id, title: b.lead.title, bookable: b.lead.bookable, point: b.lead.point, lo: b.lead.lo, hi: b.lead.hi, held: b.lead.held } : null,
      from: d.room.banked?.from, note: d.room.banked?.note, coverage: b.coverage,
    };
  }

  /* Earned against matched weeks: only what's banked is ever accounted for. */
  const move = d.hist.marginMove;
  const claimable = Math.max(0, Math.min(banked.week, move));
  const margin = { move, claimable, unexplained: move - claimable, matchedMean: d.hist.matchedMean };

  /* Tests in flight. */
  const inFlight = real
    ? windows.filter((w) => w.roomId === d.id && (w.status === 'running' || w.status === 'waiting')).map((w) => ({
      id: w.id, title: w.title, kind: 'window', waiting: w.status === 'waiting',
      progress: Math.round((Math.min(WINDOW_DAYS, w.day ?? 0) / WINDOW_DAYS) * 100),
      note: w.status === 'waiting'
        ? `Day ${w.day ?? 0} of ${WINDOW_DAYS}. Waiting for a new week of data${w.staleDays != null ? ` (the last is ${w.staleDays} days old)` : ''}; the clock only counts weeks of data.`
        : `Day ${w.day ?? 0} of ${WINDOW_DAYS}. Nothing accrues until the window closes and verifies.`,
      go: 'windows',
    }))
    : d.proofs.filter((p) => p.outcome === 'testing').map((p) => ({
      id: p.id, title: p.title, kind: 'packet', waiting: false, progress: p.progress || 10,
      note: `${p.checkpoint}. The window closes ${p.closes}, and nothing accrues until it does.`, go: 'packet',
    }));

  /* Needs you: alarms, stalled tests, reversals and stale feeds. Sample rooms keep their written alarms. */
  const attention = [];
  if (real) {
    const own = !!(d.inputs?.exceptions || d.inputs?.toast?.rows?.[0]?.rows?.exceptions?.length);
    if (own) {
      for (const [k, label] of [['postVoid', 'voids after send'], ['comps', 'comps'], ['disc', 'discounts']]) {
        const s = d.staff.types[k]?.signals || [];
        if (s.length) attention.push({ id: `signal:${k}`, tone: 'warn', icon: 'Siren', title: `${plural(s.length, 'person', 'people')} over the control limit on ${label}`, body: `${s.map((p) => p.name).join(', ')}. About ${money(Math.round(d.staff.types[k].excess))} over the limit in 28 days.`, go: 'controls', cta: 'See the control charts' });
      }
    }
    const recent = now.getTime() - 14 * MS_DAY;
    for (const w of windows.filter((x) => x.status === 'reversed' && x.reversedAt && Date.parse(x.reversedAt) >= recent)) {
      attention.push({ id: `reversed:${w.id}`, tone: 'bad', icon: 'Undo2', title: `${w.roomId === d.id ? '' : 'Elsewhere in the group: '}${w.title} reversed`, body: 'A guardrail broke after it verified, so it stopped accruing from the day the metric turned.', go: 'windows', cta: 'Open the test' });
    }
  } else {
    for (const a of d.alarms) attention.push({ id: `alarm:${a.title}`, tone: 'warn', icon: 'Siren', title: a.title, body: a.body, go: a.go, cta: 'See it' });
    for (const p of d.allProof.filter((x) => x.paused && x.loc !== d.id)) {
      attention.push({ id: `paused:${p.id}`, tone: 'neutral', icon: 'CirclePause', title: `Elsewhere in the group: ${p.title.charAt(0).toLowerCase()}${p.title.slice(1)} is paused`, body: p.reason, go: 'packet', goId: p.id, cta: 'Open the packet' });
    }
    for (const p of d.proofs.filter((x) => x.outcome === 'data')) {
      attention.push({ id: `data:${p.id}`, tone: 'warn', icon: 'DatabaseZap', title: `${p.title}: quarantined`, body: p.reason, go: p.unblockedBy ? 'inputs' : 'sources', cta: p.unblockedBy ? 'Enter the data' : 'Fix the feed' });
    }
  }
  for (const f of d.feeds.filter((x) => x.state === 'stale')) {
    attention.push({ id: `feed:${f.name}`, tone: 'warn', icon: 'Unplug', title: `${f.name} is stale`, body: `Last data ${f.last}.${f.note ? ` ${f.note}` : ''}`, go: 'sources', cta: 'Check the feed' });
  }

  const open = d.candidates.filter((c) => !c.prevent && c.value > 0);
  return {
    roomId: d.id, room: d.profile.name, short: d.profile.short, real,
    awaiting: awaitingData(d.room),
    period, brief,
    earned: { value: d.week.earned, net: d.week.net, covers: d.week.covers, vsLast: brief?.vsLast.earned ?? null },
    banked, margin,
    exposure: { value: d.exposure, count: open.length },
    plan: { hours: planHours, used: plan.used, chosen, next },
    inFlight, attention,
  };
}

/** The Monday digest: a short text version of the week, for the bell and email. */
export function weekDigest(v) {
  const lines = [];
  if (v.brief) {
    const up = v.brief.vsLast.earned >= 0;
    lines.push(`Earned ${money(Math.round(v.earned.value))}, ${up ? 'up' : 'down'} ${money(Math.abs(Math.round(v.brief.vsLast.earned)))} on the week before. ${v.brief.driver.label} moved it most.`);
  } else {
    lines.push(`Earned ${money(Math.round(v.earned.value))}.`);
  }
  lines.push(v.banked.week > 0
    ? `Banked ${money(v.banked.week, { cents: true })} from ${plural(v.banked.liveCount, 'verified change')}, at the cautious end of what each proved.`
    : v.banked.running ? `Nothing banked yet; ${plural(v.banked.running, 'test')} running.` : 'Nothing banked yet.');
  if (v.inFlight.length) lines.push(`In flight: ${v.inFlight.map((t) => t.title).join('; ')}.`);
  if (v.attention.length) lines.push(`Needs you: ${v.attention.map((a) => a.title).join('; ')}.`);
  if (v.plan.next) lines.push(`Next: ${v.plan.next.title} (estimated ${money(Math.round(v.plan.next.value))}/wk, ${Math.round(v.plan.next.p * 100)}% chance it verifies).`);
  return {
    title: `${v.short}: the week of ${v.period?.label ?? 'this week'}`,
    body: lines.join('\n'),
    severity: v.attention.some((a) => a.tone === 'warn' || a.tone === 'bad') ? 'warn' : 'info',
  };
}

/** Keep a room's review record bounded: the newest REVIEW_KEEP weeks. */
export function trimReviews(rec) {
  const keys = Object.keys(rec || {}).sort().slice(-REVIEW_KEEP);
  return Object.fromEntries(keys.map((k) => [k, rec[k]]));
}
