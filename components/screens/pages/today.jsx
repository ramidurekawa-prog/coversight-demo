'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import {
  applyOp, cardState, DECLINE, DEFAULT_TZ, FIRST_SCREEN, isActive, localDay, queueSummary, queueView, TEST_DAYS, todayCards, unlocksOf, upNextOrder, worthOf,
} from '../../../lib/data/page/today';
import { TasksPanel } from '../tasks';
import { useCv, CV_CLAIM, CV_D, CV_NOW, Claim, cvMoney } from '../core';
import { useDense, pct } from '../dense-ui';
import { reportTodayView } from './today.badge';
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
  const keep = React.useCallback((b) => { remoteCache.set(key, b); setRemote(b); reportTodayView(CV_D.id, b.state); }, [key]);
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

const dueLabel = (q) => (q.deadline === 'today' ? 'Due today' : q.deadline ? `Due ${q.deadline}` : null);
/** The button's words. An approval says what it does; a blocked card names its first step. */
const actLabel = (q, fix) => (q.blocked && fix ? `First: ${fix.primary}` : q.approval && q.primary === 'Review' ? 'Review and approve' : q.primary);
/** Two weights below the one filled button: commit (does the thing) and go (opens a screen or a form). */
const isGo = (q) => !!q.input || /^Open\b/.test(q.primary) || !!q.blocked;
/** What this card's dependency line says: what it unblocks, protects or settles. */
const dependency = (q) => (worthOf(q).figure ? null : q.value);

/**
 * The value slot: one dollar figure, its unit and its claim strength, in a
 * fixed right-hand column so rows compare at a glance. A card that unlocks
 * money shows that; a card with no dollars says so.
 */
function Slot({ q, cards }) {
  const w = worthOf(q);
  const un = w.figure ? null : unlocksOf(q, cards);
  if (!w.figure && !un) return <span className={s.slotNone}>No $ impact yet</span>;
  const fig = w.figure || un.figure;
  return (
    <span className={s.slot} title={w.means || 'What this unlocks, on the card waiting for it'}>
      <span className={s.slotFig}>
        {un && <span className={s.slotPre}>Unlocks </span>}
        {w.about && <span className={s.slotPre}>about </span>}
        {fig}
        {(w.unit || un?.unit) && <span className={s.slotUnit}>{(w.unit || un.unit).startsWith('/') ? '' : ' '}{w.unit || un.unit}</span>}
      </span>
      <Claim k={un ? un.claim : q.claim} />
    </span>
  );
}

function Details({ q, history, tz, fix }) {
  const what = q.approval ? 'Review shows what changes, the limits, and how to undo. Nothing happens until you confirm.'
    : q.start ? `Starts a ${TEST_DAYS}-day test that runs on its own. Nothing is counted as saved unless the test proves it.`
      : q.task ? `Adds the steps to make this change in ${q.task.system}. Tick it off when it’s made.`
        : q.go ? 'Opens the screen where this is done.'
          : 'Records that it’s done, with your name and the time.';
  const mine = history.filter((h) => h.cardId === q.id);
  const claim = CV_CLAIM[q.claim];
  return (
    <dl className={s.details}>
      {q.blocked && <><dt>Waiting on</dt><dd>{fix ? fix.title : q.blocked}</dd></>}
      <dt>If you act</dt><dd>{what}</dd>
      {worthOf(q).figure && claim && <><dt>{claim.label}</dt><dd>{claim.tip}</dd></>}
      {q.deadline && <><dt>Due</dt><dd>{q.deadline === 'today' ? 'Today' : q.deadline[0].toUpperCase() + q.deadline.slice(1)}</dd></>}
      <dt>Why now</dt><dd>{q.why}</dd>
      <dt>Source</dt><dd>{q.source.kind === 'toast' ? `Your Toast data through ${q.source.through}` : 'Sample restaurant data'}</dd>
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
  const any = (canSnooze && !q.refuse) || (q.refuse && !q.critical) || (q.go && !q.blocked);
  if (!any) return null;
  return (
    <div className={s.secondary}>
      {canSnooze && !q.refuse && <Button size="sm" variant="secondary" disabled={busy} onClick={onSnooze}>Snooze to tomorrow</Button>}
      {q.refuse && !q.critical && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking(true)}>Not for us</Button>}
      {q.go && !q.blocked && <Button size="sm" variant="secondary" disabled={busy} onClick={onDone}>Already done</Button>}
    </div>
  );
}

