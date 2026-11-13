// The This week page, as data. Pure: the screen, the week API and the Monday
// digest all call weekView(), so the browser and the server always say the
// same thing about a week.
//
// Two sources for what's been proven:
//  - the sample group: its verification packets (d.proofs, d.banked), and
//  - a real group: its own test windows (the server's test_windows rows),
//    passed in as `windows`. A real group never shows a sample packet.
// Every dollar comes from lib/data/model.js (deriveRoom) or a window row.
//
// Words used on the page (spec §2.4):
//  - contribution: net sales − food cost − hourly labour. Not profit.
//  - run-rate: what verified changes accrue per week.
//  - accrued this week: what they actually accrued on the days of this week.

import { choosePlan, money } from '../model.js';
import { bookedBetween, utcDay } from '../billing.js';
import { weekBrief } from '../weekbrief.js';
import { dataEnd } from '../readers.js';

export const REVIEW_KEY = 'week.review';
export const PLAN_KEY = 'week.plan';
/** How many past reviews a room keeps (the rest drop off the oldest end). */
export const REVIEW_KEEP = 26;
/** The plan shows this many actions at first (spec §7.6). */
export const PLAN_TOP = 3;
export const PLAN_MAX = 5;
export const ITEM_STATUS = ['planned', 'doing', 'done', 'dropped'];
const WINDOW_DAYS = 28;
const CHECK_EVERY = 7;
const MS_DAY = 864e5;
const CALC_VERSION = 'week/2';

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const at = (d) => Date.parse(`${d}T00:00:00Z`);
const short = (d) => new Date(at(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(at(s));

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

/* ------------------------------------------------------------------ comparators (spec §7.4) */
const FIELDS = ['net', 'covers', 'food', 'labour', 'earned'];
const avgRow = (rows) => Object.fromEntries(FIELDS.map((k) => [k, mean(rows.map((r) => r[k]))]));

/**
 * The baselines this week can be compared with. A real group's rows count
 * only when they are its own data (row.own): template weeks are never a baseline.
 */
export function comparators(rows, { matchedWeeks = [], real = false } = {}) {
  const n = rows.length;
  const usable = (r) => r && (!real || r.own);
  const opt = (id, label, desc, picked, need) => {
    const ok = picked.length > 0 && picked.every(usable);
    return { id, label, desc, available: ok, reason: ok ? null : need, row: ok ? avgRow(picked) : null, weeks: picked.map((r) => r?.iso).filter(Boolean) };
  };
  const prior = n >= 53 ? [rows[n - 53]] : [];
  return [
    opt('last', 'Last week', `The week of ${rows[n - 2]?.label ?? '—'}`, n >= 2 ? [rows[n - 2]] : [], 'Needs the week before this one.'),
    opt('avg4', '4-week average', 'The average of the four weeks before this one', n >= 5 ? rows.slice(-5, -1) : [], 'Needs four earlier weeks of your own data.'),
    opt('matched', '6 matched weeks', 'Six weeks picked to match this one: the same weeks last year and late September this year', matchedWeeks.length ? matchedWeeks.map((i) => rows[i]) : [], 'Needs a year of your own data to pick matched weeks.'),
    opt('prior', 'Same week last year', 'The same week a year ago', prior, 'Needs 53 weeks of history.'),
    { id: 'budget', label: 'Budget', desc: 'Your budget for this week', available: false, reason: 'No budget has been entered for this room.', row: null, weeks: [] },
  ];
}
/** Matched weeks when there are enough, else the 4-week average, else last week. */
export function defaultComparator(list) {
  return (['matched', 'avg4', 'last'].map((id) => list.find((c) => c.id === id && c.available))[0] ?? list.find((c) => c.available) ?? null);
}

/** Every component of the change, in the same units; contribution = sales − food − labour exactly. */
export function decompose(cur, base) {
  const check = (r) => (r.covers ? r.net / r.covers : 0);
  return {
    lines: [
      { key: 'net', label: 'Net sales', now: cur.net, then: base.net, change: cur.net - base.net, money: true, effect: cur.net - base.net },
      { key: 'covers', label: 'Covers', now: cur.covers, then: base.covers, change: cur.covers - base.covers, money: false },
      { key: 'check', label: 'Average check', now: check(cur), then: check(base), change: check(cur) - check(base), money: true, cents: true },
      { key: 'food', label: 'Food cost', now: cur.food, then: base.food, change: cur.food - base.food, money: true, effect: -(cur.food - base.food) },
      { key: 'labour', label: 'Labour cost', now: cur.labour, then: base.labour, change: cur.labour - base.labour, money: true, effect: -(cur.labour - base.labour) },
    ],
    contribution: { now: cur.earned, then: base.earned, change: cur.earned - base.earned },
  };
}

/** One sentence, only as strong as the arithmetic allows. */
export function headline(dec, comparatorLabel) {
  if (!dec) return 'There is no earlier week of your own data to compare this one with yet.';
  const parts = dec.lines.filter((l) => l.effect != null);
  const total = dec.contribution.change;
  const dir = total >= 0 ? 'rose' : 'fell';
  const top = parts.reduce((a, b) => (Math.abs(b.effect) > Math.abs(a.effect) ? b : a));
  const share = Math.abs(top.effect) / (parts.reduce((s, p) => s + Math.abs(p.effect), 0) || 1);
  const reason = { net: top.effect >= 0 ? 'higher sales' : 'lower sales', food: top.effect >= 0 ? 'a lower food cost' : 'a higher food cost', labour: top.effect >= 0 ? 'a lower labour cost' : 'a higher labour cost' }[top.key];
  const amount = money(Math.abs(Math.round(total)));
  if (share >= 0.6 && Math.sign(top.effect) === Math.sign(total)) return `Contribution ${dir} ${amount} against ${comparatorLabel.toLowerCase()}, mostly from ${reason}.`;
  return `Contribution ${dir} ${amount} against ${comparatorLabel.toLowerCase()}, but no single part explains it reliably.`;
}

/* ------------------------------------------------------------------ verified (spec §7.5) */
/** Banked from a real group's own test windows: verified ones accrue their lower bound. */
export function bankedFromWindows(windows, roomId, now = new Date(), period = null) {
  const mine = (windows || []).filter((w) => w.roomId === roomId);
  const proven = mine.filter((w) => w.status === 'verified' || w.status === 'reversed')
    .map((w) => ({ ...w, bookedCentsBeforeReversal: w.bookedCentsBeforeReversal ?? Math.max(0, w.lowCents ?? 0) }));
  const live = proven.filter((w) => w.status === 'verified');
  const today = utcDay(now) + 1;
  const weekCents = live.reduce((t, w) => t + (w.bookedCents ?? 0), 0);
  const toDateCents = proven.reduce((t, w) => t + bookedBetween(w, 0, today).cents, 0);
  const inWeek = period ? [utcDay(at(period.start)), utcDay(at(period.end)) + 1] : null;
  const accruedCents = inWeek ? proven.reduce((t, w) => t + bookedBetween(w, inWeek[0], inWeek[1]).cents, 0) : null;
  const within = (d) => inWeek && d && utcDay(new Date(d)) >= inWeek[0] && utcDay(new Date(d)) < inWeek[1];
  const lead = [...live].sort((a, b) => (b.bookedCents ?? 0) - (a.bookedCents ?? 0))[0] || null;
  return {
    week: weekCents / 100, toDate: toDateCents / 100, accrued: accruedCents == null ? null : accruedCents / 100, live, lead,
    running: mine.filter((w) => w.status === 'running' || w.status === 'waiting'),
    newly: live.filter((w) => within(w.closedAt)),
    suspended: proven.filter((w) => w.status === 'reversed' && within(w.reversedAt)),
  };
}

/* ------------------------------------------------------------------ plan readiness (spec §7.6) */
const INPUT_FEED = { recipes: 'Recipe costs', counts: 'Inventory counts', waste: 'Waste log', invoices: 'Invoices', channels: 'Delivery statements', exceptions: 'Toast' };
const SAFETY = {
  Labour: 'Staffing fences apply: never below the room’s minimum servers, and no change inside 24 hours of a shift without the GM.',
  Menu: 'Tested for 28 days of data; reverses if average check drops 5% or turn time rises 15%.',
  Purchasing: 'No change to service or recipes; the saving shows on the next invoices.',
  Controls: 'A conversation with the people over the limit, not a policy change.',
  Inventory: 'Portion and prep changes go through the kitchen lead first.',
  Throughput: 'Watched against turn time and covers walked.',
  Channels: 'Delivery prices change on the platforms, not in the room.',
  Kitchen: 'Station changes go through the kitchen lead first.',
};
/** Why a candidate can't be acted on yet, or null. A blocked candidate can't be committed. */
export function blockedReason(c, d) {
  if (c.needs) {
    const feed = d.feeds.find((f) => f.name === INPUT_FEED[c.needs]);
    if (feed && feed.state !== 'healthy') return `Needs current ${feed.name.toLowerCase()} (last ${feed.last}). Bring them in on Data inputs first.`;
  }
  if (c.kind === 'price') {
    const dish = d.room.menu.find((m) => m.key === c.item);
    if (dish?.costEstimated) return 'This dish’s plate cost is estimated. Enter its recipe cost before changing its price.';
  }
  return null;
}
const goFor = { Menu: 'menu', Purchasing: 'purchasing', Labour: 'labour', Throughput: 'throughput', Controls: 'controls', Inventory: 'inventory', Channels: 'channels', Kitchen: 'kitchen' };
function planItem(c, d) {
  const blocked = blockedReason(c, d);
  return {
    id: c.id, title: c.title, why: c.why || '', lever: c.lever, hours: c.hours, p: c.p, claim: c.claim, prevent: !!c.prevent,
    value: c.value, conservative: Number.isFinite(c.lo) ? Math.max(0, c.lo) : null,
    blocked, ready: !blocked, safety: SAFETY[c.lever] || null, go: goFor[c.lever] || 'plan',
    approvalId: c.kind === 'price' && c.item && c.to != null ? `price:${c.item}:${c.to}` : null,
  };
}

/* ------------------------------------------------------------------ the week */
/**
 * Everything the This week page shows for one room.
 * @param {any} d deriveRoom(ds, roomId)
 * @param {{ windows?: any[] | null, hours?: number, dismissed?: Record<string, string>, matchedWeeks?: number[], comparator?: string, tasks?: any[], now?: Date }} [opts]
 *   windows: the group's test windows (a real group), or null for the sample's packets.
 *   hours: manager hours saved on The plan. dismissed: findings set aside ("Not for us") until a date.
 */
export function weekView(d, { windows = null, hours, dismissed = {}, matchedWeeks = [], comparator, tasks = [], now = new Date() } = {}) {
  const real = Array.isArray(windows);
  const rows = d.hist.rows;
  const period = weekOf(rows);
  const through = dataEnd(d.room);
  const status = period && through >= period.end ? 'complete' : 'partial';
  const own = !!d.room.fromToast;
  const files = d.room.fromToast?.files || [];
  const brief = weekBrief(real ? rows.filter((r) => r.own) : rows);

  /* Comparisons. */
  const comps = comparators(rows, { matchedWeeks, real });
  const chosenComp = comps.find((c) => c.id === comparator && c.available) || defaultComparator(comps);
  const cur = rows[rows.length - 1];
  const curOk = cur && (!real || cur.own);
  const dec = chosenComp && curOk ? decompose(cur, chosenComp.row) : null;

  /* Contribution, with what it rests on (spec §2.5). */
  const labourMeasured = !real || files.includes('time');
  const contribution = {
    id: 'contribution', label: 'Contribution after food and labour', value: curOk ? d.week.earned : null, unit: 'USD/week',
    definition: 'Net sales − food cost − hourly labour. Rent, utilities and other costs are not deducted.',
    status: !curOk ? 'unavailable' : labourMeasured ? 'observed' : 'estimated',
    claim: labourMeasured ? 'obs' : 'est',
    period, dataThrough: through, source: own ? `Toast data through ${through}` : real ? 'No data of your own yet' : 'Sample restaurant data',
    limitations: [
      'Food cost is plates sold × recipe cost, not invoices.',
      ...(labourMeasured ? [] : ['Labour isn’t measured yet: add Toast TimeEntries to replace the starting staff list.']),
      ...(status === 'partial' ? [`The week isn’t complete: data runs through ${through}.`] : []),
    ],
    version: CALC_VERSION,
  };

  /* The plan, exactly as The plan page chooses it, with readiness. */
  const nowIso = now.toISOString();
  const planHours = Number.isFinite(hours) ? hours : d.room.managerHours;
  const cands = d.candidates.filter((c) => !(dismissed[c.id] && dismissed[c.id] > nowIso));
  const plan = choosePlan(cands, planHours);
  const chosen = plan.sorted.filter((c) => plan.chosen.has(c.id));
  const next = chosen.find((c) => !c.prevent && !blockedReason(c, d)) || null;
  const proposal = chosen.map((c) => planItem(c, d)).sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked));
  const ranked = plan.sorted.filter((c) => c.value > 0.5).map((c) => planItem(c, d));

  /* Verified: the sample's packets, or the group's own verified windows. */
  let banked;
  if (real) {
    const b = bankedFromWindows(windows, d.id, now, period);
    banked = {
      source: 'windows', week: b.week, accrued: b.accrued ?? 0, toDate: b.toDate, liveCount: b.live.length, running: b.running.length,
      newly: b.newly.map((w) => ({ id: w.id, title: w.title, bookable: (w.bookedCents ?? 0) / 100 })),
      suspended: b.suspended.map((w) => ({ id: w.id, title: w.title, bookable: (w.bookedCentsBeforeReversal ?? 0) / 100 })),
      lead: b.lead ? { id: b.lead.id, title: b.lead.title, bookable: (b.lead.bookedCents ?? 0) / 100, point: b.lead.pointCents != null ? b.lead.pointCents / 100 : null } : null,
      coverage: null,
    };
  } else {
    const b = d.banked;
    banked = {
      source: 'packets', week: b.week,
      accrued: b.live.reduce((s, p) => s + (p.bookable / 7) * Math.min(7, p.accrualDays ?? 7), 0),
      toDate: b.toDate, liveCount: b.live.length, running: d.proofs.filter((p) => p.outcome === 'testing').length,
      newly: b.live.filter((p) => (p.accrualDays ?? 99) <= 7).map((p) => ({ id: p.id, title: p.title, bookable: p.bookable })),
      suspended: b.accruing.filter((p) => p.paused).map((p) => ({ id: p.id, title: p.title, bookable: p.bookable })),
      lead: b.lead ? { id: b.lead.id, title: b.lead.title, bookable: b.lead.bookable, point: b.lead.point, lo: b.lead.lo, hi: b.lead.hi, held: b.lead.held } : null,
      from: d.room.banked?.from, note: d.room.banked?.note, coverage: b.coverage,
    };
  }

  /* Against matched weeks: only what's banked is ever accounted for. */
  const matched = comps.find((c) => c.id === 'matched');
  const move = matched?.available ? d.hist.marginMove : null;
  const claimable = move == null ? 0 : Math.max(0, Math.min(banked.week, move));
  const margin = { move, claimable, unexplained: move == null ? null : move - claimable, matchedMean: matched?.available ? d.hist.matchedMean : null };

  /* Tests in flight (spec §7.8). */
  const day = (w) => Math.min(WINDOW_DAYS, w.day ?? 0);
  const inFlight = real
    ? windows.filter((w) => w.roomId === d.id && (w.status === 'running' || w.status === 'waiting')).map((w) => {
      const nextCp = Math.min(WINDOW_DAYS, (Math.floor(day(w) / CHECK_EVERY) + 1) * CHECK_EVERY);
      return {
        id: w.id, title: w.title, kind: 'window', waiting: w.status === 'waiting', owner: w.ownerName ?? null,
        started: w.startedAt, day: day(w), progress: Math.round((day(w) / WINDOW_DAYS) * 100),
        next: `Checkpoint at day ${nextCp}`, review: iso(at(w.startedAt) + WINDOW_DAYS * MS_DAY),
        coverage: w.staleDays != null && w.staleDays > 9 ? `Last week of data is ${w.staleDays} days old` : 'Weekly data arriving',
        guardrail: w.status === 'waiting' ? 'Paused: waiting for data' : 'Inside limits', verified: 'Nothing verified yet; nothing accrues until day 28.',
        go: 'windows',
      };
    })
    : d.proofs.filter((p) => p.outcome === 'testing').map((p) => ({
      id: p.id, title: p.title, kind: 'packet', waiting: false, owner: p.owner ?? null, started: p.since ?? null,
      day: null, progress: p.progress || 10, next: p.checkpoint, review: p.closes,
      coverage: 'Weekly data arriving', guardrail: 'Inside limits', verified: 'Nothing verified yet; nothing accrues until the window closes.',
      go: 'packet',
    }));

  /* Needs attention (spec §7.7): only material items, each linked to where it's handled. */
  const attention = [];
  if (real) {
    const ownExc = !!(d.inputs?.exceptions || d.inputs?.toast?.rows?.[0]?.rows?.exceptions?.length);
    if (ownExc) {
      for (const [k, label] of [['postVoid', 'voids after send'], ['comps', 'comps'], ['disc', 'discounts']]) {
        const s = d.staff.types[k]?.signals || [];
        if (s.length) attention.push({ id: `signal:${k}`, kind: 'exception', tone: 'warn', icon: 'Siren', title: `${plural(s.length, 'person', 'people')} over the control limit on ${label}`, body: `${s.map((p) => p.name).join(', ')}. About ${money(Math.round(d.staff.types[k].excess))} over the limit in 28 days.`, go: 'controls', cta: 'See the control charts' });
      }
    }
    const recent = now.getTime() - 14 * MS_DAY;
    for (const w of windows.filter((x) => x.status === 'reversed' && x.reversedAt && Date.parse(x.reversedAt) >= recent)) {
      attention.push({ id: `reversed:${w.id}`, kind: 'guardrail', tone: 'bad', icon: 'Undo2', title: `${w.roomId === d.id ? '' : 'Elsewhere in the group: '}${w.title} reversed`, body: 'A guardrail broke after it verified, so it stopped accruing from the day the metric turned.', go: 'windows', cta: 'Open the test' });
    }
  } else {
    for (const a of d.alarms) attention.push({ id: `alarm:${a.title}`, kind: 'exception', tone: 'warn', icon: 'Siren', title: a.title, body: a.body, go: a.go, cta: 'See it' });
    for (const p of d.allProof.filter((x) => x.paused && x.loc !== d.id)) {
      attention.push({ id: `paused:${p.id}`, kind: 'guardrail', tone: 'neutral', icon: 'CirclePause', title: `Elsewhere in the group: ${p.title.charAt(0).toLowerCase()}${p.title.slice(1)} is paused`, body: p.reason, go: 'packet', goId: p.id, cta: 'Open the packet' });
    }
    for (const p of d.proofs.filter((x) => x.outcome === 'data')) {
      attention.push({ id: `data:${p.id}`, kind: 'blocked', tone: 'warn', icon: 'DatabaseZap', title: `${p.title}: quarantined`, body: p.reason, go: p.unblockedBy ? 'inputs' : 'sources', cta: p.unblockedBy ? 'Enter the data' : 'Fix the feed' });
    }
  }
  if (move != null && move < 0 && contribution.value && -move > 0.05 * contribution.value) {
    attention.push({ id: 'deterioration', kind: 'financial', tone: 'warn', icon: 'TrendingDown', title: `Contribution is ${money(Math.abs(Math.round(move)))} below matched weeks`, body: 'More than 5% under comparable weeks. Daily shows which days it came from.', go: 'daily', cta: 'Open Daily' });
  }
  for (const f of d.feeds.filter((x) => x.state === 'stale')) {
    attention.push({ id: `feed:${f.name}`, kind: 'data', tone: 'warn', icon: 'Unplug', title: `${f.name} is stale`, body: `Last data ${f.last}.${f.note ? ` ${f.note}` : ''}`, go: 'sources', cta: 'Check the feed' });
  }
  const late = (tasks || []).filter((t) => t.roomId === d.id && t.status === 'open' && t.createdAt && now.getTime() - Date.parse(t.createdAt) > 3 * MS_DAY);
  if (late.length) attention.push({ id: 'tasks:late', kind: 'delayed', tone: 'warn', icon: 'Timer', title: `${plural(late.length, 'task')} open for more than 3 days`, body: late.map((t) => t.title).slice(0, 3).join('; '), go: 'today', cta: 'Open Today' });

  /* The last 12 weeks for the weekly chart; a real group's own weeks only. */
  const history = (real ? rows.filter((r) => r.own) : rows).slice(-12).map((r) => ({
    iso: r.iso, label: r.label, net: r.net, covers: r.covers, earned: r.earned, labourRate: r.net ? r.labour / r.net : 0, current: r === cur,
  }));

  const open = d.candidates.filter((c) => !c.prevent && c.value > 0);
  return {
    roomId: d.id, room: d.profile.name, short: d.profile.short, real, sample: !real, own,
    awaiting: awaitingData(d.room),
    period, status, dataThrough: through, brief, history,
    comparators: comps.map(({ row, ...c }) => c), comparator: chosenComp ? { id: chosenComp.id, label: chosenComp.label, desc: chosenComp.desc } : null,
    decomposition: dec, headline: headline(dec, chosenComp?.label ?? ''),
    contribution,
    earned: { value: d.week.earned, net: d.week.net, covers: d.week.covers, vsLast: brief?.vsLast.earned ?? null },
    banked, margin,
    exposure: { value: d.exposure, count: open.length },
    plan: { hours: planHours, used: plan.used, chosen, next, proposal, ranked },
    inFlight, attention,
  };
}

