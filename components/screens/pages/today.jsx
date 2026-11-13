'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import {
  applyOp, cardState, DECLINE, DEFAULT_TZ, FIRST_SCREEN, isActive, localDay, queueSummary, queueView, TEST_DAYS, todayCards,
} from '../../../lib/data/page/today';
import { TasksPanel } from '../tasks';
import { useCv, CV_CLAIM, CV_D, CV_ROOM, CV_NOW, Claim, cvMoney } from '../core';
import { useDense, pct } from '../dense-ui';
import s from './today.module.css';

/* ================================================================ Today (work queue)
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
  return out;
}

function useQueue({ cards, today, own, tz }) {
  const eng = useEngine();
  const server = eng.mode === 'server';
  const key = `${eng.org?.id || 'local'}/${CV_D.id}`;
  const [saved, setSaved] = useSaved('queue', null);
  const [remote, setRemote] = React.useState(() => remoteCache.get(key) || null);
  const [busy, setBusy] = React.useState(null);
  const keep = React.useCallback((b) => { remoteCache.set(key, b); setRemote(b); }, [key]);
  // Re-read when the room, or a task's status, changes (an approval on another screen updates the queue here).
  const taskSig = (eng.tasks || []).filter((t) => t.roomId === CV_D.id).map((t) => `${t.approvalId}:${t.status}`).join('|');

  React.useEffect(() => {
    if (!server) return undefined;
    let live = true;
    call(`/api/page/today?room=${encodeURIComponent(CV_D.id)}`).then((b) => { if (live) keep(b); }).catch(() => { /* the saved value from /api/state still shows */ });
    return () => { live = false; };
  }, [server, key, keep, taskSig]);

  const view = server && remote ? remote.state : queueView(saved, { today, own, tz, cards });
  const history = server && remote ? remote.history : localHistory(view);

  /** One decision. Resolves { ok, error? }. */
  const run = async (op, card, { reason, summary } = {}) => {
    let next;
    try {
      next = applyOp(view, { op, cardId: card?.id, reason }, { cards, today, own, tz });
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
      keep(await call('/api/page/today', { method: 'POST', body: JSON.stringify({ roomId: CV_D.id, op, cardId: card?.id, reason }) }));
      return { ok: true };
    } catch (err) {
      setRemote(before);
      return { ok: false, error: `Not saved: ${err.message}` };
    } finally {
      setBusy(null);
    }
  };
  return { view, history, run, busy, remote };
}

const clock = (at, tz) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
const shortDate = (at, tz) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
const whoLabel = (by) => (by?.you ? 'You' : by?.name || 'A guest');
const OP_LABEL = { done: 'Marked done', refuse: 'Turned down', snooze: 'Snoozed', undo: 'Put back on the queue', reset: 'Showed today’s cards again' };

/** "$37 tonight" → big "$37", small "tonight"; a value with no dollar figure stays a short note. */
function Worth({ value, big }) {
  const m = /^(about\s+)?(\$[\d,.]+(?:k)?(?:\/wk)?)(.*)$/i.exec(value || '');
  if (!m) return <span className={s.worthNote}>{value}</span>;
  const rest = m[3].trim();
  return <span className={big ? s.leadFig : s.rowFig}>{m[1] && <span className={s.worthRest}>about </span>}{m[2]}{rest && <span className={s.worthRest}> {rest}</span>}</span>;
}

const dueLabel = (q) => (q.deadline === 'today' ? 'Due today' : q.deadline ? 'Due this week' : null);