/** The one thing to do first: what the money is, the figure, one filled button. */
function Lead({ q, n, busy, history, tz, isNew, actions }) {
  const [open, setOpen] = React.useState(false);
  const due = dueLabel(q);
  const w = worthOf(q);
  return (
    <section id={`card-${q.id}`} className={s.lead} aria-labelledby={`q-${q.id}`} aria-busy={busy || undefined}>
      <div className={s.overline}>
        <span>Do this first{n > 1 ? ` · 1 of ${n}` : ''}</span>
        {q.approval && <span className={s.tag}>Needs your approval</span>}
        {due && <span className={q.deadline === 'today' ? s.dueToday : s.due}>{due}</span>}
        {isNew && <span className={s.tag}>New since this morning</span>}
      </div>
      <div className={s.leadGrid}>
        <div className={s.leadText}>
          <h3 id={`q-${q.id}`} className={s.leadTitle}>{q.title}</h3>
          <p className={s.leadWhy}>{q.body}</p>
          <div className={s.leadBottom}>
            <button type="button" className={s.textBtn} aria-expanded={open} aria-controls={`d-${q.id}`} onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>
            <Secondary q={q} busy={busy} onSnooze={actions.snooze} onDecline={actions.decline} onDone={actions.done} />
          </div>
        </div>
        <div className={s.leadSide}>
          {w.figure ? (
            <span className={s.leadWorth}>
              <span className={s.worthMeans}>{w.means}</span>
              <span className={s.leadFigRow}><span className={s.leadFig}>{w.about && <span className={s.about}>about </span>}{w.figure}</span><Claim k={q.claim} /></span>
            </span>
          ) : <span className={s.worthNote}>{w.note}</span>}
          <Button size="lg" className={s.leadBtn} disabled={busy} onClick={actions.primary}>{actLabel(q, null)}</Button>
          <span className={s.leadMeta}>{q.effort.manager} min of your time</span>
        </div>
      </div>
      {open && <div id={`d-${q.id}`}><Details q={q} history={history} tz={tz} fix={null} /></div>}
    </section>
  );
}

/** One action row: title, its dependency or why, time; the value slot; one button and More. */
function Row({ q, cards, busy, fix, history, tz, isNew, open, onToggle, actions }) {
  const dep = q.blocked ? `Needs: ${fix ? fix.title : 'new data'}` : dependency(q);
  const meta = [`${q.effort.manager} min`, dueLabel(q)].filter(Boolean).join(' · ');
  return (
    <li id={`card-${q.id}`} className={`${s.item} ${q.blocked ? s.itemBlocked : ''} ${open ? s.itemOpen : ''}`} aria-busy={busy || undefined}>
      <div className={s.rowMain}>
        <div className={s.rowText}>
          <span className={s.rowTitle}>{q.blocked && <Icon name="Lock" size={13} className={s.lock} />}{q.title}{isNew && <span className={s.newTag}>New</span>}</span>
          {dep ? <span className={s.rowDep}>{dep}</span> : <span className={s.rowWhy}>{q.body}</span>}
          <span className={s.rowSub}>{q.blocked && <span className={s.srOnly}>Waiting on data. </span>}{meta}</span>
        </div>
        <div className={s.rowWorth}><Slot q={q} cards={cards} /></div>
        <div className={s.rowActs}>
          <Button size="sm" variant="secondary" className={`${s.rowBtn} ${isGo(q) ? '' : s.commit}`} disabled={busy} onClick={actions.primary}>{actLabel(q, fix)}</Button>
          <button type="button" className={s.textBtn} aria-expanded={open} aria-controls={`d-${q.id}`} onClick={onToggle}>
            {open ? 'Less' : 'More'}<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} />
          </button>
        </div>
      </div>
      {open && (
        <div id={`d-${q.id}`} className={s.rowOpen}>
          {dep && <p className={s.rowBody}>{q.body}</p>}
          <Details q={q} history={history} tz={tz} fix={fix} />
          <Secondary q={q} busy={busy} onSnooze={actions.snooze} onDecline={actions.decline} onDone={actions.done} />
        </div>
      )}
    </li>
  );
}

