'use client';

import * as React from 'react';

import { Icon, Button, Tabs } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import {
  applyOp, cardState, DECLINE, DEFAULT_TZ, FIRST_SCREEN, isActive, localDay, queueSummary, queueView, RANK_POLICY, TEST_DAYS, todayCards,
} from '../../../lib/data/page/today';
import { TasksPanel } from '../tasks';
import { useCv, CV_CLAIM, CV_D, CV_ROOM, CV_NOW, Claim, PageHead, Pill } from '../core';
import { DenseToday } from '../dense-sections';
import s from './today.module.css';

/* ================================================================ Today (work queue)
 * What needs the manager now, in the order to do it. Cards and their rules
 * come from lib/data/page/today.js, shared with the server. Signed in, each
 * decision goes to /api/page/today, which checks it against the room's queue
 * for the day and merges it; approvals and prepared changes become guided
 * tasks (the same record Service and Meeting create), shown under "Approved
 * changes to make". With no server it's saved in this browser by the same rules. */

const KIND = { decide: 'Decision', data: 'Keep the numbers right', test: 'Start a test' };
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

function StatePill({ state }) {
  const st = STATE[state];
  return st ? <Pill tone={st.tone} icon={st.icon}>{st.label}</Pill> : null;
}

function Details({ q, history, tz, fix }) {
  const claim = CV_CLAIM[q.claim] || CV_CLAIM.none;
  const what = q.approval ? 'Opens the approval: exactly what changes, the fence, what would stop it, and how to undo it. Approving adds the steps under “Approved changes to make”; it isn’t done until the change is made.'
    : q.start ? `Starts a ${TEST_DAYS}-day test. The baseline is frozen and each new week of data is a checkpoint; nothing is booked unless the test verifies. No manager time while it runs.`
      : q.task ? `Adds step-by-step instructions to make the change in ${q.task.system}, under “Approved changes to make”. Tick it off when it’s made.`
        : q.go ? 'Opens the screen where this is done. Mark it done here once it is.'
          : 'Records that it’s done, with your name and the time.';
  const mine = history.filter((h) => h.cardId === q.id);
  return (
    <dl className={s.details}>
      <dt>Why it’s here</dt><dd>{q.body} <span className="cv-faint">{q.why}</span></dd>
      <dt>What it’s worth</dt><dd><Claim k={q.claim} /> <span className="cv-num">{q.value}</span>. {claim.tip}{q.worth ? ' It’s a potential figure until a test verifies it.' : ''}</dd>
      <dt>Evidence</dt><dd>{q.source.kind === 'toast' ? `Your Toast data through ${q.source.through}.` : 'Sample restaurant data, not a real restaurant.'}</dd>
      {q.blocked && <><dt>Waiting on</dt><dd>{q.blocked}{fix ? ` Do “${fix.title}” first.` : ''}</dd></>}
      <dt>What happens when you act</dt><dd>{what}</dd>
      <dt>Your time</dt><dd>About {q.effort.manager} min of your time{q.effort.waitDays ? `, then ${q.effort.waitDays} days of measuring in the background` : ''}.</dd>
      {mine.length > 0 && <><dt>History</dt><dd>{mine.map((h, i) => <div key={i}>{OP_LABEL[h.op]}{h.reason ? ` (${DECLINE[h.reason]?.label.toLowerCase()})` : ''} · {whoLabel(h.by)}{h.at ? ` · ${clock(h.at, tz)}` : ''}</div>)}</dd></>}
    </dl>
  );
}