function Details({ q, history, tz, fix }) {
  const claim = CV_CLAIM[q.claim] || CV_CLAIM.none;
  const what = q.approval ? 'You’ll see exactly what changes, the limits it stays inside and how to undo it. Approving adds the steps to make it; it isn’t done until it’s made.'
    : q.start ? `Starts a ${TEST_DAYS}-day test that runs on its own. Nothing is counted as saved unless the test proves it.`
      : q.task ? `Adds the steps to make this change in ${q.task.system}. Tick it off when it’s made.`
        : q.go ? 'Opens the screen where this is done.'
          : 'Records that it’s done, with your name and the time.';
  const mine = history.filter((h) => h.cardId === q.id);
  return (
    <dl className={s.details}>
      <dt>Why</dt><dd>{q.body}</dd>
      {q.blocked && <><dt>Waiting on</dt><dd>{fix ? fix.title : q.blocked}</dd></>}
      <dt>Worth</dt><dd>{q.value}, {claim.label.toLowerCase()}. {claim.tip}</dd>
      <dt>If you act</dt><dd>{what}</dd>
      <dt>Source</dt><dd>{q.source.kind === 'toast' ? `Your Toast data through ${q.source.through}` : 'Sample restaurant data'} · {q.why}</dd>
      {mine.length > 0 && <><dt>History</dt><dd>{mine.map((h, i) => <div key={i}>{OP_LABEL[h.op]}{h.reason ? ` (${DECLINE[h.reason]?.label.toLowerCase()})` : ''}, {whoLabel(h.by).toLowerCase() === 'you' ? 'you' : whoLabel(h.by)}{h.at ? `, ${clock(h.at, tz)}` : ''}</div>)}</dd></>}
    </dl>
  );
}

/** The quiet choices: snooze, not for us (with why), already done. */
function Secondary({ q, busy, onSnooze, onDecline, onDone }) {
  const [asking, setAsking] = React.useState(false);
  const canSnooze = !q.critical && q.deadline !== 'today';
  if (asking) {
    return (
      <div className={s.ask} role="group" aria-label="Why isn’t this for you?">
        <span className={s.askQ}>Why not?</span>
        {Object.entries(DECLINE).map(([k, d]) => <button key={k} type="button" className={s.choice} disabled={busy} onClick={() => { setAsking(false); onDecline(k); }}>{d.label}</button>)}
        <button type="button" className={s.textBtn} onClick={() => setAsking(false)}>Cancel</button>
      </div>
    );
  }
  return (
    <div className={s.secondary}>
      {canSnooze && !q.refuse && <button type="button" className={s.textBtn} disabled={busy} onClick={onSnooze}>Snooze to tomorrow</button>}
      {q.refuse && !q.critical && <button type="button" className={s.textBtn} disabled={busy} onClick={() => setAsking(true)}>Not for us</button>}
      {q.go && !q.blocked && <button type="button" className={s.textBtn} disabled={busy} onClick={onDone}>Already done</button>}
    </div>
  );
}

/** The one thing to do first: big, with its value and one button. */
function Lead({ q, busy, fix, history, tz, isNew, actions }) {
  const [open, setOpen] = React.useState(false);
  const due = dueLabel(q);
  const overline = ['Do this first', q.approval && !q.blocked ? 'needs your approval' : null, due?.toLowerCase(), isNew ? 'new' : null].filter(Boolean).join(' · ');
  return (
    <section id={`card-${q.id}`} className={s.lead} aria-labelledby={`q-${q.id}`} aria-busy={busy || undefined}>
      <span className={s.overline}>{overline}</span>
      <h3 id={`q-${q.id}`} className={s.leadTitle}>{q.title}</h3>
      <p className={s.leadWhy}>{q.blocked || q.body}</p>
      <div className={s.leadFoot}>
        <div className={s.leadWorth}>
          <Worth value={q.value} big />
          <span className={s.leadMeta}><Claim k={q.claim} /><span>{q.effort.manager} min of your time</span></span>
        </div>
        <div className={s.leadActs}>
          <Button size="lg" disabled={busy} onClick={actions.primary}>{q.blocked && fix ? `First: ${fix.primary}` : q.primary}</Button>
        </div>
      </div>
      <div className={s.leadBottom}>
        <button type="button" className={s.textBtn} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} /></button>
        <Secondary q={q} busy={busy} onSnooze={actions.snooze} onDecline={actions.decline} onDone={actions.done} />
      </div>
      {open && <Details q={q} history={history} tz={tz} fix={fix} />}
    </section>
  );
}

