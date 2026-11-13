/**
 * The Today page's queue, shared by the browser and the server so both see
 * the same cards, the same order and the same rules. Pure JS; tested in
 * tests/page-today.test.ts.
 *
 * - todayCards(d, ctx): the room's cards for the day, each with its category,
 *   manager effort, what blocks it, what it unblocks, and the task it is
 *   linked to, ranked by RANK_POLICY.
 * - queueView / cardState: where each card stands today. The saved queue
 *   holds only the decisions made on this page (done, declined, snoozed);
 *   approvals and prepared changes are the guided tasks themselves (one
 *   record, shown the same on every page), and tests are the test windows.
 * - applyOp: one decision on one card, checked against the card's rules.
 */

import { findingBlocked } from '../findings.js';
import { tmpl } from '../model.js';
import { buildOwnQueue } from '../queue.js';
import { dataEnd } from '../readers.js';

export const DEFAULT_TZ = 'America/Los_Angeles';
export const OPS = ['done', 'snooze', 'refuse', 'undo', 'reset'];
/** How many cards the first screen shows before "View remaining". */
export const FIRST_SCREEN = 3;
/** A test's measurement runs this long in the background; it is not manager time. */
export const TEST_DAYS = 28;

/**
 * Why a suggestion was turned down, and how long that keeps it away. A
 * declined card comes back early if what it's worth grows by half or more,
 * and a critical card can't be turned down at all.
 */
export const DECLINE = {
  not_relevant: { label: 'Doesn’t apply here', days: 90 },
  handled: { label: 'Already handled another way', days: 30 },
  disagree: { label: 'The numbers look wrong', days: 30 },
  not_now: { label: 'Not a priority right now', days: 30 },
};
export const RECONSIDER_GROWTH = 1.5;

/**
 * Ranking policy, highest first. Within a category: dated work first, then
 * what it's worth (where the data values it), then the least manager time.
 * A card waiting on data is never ranked as ready: it goes after every card
 * that can be acted on, and the card that unblocks it rises to `problem`.
 */
export const RANK_POLICY = [
  ['critical', 'Safety or compliance'],
  ['urgent', 'Has to happen today'],
  ['problem', 'A problem costing money now, or data that blocks other decisions'],
  ['opportunity', 'A safe, valued improvement'],
  ['followup', 'Follow-up on something under way'],
  ['repair', 'Data to keep the numbers right'],
  ['maintenance', 'Housekeeping'],
];
const RANK = Object.fromEntries(RANK_POLICY.map(([k], i) => [k, i]));

/** The calendar day (YYYY-MM-DD) at an instant, in the room's time zone. */
export function localDay(at, tz = DEFAULT_TZ) {
  return new Date(at).toLocaleDateString('en-CA', { timeZone: tz || DEFAULT_TZ });
}

/** The day after a YYYY-MM-DD date. */
export function nextDay(day) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
}

/** Hours of manager time to whole minutes (at least 1). */
export const hoursToMinutes = (h) => Math.max(1, Math.round((Number(h) || 0) * 60));

/**
 * How a written sample card is carried out and when it's due, by card id.
 * Keyed by card, never by room: every room's copy behaves the same. Cards
 * built from a room's own data carry their own action.
 *  - go: open that screen. task: becomes a guided write-back task in that
 *    system. log: the change happens on the floor; Done records who and when.
 *  - deadline: 'today' makes it urgent; any other value is shown as the due day.
 */
const WRITTEN = {
  cut: { deadline: 'today' },
  '7shifts': { go: 'sources' },
  ot: { task: '7shifts', deadline: 'before the overtime starts' },
  refunds: { log: true },
};

function wire(card) {
  const w = WRITTEN[card.id] || {};
  const out = { ...card, ...(w.deadline ? { deadline: w.deadline } : {}) };
  if (card.go || card.approval || card.start) return out;
  if (w.task) {
    const who = /^staff:(.+)$/.exec(card.when || '')?.[1] || 'Shifts';
    return { ...out, task: { system: w.task, diff: [[`${who}, this week`, 'As scheduled', card.title]] } };
  }
  if (w.go) return { ...out, go: w.go };
  return { ...out, log: true };
}

/** What kind of decision a card is, for its label on the page. */
export function cardKind(card) {
  if (card.start) return 'test';
  if (card.claim === 'none') return 'data';
  return 'decide';
}

/**
 * What a card's value is, in words: the dollar figure on its own (when the
 * value leads with one) and what that money is. A dollar figure whose meaning
 * isn't written down is not shown as a headline figure: `figure` is null and
 * the value stays a plain note.
 * @param {{ value?: string, means?: string }} card
 * @returns {{ figure: string|null, about: boolean, means: string|null, note: string|null }}
 */