/* ------------------------------------------------------------------ the committed plan (spec §7.9) */
/**
 * Check a plan someone is committing against the week as computed now. Returns
 * the plan to store; every title and figure comes from the view, never the client.
 * @param {ReturnType<typeof weekView>} view
 * @param {{ week?: unknown, items?: unknown }} input
 */
export function buildCommit(view, input) {
  if (!view.period) throw new Error('This room has no week to plan yet.');
  if (input?.week !== view.period.start) throw new Error(`This plan is for the week of ${view.period.label}; the page was showing another week. Reload and try again.`);
  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items || items.length < 1 || items.length > PLAN_MAX) throw new Error(`A plan has 1 to ${PLAN_MAX} actions.`);
  const seen = new Set();
  const latest = iso(at(view.period.end) + 35 * MS_DAY);
  return items.map((raw) => {
    const id = typeof raw?.id === 'string' ? raw.id : '';
    const c = view.plan.ranked.find((x) => x.id === id);
    if (!c) throw new Error(`'${id.slice(0, 40)}' isn’t one of this week’s candidates.`);
    if (seen.has(id)) throw new Error(`'${c.title}' is in the plan twice.`);
    seen.add(id);
    if (c.blocked) throw new Error(`'${c.title}' can’t be committed yet: ${c.blocked}`);
    const owner = typeof raw.owner === 'string' ? raw.owner.trim() : '';
    if (!owner || owner.length > 80) throw new Error(`Name who owns '${c.title}' (up to 80 characters).`);
    const due = raw.due;
    if (!isDay(due) || due < view.period.start || due > latest) throw new Error(`Pick a due date for '${c.title}' between ${view.period.start} and ${latest}.`);
    return { id, title: c.title, lever: c.lever, hours: c.hours, value: Math.round(c.value), conservative: c.conservative == null ? null : Math.round(c.conservative), claim: c.claim, owner, due, status: 'planned' };
  });
}