/** Everything after the first: one quiet row each, details on click. */
function Row({ q, busy, fix, history, tz, isNew, open, onToggle, actions }) {
  return (
    <li id={`card-${q.id}`} className={`${s.item} ${q.blocked ? s.itemBlocked : ''} ${open ? s.itemOpen : ''}`} aria-busy={busy || undefined}>
      <div className={s.rowMain}>
        <button type="button" className={s.rowHit} aria-expanded={open} aria-controls={`d-${q.id}`} onClick={onToggle}>
          {q.blocked && <Icon name="Lock" size={14} className={s.lock} />}
          <span className={s.rowText}>
            <span className={s.rowTitle}>{q.title}{isNew && <span className={s.newTag}>New</span>}</span>
            <span className={s.rowSub}>{q.blocked ? `Waiting on ${fix ? fix.title.toLowerCase() : 'data'}` : [`${q.effort.manager} min`, dueLabel(q)].filter(Boolean).join(' · ')}</span>
          </span>
        </button>
        <span className={s.rowWorth}><Worth value={q.value} /><Claim k={q.claim} /></span>
        <Button size="sm" variant="secondary" disabled={busy} onClick={actions.primary}>{q.blocked && fix ? `First: ${fix.primary}` : q.primary}</Button>
      </div>
      {open && (
        <div id={`d-${q.id}`} className={s.rowMore}>
          <Details q={q} history={history} tz={tz} fix={fix} />
          <Secondary q={q} busy={busy} onSnooze={actions.snooze} onDecline={actions.decline} onDone={actions.done} />
        </div>
      )}
    </li>
  );
}

/** Today's progress as one line: a segment per card, as wide as its minutes. Hover to name it, click to open it. */
function Progress({ cards, view, onPick }) {
  const [tip, setTip] = React.useState(null);
  const cls = (c) => {
    const st = cardState(c, view);
    if (st === 'blocked') return s.pWait;
    if (st === 'ready' || st === 'needs_review') return s.pLeft;
    if (st === 'snoozed' || st === 'declined') return s.pSet;
    return s.pDone;
  };
  const label = (c) => { const st = cardState(c, view); return st === 'ready' || st === 'needs_review' ? 'to do' : (STATE[st]?.label || st).toLowerCase(); };
  return (
    <div className={s.progress}>
      <div className={s.pTrack} onMouseLeave={() => setTip(null)}>
        {cards.map((c) => (
          <button key={c.id} type="button" className={`${s.pSeg} ${cls(c)}`} style={{ flexGrow: Math.max(2, c.effort.manager) }}
            aria-label={`${c.title}: ${label(c)}, ${c.effort.manager} min`}
            onMouseEnter={() => setTip(c)} onFocus={() => setTip(c)} onBlur={() => setTip(null)} onClick={() => onPick(c)} />
        ))}
      </div>
      <span className={s.pTip} aria-live="polite">{tip ? `${tip.title} · ${label(tip)} · ${tip.effort.manager} min` : ' '}</span>
    </div>
  );
}