export function worthOf(card) {
  const v = String(card.value || '');
  const m = /^(about\s+)?([−-]?\$[\d,.]+k?(?:\s+to\s+[−-]?\$[\d,.]+k?)?)(?:\/wk)?\b/i.exec(v);
  if (m && card.means) return { figure: m[2].replace('-', '−'), about: !!m[1], means: card.means, note: null };
  return { figure: null, about: false, means: null, note: v || null };
}

/** The approval id of the guided task a card becomes, if any. */
export const taskIdFor = (card) => card.approval || (card.task ? `today:${card.id}` : null);

const LIVE_TASK = new Set(['open', 'done', 'verified', 'mismatch']);

/**
 * The room's cards for the day, ranked.
 * @param {any} d deriveRoom(ds, roomId)
 * @param {{ today: string, testing?: string[], dismissed?: Record<string,string>, tasks?: { approvalId: string, status: string, roomId?: string }[] }} ctx
 * @returns {any[]}
 */
export function todayCards(d, { today, testing = [], dismissed = {}, tasks = [] }) {
  const own = !!d.room.fromToast;
  const through = dataEnd(d.room);
  const raw = own
    ? buildOwnQueue(d, { today, dataEnd: through, dismissed, testing })
    : (d.queue || []).map((q) => ({ ...q, title: tmpl(q.title, d.tokens), value: tmpl(q.value, d.tokens), body: tmpl(q.body, d.tokens) }));
  const cand = (id) => (d.candidates || []).find((c) => c.id === id) || null;
  const roomTasks = tasks.filter((t) => !t.roomId || t.roomId === d.room.id);

  const cards = raw.map((c0, order) => {
    const c = wire(c0);
    const kind = cardKind(c);
    // The finding behind the card, when there is one: its value, effort and whether it may be acted on.
    const f = c.id.startsWith('find:') ? cand(c.id.slice(5)) : /^cand:/.test(c.when || '') ? cand(c.when.slice(5)) : null;
    let mins = c.mins;
    if (own && f) mins = hoursToMinutes(f.hours ?? 0.25); // a finding's manager hours, as minutes
    const effort = c.start ? { manager: mins, waitDays: TEST_DAYS } : { manager: mins, waitDays: 0 };
    const blocked = f ? findingBlocked(f, d.room) : null;
    const tid = taskIdFor(c);
    const linked = tid ? roomTasks.find((t) => t.approvalId === tid && LIVE_TASK.has(t.status)) || null : null;
    return {
      ...c, kind, order, mins, effort,
      worth: f && f.value > 0 ? Math.round(f.value) : null,
      blocked, blockedNeeds: blocked ? (f?.kind === 'price' || f?.needs === 'recipes' ? 'recipes' : 'data') : null,
      linked: linked ? { approvalId: linked.approvalId, status: linked.status } : null,
      source: own ? { kind: 'toast', through } : { kind: 'sample', through },
      critical: !!c.critical,
    };
  });

  // Stale data holds back everything built on it: it's the first thing to fix.
  const stale = cards.find((c) => c.id.startsWith('stale:'));
  if (own && stale) {
    for (const c of cards) {
      if (!c.blocked && (c.id.startsWith('find:') || c.start)) { c.blocked = `Your Toast data ends ${through}. Act on this after the new week arrives.`; c.blockedNeeds = 'data'; }
    }
  }
  // Each blocked card points at the card that unblocks it; that card counts what it unblocks.
  for (const c of cards) {
    if (!c.blocked) continue;
    const fix = c.blockedNeeds === 'recipes' ? cards.find((x) => x.input === 'recipes') : stale;
    if (fix) { c.blockedBy = fix.id; fix.unblocks = (fix.unblocks || 0) + 1; }
  }
  for (const c of cards) {
    c.category = c.critical ? 'critical'
      : c.deadline === 'today' ? 'urgent'
        : c.kind === 'data' ? (c.unblocks ? 'problem' : 'repair')
          : c.kind === 'test' ? 'opportunity'
            : c.claim === 'obs' && (c.tone === 'warn' || c.tone === 'bad') ? 'problem'
              : 'opportunity';
  }
  cards.sort((a, b) => (!!a.blocked - !!b.blocked) || (RANK[a.category] - RANK[b.category]) || (!!b.deadline - !!a.deadline)
    || ((b.worth ?? -1) - (a.worth ?? -1)) || (a.order - b.order));
  return cards.map((c, i) => ({ ...c, rank: i + 1, why: whyHere(c) }));
}