/** Today's list as one line: a segment per card, as wide as its minutes, with the counts that add up to the whole. */
function Progress({ cards, view, sum, onPick }) {
  const [tip, setTip] = React.useState(null);
  const track = React.useRef(null);
  const cls = (c) => {
    const st = cardState(c, view);
    if (st === 'blocked') return s.pWait;
    if (st === 'ready' || st === 'needs_review') return s.pLeft;
    return s.pDone;
  };
  const label = (c) => { const st = cardState(c, view); return st === 'ready' || st === 'needs_review' ? 'To decide' : STATE[st]?.label || st; };
  const show = (c, e) => {
    const box = track.current?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ c, x: box ? r.left - box.left + r.width / 2 : 0, w: box?.width ?? 0 });
  };
  return (
    <div className={s.progress}>
      <div className={s.pTrack} ref={track} onMouseLeave={() => setTip(null)}>
        {cards.map((c) => (
          <button key={c.id} type="button" className={`${s.pSeg} ${cls(c)}`} style={{ flexGrow: Math.max(2, c.effort.manager) }}
            aria-label={`${c.title}: ${label(c).toLowerCase()}, ${c.effort.manager} min`}
            onMouseEnter={(e) => show(c, e)} onFocus={(e) => show(c, e)} onBlur={() => setTip(null)} onClick={() => onPick(c)} />
        ))}
        {tip && (
          <span className={s.pTip} role="tooltip" style={{ left: Math.min(Math.max(tip.x, 110), Math.max(110, tip.w - 110)) }}>
            <b>{tip.c.title}</b>
            <span>{label(tip.c)} · {tip.c.effort.manager} min</span>
          </span>
        )}
      </div>
      <div className={s.pFoot}>
        <span><b>{sum.total}</b> on today’s list</span>
        <span className={s.legend}>
          <span><i className={s.pLeft} /><b>{sum.ready}</b> to decide</span>
          {sum.blocked > 0 && <span><i className={s.pWait} /><b>{sum.blocked}</b> waiting on data</span>}
          {sum.handled > 0 && <span><i className={s.pDone} /><b>{sum.handled}</b> handled</span>}
        </span>
      </div>
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



const shortMoney = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(v)}`);
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const isoMinus = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

/** Width of an element, kept up to date. */
function useWidth() {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Net sales on the last eight of one weekday, as a run chart: a line with
 * points on an axis that fits the data, the range of the seven before as a
 * band (solid edges) and their average as a dashed line, the latest point
 * marked and labelled.
 */
function RunChart({ days, stat, dow }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = React.useState(null);
  const H = 168, P = { l: 48, r: 16, t: 14, b: 26 };
  const vals = days.map((d) => d.net);
  const lo = Math.min(...vals, stat.lo), hi = Math.max(...vals, stat.hi);
  const pad = (hi - lo) * 0.25 || hi * 0.05;
  const step = 10 ** Math.floor(Math.log10(hi - lo + 2 * pad)) / 2;
  const y0 = Math.floor((lo - pad) / step) * step, y1 = Math.ceil((hi + pad) / step) * step;
  const iw = Math.max(1, W - P.l - P.r);
  const x = (i) => P.l + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const ticks = [y0, (y0 + y1) / 2, y1];
  const last = days.length - 1;
  const where = vals[last] > stat.hi ? 'above the range of the 7 before' : vals[last] < stat.lo ? 'below the range of the 7 before' : 'inside the range of the 7 before';
  const label = `Net sales, last ${days.length} ${dow}s, latest ${cvMoney(Math.round(vals[last]))}, ${where}`;
  const shown = hover ?? last;
  return (
    <div ref={ref} className={s.run}>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
          <rect x={P.l} width={iw} y={y(stat.hi)} height={Math.max(1, y(stat.lo) - y(stat.hi))} className={s.runBand} />
          <line x1={P.l} x2={P.l + iw} y1={y(stat.hi)} y2={y(stat.hi)} className={s.runEdge} />
          <line x1={P.l} x2={P.l + iw} y1={y(stat.lo)} y2={y(stat.lo)} className={s.runEdge} />
          <line x1={P.l} x2={P.l + iw} y1={y(stat.avg)} y2={y(stat.avg)} className={s.runAvg} />
          {ticks.map((t) => <text key={t} x={P.l - 8} y={y(t) + 4} textAnchor="end" className={s.runAxis}>{shortMoney(t)}</text>)}
          <line x1={P.l} x2={P.l + iw} y1={H - P.b} y2={H - P.b} className={s.runBase} />
          <polyline points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} className={s.runLine} />
          {days.map((d, i) => (
            <g key={d.iso}>
              <circle cx={x(i)} cy={y(d.net)} r={i === last ? 5.5 : i === hover ? 4.5 : 3.5} className={i === last ? s.runNow : s.runPt} />
              {(W >= 560 || i === last || (i % 2 === 0 && i < last - 1)) && <text x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} className={i === last ? s.runXNow : s.runAxis}>{dayLabel(d.iso)}</text>}
              <rect x={x(i) - iw / (2 * Math.max(1, last))} width={iw / Math.max(1, last)} y={P.t} height={H - P.t - P.b} fill="transparent"
                onMouseEnter={() => setHover(i)} />
            </g>
          ))}
          <text x={Math.min(x(shown), P.l + iw)} y={y(vals[shown]) - 11} textAnchor={shown === last ? 'end' : shown === 0 ? 'start' : 'middle'} className={s.runVal}>{cvMoney(Math.round(vals[shown]))}</text>
          <text x={P.l + 4} y={y(stat.avg) - 6} className={s.runAvgLbl}>avg {shortMoney(stat.avg)}</text>
        </svg>
      )}
    </div>
  );
}

/**
 * The last day of sales against the same weekday in the weeks before: the
 * two numbers, and the run chart. Titled "Yesterday" only when the data's
 * last day is the day before the header's date; otherwise "Last service",
 * with how far the data runs. Colour only marks a figure outside the range of
 * the 7 before. Sample rooms only (real rooms have no daily detail here).
 */
function Yesterday({ todayIso }) {
  const cv = useCv();
  const dense = useDense();
  if (!dense) return null;
  const day = dense.days.at(-1);
  const same = dense.days.filter((d) => d.dow === day.dow).slice(-8);
  if (same.length < 3) return null;
  const prior = same.slice(0, -1);
  const prev = prior.at(-1);
  const stat = (k) => {
    const vals = prior.map((d) => d[k]);
    return { lo: Math.min(...vals), hi: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length };
  };
  const net = stat('net'), cov = stat('covers');
  const tone = (v, st) => (v > st.hi ? s.up : v < st.lo ? s.down : s.flat);
  const isYesterday = day.iso === isoMinus(todayIso, 1);
  const verdict = day.net > net.hi ? `Higher than any of the ${prior.length} ${day.dow}s before`
    : day.net < net.lo ? `Lower than any of the ${prior.length} ${day.dow}s before`
      : `Normal for a ${day.dow}`;
  const vsAvg = (day.net - net.avg) / net.avg;
  return (
    <section className={s.pulse} aria-labelledby="y-head">
      <div className={s.sectionHead}>
        <h3 id="y-head" className={s.sectionTitle}>{isYesterday ? 'Yesterday' : 'Last service'}</h3>
        <span className={s.sectionSub}>{day.dow}, {dayLabel(day.iso)}{isYesterday ? '' : ' · the latest day in your sales data'}</span>
        <span className={s.headEnd}><Claim k="obs" /></span>
      </div>
      <div className={s.pulseBody}>
        <div className={s.kpiCol}>
          <dl className={s.kpis}>
            <div>
              <dt>Net sales</dt>
              <dd><span className={s.kpiFig}>{cvMoney(Math.round(day.net))}</span></dd>
              <dd className={tone(day.net, net)}>{pct(day.net, prev.net)} vs {dayLabel(prev.iso)}</dd>
            </div>
            <div>
              <dt>Covers</dt>
              <dd><span className={s.kpiFig}>{day.covers}</span></dd>
              <dd className={tone(day.covers, cov)}>{pct(day.covers, prev.covers)} vs {dayLabel(prev.iso)}</dd>
            </div>
          </dl>
          <p className={s.verdict}><b>{verdict}.</b> The {prior.length} before ran {shortMoney(net.lo)} to {shortMoney(net.hi)}; this was {Math.abs(vsAvg) < 0.005 ? 'right on' : `${(Math.abs(vsAvg) * 100).toFixed(1)}% ${vsAvg > 0 ? 'above' : 'below'}`} their average.</p>
        </div>
        <figure className={s.chart}>
          <figcaption className={s.chartHead}>Net sales, last {same.length} {day.dow}s</figcaption>
          <RunChart days={same} stat={net} dow={day.dow} />
          <div className={s.chartKey} aria-hidden="true">
            <span><i className={s.keyBand} />Range of the {prior.length} before</span>
            <span><i className={s.keyAvg} />Their average</span>
            <span><i className={s.keyNow} />{isYesterday ? 'Yesterday' : 'Last service'}</span>
          </div>
        </figure>
      </div>
      <button type="button" className={s.textLink} onClick={() => cv.go('daily')}>Every day and hour in Daily detail<Icon name="ArrowRight" size={13} /></button>
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
  const [openId, setOpenId] = React.useState(null);
  const testing = (eng.windows || []).filter((w) => w.roomId === CV_D.id && (w.status === 'running' || w.status === 'waiting')).map((w) => w.lever);
  const cards = todayCards(CV_D, { today, testing, dismissed, tasks: (eng.tasks || []).filter((t) => t.roomId === CV_D.id) });
  const { view, history, run, busy, remote } = useQueue({ cards, today, own, tz });
  const sum = queueSummary(cards, view);
  const left = cards.filter((c) => isActive(c, view));
  const ready = left.filter((c) => !c.blocked);
  const waiting = left.filter((c) => c.blocked);
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

  const checksOk = !CV_D.staleCount && !waiting.length;
  const [lead, ...rest] = ready;
  const next = upNextOrder(rest, cards);
  const LIMIT = FIRST_SCREEN + 1;
  const shownNext = showAll ? next : next.slice(0, LIMIT);
  const pick = (c) => {
    if (!isActive(c, view)) return;
    if (next.indexOf(c) >= LIMIT) setShowAll(true);
    if (c !== lead) setOpenId(c.id);
    setTimeout(() => document.getElementById(`card-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const rowProps = (q) => ({ q, cards, busy: busy === q.id, fix: q.blockedBy ? byId(q.blockedBy) : null, history, tz, isNew: added.has(q.id),
    open: openId === q.id, onToggle: () => setOpenId(openId === q.id ? null : q.id), actions: actionsFor(q) });

  return (
    <div className={`cv-page ${s.page}`} data-page="today">
      <header className={s.head}>
        {sum.ready ? (
          <h2 className={s.answer}>
            {sum.ready} thing{sum.ready === 1 ? '' : 's'} to decide
            <span className={s.answerMins}>about {sum.minsLeft} min of your time</span>
          </h2>
        ) : (
          <h2 className={s.answer}>{!sum.left && checksOk ? 'All done for today.' : 'Nothing to decide right now.'}</h2>
        )}
        {!sum.ready && sum.blocked > 0 && <span className={s.answerSub}>{sum.blocked} more {sum.blocked === 1 ? 'is' : 'are'} waiting on data, below.</span>}
        {cards.length > 0 && <Progress cards={cards} view={view} sum={sum} onPick={pick} />}
      </header>

      {lead && <Lead q={lead} n={ready.length} busy={busy === lead.id} history={history} tz={tz} isNew={added.has(lead.id)} actions={actionsFor(lead)} />}

      {next.length > 0 && (
        <section aria-labelledby="next-head">
          <div className={s.sectionHead}>
            <h3 id="next-head" className={s.sectionTitle}>Up next</h3>
            <span className={s.sectionSub}>{next.length} more to decide, most money first</span>
          </div>
          <ul className={s.list}>{shownNext.map((q) => <Row key={q.id} {...rowProps(q)} />)}</ul>
          {next.length > LIMIT && (
            <button type="button" className={s.moreBtn} aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show ${next.length - LIMIT} more`}<Icon name={showAll ? 'ChevronUp' : 'ChevronDown'} size={14} />
            </button>
          )}
        </section>
      )}

      {waiting.length > 0 && (
        <section aria-labelledby="wait-head">
          <div className={s.sectionHead}>
            <h3 id="wait-head" className={s.sectionTitle}>Waiting on data</h3>
            <span className={s.sectionSub}>{waiting.length === 1 ? 'Can’t be decided until its data arrives' : `${waiting.length} can’t be decided until their data arrives`}</span>
          </div>
          <ul className={s.list}>{waiting.map((q) => <Row key={q.id} {...rowProps(q)} />)}</ul>
        </section>
      )}

      <TasksPanel />
      <Yesterday todayIso={own ? today : CV_NOW.iso} />
      <Decided cards={cards} view={view} history={history} tz={tz} busy={busy} own={own} onUndo={undo} onReset={reset} />
    </div>
  );
}

export { CvToday };
