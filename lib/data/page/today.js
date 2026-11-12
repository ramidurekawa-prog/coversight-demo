/**
 * The Today page's queue, shared by the browser and the server so both see
 * the same cards and the same rules. Pure JS; tested in tests/page-today.test.js.
 *
 * - todayCards(d, ctx): the room's cards for the day. A room on its own Toast
 *   data gets a queue built from that data (lib/data/queue.js); a sample room
 *   keeps its written queue, with {tokens} filled from the model.
 * - queueView(stored, ...): which cards are cleared, snoozed or refused today.
 * - applyOp(...): one card decision (done, snooze, refuse, undo, reset),
 *   pruned so the saved value never grows past what still matters.
 */

import { tmpl } from '../model.js';
import { buildOwnQueue } from '../queue.js';
import { dataEnd } from '../readers.js';

export const DEFAULT_TZ = 'America/Los_Angeles';
/** "Not for us" keeps a card away this long. */
export const REFUSE_DAYS = 90;
export const OPS = ['done', 'snooze', 'refuse', 'undo', 'reset'];

/** The calendar day (YYYY-MM-DD) at an instant, in the room's time zone. */
export function localDay(at, tz = DEFAULT_TZ) {
  return new Date(at).toLocaleDateString('en-CA', { timeZone: tz || DEFAULT_TZ });
}

/** The day after a YYYY-MM-DD date. */
export function nextDay(day) {
  const t = Date.parse(`${day}T12:00:00Z`) + 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * How a written sample card with no screen of its own is carried out, by card
 * id. Keyed by card, never by room: every room's copy of the card behaves the
 * same. Cards built from a room's own data always carry their own action.
 *  - go: open that screen.
 *  - task: becomes a guided write-back task (steps to make the change in that
 *    system, then Done), like an approval.
 *  - log: the change happens on the floor; Done records who and when.
 */
const WRITTEN = {
  '7shifts': { go: 'sources' },
  ot: { task: '7shifts' },
  refunds: { log: true },
};

function wire(card) {
  if (card.go || card.approval || card.start) return card;
  const w = WRITTEN[card.id];
  if (!w) return { ...card, log: true };
  if (w.task) {
    const who = /^staff:(.+)$/.exec(card.when || '')?.[1] || 'Shifts';
    return { ...card, task: { system: w.task, diff: [[`${who}, this week`, 'As scheduled', card.title]] } };
  }
  return { ...card, ...w };
}

/** What kind of decision a card is, for its label on the page. */
export function cardKind(card) {
  if (card.start) return 'test';
  if (card.claim === 'none') return 'data';
  return 'decide';
}

/**
 * The room's cards for the day.
 * @param {any} d deriveRoom(ds, roomId)
 * @param {{ today: string, testing?: string[], dismissed?: Record<string,string> }} ctx
 * @returns {any[]}
 */
export function todayCards(d, { today, testing = [], dismissed = {} }) {
  const own = !!d.room.fromToast;
  const cards = own
    ? buildOwnQueue(d, { today, dataEnd: dataEnd(d.room), dismissed, testing })
    : (d.queue || []).map((q) => ({ ...q, title: tmpl(q.title, d.tokens), value: tmpl(q.value, d.tokens), body: tmpl(q.body, d.tokens) }));
  return cards.map((c) => ({ ...wire(c), kind: cardKind(c) }));
}

const EMPTY = { done: {}, refused: {}, snoozed: {} };
const ageDays = (iso, now) => (now - Date.parse(iso)) / 864e5;

/**
 * Which cards are out of the queue today, and why.
 * A room on its own data: a card cleared counts for the day it was cleared
 * (tomorrow's queue is new). The sample's written queue doesn't change by
 * day, so its cleared cards stay cleared until the demo is reset.
 * Snoozed: until the day it comes back. Refused: for REFUSE_DAYS.
 */
export function queueView(stored, { today, own, now = Date.now(), tz = DEFAULT_TZ }) {
  const s = { ...EMPTY, ...(stored || {}) };
  const pick = (obj, keep) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => typeof v === 'string' && keep(v)));
  return {
    done: pick(s.done, (at) => !own || localDay(at, tz) === today),
    refused: pick(s.refused, (at) => ageDays(at, now) < REFUSE_DAYS),
    snoozed: pick(s.snoozed, (until) => until > today),
  };
}

/** Is this card out of today's queue? */
export const isOut = (view, id) => !!(view.done[id] || view.refused[id] || view.snoozed[id]);

/**
 * One decision on the queue. Returns the next saved value, pruned to what
 * still matters (so the saved value stays small for years of daily use), or
 * throws an Error with a message for the person.
 * @param {any} stored the saved queue value (or null)
 * @param {{ op: string, cardId?: string }} act
 * @param {{ cards: any[], today: string, own: boolean, now?: number, tz?: string }} ctx
 */
export function applyOp(stored, { op, cardId }, { cards, today, own, now = Date.now(), tz = DEFAULT_TZ }) {
  if (!OPS.includes(op)) throw new Error(`op must be one of ${OPS.join(', ')}`);
  const view = queueView(stored, { today, own, now, tz });
  const stamp = new Date(now).toISOString();
  let next = { done: { ...view.done }, refused: { ...view.refused }, snoozed: { ...view.snoozed } };
  if (op === 'reset') {
    // A room on its own data gets today's cards back, and keeps its "not for us" decisions; the sample starts over.
    next = own ? { done: {}, refused: next.refused, snoozed: {} } : { ...EMPTY };
  } else if (op === 'undo') {
    if (!cardId || !isOut(view, cardId)) throw new Error('That card isn’t cleared, snoozed or refused.');
    for (const k of ['done', 'refused', 'snoozed']) delete next[k][cardId];
  } else {
    const card = cards.find((c) => c.id === cardId);
    if (!card) throw new Error('That card isn’t in today’s queue any more.');
    if (isOut(view, cardId)) throw new Error('That card is already off the queue.');
    if (op === 'refuse' && !card.refuse) throw new Error('Only a suggestion can be turned down; this card is needed to keep the numbers right.');
    if (op === 'done') next.done[cardId] = stamp;
    if (op === 'refuse') next.refused[cardId] = stamp;
    if (op === 'snooze') next.snoozed[cardId] = nextDay(today);
  }
  return next;
}

/** Totals for the head of the page. */
export function queueSummary(cards, view) {
  const left = cards.filter((c) => !isOut(view, c.id));
  return {
    total: cards.length,
    left: left.length,
    cleared: cards.filter((c) => view.done[c.id]).length,
    snoozed: cards.filter((c) => view.snoozed[c.id]).length,
    refused: cards.filter((c) => view.refused[c.id]).length,
    minsLeft: left.reduce((s, c) => s + (c.mins || 0), 0),
  };
}

/**
 * Who did what today, from the saved values in order (oldest first): each
 * card that newly appears in done, refused or snoozed, or leaves all three.
 * @param {{ value: any, at: string, by: any }[]} rows
 * @param {any} [before] the saved value before the first row
 * @returns {{ cardId: string|null, op: string, at: string, by: any, count?: number }[]}
 */
export function queueHistory(rows, before = null) {
  const out = [];
  let prev = { ...EMPTY, ...(before || {}) };
  for (const r of rows) {
    const cur = { ...EMPTY, ...(r.value || {}) };
    for (const [k, op] of [['done', 'done'], ['refused', 'refuse'], ['snoozed', 'snooze']]) {
      for (const id of Object.keys(cur[k] || {})) if (!prev[k]?.[id]) out.push({ cardId: id, op, at: r.at, by: r.by });
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
