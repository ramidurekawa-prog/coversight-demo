'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import {
  applyOp, assigneeLabel, cardState, DECLINE, DEFAULT_TZ, FIRST_SCREEN, isActive, localDay, queueSummary, queueView, TEST_DAYS, todayCards, upNextOrder,
} from '../../../lib/data/page/today';
import { briefing, clockMinutes, results as resultsOf, servicePeriod, tonight } from '../../../lib/data/page/today-brief';
import { TasksPanel } from '../tasks';
import { useCv, CV_D, CV_GROUP, CV_NOW } from '../core';
import { useDense } from '../dense-ui';
import { reportTodayView } from './today.badge';
import { Yesterday } from './today.last';
import { applyScenario, useLayout, WIDGETS } from './today.layout';
import {
  BeingHandled, Briefing, ComingUp, CustomizePanel, IssueCard, Locations, MoreIssues, Results, ResultsPanel, ScenarioBar, Snapshot, snapshotTiles,
} from './today.parts';
import { ReviewPanel } from './today.review';
import s from './today.module.css';

/* ================================================================ Today
 * The room's daily command center: how it's doing (briefing and quick
 * numbers), what needs attention and what to do about it (review panel),
 * what's coming up, what's being handled, and the money in its separate
 * states. Layout and order stay put; only the content changes.
 * What needs the manager now, in the order to do it. Cards and their rules
 * come from lib/data/page/today.js, shared with the server. Signed in, each
 * decision goes to /api/page/today, which checks it against the room's queue
 * for the day and merges it; approvals and prepared changes become guided
 * tasks (the same record Service and Meeting create), shown under "Approved
 * changes to make". With no server it's saved in this browser by the same rules. */

const STATE = {
  ready: null,
  needs_review: { tone: 'info', icon: 'ShieldCheck', label: 'Needs your approval' },
  blocked: { tone: 'warn', icon: 'Lock', label: 'Waiting on data' },
  approved: { tone: 'info', icon: 'Hourglass', label: 'Approved · waiting to be made' },
  prepared: { tone: 'info', icon: 'Hourglass', label: 'Steps ready · waiting to be made' },
  executed: { tone: 'info', icon: 'Hourglass', label: 'Made · waiting for the data to show it' },
  confirmed: { tone: 'good', icon: 'BadgeCheck', label: 'Confirmed by the data' },
  mismatch: { tone: 'warn', icon: 'MessageSquareWarning', label: 'Marked made, data doesn’t show it yet' },
  completed: { tone: 'good', icon: 'CircleCheck', label: 'Done' },
  declined: { tone: 'neutral', icon: 'CircleMinus', label: 'Not for us' },
  snoozed: { tone: 'info', icon: 'CalendarClock', label: 'Snoozed' },
  assigned: { tone: 'info', icon: 'UserCheck', label: 'Assigned' },
};
const remoteCache = new Map();

async function call(path, init) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

/** In this browser there's no "who": every decision is yours, at the time it was saved. */
function localHistory(view) {
  const out = [];
  for (const [id, at] of Object.entries(view.done)) out.push({ cardId: id, op: 'done', at, by: { you: true } });
  for (const [id, at] of Object.entries(view.refused)) out.push({ cardId: id, op: 'refuse', at, by: { you: true }, reason: view.meta?.[id]?.reason });
  for (const id of Object.keys(view.snoozed)) out.push({ cardId: id, op: 'snooze', at: null, by: { you: true } });
  for (const [id, a] of Object.entries(view.assigned || {})) out.push({ cardId: id, op: 'assign', at: a.at, by: { you: true }, to: a.to });
  return out;
}

