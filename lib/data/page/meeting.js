// The weekly meeting, as pure functions the screen, the server and the tests
// share. The agenda is built from the room's own data (never from written
// narrative), ranked deterministically, frozen when the meeting starts, and
// finalized into a structured record plus meeting actions (owner, due date,
// definition of done) that the platform follows up on.

import { choosePlan } from '../model.js';
import { findingBlocked, findingStatus, findingTest } from '../findings.js';
import { dataEnd } from '../readers.js';

export const AGENDA_VERSION = 'meeting-agenda/2';

/** Bounds on everything a meeting saves. server/page/meeting.ts validates against the same numbers. */
export const MEETING_LIMITS = {
  items: 16, title: 200, body: 1200, note: 1000, reason: 300, owner: 80, attendees: 12, figures: 4, options: 6,
  events: 300, history: 26, actions: 40, doneWhen: 300, approval: 120,
  /* legacy single-record key (`meeting` action) */
  log: 20, logLine: 200, choice: 120,
};

/** The five segments and their default minutes (15 in all). A segment with nothing to discuss is left out. */
export const SEGMENTS = {
  A: { label: 'Financial performance', mins: 2 },
  B: { label: 'Operational problems', mins: 3 },
  C: { label: 'Interventions', mins: 4 },
  D: { label: 'Decisions and assignments', mins: 4 },
  E: { label: 'Confirm the plan', mins: 2 },
};

export const DEFAULT_SCHEDULE = { day: 2, time: '09:00', mins: 15, attendees: [] };
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const HOLD_DAYS = 14;
export const DISMISS_DAYS = 90;
const DAY_MS = 864e5;

/** What a person can do with an agenda item. `kind` is what's stored; labels are the screen's. */
export const OUTCOMES = {
  accepted: 'Accepted',
  changed: 'Accepted with changes',
  deferred: 'Deferred',
  rejected: 'Rejected',
  evidence: 'More evidence requested',
  discussed: 'Discussed',
  done: 'Done',
  kept: 'Still on it',
  reassigned: 'Owner or date changed',
  cancelled: 'Cancelled',
  continue: 'Continue',
  adjust: 'Adjust',
  stop: 'Stop',
  investigate: 'Investigate',
};
/** Outcomes that turn into a meeting action at finalize. */
const MAKES_ACTION = new Set(['accepted', 'changed', 'evidence', 'adjust', 'stop', 'investigate']);

export const ACTION_STATUS = ['open', 'done', 'cancelled', 'deferred'];
export const PRIORITIES = ['high', 'normal', 'low'];