/** Move one committed item along. Done and dropped can be reopened. */
export function setItemStatus(plan, id, status) {
  if (!plan) throw new Error('There is no committed plan for this week.');
  if (!ITEM_STATUS.includes(status)) throw new Error('Unknown status.');
  if (!plan.items.some((i) => i.id === id)) throw new Error('That action isn’t in the plan.');
  return { ...plan, items: plan.items.map((i) => (i.id === id ? { ...i, status } : i)) };
}

/**
 * The plan as the page shows it: the committed one (never regenerated) with
 * progress from Today's tasks, plus what fresh data would change, as revisions to review.
 */
export function planState(view, committed, tasks = []) {
  const live = committed && committed.week === view.period?.start ? committed : null;
  if (!live) return { committed: null, items: view.plan.proposal.slice(0, PLAN_TOP), more: view.plan.proposal.slice(PLAN_TOP), revisions: null };
  const items = live.items.map((i) => {
    const now = view.plan.ranked.find((x) => x.id === i.id);
    const approvalId = now?.approvalId;
    const task = approvalId ? (tasks || []).filter((t) => t.roomId === view.roomId && t.approvalId === approvalId && t.status !== 'cancelled').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] : null;
    const progress = task ? ({ open: 'In Today’s tasks', done: 'Marked done; waiting for the data to confirm it', verified: 'Confirmed in the data', mismatch: 'Marked done, but the data doesn’t show it yet' }[task.status] ?? null) : null;
    const status = task && i.status === 'planned' ? (task.status === 'open' ? 'doing' : 'done') : i.status;
    return { ...i, status, progress, blocked: now?.blocked ?? null, why: now?.why ?? '', safety: now?.safety ?? null, go: now?.go ?? 'plan', stillProposed: !!now };
  });
  const proposedTop = view.plan.proposal.filter((p) => !p.blocked).slice(0, PLAN_TOP).map((p) => p.id);
  const added = view.plan.proposal.filter((p) => proposedTop.includes(p.id) && !live.items.some((i) => i.id === p.id));
  const dropped = items.filter((i) => i.status !== 'done' && i.status !== 'dropped' && (!i.stillProposed || i.blocked));
  return { committed: live, items, more: [], revisions: added.length || dropped.length ? { added, dropped } : null };
}

/* ------------------------------------------------------------------ digest + reviews */
/** The Monday digest: a short text version of the week, for the bell and email. */
export function weekDigest(v) {
  const lines = [v.headline];
  if (v.contribution.value != null) lines.push(`Contribution after food and labour: ${money(Math.round(v.contribution.value))}${v.contribution.status === 'estimated' ? ' (estimated: labour not measured yet)' : ''}.`);
  lines.push(v.banked.week > 0
    ? `Verified run-rate ${money(v.banked.week, { cents: true })}/wk from ${plural(v.banked.liveCount, 'verified change')}; ${money(v.banked.accrued, { cents: true })} accrued this week.`
    : v.banked.running ? `Nothing verified yet; ${plural(v.banked.running, 'test')} running.` : 'Nothing verified yet.');
  if (v.inFlight.length) lines.push(`In flight: ${v.inFlight.map((t) => t.title).join('; ')}.`);
  if (v.attention.length) lines.push(`Needs attention: ${v.attention.map((a) => a.title).join('; ')}.`);
  if (v.plan.next) lines.push(`Proposed first: ${v.plan.next.title} (estimated ${money(Math.round(v.plan.next.value))}/wk, ${Math.round(v.plan.next.p * 100)}% chance it verifies).`);
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