function useQueue({ cards, today, own, tz }) {
  const eng = useEngine();
  const server = eng.mode === 'server';
  const key = `${eng.org?.id || 'local'}/${CV_D.id}`;
  const [saved, setSaved] = useSaved('queue', null);
  const [remote, setRemote] = React.useState(() => remoteCache.get(key) || null);
  const [busy, setBusy] = React.useState(null);
  const [offline, setOffline] = React.useState(false);
  const keep = React.useCallback((b) => { remoteCache.set(key, b); setRemote(b); reportTodayView(CV_D.id, b.state); }, [key]);
  // Re-read when the room, or a task's status, changes (an approval on another screen updates the queue here).
  const taskSig = (eng.tasks || []).filter((t) => t.roomId === CV_D.id).map((t) => `${t.approvalId}:${t.status}`).join('|');

  React.useEffect(() => {
    if (!server) return undefined;
    let live = true;
    call(`/api/page/today?room=${encodeURIComponent(CV_D.id)}`).then((b) => { if (live) { keep(b); setOffline(false); } }).catch(() => { if (live) setOffline(true); /* the saved value from /api/state still shows */ });
    return () => { live = false; };
  }, [server, key, keep, taskSig]);

  const view = server && remote ? remote.state : queueView(saved, { today, own, tz, cards });
  const history = server && remote ? remote.history : localHistory(view);

  /** One decision. Resolves { ok, error? }. */
  const run = async (op, card, { reason, to, summary } = {}) => {
    let next;
    try {
      next = applyOp(view, { op, cardId: card?.id, reason, to }, { cards, today, own, tz });
    } catch (err) {
      return { ok: false, error: err.message };
    }
    if (!server) {
      setSaved(next, summary);
      return { ok: true };
    }
    const before = remote;
    setRemote({ ...(remote || { history: [] }), state: queueView(next, { today, own, tz, cards }) });
    setBusy(card?.id || 'reset');
    try {
      keep(await call('/api/page/today', { method: 'POST', body: JSON.stringify({ roomId: CV_D.id, op, cardId: card?.id, reason, to }) }));
      return { ok: true };
    } catch (err) {
      setRemote(before);
      return { ok: false, error: `Not saved: ${err.message}` };
    } finally {
      setBusy(null);
    }
  };
  return { view, history, run, busy, remote, offline };
}

const clock = (at, tz) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
const shortDate = (at, tz) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
const whoLabel = (by) => (by?.you ? 'You' : by?.name || 'A guest');


/** The button's words: what it actually does. */
function actLabel(q, fix) {
  if (q.blocked && fix) return `First: ${fix.primary}`;
  if (q.approval) return 'Review the change';
  if (q.task) return `Get the ${q.task.system} steps`;
  if (q.start) return 'Start the test';
  return q.primary;
}
/** In the review panel, the primary says the decision itself. */
const panelLabel = (q, fix) => (q.approval ? 'Approve…' : actLabel(q, fix));