const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
export const usd = (n) => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const signed = (n) => `${n >= 0 ? '+' : '−'}${usd(Math.abs(n))}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY_MS);

/** Monday of the week `d` falls in, as YYYY-MM-DD (UTC). */
export function weekOf(d = new Date()) {
  const t = new Date(d);
  const day = (t.getUTCDay() + 6) % 7;
  return isoDay(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - day)));
}

/**
 * Which of the room's data can be stated as fact. In the sample everything is
 * (it is labelled sample). In a real group, only what came from its own
 * sources: sample figures still standing in are never presented as findings.
 */
export function provenance(d, sample) {
  const inputs = d.inputs || {};
  if (sample) return { sales: true, staff: true, counts: true, feeds: true, proofs: true, alarms: true };
  return {
    sales: !!d.room.fromToast,
    staff: !!(d.room.staffSet || inputs.exceptions),
    counts: !!inputs.counts,
    feeds: false,
    proofs: false,
    alarms: false,
  };
}

/* ------------------------------------------------------------------ segment A */
function financial(d, prov) {
  const name = d.profile?.short || d.profile?.name || 'this room';
  if (!prov.sales) {
    return {
      id: 'fin', seg: 'A', icon: 'ChartLine', title: 'How last week went', missing: true,
      body: `Coversight can't establish last week's contribution for ${name}: no sales data is connected yet. Nothing here is estimated to fill the gap; the meeting goes ahead on what is supported.`,
      figures: [], risks: [], recommend: 'discussed', options: ['discussed'], go: 'connect',
    };
  }
  const rows = d.hist.rows;
  const last = rows[rows.length - 1];
  const prior = rows.slice(-5, -1);
  const avg = (k) => mean(prior.map((r) => r[k]));
  const delta = last.earned - avg('earned');
  const spread = sd(rows.slice(-13, -1).map((r) => r.earned));
  const unusual = spread > 0 && Math.abs(delta) > 1.5 * spread;
  const drivers = [
    ['sales', last.net - avg('net'), (v) => `net sales, ${v >= 0 ? 'up' : 'down'} ${usd(Math.abs(v))}`],
    ['food', -(last.food - avg('food')), (v) => `food cost, ${v >= 0 ? 'down' : 'up'} ${usd(Math.abs(v))}`],
    ['labour', -(last.labour - avg('labour')), (v) => `labour, ${v >= 0 ? 'down' : 'up'} ${usd(Math.abs(v))}`],
  ].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const [, dv, say] = drivers[0];
  const banked = d.banked?.week || 0;
  const verified = prov.proofs && banked > 0
    ? ` Verified savings are running at ${usd(banked)}/wk (a weekly run-rate, not this week's realized total).`
    : '';
  return {
    id: 'fin', seg: 'A', icon: 'ChartLine', title: 'How last week went',
    body: `Contribution after food and labour was ${usd(last.earned)} in the week of ${last.label}, ${usd(Math.abs(delta))} ${delta >= 0 ? 'above' : 'below'} its 4-week average, ${unusual ? 'which is outside its normal range' : 'within its normal range'}. The biggest mover was ${say(dv)}.${verified}`,
    figures: [
      { label: 'Contribution after food and labour', value: usd(last.earned), claim: 'obs' },
      { label: 'Against the 4-week average', value: signed(delta), claim: 'obs' },
      ...(prov.proofs && banked > 0 ? [{ label: 'Verified saving run-rate', value: `${usd(banked)}/wk`, claim: 'book' }] : []),
    ],
    risks: unusual ? ['This week is outside the normal range. Ask why before acting on it.'] : [],
    recommend: 'discussed', options: ['discussed', 'evidence'], go: 'trends',
    action: { sourceKey: `fin:${last.iso || last.label}`, title: `Explain the ${delta >= 0 ? 'rise' : 'drop'} in contribution in the week of ${last.label}`, doneWhen: 'The cause is written down and shared at the next meeting', approval: 'None', priority: 'normal', dueDays: 7 },
  };
}

