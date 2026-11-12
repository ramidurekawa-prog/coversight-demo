'use client';

import * as React from 'react';

import { Icon, Button, Tabs } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { dataEnd as roomDataEnd } from '../../../lib/data/readers';
import { applyOp, DEFAULT_TZ, isOut, localDay, queueSummary, queueView, REFUSE_DAYS, todayCards } from '../../../lib/data/page/today';
import { TasksPanel } from '../tasks';
import { useCv, CV_D, CV_ROOM, CV_NOW, Claim, PageHead, Pill } from '../core';
import { DenseToday } from '../dense-sections';
import s from './today.module.css';

/* ================================================================ Today (work queue)
 * One decision per card, in the order to do them. Signed in, every decision
 * goes to /api/page/today, which checks the card against the room's queue for
 * the day and merges it into the latest saved value, so two managers clearing
 * different cards at once both stick. With no server it's saved in this
 * browser by the same rules (lib/data/page/today.js). */

const KIND = { decide: 'Decision', data: 'Keep the numbers right', test: 'Start a test' };
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
  for (const [id, at] of Object.entries(view.refused)) out.push({ cardId: id, op: 'refuse', at, by: { you: true } });
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

  React.useEffect(() => {
    if (!server) return undefined;
    let live = true;
    call(`/api/page/today?room=${encodeURIComponent(CV_D.id)}`).then((b) => { if (live) keep(b); }).catch(() => { /* the saved value from /api/state still shows */ });
    return () => { live = false; };
  }, [server, key, keep]);

  const ctx = { cards, today, own, tz };
  const view = server && remote ? remote.state : queueView(saved, { today, own, tz });
  const history = server && remote ? remote.history : localHistory(view);

  /** One decision. Resolves true when it's saved. */
  const run = async (op, card, summary) => {
    let next;
    try {
      next = applyOp(view, { op, cardId: card?.id }, ctx);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    if (!server) {
      setSaved(next, summary);
      return { ok: true };
    }
    const before = remote;
    setRemote({ ...(remote || { history: [] }), state: queueView(next, { today, own, tz }) });
    setBusy(card?.id || 'reset');
    try {
      keep(await call('/api/page/today', { method: 'POST', body: JSON.stringify({ roomId: CV_D.id, op, cardId: card?.id }) }));
      return { ok: true };
    } catch (err) {
      setRemote(before);
      return { ok: false, error: `Not saved: ${err.message}` };
    } finally {
      setBusy(null);
    }
  };
  return { view, history, run, busy, server };
}

const clock = (at, tz) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
const shortDate = (at, tz) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
const whoLabel = (by) => (by?.you ? 'You' : by?.name || 'A guest');

function CardMeta({ q }) {
  return (
    <div className={s.meta}>
      <Claim k={q.claim} />
      <span className={s.value}>{q.value}</span>
      <span className={s.mins}><Icon name="Clock" size={12} />{q.mins} min</span>
    </div>
  );
}

function QueueCard({ q, next, busy, onPrimary, onDone, onSnooze, onRefuse }) {
  return (
    <article className={`cv-q-card ${next ? s.next : ''}`} aria-labelledby={`q-${q.id}`} aria-busy={busy || undefined}>
      <span className={`cv-q-ico ${q.tone}`}><Icon name={q.icon} size={18} /></span>
      <div className="cv-col" style={{ gap: 6, minWidth: 0 }}>
        {next ? <span className={s.nextTag}><Icon name="ArrowRight" size={12} />Next up · {KIND[q.kind]}</span> : <span className={s.kind}>{KIND[q.kind]}</span>}
        <span id={`q-${q.id}`} style={{ fontWeight: 600, fontSize: next ? 'var(--text-lg)' : undefined }}>{q.title}</span>
        <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{q.body}</span>
        <CardMeta q={q} />
      </div>
      <div className="cv-q-acts">
        {q.refuse
          ? <Button variant="ghost" size="sm" disabled={busy} onClick={onRefuse}>Not for us</Button>
          : <Button variant="ghost" size="sm" disabled={busy} onClick={onSnooze}>Snooze</Button>}
        {q.go && <Button variant="ghost" size="sm" icon="Check" disabled={busy} onClick={onDone}>Done</Button>}
        <Button size="sm" variant={next ? 'primary' : 'secondary'} disabled={busy} onClick={onPrimary}>{q.primary}</Button>
      </div>
    </article>
  );
}

