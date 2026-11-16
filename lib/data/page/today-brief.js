/**
 * The Today page's reading of the room: the one-line briefing, the service
 * period, what's coming up, and the money kept in its separate states
 * (could save, being checked, confirmed). Pure JS, shared by the browser and
 * tests (tests/page-today.test.ts). Every figure here is read from
 * deriveRoom(); nothing is typed in.
 */

import { cardState, isActive, worthOf } from './today.js';

/** The room's service periods, in minutes after midnight (local). */
export const PERIODS = [
  { id: 'lunch', label: 'Lunch', from: 11 * 60 + 30, to: 14 * 60 + 30 },
  { id: 'dinner', label: 'Dinner', from: 17 * 60, to: 22 * 60 },
];
/** A restaurant open past midnight is still on the previous business day until this hour. */
export const DAY_ROLLS_AT = 4;

/** "7:15 pm" → minutes after midnight. */
export function clockMinutes(text) {
  const m = /^(\d{1,2}):?(\d{2})?\s*(am|pm)$/i.exec(String(text || '').trim());
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  return h * 60 + Number(m[2] || 0);
}

/**
 * Where the day stands: before, during or after a service period. Before
 * DAY_ROLLS_AT, it's still the previous night's business day.
 * @param {number|null} mins minutes after midnight
 */
export function servicePeriod(mins) {
  if (mins == null) return { id: 'unknown', label: '', phase: 'day' };
  if (mins < DAY_ROLLS_AT * 60) return { id: 'late', label: 'After close', phase: 'after', lateNight: true };
  for (const p of PERIODS) {
    if (mins >= p.from && mins < p.to) return { id: p.id, label: `${p.label} service`, phase: 'during', period: p };
  }
  const next = PERIODS.find((p) => mins < p.from);
  if (next) return { id: `before-${next.id}`, label: `Before ${next.label.toLowerCase()}`, phase: 'before', period: next };
  return { id: 'after', label: 'After close', phase: 'after' };
}

/** Which part of the business a card is about, for the filter. */
export const AREAS = {
  labor: 'Labor',
  menu: 'Menu',
  stock: 'Stock',
  delivery: 'Delivery',
  comps: 'Comps and voids',
  data: 'Data',
};
export function areaOf(card) {
  if (card.area && AREAS[card.area]) return card.area;
  const when = String(card.when || '');
  if (card.kind === 'data' || card.claim === 'none' || card.input === 'recipes' || card.input === 'toast') return 'data';
  if (card.task?.system === '7shifts' || when.startsWith('staff:') || /server|shift|schedule|labor|overtime/i.test(card.title)) return 'labor';
  if (card.input === 'counts' || card.go === 'inventory' || when.startsWith('flag') || /count|pour|waste|usage/i.test(card.title)) return 'stock';
  if (card.go === 'channels' || /deliver|doordash|uber/i.test(`${card.title} ${card.body}`)) return 'delivery';
  if (card.go === 'controls' || /comp|void/i.test(card.title)) return 'comps';
  return 'menu';
}

/**
 * How a card's action is carried out, said plainly. Coversight never changes
 * another system by itself: a write-back is always a person's step.
 *  - approve: recorded here, then the steps go under "Being handled"
 *  - manual: you make the change in another system; we give the steps and check the data after
 *  - screen: opens the screen where it's done
 *  - record: happens on the floor; Done records who and when
 *  - test: starts a test that measures on its own
 */
export function carriedOut(card) {
  if (card.start) return { kind: 'test', text: 'Starts a test that measures on its own. Nothing is counted as saved unless the test proves it.' };
  if (card.approval) return { kind: 'approve', text: 'Your approval is recorded here. The change itself isn’t made until someone makes it; its steps go under Being handled on Today.' };
  if (card.task) return { kind: 'manual', text: `You make this change in ${card.task.system}. Coversight doesn’t change ${card.task.system} for you: it lists the steps, and checks the data afterwards.` };
  if (card.go) return { kind: 'screen', text: 'Opens the screen where this is done.' };
  return { kind: 'record', text: 'This happens on the floor. Marking it done records your name and the time.' };
}

/** Feeds that are behind, with what they hold back. */
export function behindFeeds(d) {
  return (d.feeds || []).filter((f) => f.state === 'stale').map((f) => ({
    name: f.name,
    last: f.last,
    labor: f.name === '7shifts',
    what: f.name === '7shifts' ? 'Labor figures and staffing advice may be behind'
      : f.name === 'Kitchen display' ? 'Ticket times may be behind'
        : f.name === 'Recipe costs' ? 'Plate costs and menu advice use old costs'
          : f.name === 'Toast' ? 'Sales figures may be behind'
            : `${f.what || 'Its figures'} may be behind`,
  }));
}

/**
 * How far a card can be trusted right now, and how long there is to act.
 *  - delayed: the feed it rests on is behind (a labor card while 7shifts is stale)
 *  - before / minsLeft: for a card about an hour tonight, the hour and the minutes until it
 */
export function cardTrust(card, d, now) {
  const area = areaOf(card);
  const feed = area === 'labor' ? (d.feeds || []).find((f) => f.name === '7shifts' && f.state === 'stale') : null;
  const hr = /at (\d{1,2}):00 tonight/.exec(card.title || '')?.[1];
  const at = clockMinutes(now?.time);
  let before = null;
  let minsLeft = null;
  if (hr && at != null) {
    before = `${hr} pm`;
    minsLeft = (Number(hr) % 12 + 12) * 60 - at;
  }
  return { delayed: feed ? { name: feed.name, last: feed.last } : null, before, minsLeft };
}