/** What's been decided, folded into one line until asked for. */
function Decided({ cards, view, history, tz, busy, onUndo, onReset, own }) {
  const [open, setOpen] = React.useState(false);
  const titleOf = (id) => cards.find((c) => c.id === id)?.title
    || (id.startsWith('find:') && CV_D.candidates.find((c) => c.id === id.slice(5))?.title) || id;
  const last = (id, op) => [...history].reverse().find((h) => h.cardId === id && h.op === op);
  const rows = [
    ...cards.filter((c) => c.linked).map((c) => ({ id: c.id, state: cardState(c, view), note: 'Steps are under Approved changes', undo: false })),
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

/** Yesterday in one line, for context; the full day is on Daily detail. Sample rooms only (real rooms have no hourly detail here). */
function Yesterday() {
  const cv = useCv();
  const dense = useDense();
  if (!dense) return null;
  const day = dense.days.at(-1), wk = dense.days.at(-8);
  const up = day.net >= wk.net;
  return (
    <button type="button" className={s.yesterday} onClick={() => cv.go('daily')}>
      <span className={s.yLabel}>{day.dow}</span>
      <span className={s.yFig}>{cvMoney(Math.round(day.net))}</span>
      <span className={up ? s.yUp : s.yDown}>{pct(day.net, wk.net)} vs last {day.dow}</span>
      <span className={s.ySep} />
      <span className={s.yFig}>{day.covers}</span><span className={s.yLabel}>covers</span>
      <Claim k="obs" />
      <span className={s.yGo}>Daily detail<Icon name="ArrowRight" size={13} /></span>
    </button>
  );
}

function CvToday() {
  const cv = useCv();
  const eng = useEngine();
  const tz = CV_D.room.tz || DEFAULT_TZ;
  const today = localDay(Date.now(), tz);
  const own = !!CV_D.room.fromToast;
  const [dismissed, setDismissed] = useSaved('findings', {});
  const [showAll, setShowAll] = React.useState(false);
  const [openId, setOpenId] = React.useState(null);
  const testing = (eng.windows || []).filter((w) => w.roomId === CV_D.id && (w.status === 'running' || w.status === 'waiting')).map((w) => w.lever);
  const cards = todayCards(CV_D, { today, testing, dismissed, tasks: (eng.tasks || []).filter((t) => t.roomId === CV_D.id) });
  const { view, history, run, busy, remote } = useQueue({ cards, today, own, tz });
  const sum = queueSummary(cards, view);
  const left = cards.filter((c) => isActive(c, view));
  const byId = (id) => cards.find((c) => c.id === id);
  const added = new Set(remote?.changes?.added || []);

  const decide = (op, q, opts, toast) => run(op, q, opts).then((r) => { cv.toast(r.ok ? toast : r.error); return r.ok; });
  const findingId = (q) => (q?.id?.startsWith('find:') ? q.id.slice(5) : null);

  const primary = (q) => {
    if (q.blocked) {
      const fix = byId(q.blockedBy);
      if (fix) return primary(fix);
      return cv.toast(q.blocked);
    }
    if (q.approval) return cv.approve(q.approval);
    if (q.start) return engine.startWindow(q.start).then((r) => cv.toast(r.ok ? `Test started. Nothing is counted as saved unless it proves out in ${TEST_DAYS} days.` : r.error));
    if (q.task) {
      return engine.createTask(`today:${q.id}`, { title: q.title, system: q.task.system, diff: q.task.diff })
        .then((t) => t && cv.toast(`Added the steps for ${q.task.system}. Tick it off when it’s made.`));
    }
    if (q.go === 'finding') return cv.go('finding', { id: q.goId });
    if (q.go) return cv.go(q.go, q.input ? { kind: q.input } : undefined);
    return decide('done', q, { summary: `${q.title}: done` }, 'Done. Logged with your name and the time.');
  };
  const decline = (q, reason) => decide('refuse', q, { reason, summary: `${q.title}: not for us` }, `Got it. Hidden for ${DECLINE[reason].days} days unless it becomes worth much more.`).then((ok) => {
    const id = findingId(q);
    if (ok && id) setDismissed((f) => ({ ...(f || {}), [id]: new Date(Date.now() + DECLINE[reason].days * 864e5).toISOString() }), `${q.title}: not for us`);
  });
  const undo = (id) => {
    const q = byId(id) || { id, title: id };
    return decide('undo', q, { summary: `${q.title}: back on the queue` }, 'Back on the list.').then((ok) => {
      const fid = findingId(q);
      if (ok && fid && dismissed?.[fid]) setDismissed((f) => { const n = { ...(f || {}) }; delete n[fid]; return n; }, `${q.title}: back on the queue`);
    });
  };
  const reset = () => decide('reset', null, { summary: own ? 'Today’s cards shown again' : 'Queue reset' }, own ? 'Today’s cards are back.' : 'The demo is reset.');
  const actionsFor = (q) => ({
    primary: () => primary(q),
    done: () => decide('done', q, { summary: `${q.title}: done` }, 'Done. Logged with your name and the time.'),
    snooze: () => decide('snooze', q, { summary: `${q.title}: snoozed` }, 'Snoozed until tomorrow.'),
    decline: (reason) => decline(q, reason),
  });

  const day = own ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }) : CV_NOW.label;
  const checksOk = !CV_D.staleCount && !left.some((c) => c.blocked);
  const [lead, ...rest] = left;
  const shownRest = showAll ? rest : rest.slice(0, FIRST_SCREEN - 1);
  const hiddenRest = rest.length - shownRest.length;
  const pick = (c) => {
    if (!isActive(c, view)) return;
    if (rest.indexOf(c) >= FIRST_SCREEN - 1) setShowAll(true);
    if (c !== lead) setOpenId(c.id);
    setTimeout(() => document.getElementById(`card-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const waitingOn = left.filter((c) => c.blocked).length;

  return (
    <div className={`cv-page ${s.page}`}>
      <header className={s.head}>
        <span className={s.where}>
          {CV_ROOM.name} · {day}
          {!own && <span className={s.sample}>Sample data</span>}
          {CV_D.staleCount > 0 && <button type="button" className={s.stale} onClick={() => cv.go('sources')}>{CV_D.staleCount} feed{CV_D.staleCount === 1 ? '' : 's'} out of date</button>}
        </span>
        {sum.left ? (
          <h2 className={s.answer}>
            <span className={s.answerFig}>{sum.ready}</span> thing{sum.ready === 1 ? '' : 's'} to do,{' '}
            <span className={s.answerFig}>{sum.minsLeft}</span> minutes
          </h2>
        ) : (
          <h2 className={s.answer}>{checksOk ? 'All done for today.' : 'Nothing to decide.'}</h2>
        )}
        {sum.left > 0 && waitingOn > 0 && <span className={s.answerSub}>{waitingOn} more once the data comes in.</span>}
        {!sum.left && !checksOk && <span className={s.answerSub}>But a data feed is out of date, so some numbers can’t be trusted yet. <button type="button" className={s.inlineLink} onClick={() => cv.go('sources')}>Fix it in Sources</button></span>}
        {cards.length > 0 && <Progress cards={cards} view={view} onPick={pick} />}
      </header>

      {lead && <Lead q={lead} busy={busy === lead.id} fix={lead.blockedBy ? byId(lead.blockedBy) : null} history={history} tz={tz} isNew={added.has(lead.id)} actions={actionsFor(lead)} />}

      {rest.length > 0 && (
        <section aria-labelledby="then-head">
          <h3 id="then-head" className={s.sectionLabel}>Then</h3>
          <ul className={s.list}>
            {shownRest.map((q) => (
              <Row key={q.id} q={q} busy={busy === q.id} fix={q.blockedBy ? byId(q.blockedBy) : null} history={history} tz={tz} isNew={added.has(q.id)}
                open={openId === q.id} onToggle={() => setOpenId(openId === q.id ? null : q.id)} actions={actionsFor(q)} />
            ))}
          </ul>
          {rest.length > FIRST_SCREEN - 1 && (
            <button type="button" className={s.moreBtn} aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show less' : `${hiddenRest} more`}<Icon name={showAll ? 'ChevronUp' : 'ChevronDown'} size={14} />
            </button>
          )}
        </section>
      )}

      <TasksPanel />
      <Decided cards={cards} view={view} history={history} tz={tz} busy={busy} own={own} onUndo={undo} onReset={reset} />
      <Yesterday />
    </div>
  );
}

export { CvToday };