function whyHere(c) {
  if (c.blocked) return 'Waiting on data, so it sits below everything that can be done now.';
  if (c.category === 'problem' && c.unblocks) return `Ranked high because ${c.unblocks} other decision${c.unblocks === 1 ? '' : 's'} can’t go ahead until it’s done.`;
  return `${RANK_POLICY[RANK[c.category]][1]}.`;
}

const EMPTY = { done: {}, refused: {}, snoozed: {}, meta: {} };
const ageDays = (iso, now) => (now - Date.parse(iso)) / 864e5;

/**
 * The decisions that still apply today.
 * Done: on a room's own data, for the day it was done (tomorrow's queue is
 * new); the sample's written queue doesn't change by day, so there it holds
 * until the demo is reset. Snoozed: until its resume day. Declined: for its
 * reason's days, unless the card is now worth RECONSIDER_GROWTH times more.
 * @param {any} stored
 * @param {{ today: string, own: boolean, now?: number, tz?: string, cards?: any[] }} ctx
 * @returns {any}
 */
export function queueView(stored, { today, own, now = Date.now(), tz = DEFAULT_TZ, cards = [] }) {
  const s = { ...EMPTY, ...(stored || {}) };
  const meta = s.meta || {};
  const pick = (obj, keep) => Object.fromEntries(Object.entries(obj || {}).filter(([id, v]) => typeof v === 'string' && keep(v, id)));
  const declinedFor = (id) => DECLINE[meta[id]?.reason]?.days ?? 90;
  const grown = (id) => {
    const was = meta[id]?.worth, card = cards.find((c) => c.id === id);
    return !!(was && card?.worth && card.worth >= was * RECONSIDER_GROWTH);
  };
  const view = {
    done: pick(s.done, (at) => !own || localDay(at, tz) === today),
    refused: pick(s.refused, (at, id) => ageDays(at, now) < declinedFor(id) && !grown(id)),
    snoozed: pick(s.snoozed, (until) => until > today),
  };
  const keep = new Set([...Object.keys(view.done), ...Object.keys(view.refused), ...Object.keys(view.snoozed)]);
  view.meta = Object.fromEntries(Object.entries(meta).filter(([id]) => keep.has(id)));
  return view;
}

/**
 * Where a card stands. Active: ready, needs_review, blocked. Out of the
 * queue: approved / prepared (its guided task is open), executed (marked
 * made, waiting for the data), confirmed (the data shows it), completed,
 * declined, snoozed.
 */
export function cardState(card, view) {
  if (card.linked) {
    const st = card.linked.status;
    if (st === 'verified') return 'confirmed';
    if (st === 'done') return 'executed';
    if (st === 'mismatch') return 'mismatch';
    return card.approval ? 'approved' : 'prepared';
  }
  if (view.done[card.id]) return 'completed';
  if (view.refused[card.id]) return 'declined';
  if (view.snoozed[card.id]) return 'snoozed';
  if (card.blocked) return 'blocked';
  if (card.approval) return 'needs_review';
  return 'ready';
}
export const ACTIVE = new Set(['ready', 'needs_review', 'blocked']);
export const isActive = (card, view) => ACTIVE.has(cardState(card, view));
const decided = (view, id) => !!(view.done[id] || view.refused[id] || view.snoozed[id]);

/**
 * One decision on the queue. Returns the next saved value, pruned to what
 * still matters (so it stays small for years of daily use), or throws an
 * Error with a message for the person.
 * @param {any} stored the saved queue value (or null)
 * @param {{ op: string, cardId?: string, reason?: string }} act
 * @param {{ cards: any[], today: string, own: boolean, now?: number, tz?: string }} ctx
 * @returns {any}
 */
