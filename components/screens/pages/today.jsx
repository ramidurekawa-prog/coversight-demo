'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import {
  applyOp, cardState, DECLINE, DEFAULT_TZ, FIRST_SCREEN, isActive, localDay, queueSummary, queueView, TEST_DAYS, todayCards, worthOf,
} from '../../../lib/data/page/today';
import { TasksPanel } from '../tasks';
import { useCv, CV_CLAIM, CV_D, Claim, cvMoney } from '../core';
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

const dueLabel = (q) => (q.deadline === 'today' ? 'Due today' : q.deadline ? 'Due this week' : null);
const actLabel = (q, fix) => (q.blocked && fix ? `First: ${fix.primary}` : q.primary);

/** What a card is worth, in words: the money and what it is, with its claim strength. A value that isn't money stays a short note. */
function Worth({ q, big }) {
  const w = worthOf(q);
  if (!w.figure) return <span className={s.worthNote}>{w.note}</span>;
  return (
    <span className={big ? s.worthBig : s.worth}>
      <span className={s.worthMeans}>{w.means}</span>
      <span className={big ? s.leadFig : s.rowFig}>{w.about && <span className={s.about}>about </span>}{w.figure}</span>
      <Claim k={q.claim} />
    </span>
  );
}

function Details({ q, history, tz, fix }) {
  const claim = CV_CLAIM[q.claim] || CV_CLAIM.none;
  const w = worthOf(q);
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
      <dt>{w.figure ? 'The money' : 'Why it matters'}</dt>
      <dd>{w.figure ? <>{q.value}: {w.means.toLowerCase()}. {claim.label}: {claim.tip}</> : w.note}</dd>
      <dt>If you act</dt><dd>{what}</dd>
      <dt>Source</dt><dd>{q.source.kind === 'toast' ? `Your Toast data through ${q.source.through}` : 'Sample restaurant data'}. {q.why}</dd>
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

/** The one thing to do first: its money and what that money is, one button. */
function Lead({ q, n, busy, fix, history, tz, isNew, actions }) {
  const [open, setOpen] = React.useState(false);
  const due = dueLabel(q);
  return (
    <section id={`card-${q.id}`} className={s.lead} aria-labelledby={`q-${q.id}`} aria-busy={busy || undefined}>
      <div className={s.overline}>
        <span>Do this first{n > 1 ? ` · 1 of ${n}` : ''}</span>
        {q.approval && <span className={s.tag}>Needs your approval</span>}
        {due && <span className={q.deadline === 'today' ? s.dueToday : s.due}>{due}</span>}
        {isNew && <span className={s.tag}>New since this morning</span>}
      </div>
      <h3 id={`q-${q.id}`} className={s.leadTitle}>{q.title}</h3>
      <p className={s.leadWhy}>{q.body}</p>
      <div className={s.leadFoot}>
        <div className={s.leadWorth}>
          <Worth q={q} big />
          <span className={s.leadMeta}>{q.effort.manager} min of your time</span>
        </div>
        <Button size="lg" className={s.leadBtn} disabled={busy} onClick={actions.primary}>{actLabel(q, fix)}</Button>
      </div>
      <div className={s.leadBottom}>
        <button type="button" className={s.detailsBtn} aria-expanded={open} aria-controls={`d-${q.id}`} onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details'}<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>
        <Secondary q={q} busy={busy} onSnooze={actions.snooze} onDecline={actions.decline} onDone={actions.done} />
      </div>
      {open && <div id={`d-${q.id}`}><Details q={q} history={history} tz={tz} fix={fix} /></div>}
    </section>
  );
}

/** One action row: what, why, how long; what it's worth; one button. Details open in place. */
function Row({ q, busy, fix, history, tz, isNew, open, onToggle, actions }) {
  const meta = q.blocked ? [`Needs: ${fix ? fix.title : 'new data'}`] : [`${q.effort.manager} min`, dueLabel(q)].filter(Boolean);
  return (
    <li id={`card-${q.id}`} className={`${s.item} ${q.blocked ? s.itemBlocked : ''} ${open ? s.itemOpen : ''}`} aria-busy={busy || undefined}>
      <div className={s.rowMain}>
        <div className={s.rowText}>
          <span className={s.rowTitle}>{q.blocked && <Icon name="Lock" size={13} className={s.lock} aria-label="Waiting on data" />}{q.title}{isNew && <span className={s.newTag}>New</span>}</span>
          <span className={s.rowWhy}>{q.body}</span>
          <span className={s.rowSub}>{meta.join(' · ')}</span>
        </div>
        <div className={s.rowWorth}><Worth q={q} /></div>
        <div className={s.rowActs}>
          <Button size="sm" variant="secondary" className={s.rowBtn} disabled={busy} onClick={actions.primary}>{actLabel(q, fix)}</Button>
          <button type="button" className={s.rowMore} aria-expanded={open} aria-controls={`d-${q.id}`} onClick={onToggle}>
            {open ? 'Less' : 'More'}<Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} />
          </button>
        </div>
      </div>
      {open && (
        <div id={`d-${q.id}`} className={s.rowOpen}>
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
  const cls = (c) => {
    const st = cardState(c, view);
    if (st === 'blocked') return s.pWait;
    if (st === 'ready' || st === 'needs_review') return s.pLeft;
    return s.pDone;
  };
  const label = (c) => { const st = cardState(c, view); return st === 'ready' || st === 'needs_review' ? 'to decide' : (STATE[st]?.label || st).toLowerCase(); };
  return (
    <div className={s.progress}>
      <div className={s.pTrack} onMouseLeave={() => setTip(null)}>
        {cards.map((c) => (
          <button key={c.id} type="button" className={`${s.pSeg} ${cls(c)}`} style={{ flexGrow: Math.max(2, c.effort.manager) }}
            aria-label={`${c.title}: ${label(c)}, ${c.effort.manager} min`}
            onMouseEnter={() => setTip(c)} onFocus={() => setTip(c)} onBlur={() => setTip(null)} onClick={() => onPick(c)} />
        ))}
      </div>
      <div className={s.pFoot} aria-live="polite">
        {tip ? <span>{tip.title} · {label(tip)} · {tip.effort.manager} min</span> : (
          <>
            <span><b>{sum.total}</b> on today’s list</span>
            <span className={s.legend}>
              <span><i className={s.pLeft} /><b>{sum.ready}</b> to decide</span>
              {sum.blocked > 0 && <span><i className={s.pWait} /><b>{sum.blocked}</b> waiting on data</span>}
              <span><i className={s.pDone} /><b>{sum.handled}</b> handled</span>
            </span>
          </>
        )}
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


const niceMax = (v) => {
  const raw = v * 1.08;
  const step = 10 ** Math.floor(Math.log10(raw)) / 2;
  return Math.ceil(raw / step) * step;
};
const shortMoney = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `$${Math.round(v)}`);
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Yesterday's sales against the same weekday in the weeks before: the two
 * numbers, and the last eight of that weekday on a labelled chart with the
 * range and average of the seven before it. Colour only marks a day outside
 * that range. Sample rooms only (real rooms have no daily detail here).
 */
function Yesterday() {
  const cv = useCv();
  const dense = useDense();
  const [hover, setHover] = React.useState(null);
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
  const top = niceMax(Math.max(...same.map((d) => d.net)));
  const y = (v) => `${(v / top) * 100}%`;
  const verdict = day.net > net.hi ? `Higher than any of the ${prior.length} ${day.dow}s before`
    : day.net < net.lo ? `Lower than any of the ${prior.length} ${day.dow}s before`
      : `Normal for a ${day.dow}: inside the range of the ${prior.length} before`;
  const vsAvg = (day.net - net.avg) / net.avg;
  const shown = hover == null ? null : same[hover];
  return (
    <section className={s.pulse} aria-labelledby="y-head">
      <div className={s.sectionHead}>
        <h3 id="y-head" className={s.sectionTitle}>Yesterday</h3>
        <span className={s.sectionSub}>{day.dow}, {dayLabel(day.iso)}</span>
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
          <p className={s.verdict}><b>{verdict}.</b> {Math.abs(vsAvg) < 0.005 ? 'Right on' : `${(Math.abs(vsAvg) * 100).toFixed(1)}% ${vsAvg > 0 ? 'above' : 'below'}`} their average of {cvMoney(Math.round(net.avg))}.</p>
        </div>
        <figure className={s.chart}>
          <figcaption className={s.chartHead}>
            <span>Net sales, last {same.length} {day.dow}s</span>
            <span className={s.chartTip} aria-live="polite">{shown ? `${dayLabel(shown.iso)}: ${cvMoney(Math.round(shown.net))}` : ''}</span>
          </figcaption>
          <div className={s.plotWrap}>
            <div className={s.axis} aria-hidden="true">
              <span style={{ bottom: '100%' }}>{shortMoney(top)}</span>
              <span style={{ bottom: '50%' }}>{shortMoney(top / 2)}</span>
              <span style={{ bottom: 0 }}>$0</span>
            </div>
            <div className={s.plot} onMouseLeave={() => setHover(null)}>
              <span className={s.grid} style={{ bottom: '100%' }} />
              <span className={s.grid} style={{ bottom: '50%' }} />
              <span className={s.band} style={{ bottom: y(net.lo), height: `calc(${y(net.hi)} - ${y(net.lo)})` }} title={`Range of the ${prior.length} ${day.dow}s before: ${cvMoney(Math.round(net.lo))} to ${cvMoney(Math.round(net.hi))}`} />
              <span className={s.avg} style={{ bottom: y(net.avg) }}><em>avg {shortMoney(net.avg)}</em></span>
              {same.map((d, i) => {
                const last = i === same.length - 1;
                return (
                  <button key={d.iso} type="button" className={`${s.col} ${hover === i ? s.colOn : ''}`}
                    aria-label={`${dayLabel(d.iso)}: ${cvMoney(Math.round(d.net))} net sales`}
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                    <span className={`${s.bar} ${last ? s.barNow : ''}`} style={{ height: y(d.net) }}>
                      {last && <span className={s.barVal}>{shortMoney(d.net)}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <span />
            <div className={s.xLabels} aria-hidden="true">
              {same.map((d, i) => <span key={d.iso} className={i === same.length - 1 ? s.xNow : undefined}>{i === same.length - 1 ? 'Yest.' : dayLabel(d.iso)}</span>)}
            </div>
          </div>
          <div className={s.chartKey} aria-hidden="true">
            <span><i className={s.keyBand} />Range of the {prior.length} before</span>
            <span><i className={s.keyAvg} />Their average</span>
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
  const [lead, ...next] = ready;
  const LIMIT = FIRST_SCREEN + 1;
  const shownNext = showAll ? next : next.slice(0, LIMIT);
  const pick = (c) => {
    if (!isActive(c, view)) return;
    if (next.indexOf(c) >= LIMIT) setShowAll(true);
    if (c !== lead) setOpenId(c.id);
    setTimeout(() => document.getElementById(`card-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const rowProps = (q) => ({ q, busy: busy === q.id, fix: q.blockedBy ? byId(q.blockedBy) : null, history, tz, isNew: added.has(q.id),
    open: openId === q.id, onToggle: () => setOpenId(openId === q.id ? null : q.id), actions: actionsFor(q) });

  return (
    <div className={`cv-page ${s.page}`}>
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

      {lead && <Lead q={lead} n={ready.length} busy={busy === lead.id} fix={null} history={history} tz={tz} isNew={added.has(lead.id)} actions={actionsFor(lead)} />}

      {next.length > 0 && (
        <section aria-labelledby="next-head">
          <div className={s.sectionHead}>
            <h3 id="next-head" className={s.sectionTitle}>Up next</h3>
            <span className={s.sectionSub}>{next.length} more to decide, in order</span>
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
      <Yesterday />
      <Decided cards={cards} view={view} history={history} tz={tz} busy={busy} own={own} onUndo={undo} onReset={reset} />
    </div>
  );
}

export { CvToday };
