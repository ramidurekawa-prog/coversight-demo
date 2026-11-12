// The weekly meeting, as pure functions the screen, the server and the tests
// share: the agenda with the finding behind its decision, what a decision does,
// the record a finished meeting saves, the summary email, follow-ups still
// open, the room's meeting record, and when the next meeting is.

/** Bounds on a saved meeting. server/actions.ts validates against the same numbers. */
export const MEETING_LIMITS = { items: 12, note: 500, followups: 12, followupText: 200, owner: 80, plan: 12, log: 20, logLine: 200, choice: 120, title: 200, history: 26, done: 150 };

/** Tuesday 9:00, 15 minutes: the default slot until a room sets its own. */
export const DEFAULT_SCHEDULE = { day: 2, time: '09:00' };
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DAY_MS = 864e5;
/** How long each kind of decision keeps a finding off the plan (matches the finding page's "Not for us"). */
export const HOLD_DAYS = 14;
export const DISMISS_DAYS = 90;

const clip = (s, n) => String(s ?? '').trim().slice(0, n);

/**
 * The finding a decision item is about: the one its `when: 'cand:<id>'` names,
 * or, for the slot the model fills itself, the top-ranked open move (the same
 * rule as model.js meetingFor).
 */
export function decisionFinding(item, d) {
  if (!item?.decision) return null;
  const named = typeof item.when === 'string' && item.when.startsWith('cand:') ? item.when.slice(5) : null;
  if (named) return d.candidates.find((c) => c.id === named) || null;
  return d.plan.sorted.find((c) => c.value > 0.5 && !c.prevent) || null;
}

/** approve | hold | dismiss for an option on a decision item: the last word of each list is usually "Not for us". */
export function choiceKind(choice, index) {
  const s = String(choice || '').toLowerCase();
  if (/not for us|\bno\b|decline|skip/.test(s)) return 'dismiss';
  if (/hold|wait|later|two weeks|next week/.test(s)) return 'hold';
  if (index === 0 || /approve|yes|go ahead|reprint|raise|try/.test(s)) return 'approve';
  return 'other';
}

/** The findings entry a decision writes (the date it may come back), or null when it writes none. */
export function decisionUntil(kind, now = new Date()) {
  if (kind === 'hold') return new Date(now.getTime() + HOLD_DAYS * DAY_MS).toISOString();
  if (kind === 'dismiss') return new Date(now.getTime() + DISMISS_DAYS * DAY_MS).toISOString();
  return null;
}

/** Which claim strength an agenda item's dollars carry. */
export function itemClaim(item, cand) {
  if (item.decision) return cand?.claim || null;
  if (/^what banked/i.test(item.k)) return 'book';
  return null;
}
export const isPlanItem = (item) => item.go === 'plan' || /^commit/i.test(item.k);

/** The agenda for a room: the model's items with the finding behind the decision attached. */
export function agendaFor(d, fill = (s) => s) {
  return (d.meeting || []).map((a, n) => {
    const cand = decisionFinding(a, d);
    return { ...a, key: `${n}:${a.k}`, body: fill(a.body), cand: cand ? { id: cand.id, title: cand.title || cand.id, claim: cand.claim, value: cand.value, p: cand.p } : null };
  });
}
export const agendaMinutes = (agenda) => agenda.reduce((s, a) => s + (a.mins || 0), 0);

/** A follow-up id that won't collide inside one room's record. */
export function followupId(now = Date.now(), rand = Math.random) {
  return `f-${now.toString(36)}${Math.floor(rand() * 1296).toString(36).padStart(2, '0')}`;
}

/**
 * What a finished meeting saves under the room's `meeting` key.
 * @param {{ startedAt: string, notes?: Record<string,string>, choice?: string|null, followups?: {id:string,text:string,owner?:string}[], plan?: string[] }} draft
 * @param {ReturnType<typeof agendaFor>} agenda
 */