export function applyOp(stored, { op, cardId, reason }, { cards, today, own, now = Date.now(), tz = DEFAULT_TZ }) {
  if (!OPS.includes(op)) throw new Error(`op must be one of ${OPS.join(', ')}`);
  const view = queueView(stored, { today, own, now, tz, cards });
  const stamp = new Date(now).toISOString();
  let next = { done: { ...view.done }, refused: { ...view.refused }, snoozed: { ...view.snoozed }, meta: { ...view.meta } };
  if (op === 'reset') {
    // A room on its own data gets today's cards back and keeps its declines; the sample starts over.
    return own ? { done: {}, refused: next.refused, snoozed: {}, meta: Object.fromEntries(Object.keys(next.refused).map((id) => [id, next.meta[id]]).filter(([, m]) => m)) } : { ...EMPTY };
  }
  if (op === 'undo') {
    if (!cardId || !decided(view, cardId)) throw new Error('That card isn’t done, snoozed or declined.');
    for (const k of ['done', 'refused', 'snoozed', 'meta']) delete next[k][cardId];
    return next;
  }
  const card = cards.find((c) => c.id === cardId);
  if (!card) throw new Error('That card isn’t in today’s queue any more.');
  const state = cardState(card, view);
  if (!ACTIVE.has(state)) throw new Error('That card is already off the queue.');
  if (op === 'done') {
    if (card.approval) throw new Error('This needs an approval, not a tick: approve it and its steps go to “Changes to make”.');
    if (card.task || card.start) throw new Error('This is carried out by its own steps; use its main button.');
    if (card.blocked) throw new Error(`Not yet: ${card.blocked}`);
    next.done[cardId] = stamp;
  }
  if (op === 'refuse') {
    if (card.critical) throw new Error('A critical card can’t be turned down.');
    if (!card.refuse) throw new Error('Only a suggestion can be turned down; this card is needed to keep the numbers right.');
    if (!DECLINE[reason]) throw new Error(`Say why: ${Object.keys(DECLINE).join(', ')}.`);
    next.refused[cardId] = stamp;
    next.meta[cardId] = { reason, ...(card.worth ? { worth: card.worth } : {}) };
  }
  if (op === 'snooze') {
    if (card.critical || card.deadline === 'today') throw new Error('This is due today, so it can’t be snoozed to tomorrow.');
    next.snoozed[cardId] = nextDay(today);
  }
  return next;
}

/** Totals for the head of the page. Only manager time counts toward the minutes left. */
export function queueSummary(cards, view) {
  const st = cards.map((c) => cardState(c, view));
  const n = (s) => st.filter((x) => x === s).length;
  const active = cards.filter((c, i) => ACTIVE.has(st[i]));
  const ready = active.filter((c) => !c.blocked);
  return {
    total: cards.length,
    left: active.length,
    ready: ready.length,
    blocked: active.length - ready.length,
    cleared: n('completed') + n('approved') + n('prepared') + n('executed') + n('confirmed') + n('mismatch'),
    snoozed: n('snoozed'),
    refused: n('declined'),
    // Everything off today's list one way or another: total = ready + blocked + handled, always.
    handled: cards.length - active.length,
    minsLeft: ready.reduce((s, c) => s + (c.effort?.manager ?? c.mins ?? 0), 0),
  };
}

/**
 * Who did what today, from the saved values in order (oldest first): each
 * card that newly appears in done, refused or snoozed, or leaves all three.
 * @param {{ value: any, at: string, by: any }[]} rows
 * @param {any} [before] the saved value before the first row
 * @returns {{ cardId: string|null, op: string, at: string, by: any, reason?: string, count?: number }[]}
 */
export function queueHistory(rows, before = null) {
  const out = [];
  let prev = { ...EMPTY, ...(before || {}) };
  for (const r of rows) {
    const cur = { ...EMPTY, ...(r.value || {}) };
    for (const [k, op] of [['done', 'done'], ['refused', 'refuse'], ['snoozed', 'snooze']]) {
      for (const id of Object.keys(cur[k] || {})) {
        if (prev[k]?.[id]) continue;
        const reason = op === 'refuse' ? cur.meta?.[id]?.reason : undefined;
        out.push({ cardId: id, op, at: r.at, by: r.by, ...(reason ? { reason } : {}) });
      }
    }
    const was = new Set([...Object.keys(prev.done || {}), ...Object.keys(prev.refused || {}), ...Object.keys(prev.snoozed || {})]);
    const back = [...was].filter((id) => !cur.done?.[id] && !cur.refused?.[id] && !cur.snoozed?.[id]);
    // One card back is an undo; several at once is "show today's cards again".
    if (back.length === 1) out.push({ cardId: back[0], op: 'undo', at: r.at, by: r.by });
    else if (back.length > 1) out.push({ cardId: null, op: 'reset', count: back.length, at: r.at, by: r.by });
    prev = cur;
  }
  return out;
}

/** What changed in the queue since it was last built: new cards, and cards gone without a decision here. */
export function queueChanges(prevIds, cards, view) {
  if (!prevIds) return { added: [], gone: [] };
  const now = new Set(cards.map((c) => c.id));
  const was = new Set(prevIds);
  return {
    added: cards.filter((c) => !was.has(c.id) && isActive(c, view)).map((c) => c.id),
    gone: prevIds.filter((id) => !now.has(id)),
  };
}