function OffQueue({ cards, view, history, tz, busy, onUndo, onReset, own }) {
  const titleOf = (id) => cards.find((c) => c.id === id)?.title
    || (id.startsWith('find:') && CV_D.candidates.find((c) => c.id === id.slice(5))?.title) || id;
  const last = (id, op) => [...history].reverse().find((h) => h.cardId === id && h.op === op);
  const groups = {
    done: Object.keys(view.done).map((id) => ({ id, icon: 'CircleCheck', tone: 'good', note: (() => { const h = last(id, 'done'); return `${whoLabel(h?.by)} · ${clock(view.done[id], tz)}`; })() })),
    snoozed: Object.keys(view.snoozed).map((id) => ({ id, icon: 'CalendarClock', tone: 'info', note: `${whoLabel(last(id, 'snooze')?.by)} · back ${view.snoozed[id] <= localDay(Date.now() + 864e5, tz) ? 'tomorrow' : shortDate(`${view.snoozed[id]}T12:00:00Z`, 'UTC')}` })),
    refused: Object.keys(view.refused).map((id) => ({ id, icon: 'CircleMinus', tone: 'neutral', note: `${whoLabel(last(id, 'refuse')?.by)} · ${shortDate(view.refused[id], tz)}, can come back after ${shortDate(Date.parse(view.refused[id]) + REFUSE_DAYS * 864e5, tz)}` })),
  };
  const first = Object.keys(groups).find((k) => groups[k].length) || 'done';
  const [tab, setTab] = React.useState(first);
  const total = groups.done.length + groups.snoozed.length + groups.refused.length;
  if (!total) return null;
  const rows = groups[tab].length ? groups[tab] : groups[first];
  const shown = groups[tab].length ? tab : first;
  const others = history.filter((h) => h.op === 'done' && !h.by?.you).length;
  return (
    <section className="cv-card" aria-labelledby="off-head">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="off-head">Off the queue</span>
          <span className="cv-small cv-muted">{own ? 'Cleared today, snoozed and turned down, with who did it.' : 'Cleared, snoozed and turned down, with who did it.'}{others ? ` ${others} cleared by someone else on your team.` : ''} Anything here can go back on the queue.</span>
        </div>
        <Button size="sm" variant="ghost" icon="RotateCcw" disabled={!!busy} onClick={onReset}>{own ? 'Show today’s cards again' : 'Reset the demo'}</Button>
      </div>
      <Tabs value={shown} onChange={setTab} tabs={[
        { value: 'done', label: own ? 'Done today' : 'Done', count: groups.done.length },
        { value: 'snoozed', label: 'Snoozed', count: groups.snoozed.length },
        { value: 'refused', label: 'Not for us', count: groups.refused.length },
      ]} />
      <div className={s.list} role="tabpanel">
        {rows.length === 0 && <span className="cv-small cv-muted" style={{ padding: '10px 0' }}>Nothing here.</span>}
        {rows.map((r) => (
          <div key={r.id} className={s.row}>
            <span className={`cv-q-ico ${r.tone} ${s.rowIco}`}><Icon name={r.icon} size={15} /></span>
            <div className="cv-col" style={{ gap: 2, minWidth: 0 }}>
              <span className="cv-small" style={{ fontWeight: 600 }}>{titleOf(r.id)}</span>
              <span className="cv-xs cv-faint">{r.note}</span>
            </div>
            <Button size="sm" variant="ghost" icon="Undo2" disabled={busy === r.id} onClick={() => onUndo(r.id)}>{shown === 'done' ? 'Undo' : 'Bring back'}</Button>
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
  const testing = (eng.windows || []).filter((w) => w.roomId === CV_D.id && (w.status === 'running' || w.status === 'waiting')).map((w) => w.lever);
  const cards = todayCards(CV_D, { today, testing, dismissed });
  const { view, history, run, busy } = useQueue({ cards, today, own, tz });
  const sum = queueSummary(cards, view);
  const left = cards.filter((c) => !isOut(view, c.id));

  const decide = (op, q, summary, toast) => run(op, q, summary).then((r) => { cv.toast(r.ok ? toast : r.error); return r.ok; });
  const findingId = (q) => (q?.id?.startsWith('find:') ? q.id.slice(5) : null);

  const primary = (q) => {
    if (q.approval) return cv.approve(q.approval, () => decide('done', q, `${q.title}: approved`, `${q.title}: approved. The steps are under “Approved changes to make”.`));
    if (q.start) {
      return engine.startWindow(q.start).then((r) => (r.ok
        ? decide('done', q, `${q.title}: started`, 'Test started. The baseline is frozen; each new week of Toast data is a checkpoint.')
        : cv.toast(r.error)));
    }
    if (q.task) {
      return engine.createTask(`today:${q.id}`, { title: q.title, system: q.task.system, diff: q.task.diff }).then((t) => t && decide('done', q, `${q.title}: steps added`, `Added to “Approved changes to make”, with the steps to do it in ${q.task.system}.`));
    }
    if (q.go === 'finding') return cv.go('finding', { id: q.goId });
    if (q.go) return cv.go(q.go, q.input ? { kind: q.input } : undefined);
    return decide('done', q, `${q.title}: done`, 'Done. Logged with your name and the time.');
  };
  const refuse = (q) => decide('refuse', q, `${q.title}: not for us`, `Noted. We won’t suggest this again for ${REFUSE_DAYS} days.`).then((ok) => {
    const id = findingId(q);
    if (ok && id) setDismissed((f) => ({ ...(f || {}), [id]: new Date(Date.now() + REFUSE_DAYS * 864e5).toISOString() }), `${q.title}: not for us`);
  });
  const undo = (id) => {
    const q = cards.find((c) => c.id === id) || { id, title: id };
    return decide('undo', q, `${q.title}: back on the queue`, 'Back on the queue.').then((ok) => {
      const fid = findingId(q);
      if (ok && fid && dismissed?.[fid]) setDismissed((f) => { const n = { ...(f || {}) }; delete n[fid]; return n; }, `${q.title}: back on the queue`);
    });
  };
  const reset = () => decide('reset', null, own ? 'Today’s cards shown again' : 'Queue reset', own ? 'Today’s cards are back.' : 'The demo queue is reset.');

  const day = own ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }) : CV_NOW.label;
  const pct = (n) => `${sum.total ? (n / sum.total) * 100 : 0}%`;
  return (
    <div className="cv-page" style={{ maxWidth: 880 }}>
      <PageHead over={`${CV_ROOM.name} · ${day}`} q={sum.left ? `Clear this in about ${sum.minsLeft} minutes` : 'Nothing needs you today'}
        sub={own ? `Built this morning from your Toast data through ${roomDataEnd(CV_D.room)}. Each card is one decision, with what it’s worth and how long it takes, in the order to do them.` : 'A work queue, not a dashboard. Each card is one decision, with what it’s worth and how long it takes, in the order to do them.'} />

      <section className="cv-card" aria-label="Today’s progress">
        <div className={s.summary}>
          <div className={s.figure}><span className={s.label}>Cards left</span><span className="cv-fig md cv-num">{sum.left}<span className="cv-small cv-faint"> of {sum.total}</span></span></div>
          <div className={s.figure}><span className={s.label}>Time left</span><span className="cv-fig md cv-num">{sum.minsLeft}<span className="cv-small cv-faint"> min</span></span></div>
          <div className={s.figure}><span className={s.label}>{own ? 'Cleared today' : 'Cleared'}</span><span className="cv-fig md cv-num">{sum.cleared}</span></div>
          {sum.left ? <Pill tone="warn" icon="ListChecks">{sum.left} to do</Pill> : <Pill tone="good" icon="CircleCheck">All clear</Pill>}
        </div>
        <div className={s.bar} role="img" aria-label={`${sum.cleared} cleared, ${sum.snoozed} snoozed, ${sum.refused} turned down, ${sum.left} left`}>
          <span className={s.done} style={{ width: pct(sum.cleared) }} />
          <span className={s.snoozed} style={{ width: pct(sum.snoozed) }} />
          <span className={s.refused} style={{ width: pct(sum.refused) }} />
        </div>
        <div className={s.legend} aria-hidden="true">
          <span><i style={{ background: 'var(--success-600)' }} />Cleared {sum.cleared}</span>
          {sum.snoozed > 0 && <span><i style={{ background: 'var(--info-600)', opacity: 0.55 }} />Snoozed {sum.snoozed}</span>}
          {sum.refused > 0 && <span><i style={{ background: 'var(--fg-3)', opacity: 0.45 }} />Not for us {sum.refused}</span>}
          <span><i style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border)' }} />Left {sum.left}</span>
        </div>
      </section>

      {left.length === 0 ? (
        <div className="cv-empty">
          <span className="ico"><Icon name="Check" size={22} /></span>
          <span className="cv-h3">Queue clear</span>
          <span className="cv-small cv-muted" style={{ maxWidth: 400 }}>{own ? 'Nothing else needs you today. Tomorrow’s queue is built from your latest data.' : 'Nothing else needs you today. The next check is Thursday at 9 am, when overtime for the weekend is still preventable.'}</span>
        </div>
      ) : (
        <div className="cv-col" style={{ gap: 10 }}>
          {left.map((q, i) => (
            <React.Fragment key={q.id}>
              {i === 1 && <div className={s.sectionHead}><span className="cv-h4">After that</span><span className="cv-xs cv-faint cv-num">{left.length - 1} more · {sum.minsLeft - left[0].mins} min</span></div>}
              <QueueCard q={q} next={i === 0} busy={busy === q.id}
                onPrimary={() => primary(q)}
                onDone={() => decide('done', q, `${q.title}: done`, 'Done. Logged with your name and the time.')}
                onSnooze={() => decide('snooze', q, `${q.title}: snoozed`, 'Snoozed. It’s back on tomorrow’s queue.')}
                onRefuse={() => refuse(q)} />
            </React.Fragment>
          ))}
        </div>
      )}

      <TasksPanel />
      <OffQueue cards={cards} view={view} history={history} tz={tz} busy={busy} own={own} onUndo={undo} onReset={reset} />
      <DenseToday />
    </div>
  );
}

export { CvToday };