export function meetingRecord(draft, agenda, finishedAt = new Date()) {
  const L = MEETING_LIMITS;
  const at = finishedAt.toISOString();
  const started = draft.startedAt ? new Date(draft.startedAt) : finishedAt;
  const mins = Math.max(0, Math.min(600, Math.round((finishedAt.getTime() - started.getTime()) / 60000)));
  const dItem = agenda.find((a) => a.decision);
  const choice = dItem && draft.choice ? clip(draft.choice, L.choice) : null;
  const kind = choice ? choiceKind(choice, dItem.decision.indexOf(draft.choice)) : null;
  const items = agenda.slice(0, L.items).map((a) => {
    const note = clip(draft.notes?.[a.key], L.note);
    return { k: clip(a.k, 80), ...(a.decision ? { decision: choice || 'Deferred' } : {}), ...(note ? { note } : {}) };
  });
  const plan = (draft.plan || []).slice(0, L.plan).map((t) => clip(t, L.title)).filter(Boolean);
  const followups = (draft.followups || [])
    .map((f) => ({ id: clip(f.id, 40), text: clip(f.text, L.followupText), ...(clip(f.owner, L.owner) ? { owner: clip(f.owner, L.owner) } : {}) }))
    .filter((f) => f.id && f.text).slice(0, L.followups);
  const log = items.map((it) => clip(`${it.k}${it.decision ? `: ${it.decision}` : ''}`, L.logLine)).slice(0, L.log);
  return {
    at, startedAt: started.toISOString(), mins, log, items,
    ...(dItem ? { decision: { ...(dItem.cand ? { id: dItem.cand.id, title: clip(dItem.cand.title, L.title) } : {}), choice: choice || 'Deferred', kind: kind || 'deferred' } } : {}),
    ...(plan.length ? { plan } : {}),
    ...(followups.length ? { followups } : {}),
  };
}

const longDate = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/** The email that goes to whoever wasn't in the room. Older records (log only) still read. */
export function meetingSummary(rec, roomName) {
  const when = longDate(rec.at);
  const lines = [`Weekly meeting at ${roomName}, ${when}${rec.mins ? `, ${rec.mins} min` : ''}.`, ''];
  if (rec.decision) lines.push(`Decision: ${rec.decision.title ? `${rec.decision.title}: ` : ''}${rec.decision.choice}.`, '');
  if (rec.plan?.length) lines.push("This week's plan:", ...rec.plan.map((p) => `• ${p}`), '');
  const notes = (rec.items || []).filter((i) => i.note);
  if (notes.length) lines.push('Notes:', ...notes.map((i) => `• ${i.k}: ${i.note}`), '');
  if (rec.followups?.length) lines.push('Follow-ups:', ...rec.followups.map((f) => `• ${f.text}${f.owner ? ` (${f.owner})` : ''}`), '');
  if (!rec.items) lines.push(...(rec.log || []).map((l) => `• ${l}`), '');
  lines.push('From Coversight.');
  return { subject: `${roomName}: weekly meeting, ${when}`, body: lines.join('\n') };
}

/** Follow-ups from past meetings not yet ticked off, oldest first. */
export function openFollowups(history, done = {}) {
  const seen = new Set();
  const out = [];
  for (const m of [...(history || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    for (const f of m.followups || []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      if (!done[f.id]) out.push({ ...f, from: m.at });
    }
  }
  return out;
}

/** Done marks, trimmed to the newest `MEETING_LIMITS.done` so the saved value stays bounded. */
export function trimDone(done) {
  const rows = Object.entries(done || {}).sort((a, b) => String(b[1]).localeCompare(String(a[1])));
  return Object.fromEntries(rows.slice(0, MEETING_LIMITS.done));
}

const weekStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d.getTime(); };

/** The room's meeting record over the last eight weeks (this week included). Nulls when there's nothing to say. */
export function meetingStats(history, now = new Date()) {
  const from = weekStart(now) - 7 * 7 * DAY_MS;
  const recent = (history || []).filter((m) => new Date(m.at).getTime() >= from && new Date(m.at).getTime() <= now.getTime() + DAY_MS);
  const weeks = new Set(recent.map((m) => weekStart(m.at)));
  const timed = recent.filter((m) => typeof m.mins === 'number');
  const decided = recent.filter((m) => m.decision || m.items);
  return {
    held: weeks.size,
    of: 8,
    avgMins: timed.length ? Math.round(timed.reduce((s, m) => s + m.mins, 0) / timed.length) : null,
    decisions: decided.length ? decided.filter((m) => m.decision && m.decision.kind !== 'deferred').length / decided.length : null,
    followups: recent.reduce((s, m) => s + (m.followups?.length || 0), 0),
  };
}

/** The next time the slot comes round, from `now` (today counts until the slot has passed by an hour). */
export function nextMeeting(schedule = DEFAULT_SCHEDULE, now = new Date()) {
  const [h, m] = String(schedule.time || '09:00').split(':').map(Number);
  const at = new Date(now);
  at.setHours(h || 0, m || 0, 0, 0);
  let add = (schedule.day - now.getDay() + 7) % 7;
  if (add === 0 && now.getTime() > at.getTime() + 36e5) add = 7;
  at.setDate(at.getDate() + add);
  return at;
}

/** "Tuesdays at 9:00 am" */
export function slotLabel(schedule = DEFAULT_SCHEDULE) {
  const [h, m] = String(schedule.time || '09:00').split(':').map(Number);
  const t = new Date(2000, 0, 1, h || 0, m || 0).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${DAYS[schedule.day] ?? DAYS[2]}s at ${t}`;
}