/* ------------------------------------------------------------------ segment B */
const TYPE_LABEL = { postVoid: 'Post-send voids', comps: 'Comps', disc: 'Discounts' };
function issueCandidates(d, prov) {
  const out = [];
  if (!prov.sales) {
    out.push({
      tier: 4, value: 0, id: 'issue:feed:toast', icon: 'PlugZap', title: 'Connect your sales data',
      body: 'Without Toast connected, Coversight cannot measure sales, labour or any test in this room. Connecting it is the one change that unlocks the rest.',
      figures: [], risks: ['Every figure on this page stays unavailable until it is connected.'], go: 'connect',
      action: { sourceKey: 'feed:Toast', title: 'Connect Toast', doneWhen: 'Toast shows connected and the first business day has synced', approval: 'Owner signs in to Toast', priority: 'high', dueDays: 3 },
    });
  }
  if (prov.alarms) {
    for (const a of d.alarms || []) {
      out.push({ tier: 5, value: 0, topic: typeof a.when === 'string' && a.when.startsWith('signal:') ? a.when : undefined, id: `issue:alarm:${slug(a.title)}`, icon: 'Siren', title: a.title, body: a.body, figures: [], risks: ['A control limit was crossed. Accrual on it pauses until it is back inside.'], go: a.go,
        action: { sourceKey: `alarm:${slug(a.title)}`, title: `Investigate: ${a.title}`, doneWhen: 'Cause found and the metric back inside its limit', approval: 'None', priority: 'high', dueDays: 3 } });
    }
  }
  if (prov.proofs) {
    for (const p of d.banked?.reversed || []) {
      out.push({ tier: 5, value: p.point || 0, id: `issue:reversed:${p.id}`, icon: 'Undo2', title: `${p.title} reversed`, body: `It verified, then a guardrail breached, so it was reversed and its savings left every figure. ${p.method ? `Method: ${p.method}.` : ''}`.trim(), figures: [], risks: ['A reversal usually means the change hurt service or slipped back.'], go: 'proof',
        action: { sourceKey: `reversed:${p.id}`, title: `Review why "${p.title}" reversed`, doneWhen: 'Cause written on the test and a next step agreed', approval: 'None', priority: 'high', dueDays: 3 } });
    }
  }
  if (prov.feeds) {
    for (const f of d.feeds || []) {
      if (f.state !== 'stale') continue;
      out.push({ tier: 3, value: f.risk || 0, topic: f.input === 'recipes' ? 'recipes' : undefined, id: `issue:feed:${slug(f.name)}`, icon: 'Unplug', title: `${f.name} data is stale`, body: f.note || `Last update ${f.last}.`,
        figures: f.risk ? [{ label: 'Estimate depending on it', value: `${usd(f.risk)}/wk`, claim: 'est' }] : [], risks: ['Tests that read this feed cannot verify until it is fixed.'], go: f.input ? 'inputs' : 'sources',
        action: { sourceKey: `feed:${f.name}`, title: `${f.fix || 'Fix'}: ${f.name}`, doneWhen: `${f.name} shows healthy on Sources`, approval: 'None', priority: (f.risk || 0) >= 200 ? 'high' : 'normal', dueDays: 2 } });
    }
  }
  if (prov.staff) {
    for (const [type, t] of Object.entries(d.staff?.types || {})) {
      const sig = t.signals || [];
      if (!sig.length) continue;
      const names = sig.map((s) => s.name);
      const s0 = sig[0];
      out.push({ tier: 2, value: 0, topic: `signal:${type === 'postVoid' ? 'voids' : type}`, id: `issue:signal:${type}`, icon: 'ShieldAlert', title: `${TYPE_LABEL[type] || type} above the control limit: ${list(names)}`,
        body: `${s0.name} (${s0.role}) ran ${pct(s0[`${type}Rate`] || 0, 1)} of sales against a limit of ${pct(s0[`${type}Ucl`] || 0, 1)}. A signal is a reason to look, not proof of wrongdoing.`,
        figures: [{ label: 'Rate against limit', value: `${pct(s0[`${type}Rate`] || 0, 1)} / ${pct(s0[`${type}Ucl`] || 0, 1)}`, claim: 'obs' }], risks: [], go: 'controls',
        action: { sourceKey: `signal:${type}:${slug(names.join('-'))}`, title: `Review ${TYPE_LABEL[type]?.toLowerCase() || type} with ${list(names)}`, doneWhen: 'Reviewed with the employee and the reason recorded', approval: 'None', priority: 'normal', dueDays: 7 } });
    }
  }
  if (prov.counts && d.usage?.flagged?.length) {
    const f = d.usage.flagged;
    const top = f[0];
    const dollars = f.reduce((s, x) => s + (x.dollars || 0), 0);
    out.push({ tier: 2, value: dollars / 4, id: 'issue:count', icon: 'ClipboardList', title: `Inventory variance: ${list(f.map((x) => x.label || x.item))}`,
      body: `${top.label || top.item} used ${pct(top.pct || 0)} more than recipes explain over 28 days. A spot count separates waste from portions.`,
      figures: [{ label: 'Unexplained usage, 28 days', value: usd(dollars), claim: 'est' }], risks: [], go: 'inventory',
      action: { sourceKey: `count:${slug(f.map((x) => x.item).join('-'))}`, title: `Spot-count ${list(f.map((x) => x.label || x.item))}`, doneWhen: 'Count entered on Data inputs', approval: 'None', priority: 'normal', dueDays: 7 } });
  }
  return out.sort((a, b) => b.tier - a.tier || b.value - a.value || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ segments C and D */
function doneWhenFor(c) {
  if (c.kind === 'price') return 'New price live in Toast and its 28-day test started';
  if (c.lever === 'Labour') return 'Schedule changed in the scheduling system';
  if (c.lever === 'Purchasing') return 'Vendor call made and the new price or credit confirmed in writing';
  if (c.kind === 'markup') return 'New delivery prices live on each channel';
  return 'Change made and confirmed on the finding';
}
function approvalFor(c) {
  if (c.kind === 'price' || c.kind === 'markup') return 'Owner approves the price change';
  if (c.lever === 'Labour') return 'GM approves the schedule change';
  return 'None';
}
const OPEN_WINDOW = new Set(['running', 'waiting']);
const LEVER_LABEL = { menu_margin: 'Menu price', void_comp: 'Voids and comps', overtime: 'Overtime', labour: 'Labour hours', turns: 'Table turns' };

/** The room's actions that are still live: open, or deferred and not yet due back. */
export function activeActions(actions, roomId, now = new Date()) {
  return (actions || []).filter((a) => a.roomId === roomId && (a.status === 'open' || (a.status === 'deferred' && String(a.due) >= isoDay(now))));
}

/**
 * Build the agenda for one room from its data.
 * @param {object} d deriveRoom(...) for the room
 * @param {{ sample?: boolean, windows?: object[], actions?: object[], dismissed?: Record<string,string>, hours?: number, now?: Date }} ctx
 */
export function buildAgenda(d, ctx = {}) {
  const now = ctx.now || new Date();
  const nowIso = now.toISOString();
  const prov = provenance(d, !!ctx.sample);
  const live = activeActions(ctx.actions, d.id, now);
  const taken = new Set(live.map((a) => a.sourceKey));
  const windows = (ctx.windows || []).filter((w) => w.roomId === d.id);

  /* A — the conclusion, not the P&L */
  const A = [financial(d, prov)];

  /* The plan as it stands (saved hours, minus findings held or dismissed). */
  const dismissed = ctx.dismissed || {};
  const off = (id) => dismissed[id] && dismissed[id] > nowIso;
  const cands = (d.candidates || []).filter((c) => !off(c.id));
  const plan = choosePlan(cands, ctx.hours ?? d.room.managerHours);
  const chosen = !prov.sales ? [] : plan.sorted.filter((c) => plan.chosen.has(c.id));

  /* D — the recommended decisions, highest value per manager-hour first */
  const D = chosen
    .filter((c) => !findingBlocked(c, d.room) && !taken.has(`finding:${c.id}`))
    .filter((c) => { const s = findingStatus(c, windows, d.id).state; return s !== 'testing' && s !== 'verified'; })
    .slice(0, 3)
    .map((c) => ({
      id: `dec:${c.id}`, seg: 'D', icon: 'Gavel', title: c.title, findingId: c.id, body: c.why || '',
      figures: [
        { label: c.prevent ? 'Cost prevented if done' : 'Potential opportunity', value: `${usd(c.value)}/wk`, claim: c.claim },
        ...(c.prevent ? [] : [{ label: 'Chance it verifies', value: pct(c.p) }]),
        { label: 'Manager time', value: `${Math.round(c.hours * 60)} min` },
      ],
      risks: [
        c.prevent ? 'A prevented cost is never counted as saved.' : 'Potential, not saved: nothing counts until a test verifies it.',
        ...(!c.prevent && !findingTest(c) ? ['No test reads this from your data yet, so it can be done but not verified.'] : []),
      ],
      recommend: 'accepted', options: ['accepted', 'evidence', 'deferred', 'rejected'], go: 'finding', goId: c.id,
      action: { sourceKey: `finding:${c.id}`, findingId: c.id, title: c.title, doneWhen: doneWhenFor(c), approval: approvalFor(c), priority: c.value >= 100 ? 'high' : c.value >= 40 ? 'normal' : 'low', dueDays: c.hours <= 0.5 ? 3 : 7 },
    }));

  /* One topic, one item: a decision about comps covers the comps alarm; a recipe-cost feed covers what it blocks. */
  const decTopic = (c) => (c.kind === 'comps' || c.kind === 'voids' ? `signal:${c.kind}` : null);
  const dTopics = new Set(D.map((x) => decTopic(d.candidates.find((c) => c.id === x.findingId) || {})).filter(Boolean));

  /* B — the most important current problem (two if the second is serious) */
  const issues = issueCandidates(d, prov).filter((x) => !taken.has(x.action?.sourceKey) && !(x.topic && dTopics.has(x.topic)));
  const B = issues.slice(0, 1);
  if (issues[1] && issues[1].tier >= 3) B.push(issues[1]);
  const moreIssues = issues.length - B.length;

  /* C — last week's commitments first (each once), then tests and blocked work */
  const follow = live.filter((a) => a.status === 'open')
    .sort((a, b) => String(a.due).localeCompare(String(b.due)) || String(a.id).localeCompare(String(b.id)));
  const C = follow.slice(0, 4).map((a) => {
    const overdue = String(a.due) < isoDay(now);
    const cand = a.findingId ? d.candidates.find((c) => c.id === a.findingId) : null;
    const st = cand ? findingStatus(cand, windows, d.id) : null;
    return {
      id: `follow:${a.id}`, seg: 'C', icon: 'ListChecks', title: a.title, follow: a.id,
      body: `${a.owner || 'No owner'} · due ${a.due}${overdue ? ', overdue' : ''}. Done when: ${a.doneWhen || 'the owner confirms it'}.${st?.state === 'testing' ? ' Its test is running.' : st?.state === 'verified' ? ' Its test has verified.' : ''}`,
      figures: [], risks: overdue ? ['Overdue. Agree a new date or hand it to someone else.'] : [],
      recommend: st?.state === 'testing' || st?.state === 'verified' ? 'done' : 'kept', options: ['done', 'kept', 'reassigned', 'cancelled'],
      go: a.findingId ? 'finding' : undefined, goId: a.findingId || undefined, overdue,
    };
  });
  const moreFollow = Math.max(0, follow.length - C.length);
  const tests = [
    ...windows.filter((w) => OPEN_WINDOW.has(w.status)).map((w) => ({
      id: `window:${w.id}`, title: `Test: ${w.title || LEVER_LABEL[w.lever] || w.lever}`, body: `Day ${w.day || 0} of 28${w.checkpoints?.length ? `, ${w.checkpoints.length} weekly checkpoint${w.checkpoints.length === 1 ? '' : 's'} recorded` : ''}. Its baseline is frozen; nothing books until it closes and verifies.`,
      go: 'windows', key: `window:${w.id}`,
    })),
    ...(prov.proofs ? (d.proofs || []).filter((p) => p.outcome === 'testing').map((p) => ({
      id: `proof:${p.id}`, title: `Test: ${p.title}`, body: `Testing since ${p.since}.${p.method ? ` ${p.method}.` : ''} Nothing books until it closes and verifies.`, go: 'proof', key: `proof:${p.id}`,
    })) : []),
  ].filter((t) => !taken.has(t.key)).slice(0, 2).map((t) => ({
    id: t.id, seg: 'C', icon: 'Timer', title: t.title, body: t.body, figures: [], risks: [],
    recommend: 'continue', options: ['continue', 'adjust', 'stop', 'investigate'], go: t.go,
    action: { sourceKey: t.key, title: t.title.replace(/^Test: /, ''), doneWhen: 'The test is adjusted, stopped or explained, as agreed', approval: 'Owner approves stopping a test', priority: 'normal', dueDays: 7 },
  }));
  C.push(...tests);
  const recipesRaised = B.some((x) => x.topic === 'recipes');
  const blocked = chosen.find((c) => findingBlocked(c, d.room) && !taken.has(`finding:${c.id}`) && !taken.has(`blocked:${c.id}`) && !(recipesRaised && (c.needs === 'recipes' || c.kind === 'price')));
  if (blocked && C.length < 6) {
    C.push({ id: `blocked:${blocked.id}`, seg: 'C', icon: 'Lock', title: `Blocked: ${blocked.title}`, body: findingBlocked(blocked, d.room),
      figures: [{ label: 'Potential opportunity', value: `${usd(blocked.value)}/wk`, claim: blocked.claim }], risks: ['Shown for context only until the missing input is entered.'],
      recommend: 'accepted', options: ['accepted', 'deferred', 'discussed'], go: 'finding', goId: blocked.id,
      action: { sourceKey: `blocked:${blocked.id}`, findingId: blocked.id, title: `Unblock: ${blocked.title}`, doneWhen: 'The missing input is entered and the finding is no longer blocked', approval: 'None', priority: 'normal', dueDays: 7 } });
  }

  const segs = { A, B, C, D };
  const items = [];
  for (const k of ['A', 'B', 'C', 'D']) {
    const xs = segs[k];
    xs.forEach((x) => items.push({ recommend: 'discussed', options: ['discussed'], figures: [], risks: [], ...x, seg: k, mins: Math.round((SEGMENTS[k].mins / xs.length) * 10) / 10 }));
  }
  if (items.length) items.push({ id: 'confirm', seg: 'E', icon: 'Route', title: 'Confirm the plan', body: 'Who does what, by when, and when Coversight checks the result.', figures: [], risks: [], recommend: 'discussed', options: ['discussed'], mins: SEGMENTS.E.mins });
  return {
    version: AGENDA_VERSION,
    roomId: d.id,
    week: weekOf(now),
    dataThrough: prov.sales ? dataEnd(d.room) : null,
    sample: !!ctx.sample,
    items: items.slice(0, MEETING_LIMITS.items).map((x) => ({ ...x, title: clip(x.title, MEETING_LIMITS.title), body: clip(x.body, MEETING_LIMITS.body) })),
    more: { issues: moreIssues, follow: moreFollow },
  };
}

export const agendaMinutes = (agenda) => Math.round((agenda?.items || []).reduce((s, a) => s + (a.mins || 0), 0) * 10) / 10;

/** The four numbers on the ready screen. */
export function readiness(agenda, actions, roomId, now = new Date()) {
  const live = activeActions(actions, roomId, now);
  return {
    decisions: agenda.items.filter((x) => x.seg === 'D' || (x.seg === 'C' && x.action)).length,
    unfinished: live.filter((a) => a.status === 'open').length,
    overdue: live.filter((a) => a.status === 'open' && String(a.due) < isoDay(now)).length,
    risks: agenda.items.filter((x) => x.seg === 'B').length,
    mins: agendaMinutes(agenda),
  };
}

/* ------------------------------------------------------------------ during the meeting */
/** A fresh in-progress state. */
export function startState(attendees = [], now = new Date()) {
  return { i: 0, itemAt: now.toISOString(), outcomes: {}, notes: {}, attendees: attendees.slice(0, MEETING_LIMITS.attendees), events: [] };
}

/** The action an item will create, with its defaults filled in (owner, due date) and any edits applied. */
export function draftAction(item, outcome, { now = new Date(), owner = 'Owner' } = {}) {
  if (!item?.action && !item?.follow) return null;
  const t = item.action || {};
  const e = outcome?.action || {};
  const title = outcome?.status === 'evidence' ? `Get evidence: ${t.title}` : ['adjust', 'stop', 'investigate'].includes(outcome?.status) ? `${OUTCOMES[outcome.status]}: ${t.title}` : t.title;
  return {
    sourceKey: t.sourceKey,
    findingId: t.findingId,
    title: clip(e.title || title, MEETING_LIMITS.title),
    owner: clip(e.owner || owner, MEETING_LIMITS.owner),
    due: e.due || isoDay(addDays(now, t.dueDays || 7)),
    priority: PRIORITIES.includes(e.priority) ? e.priority : t.priority || 'normal',
    doneWhen: clip(e.doneWhen || (outcome?.status === 'evidence' ? 'The evidence is in and the decision comes back to the next meeting' : t.doneWhen), MEETING_LIMITS.doneWhen),
    approval: clip(e.approval || t.approval || 'None', MEETING_LIMITS.approval),
  };
}

/** Record an outcome (editable until the meeting is finalized; every change is kept as an event). */
export function setOutcome(state, item, outcome, now = new Date()) {
  const at = now.toISOString();
  const next = outcome ? { ...outcome, at } : null;
  const outcomes = { ...state.outcomes };
  if (next) outcomes[item.id] = next; else delete outcomes[item.id];
  const events = [...(state.events || []), { at, item: item.id, status: next ? next.status : 'cleared', ...(next?.reason ? { reason: clip(next.reason, MEETING_LIMITS.reason) } : {}) }].slice(-MEETING_LIMITS.events);
  return { ...state, outcomes, events };
}

/** What still blocks finalizing: an accepted action without an owner or a due date, or a deferral without a reason. */
export function finalizeProblems(agenda, state) {
  const out = [];
  for (const item of agenda.items) {
    const o = state.outcomes[item.id];
    if (!o) continue;
    if (o.status === 'deferred' && !clip(o.reason, 300)) out.push({ id: item.id, problem: 'Give a reason for deferring it.' });
    if ((MAKES_ACTION.has(o.status) || o.status === 'reassigned') && o.action) {
      if (!clip(o.action.owner, 80)) out.push({ id: item.id, problem: 'Name an owner.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.action.due || ''))) out.push({ id: item.id, problem: 'Set a due date.' });
    }
  }
  return out;
}

/**
 * Turn a finished meeting into what gets saved: the structured record, the
 * meeting actions to create or update (keyed by source so nothing duplicates),
 * changes to last week's actions, and findings to hold or dismiss.
 * @param {object} agenda
 * @param {object} state
 * @param {{ now?: Date, startedAt?: string, roomName?: string, defaultOwner?: string }} [opts]
 */
export function finalizeMeeting(agenda, state, { now = new Date(), startedAt, roomName = '', defaultOwner = 'Owner' } = {}) {
  const at = now.toISOString();
  const upserts = [];
  const updates = [];
  const dismiss = {};
  const decisions = [];
  const deferred = [];
  const evidence = [];
  for (const item of agenda.items) {
    const o = state.outcomes[item.id];
    if (item.follow) {
      if (!o || o.status === 'kept') continue;
      if (o.status === 'done' || o.status === 'cancelled') updates.push({ id: item.follow, status: o.status });
      else if (o.status === 'reassigned' && o.action) updates.push({ id: item.follow, ...(o.action.owner ? { owner: clip(o.action.owner, 80) } : {}), ...(o.action.due ? { due: o.action.due } : {}) });
      decisions.push({ item: item.id, title: item.title, outcome: o.status });
      continue;
    }
    if (!o || item.seg === 'E') continue;
    if (item.seg !== 'A' || o.status !== 'discussed') decisions.push({ item: item.id, title: item.title, outcome: o.status, ...(o.reason ? { reason: clip(o.reason, 300) } : {}) });
    if (MAKES_ACTION.has(o.status) && item.action) {
      upserts.push({ ...draftAction(item, o, { now, owner: defaultOwner }), status: 'open' });
      if (o.status === 'evidence') evidence.push({ title: item.title });
    } else if (o.status === 'deferred') {
      const t = item.action;
      deferred.push({ title: item.title, reason: clip(o.reason, 300) });
      if (t) upserts.push({ sourceKey: t.sourceKey, findingId: t.findingId, title: clip(t.title, 200), owner: '', due: isoDay(addDays(now, HOLD_DAYS)), priority: t.priority || 'normal', doneWhen: '', approval: '', status: 'deferred', reason: clip(o.reason, 300) });
    } else if (o.status === 'rejected' && item.findingId) {
      dismiss[item.findingId] = addDays(now, DISMISS_DAYS).toISOString();
    }
  }
  const started = startedAt ? new Date(startedAt) : now;
  const mins = Math.max(0, Math.min(600, Math.round((now.getTime() - started.getTime()) / 60000)));
  const fin = agenda.items.find((x) => x.seg === 'A');
  const dueDates = upserts.filter((u) => u.status === 'open').map((u) => u.due).sort();
  const record = {
    at, startedAt: started.toISOString(), mins, plannedMins: agendaMinutes(agenda), week: agenda.week, dataThrough: agenda.dataThrough, version: agenda.version,
    attendees: (state.attendees || []).slice(0, MEETING_LIMITS.attendees),
    summary: clip(`${plural(decisions.filter((x) => !['discussed', 'kept'].includes(x.outcome)).length, 'decision')}, ${plural(upserts.filter((u) => u.status === 'open').length, 'action')} assigned${deferred.length ? `, ${deferred.length} deferred` : ''}${updates.length ? `, ${plural(updates.length, 'earlier action')} updated` : ''}.`, 300),
    observations: fin && !fin.missing ? [clip(fin.body, 600)] : fin?.missing ? ['Contribution could not be established: no sales data connected.'] : [],
    decisions: decisions.slice(0, MEETING_LIMITS.items),
    actions: upserts.filter((u) => u.status === 'open').map((u) => ({ title: u.title, owner: u.owner, due: u.due, priority: u.priority, doneWhen: u.doneWhen, findingId: u.findingId })),
    deferred, evidence,
    nextCheck: dueDates[0] || null,
    notes: Object.entries(state.notes || {}).filter(([, v]) => clip(v, 1000)).map(([id, v]) => ({ item: id, title: agenda.items.find((x) => x.id === id)?.title || id, note: clip(v, 1000) })).slice(0, MEETING_LIMITS.items),
    roomName: clip(roomName, 120),
  };
  return { record, upserts, updates, dismiss };
}

const longDate = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** The summary as text: for email drafts, copying and the download. */
export function summaryText(rec, roomName = rec.roomName || '') {
  const lines = [`# Weekly meeting · ${roomName} · ${longDate(rec.at)}`, ''];
  if (rec.summary) lines.push(rec.summary, '');
  if (rec.mins != null) lines.push(`Took ${rec.mins} min (planned ${rec.plannedMins ?? 15}).${rec.attendees?.length ? ` Present: ${rec.attendees.join(', ')}.` : ''}${rec.dataThrough ? ` Data through ${rec.dataThrough}.` : ''}`, '');
  if (rec.observations?.length) lines.push('## Performance', ...rec.observations.map((o) => `- ${o}`), '');
  const dec = (rec.decisions || []).filter((x) => x.outcome !== 'discussed' && x.outcome !== 'kept');
  if (dec.length) lines.push('## Decisions', ...dec.map((x) => `- ${x.title}: ${OUTCOMES[x.outcome] || x.outcome}${x.reason ? ` (${x.reason})` : ''}`), '');
  if (rec.actions?.length) lines.push('## Actions', ...rec.actions.map((a) => `- ${a.title}. Owner: ${a.owner || 'unassigned'}. Due ${a.due}.${a.doneWhen ? ` Done when: ${a.doneWhen}.` : ''}`), '');
  if (rec.deferred?.length) lines.push('## Deferred', ...rec.deferred.map((x) => `- ${x.title}: ${x.reason}`), '');
  if (rec.evidence?.length) lines.push('## Waiting on evidence', ...rec.evidence.map((x) => `- ${x.title}`), '');
  if (rec.notes?.length) lines.push('## Notes', ...rec.notes.map((n) => `- ${n.title}: ${n.note}`), '');
  if (rec.nextCheck) lines.push(`Next check: ${rec.nextCheck}, when the first action is due.`, '');
  /* Older records saved as a plain log still read. */
  if (!rec.decisions && rec.log?.length) lines.push(...rec.log.map((l) => `- ${l}`), '');
  lines.push('From Coversight. Agreement in a meeting is not proof a change happened: each action is checked against its definition of done.');
  return lines.join('\n');
}
export function summaryEmail(rec, roomName = rec.roomName || '') {
  return { subject: `${roomName}: weekly meeting, ${longDate(rec.at)}`, body: summaryText(rec, roomName).slice(0, 5000) };
}

/**
 * Where a meeting action stands, honestly: agreement isn't execution, and execution isn't a verified result.
 * @param {object} a
 * @param {{ windows?: object[], candidates?: object[], now?: Date }} [opts]
 */
export function actionProgress(a, { windows = [], candidates = [], now = new Date() } = {}) {
  if (a.status === 'done') return { state: 'done', label: 'Done' };
  if (a.status === 'cancelled') return { state: 'cancelled', label: 'Cancelled' };
  if (a.status === 'deferred') return { state: 'deferred', label: `Deferred to ${a.due}` };
  const c = a.findingId ? candidates.find((x) => x.id === a.findingId) : null;
  const st = c ? findingStatus(c, windows, a.roomId) : null;
  if (st?.state === 'verified') return { state: 'verified', label: 'Test verified' };
  if (st?.state === 'testing') return { state: 'monitoring', label: 'Test running' };
  if (String(a.due) < isoDay(now)) return { state: 'overdue', label: `Overdue since ${a.due}` };
  return { state: 'assigned', label: `Due ${a.due}` };
}

/* ------------------------------------------------------------------ the record and the slot */
const weekStart = (t) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime(); };

/** The room's meeting record over the last eight weeks (this week included). Nulls when there's nothing to say. */
export function meetingStats(history, now = new Date()) {
  const from = weekStart(now) - 7 * 7 * DAY_MS;
  const recent = (history || []).filter((m) => new Date(m.at).getTime() >= from && new Date(m.at).getTime() <= now.getTime() + DAY_MS);
  const timed = recent.filter((m) => typeof m.mins === 'number');
  return {
    held: new Set(recent.map((m) => weekStart(m.at))).size,
    of: 8,
    avgMins: timed.length ? Math.round(timed.reduce((s, m) => s + m.mins, 0) / timed.length) : null,
    actions: recent.reduce((s, m) => s + (m.actions?.length || 0), 0),
  };
}

/**
 * The next time the slot comes round, from `now` (today counts until an hour after it starts).
 * @param {{ day: number, time: string }} schedule
 */
export function nextMeeting(schedule = DEFAULT_SCHEDULE, now = new Date()) {
  const [h, m] = String(schedule.time || '09:00').split(':').map(Number);
  const at = new Date(now);
  at.setHours(h || 0, m || 0, 0, 0);
  let add = (schedule.day - now.getDay() + 7) % 7;
  if (add === 0 && now.getTime() > at.getTime() + 36e5) add = 7;
  at.setDate(at.getDate() + add);
  return at;
}

/**
 * "Tuesdays at 9:00 am"
 * @param {{ day: number, time: string }} schedule
 */
export function slotLabel(schedule = DEFAULT_SCHEDULE) {
  const [h, m] = String(schedule.time || '09:00').split(':').map(Number);
  const t = new Date(2000, 0, 1, h || 0, m || 0).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${DAYS[schedule.day] ?? DAYS[2]}s at ${t}`;
}