/** Tonight's live read, when the room's data has one for this service. */
export function tonight(d, now) {
  const sv = d.room?.service;
  if (!sv || !now?.label) return null;
  const weekday = now.label.split(',')[0];
  if (!String(sv.day || '').startsWith(weekday)) return null;
  return sv;
}

/**
 * The briefing: one headline and one sentence, from the room's state.
 * Reassures when nothing needs the manager; names a missing feed instead
 * of hiding it.
 * @returns {{ tone: 'calm'|'attention', headline: string, line: string, warn: {name:string,last:string,what:string}[] }}
 */
export function briefing(d, { cards, view, now }) {
  const active = cards.filter((c) => isActive(c, view));
  const ready = active.filter((c) => !c.blocked);
  const dueToday = ready.filter((c) => c.deadline === 'today');
  const sv = tonight(d, now);
  const warn = behindFeeds(d);
  const n = ready.length;
  const decisions = n === 0 ? 'Nothing needs a decision right now'
    : `${n === 1 ? 'One decision needs' : `${n} decisions need`} you${dueToday.length ? `, ${dueToday.length === 1 ? 'one' : dueToday.length} of them tonight` : ''}`;
  if (sv) {
    const pace = Math.abs(sv.pace);
    const day = String(sv.day).split(' ')[0];
    if (sv.mode === 'cut') {
      return { tone: 'attention', headline: `Dinner is ${pace}% quieter than usual.`, line: `Covers are ${pace}% below the usual ${day} dinner pace. Check staffing for the next service hour.`, warn };
    }
    if (sv.mode === 'wait') {
      return { tone: n ? 'attention' : 'calm', headline: 'Dinner is a little slow. No staffing change yet.', line: `Covers are ${pace}% under a usual ${day}, still inside the normal range. ${decisions}.`, warn };
    }
    return { tone: n ? 'attention' : 'calm', headline: n ? 'Dinner is on track.' : 'Everything looks on track for dinner.', line: `Covers are ${pace}% ${sv.pace >= 0 ? 'over' : 'under'} a usual ${day} and staffing is right. ${decisions}.`, warn };
  }
  if (!active.length) return { tone: 'calm', headline: 'Everything looks on track.', line: 'Nothing urgent needs your attention.', warn };
  if (!n) return { tone: 'calm', headline: 'Nothing to decide right now.', line: `${active.length === 1 ? 'One decision is' : `${active.length} decisions are`} waiting on data.`, warn };
  return { tone: 'attention', headline: `${n === 1 ? 'One thing needs' : `${n} things need`} a decision.`, line: dueToday.length ? `${dueToday.length === 1 ? 'One is' : `${dueToday.length} are`} due today.` : 'None of them is due today.', warn };
}

/**
 * What to prepare for: the rest of tonight's service by hour (usual covers
 * against servers on and needed), tests whose result is due, and anything
 * snoozed that comes back tomorrow. Never repeats a card that is already in
 * "Needs your attention". At most `max` items.
 */
export function comingUp(d, { cards, view, now, max = 4 }) {
  const out = [];
  const sv = tonight(d, now);
  const at = clockMinutes(now?.time);
  const plan = d.room?.labour?.tue;
  if (sv && plan && at != null && String(plan.label || '').startsWith(String(sv.day).split(' ')[0])) {
    plan.hours.forEach((h, i) => {
      const hr = clockMinutes(h);
      if (hr == null || hr <= at) return;
      const over = plan.sched[i] - plan.need[i];
      out.push({
        key: `hour-${h}`, when: h, title: `Usually ${plan.covers[i]} covers`,
        detail: `${plan.sched[i]} servers on, ${plan.need[i]} needed`,
        tone: over > 0 ? 'note' : over < 0 ? 'warn' : 'ok',
        go: 'service',
      });
    });
  }
  const snoozed = cards.filter((c) => cardState(c, view) === 'snoozed');
  snoozed.forEach((c) => out.push({ key: `snz-${c.id}`, when: 'Tomorrow', title: c.title, detail: 'Comes back to your list', tone: 'note' }));
  (d.proofs || []).filter((p) => p.outcome === 'testing' && p.closes).forEach((p) => out.push({
    key: `test-${p.id}`, when: p.closes, title: p.title, detail: 'Test result due', tone: 'note', go: 'proof',
  }));
  return out.slice(0, max);
}

/**
 * The money, kept in separate states and never added together:
 *  - could: open decisions with a dollar figure (each its own unit and claim)
 *  - checking: tests running, each with its own range and result date
 *  - confirmed: savings that passed their test and are counted, a week and to date
 */
export function results(d, { cards, view }) {
  const could = cards.filter((c) => isActive(c, view) && !c.blocked).map((c) => ({ c, w: worthOf(c) }))
    .filter((x) => x.w.figure && (x.w.dollars ?? 0) > 0)
    .sort((a, b) => (b.w.dollars ?? 0) - (a.w.dollars ?? 0));
  const checking = (d.proofs || []).filter((p) => p.outcome === 'testing');
  const b = d.banked || { week: 0, toDate: 0, accruing: [], reversed: [], paused: 0 };
  return {
    could,
    checking,
    confirmed: { week: b.week, toDate: b.toDate, paused: b.paused, items: b.accruing || [], reversed: b.reversed || [] },
  };
}