function QueueCard({ q, lead, state, busy, isNew, fix, history, tz, onPrimary, onDone, onSnooze, onDecline }) {
  const [open, setOpen] = React.useState(false);
  const [declining, setDeclining] = React.useState(false);
  const canSnooze = !q.critical && q.deadline !== 'today';
  return (
    <article id={`card-${q.id}`} className={`cv-q-card ${lead ? s.next : ''} ${q.blocked ? s.blocked : ''}`} aria-labelledby={`q-${q.id}`} aria-busy={busy || undefined}>
      <span className={`cv-q-ico ${q.tone}`}><Icon name={q.blocked ? 'Lock' : q.icon} size={18} /></span>
      <div className="cv-col" style={{ gap: 6, minWidth: 0 }}>
        <div className={s.tags}>
          {lead ? <span className={s.nextTag}><Icon name="ArrowRight" size={12} />Do this first</span> : <span className={s.kind}>{KIND[q.kind]}</span>}
          {isNew && <span className={s.newTag}>New</span>}
        </div>
        <span id={`q-${q.id}`} className={lead ? s.leadTitle : s.title}>{q.title}</span>
        <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{q.blocked ? q.blocked : q.body}</span>
        <div className={s.meta}>
          <Claim k={q.claim} />
          <span className={s.value}>{q.value}</span>
          <span className={s.mins}><Icon name="Clock" size={12} />{q.effort.manager} min of your time</span>
          {q.deadline && <Pill tone="warn" icon="CalendarClock">{q.deadline === 'today' ? 'Due today' : `Due ${q.deadline}`}</Pill>}
          <StatePill state={state} />
        </div>
        <button type="button" className={s.more} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} />{open ? 'Hide details' : 'Why, evidence and what happens next'}</button>
        {declining && (
          <div className={s.decline} role="group" aria-label="Why isn’t this for you?">
            <span className="cv-xs cv-muted">Why isn’t this for you?</span>
            <div className="cv-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(DECLINE).map(([k, d]) => <Button key={k} size="sm" variant="secondary" disabled={busy} onClick={() => { setDeclining(false); onDecline(k); }}>{d.label}</Button>)}
              <Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {open && <Details q={q} history={history} tz={tz} fix={fix} />}
      </div>
      <div className="cv-q-acts">
        {q.refuse && !q.critical && <Button variant="ghost" size="sm" disabled={busy} aria-expanded={declining} onClick={() => setDeclining(!declining)}>Not for us</Button>}
        {!q.refuse && canSnooze && <Button variant="ghost" size="sm" disabled={busy} onClick={onSnooze}>Snooze</Button>}
        {q.go && !q.blocked && <Button variant="ghost" size="sm" icon="Check" disabled={busy} onClick={onDone}>Mark done</Button>}
        <Button size="sm" variant={lead ? 'primary' : 'secondary'} disabled={busy} onClick={onPrimary}>{q.blocked && fix ? `First: ${fix.primary}` : q.primary}</Button>
      </div>
    </article>
  );
}

function OffQueue({ cards, view, history, tz, busy, onUndo, onReset, own }) {
  const titleOf = (id) => cards.find((c) => c.id === id)?.title
    || (id.startsWith('find:') && CV_D.candidates.find((c) => c.id === id.slice(5))?.title) || id;
  const last = (id, op) => [...history].reverse().find((h) => h.cardId === id && h.op === op);
  const linked = cards.filter((c) => c.linked).map((c) => ({ id: c.id, state: cardState(c, view), note: 'Steps under “Approved changes to make”', undo: false }));
  const groups = {
    done: [
      ...linked,
      ...Object.keys(view.done).map((id) => ({ id, state: 'completed', note: `${whoLabel(last(id, 'done')?.by)} · ${clock(view.done[id], tz)}`, undo: true })),
    ],
    snoozed: Object.keys(view.snoozed).map((id) => ({ id, state: 'snoozed', note: `${whoLabel(last(id, 'snooze')?.by)} · back ${view.snoozed[id] <= localDay(Date.now() + 864e5, tz) ? 'tomorrow' : shortDate(`${view.snoozed[id]}T12:00:00Z`, 'UTC')}`, undo: true })),
    refused: Object.keys(view.refused).map((id) => {
      const m = view.meta?.[id] || {};
      const days = DECLINE[m.reason]?.days ?? 90;
      return { id, state: 'declined', note: `${whoLabel(last(id, 'refuse')?.by)}${m.reason ? `: ${DECLINE[m.reason].label.toLowerCase()}` : ''} · ${shortDate(view.refused[id], tz)}. Comes back after ${shortDate(Date.parse(view.refused[id]) + days * 864e5, tz)}, or sooner if it’s worth half as much again.`, undo: true };
    }),
  };
  const first = Object.keys(groups).find((k) => groups[k].length) || 'done';
  const [tab, setTab] = React.useState(first);
  const total = groups.done.length + groups.snoozed.length + groups.refused.length;
  if (!total) return null;
  const shown = groups[tab].length ? tab : first;
  return (
    <section className="cv-card" aria-labelledby="off-head">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="off-head">Off the queue</span>
          <span className="cv-small cv-muted">What’s been decided {own ? 'today' : ''}, and by whom. Done, snoozed and turned-down cards can go back on the queue; an approval is undone by cancelling its steps.</span>
        </div>
        <Button size="sm" variant="ghost" icon="RotateCcw" disabled={!!busy} onClick={onReset}>{own ? 'Show today’s cards again' : 'Reset the demo'}</Button>
      </div>
      <Tabs value={shown} onChange={setTab} tabs={[
        { value: 'done', label: own ? 'Done today' : 'Done', count: groups.done.length },
        { value: 'snoozed', label: 'Snoozed', count: groups.snoozed.length },
        { value: 'refused', label: 'Not for us', count: groups.refused.length },
      ]} />
      <div className={s.list} role="tabpanel">
        {groups[shown].map((r) => (
          <div key={r.id} className={s.row}>
            <span className={`cv-q-ico ${STATE[r.state].tone === 'neutral' ? '' : STATE[r.state].tone} ${s.rowIco}`}><Icon name={STATE[r.state].icon} size={15} /></span>
            <div className="cv-col" style={{ gap: 2, minWidth: 0 }}>
              <span className="cv-small" style={{ fontWeight: 600 }}>{titleOf(r.id)}</span>
              <span className="cv-xs cv-faint">{STATE[r.state].label} · {r.note}</span>
            </div>
            {r.undo ? <Button size="sm" variant="ghost" icon="Undo2" disabled={busy === r.id} onClick={() => onUndo(r.id)}>{shown === 'done' ? 'Undo' : 'Bring back'}</Button> : <span />}
          </div>
        ))}
      </div>
    </section>
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
    if (q.start) return engine.startWindow(q.start).then((r) => cv.toast(r.ok ? `Test started. It’s on Test windows; nothing is booked unless it verifies after ${TEST_DAYS} days.` : r.error));
    if (q.task) {
      return engine.createTask(`today:${q.id}`, { title: q.title, system: q.task.system, diff: q.task.diff })
        .then((t) => t && cv.toast(`The steps to do it in ${q.task.system} are under “Approved changes to make”. Tick it off when it’s made.`));
    }
    if (q.go === 'finding') return cv.go('finding', { id: q.goId });
    if (q.go) return cv.go(q.go, q.input ? { kind: q.input } : undefined);
    return decide('done', q, { summary: `${q.title}: done` }, 'Done. Logged with your name and the time.');
  };
  const decline = (q, reason) => decide('refuse', q, { reason, summary: `${q.title}: not for us` }, `Noted. We won’t suggest this again for ${DECLINE[reason].days} days, unless it becomes worth much more.`).then((ok) => {
    const id = findingId(q);
    if (ok && id) setDismissed((f) => ({ ...(f || {}), [id]: new Date(Date.now() + DECLINE[reason].days * 864e5).toISOString() }), `${q.title}: not for us`);
  });
  const undo = (id) => {
    const q = byId(id) || { id, title: id };
    return decide('undo', q, { summary: `${q.title}: back on the queue` }, 'Back on the queue.').then((ok) => {
      const fid = findingId(q);
      if (ok && fid && dismissed?.[fid]) setDismissed((f) => { const n = { ...(f || {}) }; delete n[fid]; return n; }, `${q.title}: back on the queue`);
    });
  };
  const reset = () => decide('reset', null, { summary: own ? 'Today’s cards shown again' : 'Queue reset' }, own ? 'Today’s cards are back.' : 'The demo queue is reset.');

  const day = own ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }) : CV_NOW.label;
  const checksOk = !CV_D.staleCount && !left.some((c) => c.blocked);
  const head = sum.left ? 'Here’s what needs you today' : checksOk ? 'Everything important is handled' : 'Nothing to decide, but some data needs attention';
  const visible = showAll ? left : left.slice(0, FIRST_SCREEN);
  const hidden = left.length - visible.length;
  const pct = (n) => `${sum.total ? (n / sum.total) * 100 : 0}%`;
  return (
    <div className="cv-page" style={{ maxWidth: 880 }}>
      <PageHead over={`${CV_ROOM.name} · ${day}`} q={head}
        sub={sum.left
          ? `${sum.ready} thing${sum.ready === 1 ? '' : 's'} to do, about ${sum.minsLeft} minutes of your time${sum.blocked ? `, and ${sum.blocked} waiting on data` : ''}. In the order to do them.`
          : checksOk ? 'Every card is decided and the data checks passed. Tomorrow’s queue is built from the latest data.' : 'The queue is clear, but a data feed is stale, so some findings can’t be trusted until it’s fixed.'} />

      <div className={s.context} aria-label="Where this queue comes from">
        {own ? <span><Icon name="Database" size={13} />Toast data through {remote?.dataThrough || CV_D.room.fromToast.end}</span>
          : <span><Icon name="FlaskConical" size={13} />Sample restaurant · not real data</span>}
        {remote?.changes?.builtAt && <span><Icon name="Clock" size={13} />Queue built {clock(remote.changes.builtAt, tz)}{remote.changes.added.length ? `, ${remote.changes.added.length} new since` : ''}{remote.changes.gone.length ? `, ${remote.changes.gone.length} cleared by new data` : ''}</span>}
        {CV_D.staleCount > 0 && <button type="button" className={s.ctxLink} onClick={() => cv.go('sources')}><Icon name="TriangleAlert" size={13} />{CV_D.staleCount} feed{CV_D.staleCount === 1 ? '' : 's'} stale</button>}
        <span title={RANK_POLICY.map(([, l], i) => `${i + 1}. ${l}`).join('\n')}><Icon name="ListChecks" size={13} />Ranked by urgency, then value</span>
      </div>

      <section className="cv-card" aria-label="Today’s progress">
        <div className={s.summary}>
          <div className={s.figure}><span className={s.label}>To do</span><span className="cv-fig md cv-num">{sum.ready}{sum.blocked ? <span className="cv-small cv-faint"> +{sum.blocked} waiting</span> : null}</span></div>
          <div className={s.figure}><span className={s.label}>Your time</span><span className="cv-fig md cv-num">{sum.minsLeft}<span className="cv-small cv-faint"> min</span></span></div>
          <div className={s.figure}><span className={s.label}>{own ? 'Decided today' : 'Decided'}</span><span className="cv-fig md cv-num">{sum.cleared + sum.snoozed + sum.refused}<span className="cv-small cv-faint"> of {sum.total}</span></span></div>
        </div>
        <div className={s.bar} role="img" aria-label={`${sum.cleared} done or approved, ${sum.snoozed} snoozed, ${sum.refused} turned down, ${sum.left} left`}>
          <span className={s.done} style={{ width: pct(sum.cleared) }} />
          <span className={s.snoozed} style={{ width: pct(sum.snoozed) }} />
          <span className={s.refused} style={{ width: pct(sum.refused) }} />
        </div>
      </section>

      {left.length === 0 ? (
        <div className="cv-empty">
          <span className="ico"><Icon name={checksOk ? 'Check' : 'TriangleAlert'} size={22} /></span>
          <span className="cv-h3">{checksOk ? 'Queue clear' : 'Queue clear, data needs a look'}</span>
          <span className="cv-small cv-muted" style={{ maxWidth: 400 }}>{checksOk ? 'Nothing else needs you today.' : 'Open Sources to see which feed is stale and how to fix it.'}</span>
          {!checksOk && <Button size="sm" variant="secondary" onClick={() => cv.go('sources')}>Open Sources</Button>}
        </div>
      ) : (
        <div className="cv-col" style={{ gap: 10 }}>
          {visible.map((q, i) => (
            <QueueCard key={q.id} q={q} lead={i === 0} state={cardState(q, view)} busy={busy === q.id} isNew={added.has(q.id)} fix={q.blockedBy ? byId(q.blockedBy) : null} history={history} tz={tz}
              onPrimary={() => primary(q)}
              onDone={() => decide('done', q, { summary: `${q.title}: done` }, 'Done. Logged with your name and the time.')}
              onSnooze={() => decide('snooze', q, { summary: `${q.title}: snoozed` }, 'Snoozed. It’s back on tomorrow’s queue.')}
              onDecline={(reason) => decline(q, reason)} />
          ))}
          {(hidden > 0 || showAll) && left.length > FIRST_SCREEN && (
            <Button variant="secondary" icon={showAll ? 'ChevronUp' : 'ChevronDown'} aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show the first three only' : `View remaining ${hidden} (${left.slice(FIRST_SCREEN).filter((c) => !c.blocked).reduce((m, c) => m + c.effort.manager, 0)} min${left.slice(FIRST_SCREEN).some((c) => c.blocked) ? ', some waiting on data' : ''})`}
            </Button>
          )}
        </div>
      )}

      <TasksPanel />
      <OffQueue cards={cards} view={view} history={history} tz={tz} busy={busy} own={own} onUndo={undo} onReset={reset} />
      <DenseToday />
    </div>
  );
}

export { CvToday };