const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** What's been decided, folded into one line until asked for. */
function Decided({ cards, view, history, tz, busy, onUndo, onReset, own }) {
  const [open, setOpen] = React.useState(false);
  const titleOf = (id) => cards.find((c) => c.id === id)?.title
    || (id.startsWith('find:') && CV_D.candidates.find((c) => c.id === id.slice(5))?.title) || id;
  const last = (id, op) => [...history].reverse().find((h) => h.cardId === id && h.op === op);
  const rows = [
    ...cards.filter((c) => c.linked).map((c) => ({ id: c.id, state: cardState(c, view), note: 'Steps are under Changes to make', undo: false })),
    ...Object.keys(view.done).map((id) => ({ id, state: 'completed', note: `${whoLabel(last(id, 'done')?.by)}, ${clock(view.done[id], tz)}`, undo: true })),
    ...Object.keys(view.snoozed).map((id) => ({ id, state: 'snoozed', note: `Back ${view.snoozed[id] <= localDay(Date.now() + 864e5, tz) ? 'tomorrow' : shortDate(`${view.snoozed[id]}T12:00:00Z`, 'UTC')}`, undo: true })),
    ...Object.keys(view.refused).map((id) => {
      const m = view.meta?.[id] || {};
      const days = DECLINE[m.reason]?.days ?? 90;
      return { id, state: 'declined', note: `${m.reason ? DECLINE[m.reason].label : 'Not for us'} · back ${shortDate(Date.parse(view.refused[id]) + days * 864e5, tz)}`, undo: true };
    }),
  ];
  if (!rows.length) return null;
  const count = (st) => rows.filter((r) => st.includes(r.state)).length;
  const parts = [[count(['completed', 'approved', 'prepared', 'executed', 'confirmed', 'mismatch']), 'done'], [count(['snoozed']), 'snoozed'], [count(['declined']), 'not for us']].filter(([n]) => n);
  return (
    <section className={s.decided} aria-labelledby="decided-head">
      <button type="button" id="decided-head" className={s.decidedHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="CircleCheck" size={15} />
        <span>{parts.map(([n, l]) => `${n} ${l}`).join(' · ')}{own ? ' today' : ''}</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
      </button>
      {open && (
        <>
          <ul className={s.decidedList}>
            {rows.map((r) => (
              <li key={`${r.state}-${r.id}`}>
                <Icon name={STATE[r.state].icon} size={14} className={s[`st_${STATE[r.state].tone}`]} />
                <span className={s.decidedTitle}>{titleOf(r.id)}</span>
                <span className={s.decidedNote}>{STATE[r.state].label} · {r.note}</span>
                {r.undo ? <button type="button" className={s.textBtn} disabled={busy === r.id} onClick={() => onUndo(r.id)}>Undo</button> : <span />}
              </li>
            ))}
          </ul>
          <button type="button" className={s.textBtn} disabled={!!busy} onClick={onReset}>{own ? 'Put today’s cards back' : 'Reset the demo'}</button>
        </>
      )}
    </section>
  );
}




function CvToday() {
  const cv = useCv();
  const eng = useEngine();
  const tools = !!cv.tools;
  const tz = CV_D.room.tz || DEFAULT_TZ;
  const today = localDay(Date.now(), tz);
  const own = !!CV_D.room.fromToast;
  const role = eng.viewer?.role === 'gm' ? 'gm' : cv.role === 'gm' ? 'gm' : 'owner';
  const { layout, custom, save, restore } = useLayout(role);
  const [scenario, setScenario] = React.useState('live');
  const [dismissed, setDismissed] = useSaved('findings', {});
  const [review, setReview] = React.useState(null); // card id
  const [resOpen, setResOpen] = React.useState(null); // 'confirmed' | 'checking' | 'could'
  const [customizing, setCustomizing] = React.useState(false);
  const [stepsOpen, setStepsOpen] = React.useState(false);
  const [said, setSaid] = React.useState('');
  const dense = useDense();
  React.useEffect(() => { if (!tools) setScenario('live'); }, [tools]);

  const roomTasks = (eng.tasks || []).filter((t) => t.roomId === CV_D.id);
  const windows = (eng.windows || []).filter((w) => w.roomId === CV_D.id && (w.status === 'running' || w.status === 'waiting'));
  const liveCards = todayCards(CV_D, { today, testing: windows.map((w) => w.lever), dismissed, tasks: roomTasks });
  const sc = applyScenario(scenario, CV_D, liveCards);
  const d = sc.d;
  const cards = sc.cards;
  const { view, history, run, busy, remote, offline } = useQueue({ cards, today, own, tz });
  const sum = queueSummary(cards, view);
  const left = cards.filter((c) => isActive(c, view));
  const ready = left.filter((c) => !c.blocked);
  const waiting = left.filter((c) => c.blocked);
  const byId = (id) => cards.find((c) => c.id === id);
  const added = new Set(remote?.changes?.added || []);

  const now = own
    ? { label: longDate(today), time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).toLowerCase() }
    : CV_NOW;
  const period = servicePeriod(clockMinutes(now.time));
  const sv = tonight(d, now);
  const brief = briefing(d, { cards, view, now });
  const res = resultsOf(d, { cards, view });
  const tiles = snapshotTiles({ d, dense: sc.noHistory ? null : dense, sum, sv, flags: sc, res });
  const through = cards[0]?.source?.through || liveCards[0]?.source?.through;

  /** Say it on screen and to a screen reader. */
  const tell = (m) => { cv.toast(m); setSaid(m); };
  const decide = (op, q, opts, msg) => run(op, q, opts).then((r) => { tell(r.ok ? msg : r.error); return r.ok; });
  const findingId = (q) => (q?.id?.startsWith('find:') ? q.id.slice(5) : null);

  const perform = (q) => {
    if (q.blocked) {
      const fix = byId(q.blockedBy);
      if (fix) return perform(fix);
      return tell(q.blocked);
    }
    if (q.approval) return cv.approve(q.approval, () => tell('Approval recorded. The change itself hasn’t been made yet; its steps are under Being handled.'));
    if (q.start) return engine.startWindow(q.start).then((r) => tell(r.ok ? `Test started. Nothing is counted as saved unless it proves out in ${TEST_DAYS} days.` : r.error));
    if (q.task) {
      return engine.createTask(`today:${q.id}`, { title: q.title, system: q.task.system, diff: q.task.diff })
        .then((t) => t && tell(`The ${q.task.system} steps are under Being handled. ${q.task.system} hasn’t been changed; tick it off once it’s made.`));
    }
    if (q.go === 'finding') return cv.go('finding', { id: q.goId });
    if (q.go) return cv.go(q.go, q.input ? { kind: q.input } : undefined);
    return decide('done', q, { summary: `${q.title}: done` }, 'Marked done, with your name and the time.');
  };
  const primaryOf = (q) => () => (q.approval && !q.blocked ? setReview(q.id) : perform(q));
  const decline = (q, reason) => decide('refuse', q, { reason, summary: `${q.title}: not for us` }, `Recommendation dismissed: ${DECLINE[reason].label.toLowerCase()}. It stays away for ${DECLINE[reason].days} days unless it becomes worth much more.`).then((ok) => {
    const id = findingId(q);
    if (ok && id) setDismissed((f) => ({ ...(f || {}), [id]: new Date(Date.now() + DECLINE[reason].days * 864e5).toISOString() }), `${q.title}: not for us`);
    return ok;
  });
  const undo = (id) => {
    const q = byId(id) || { id, title: id };
    return decide('undo', q, { summary: `${q.title}: back on the list` }, 'Back on your list.').then((ok) => {
      const fid = findingId(q);
      if (ok && fid && dismissed?.[fid]) setDismissed((f) => { const n = { ...(f || {}) }; delete n[fid]; return n; }, `${q.title}: back on the list`);
    });
  };
  const reset = () => decide('reset', null, { summary: own ? 'Today’s cards shown again' : 'Queue reset' }, own ? 'Today’s cards are back.' : 'The demo is reset.');
  const close = React.useCallback(() => setReview(null), []);
  const panelActs = (q) => ({
    primary: () => { close(); perform(q); },
    snooze: () => { close(); decide('snooze', q, { summary: `${q.title}: snoozed` }, 'Not now: it comes back tomorrow.'); },
    decline: (r) => { close(); decline(q, r); },
    assign: (to) => { close(); decide('assign', q, { to, summary: `${q.title}: assigned` }, `Assigned to ${assigneeLabel(to, d.profile)}. It’s under Being handled until it’s done.`); },
    done: () => { close(); decide('done', q, { summary: `${q.title}: done` }, 'Marked done, with your name and the time.'); },
    open: q.go === 'finding' ? () => { close(); cv.go('finding', { id: q.goId }); } : q.go && !q.input ? () => { close(); cv.go(q.go); } : undefined,
  });

  const [lead, ...rest] = ready;
  const next = upNextOrder(rest, cards);
  const top = next.slice(0, FIRST_SCREEN - 1);
  const more = next.slice(FIRST_SCREEN - 1);
  const card = (q, i = 1) => (
    <IssueCard key={q.id} q={q} cards={cards} lead={i === 0} n={ready.length} label={actLabel(q, q.blockedBy ? byId(q.blockedBy) : null)} busy={busy === q.id}
      isNew={added.has(q.id)} onPrimary={primaryOf(q)} onReview={() => setReview(q.id)} />
  );
  const reviewing = review ? byId(review) : null;

  const side = layout.widgets.filter((w) => WIDGETS[w]?.zone === 'side');
  const wide = layout.widgets.filter((w) => WIDGETS[w]?.zone === 'wide');
  const widget = (id) => ({
    coming: <ComingUp key={id} d={d} cards={cards} view={view} now={now} onGo={cv.go} />,
    handled: <BeingHandled key={id} cards={cards} view={view} tasks={roomTasks} windows={windows} d={d} busy={busy}
      onUndo={undo} onDone={(c) => decide('done', c, { summary: `${c.title}: done` }, 'Marked done, with your name and the time.')}
      onSteps={() => setStepsOpen(!stepsOpen)} stepsOpen={stepsOpen} />,
    results: <Results key={id} res={res} onOpen={setResOpen} />,
    last: <Yesterday key={id} todayIso={own ? today : CV_NOW.iso} />,
    locations: <Locations key={id} eng={eng} today={today} onPick={(rid) => { setScenario('live'); cv.pickRoom(rid); }} />,
  }[id]);

  return (
    <div className={`cv-page ${s.page}`} data-page="today">
      {tools && <ScenarioBar value={scenario} onPick={setScenario} rooms={(CV_GROUP?.rows || []).map((r) => ({ id: r.id, name: r.name }))} onRoom={cv.pickRoom} />}

      <div className={s.context}>
        {period.label && <span className={s.ctxPeriod}><Icon name="Clock" size={13} />{period.label} · {now.time}</span>}
        {through && <span className={s.ctxData}>Sales data through {shortDay(through)}</span>}
        {offline && <span className={s.ctxWarn} role="status"><Icon name="TriangleAlert" size={13} />Can’t reach the server. Showing the last saved state.</span>}
        <span className={s.ctxEnd}>
          <Button size="sm" variant="ghost" icon="SlidersHorizontal" onClick={() => setCustomizing(true)} aria-haspopup="dialog">Customize</Button>
        </span>
      </div>

      <Briefing brief={brief} added={added.size} onFeeds={() => cv.go('sources')} />
      <Snapshot ids={layout.metrics} tiles={tiles} onGo={(p) => cv.go(p)} />

      <div className={`${s.grid} ${side.length ? '' : s.gridOne}`}>
        <div className={s.mainCol}>
          <section aria-labelledby="att-head" className={s.attention}>
            <div className={s.sectionHead}>
              <h3 id="att-head" className={s.sectionTitle}>Needs your attention</h3>
              <span className={s.sectionSub}>{sum.ready ? `${sum.ready} to decide · about ${sum.minsLeft} min` : sum.blocked ? `${sum.blocked} waiting on data` : 'Nothing right now'}</span>
            </div>
            {lead ? (
              <ul className={s.issues}>
                {card(lead, 0)}
                {top.map((q) => card(q))}
              </ul>
            ) : (
              <div className={s.empty}>
                <Icon name="CircleCheck" size={20} className={s.emptyIcon} />
                <div>
                  <p className={s.emptyHead}>{waiting.length ? 'Nothing you can act on yet.' : 'Everything looks on track. Nothing urgent needs your attention.'}</p>
                  <p className={s.emptySub}>{waiting.length ? 'The decisions below wait on data. Each says what it needs.' : 'New decisions show here as soon as the data calls for one.'}</p>
                </div>
              </div>
            )}
            <MoreIssues rest={lead ? more : []} waiting={waiting} renderCard={(q) => card(q)} />
          </section>
          <Decided cards={cards} view={view} history={history} tz={tz} busy={busy} own={own} onUndo={undo} onReset={reset} />
          {stepsOpen && <TasksPanel />}
        </div>
        {side.length > 0 && <aside className={s.aside} aria-label="Coming up, in progress and results">{side.map(widget)}</aside>}
      </div>

      {wide.map(widget)}

      <p className={s.srOnly} role="status" aria-live="polite">{said}</p>

      {reviewing && (
        <ReviewPanel q={reviewing} cards={cards} history={history} fix={reviewing.blockedBy ? byId(reviewing.blockedBy) : null} busy={busy === reviewing.id}
          label={panelLabel(reviewing, reviewing.blockedBy ? byId(reviewing.blockedBy) : null)} onClose={close} act={panelActs(reviewing)} />
      )}
      {resOpen && <ResultsPanel which={resOpen} res={res} onClose={() => setResOpen(null)} onGo={(p) => { setResOpen(null); cv.go(p); }} />}
      {customizing && <CustomizePanel layout={layout} custom={custom} role={role} onSave={save} onRestore={restore} onClose={() => setCustomizing(false)} />}
    </div>
  );
}

export { CvToday };
