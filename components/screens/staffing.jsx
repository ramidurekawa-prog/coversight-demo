'use client';

// The pre-shift staffing call, shown the same way on Today and Service: the
// hours scheduled against what Covercast (or the room's own history) says
// each hour needs, the evidence the call rests on, and once approved what
// became of it. Every figure comes from lib/data/page/staffing.js; nothing
// is worked out here.
import * as React from 'react';

import { Button, Icon } from '../kit';
import { localNow } from '../../lib/data/page/service.js';
import { shortDate, staffingCardId, staffingCards, staffingDecision, staffingOutcome } from '../../lib/data/page/staffing.js';
import { applyOp, cardState, queueView } from '../../lib/data/page/today.js';
import { engine, useEngine, useSaved } from '../engine';
import { CV_D, Claim, useCv } from './core';
import { useCovercast } from './covercast';
import s from './staffing.module.css';

const usd = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`;

/** The room's local date and minutes, ticking each minute, so a deadline passes on screen. */
function useLocalNow(tz) {
  const [t, setT] = React.useState(() => Date.now());
  React.useEffect(() => { const i = setInterval(() => setT(Date.now()), 60_000); return () => clearInterval(i); }, []);
  return localNow(new Date(t), tz);
}

/**
 * Everything the staffing call reads in the browser, the same inputs the
 * server re-checks an approval with: the room, its fences, its tasks, its
 * saved inputs and (unless the history is typed by hand) Covercast.
 */
export function useStaffingInputs() {
  const eng = useEngine();
  const room = CV_D.room;
  const [fences] = useSaved('fences', null);
  const wantsCast = !room.serviceOwn && (!!room.fromToast || (room.shifts || []).length > 0);
  const cc = useCovercast(room, CV_D.id, eng.mode === 'server', wantsCast);
  const clock = useLocalNow(room.tz);
  const tasks = (eng.tasks || []).filter((t) => t.roomId === CV_D.id);
  const entries = eng.inputs?.[CV_D.id] || {};
  return { room, fences, cc: wantsCast ? cc : null, tasks, entries, today: clock.date, nowMin: clock.minutes };
}

/** Today's staffing cards for the room in view. */
export function useStaffingCards() {
  const x = useStaffingInputs();
  return React.useMemo(() => staffingCards(x.room, x), [x.room, x.fences, x.cc, x.tasks, x.entries, x.today, x.nowMin]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** One service's call, read fresh. */
export function useStaffingDecision(date, meal) {
  const x = useStaffingInputs();
  return React.useMemo(() => (date && meal ? staffingDecision(x.room, { ...x, date, meal }) : null), [x.room, x.fences, x.cc, x.tasks, x.entries, x.today, x.nowMin, date, meal]); // eslint-disable-line react-hooks/exhaustive-deps
}

async function call(path, init) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
  return b;
}

/**
 * Today's queue, for the staffing cards only: the same record and ops Today
 * uses (decline, snooze, assign), so "keep the schedule" said on Service is
 * the same decision Today shows. Signed in, the server's queue; else this
 * browser's saved one.
 */
export function useStaffingQueue(x) {
  const eng = useEngine();
  const server = eng.mode === 'server';
  const cards = React.useMemo(() => staffingCards(x.room, x), [x.room, x.fences, x.cc, x.tasks, x.entries, x.today, x.nowMin]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = !!CV_D.room.fromToast;
  const tz = CV_D.room.tz;
  const [saved, setSaved] = useSaved('queue', null);
  const [remote, setRemote] = React.useState(/** @type {any} */ (null));
  const taskSig = x.tasks.map((t) => `${t.approvalId}:${t.status}`).join('|');
  React.useEffect(() => {
    if (!server) return undefined;
    let live = true;
    call(`/api/page/today?room=${encodeURIComponent(CV_D.id)}`).then((b) => { if (live) setRemote(b); }).catch(() => {});
    return () => { live = false; };
  }, [server, taskSig]);
  const view = server && remote ? remote.state : queueView(saved, { today: x.today, own, tz, cards });
  const stateOf = (date, meal) => {
    const c = cards.find((k) => k.id === staffingCardId(date, meal));
    return c ? cardState(c, view) : null;
  };
  /** @returns {Promise<{ ok: boolean, error?: string }>} */
  const run = async (op, date, meal, { reason, summary } = /** @type {any} */ ({})) => {
    const cardId = staffingCardId(date, meal);
    try {
      const next = applyOp(view, { op, cardId, reason }, { cards, today: x.today, own, tz });
      if (!server) { setSaved(next, summary); return { ok: true }; }
      setRemote(await call('/api/page/today', { method: 'POST', body: JSON.stringify({ roomId: CV_D.id, op, cardId, reason }) }));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
  return { stateOf, run };
}

/**
 * Approve a staffing change: one task, the server's own check first. In the
 * browser-only demo the evidence is the decision as shown; signed in, the
 * server rebuilds it and refuses if the numbers moved.
 * @returns {Promise<{ ok: true, task: any } | { ok: false, error: string }>}
 */
export function approveStaffing(dec) {
  if (!dec?.approvalId) return Promise.resolve({ ok: false, error: 'This change can’t be approved as it stands. Look at the latest call.' });
  let error = null;
  const evidence = { rule: dec.rule, version: dec.version, at: new Date().toISOString(), change: dec.change, estimate: dec.estimate, forecast: dec.forecast, schedule: dec.schedule, hours: dec.hours, guardrails: dec.guardrails, title: dec.title };
  return engine.createTask(dec.approvalId, { title: dec.title, system: dec.system, diff: dec.diff, evidence, onError: (m) => { error = m; } })
    .then((t) => (t ? { ok: true, task: t } : { ok: false, error: error || 'Not approved. Look at the latest call and try again.' }));
}

/** The hours, side by side, each in two half hours: what's scheduled now, after the change, and what the forecast needs. */
export function StaffingHours({ dec, compact = false }) {
  const rows = dec?.hoursRows || [];
  if (!rows.length) return null;
  const halves = rows.flatMap((r) => (r.halves || [{ scheduled: r.scheduled, after: r.after }]));
  const top = Math.max(1, ...rows.map((r) => r.need), ...halves.map((h) => Math.max(h.scheduled ?? 0, h.after ?? 0)));
  const unit = compact ? 14 : 20;
  const seg = (now, after, need, k) => (k < Math.min(after, now) ? s.segOn : k < now ? s.segRemoved : k < after ? s.segAdded : k < need ? s.segShort : s.segEmpty);
  const any = (f) => halves.some(f) || rows.some((r) => f(r));
  return (
    <figure className={`${s.hours} ${compact ? s.compact : ''}`} aria-label={`Servers by half hour for ${dec.label.toLowerCase()}`}>
      <div className={s.cols}>
        {rows.map((r) => {
          const hs = r.halves || [{ t: r.hour * 60, scheduled: r.scheduled, after: r.after }];
          const changed = hs.some((h) => h.after !== h.scheduled);
          return (
            <div key={r.hour} className={`${s.col} ${changed ? s.colChanged : ''}`}>
              <div className={s.pair}>
                {hs.map((h) => (
                  <div key={h.t} className={s.stack} style={{ height: `${top * unit}px` }}>
                    {Array.from({ length: top }, (_, i) => <span key={i} className={seg(h.scheduled ?? 0, h.after ?? h.scheduled ?? 0, r.need, top - 1 - i)} />)}
                  </div>
                ))}
                <span className={s.needLine} style={{ bottom: `${(r.need / top) * 100}%` }} aria-hidden="true" />
              </div>
              <span className={s.hourLabel}>{r.label.replace(':00', '')}</span>
              {!compact && <span className={s.cov}>{r.covers}{r.high !== r.covers ? <small>–{r.high}</small> : null}</span>}
            </div>
          );
        })}
      </div>
      <figcaption className={s.key}>
        <span><i className={s.segOn} />Scheduled</span>
        {any((h) => h.after < h.scheduled) && <span><i className={s.segRemoved} />Not needed</span>}
        {any((h) => h.after > h.scheduled) && <span><i className={s.segAdded} />Added</span>}
        {rows.some((r) => (r.halves || []).some((h) => h.after < r.need)) && <span><i className={s.segShort} />Short</span>}
        <span><i className={s.needKey} />Needed at the top of the range</span>
        {!compact && <span className={s.covKey}>{rows.some((r) => r.high !== r.covers) ? 'Guests: likely–top' : 'Guests'}</span>}
      </figcaption>
      <table className={s.srOnly}>
        <caption>Servers by hour</caption>
        <thead><tr><th>Hour</th><th>Guests likely</th><th>Guests top</th><th>Need</th><th>Scheduled</th><th>After</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.hour}><td>{r.label}</td><td>{r.covers}</td><td>{r.high}</td><td>{r.need}</td><td>{(r.halves || []).map((h) => h.scheduled).join(' then ') || r.scheduled}</td><td>{(r.halves || []).map((h) => h.after).join(' then ') || r.after}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

const SRC = { hand: 'Your guests-by-hour entries', toast: 'Your Toast data', sample: 'Sample restaurant data' };

/** What the call rests on: forecast and its range, the schedule, the rate, the guardrails. */
export function StaffingEvidence({ dec }) {
  if (!dec?.forecast) return null;
  const f = dec.forecast;
  const e = dec.estimate;
  return (
    <div className={s.evidence}>
      <dl className={s.facts}>
        <dt>Forecast</dt>
        <dd>{f.covers} guests{f.low != null ? `, likely ${f.low}–${f.high}` : f.high ? `, up to ${f.high} on the busiest recent ${dec.label.toLowerCase()}` : ''} · {f.hours}</dd>
        <dt>From</dt>
        <dd>{f.engine ? `Covercast on ${SRC[f.source].toLowerCase()}` : SRC[f.source]} · {f.weeks} past {dec.day} {dec.label.toLowerCase()}s · {f.rate} guests a server an hour</dd>
        <dt>Schedule</dt>
        <dd>{dec.schedule.servers} server shift{dec.schedule.servers === 1 ? '' : 's'} on {shortDate(dec.date)}{dec.schedule.savedLabel ? ` · saved ${dec.schedule.savedLabel}` : ''}{dec.schedule.source === 'sample' ? ' · sample schedule' : ''}</dd>
        {e && <><dt>{e.cost ? 'Cost' : 'Estimate'}</dt><dd className={s.money}><b>{usd(e.cents)}</b> {e.cost ? 'more labor' : 'less labor'} · {e.minutes} min × {usd(e.rateCents)}/hr ({e.rateLabel}) <Claim k="est" label={e.cost ? 'Estimated cost' : 'Estimated, before offsets'} /></dd></>}
      </dl>
      {dec.guardrails && (
        <ul className={s.guards} aria-label="Checks">
          {dec.guardrails.map((g) => (
            <li key={g.key} className={g.ok === true ? s.ok : g.ok === false ? s.bad : s.yours}>
              <Icon name={g.ok === true ? 'CircleCheck' : g.ok === false ? 'CircleX' : 'CircleHelp'} size={15} />
              <span>{g.label}{g.note ? <small> {g.note}</small> : null}</span>
            </li>
          ))}
        </ul>
      )}
      {dec.risk && <p className={s.risk}><Icon name="TriangleAlert" size={14} />{dec.risk}</p>}
    </div>
  );
}

/** What happened after an approval: decision, made, clock-ins, observed, and why it isn't counted as savings. */
export function StaffingOutcome({ task, room = CV_D.room }) {
  const o = React.useMemo(() => (task ? staffingOutcome(task, room) : null), [task, room]);
  if (!o) return null;
  return (
    <ol className={s.stages} aria-label="What happened">
      {o.stages.map((st) => (
        <li key={st.key} className={s[`st_${st.state}`] || ''}>
          <Icon name={st.state === 'done' ? 'CircleCheck' : st.state === 'warn' ? 'TriangleAlert' : st.state === 'no' ? 'Ban' : 'Clock'} size={15} />
          <span className={s.stLabel}>{st.label}{st.key === 'observed' ? <> <Claim k="obs" /></> : null}</span>
          <span className={s.stText}>{st.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** "What the call needs": each input ready, limited, stale, missing or later, with its fix. */
export function StaffingReadiness({ readiness, onFix }) {
  if (!readiness) return null;
  const ICON = { ready: 'CircleCheck', limited: 'CircleDot', stale: 'TriangleAlert', missing: 'CircleX', later: 'Clock' };
  const WORD = { ready: 'Ready', limited: 'Limited', stale: 'Out of date', missing: 'Missing', later: 'After the shift' };
  return (
    <ul className={s.ready}>
      {readiness.items.map((it) => (
        <li key={it.key} className={s[`r_${it.state}`]}>
          <Icon name={ICON[it.state]} size={16} />
          <span className={s.rMain}><b>{it.label}</b> <span className={s.rState}>{WORD[it.state]}{it.need === 'dollars' ? ' · for the dollar figure' : it.need === 'proof' ? ' · to prove it' : ''}</span><small>{it.detail}</small></span>
          {it.fix && it.state !== 'ready' && onFix && <button type="button" className={s.fix} onClick={() => onFix(it.fix)}>{it.fix.label}<Icon name="ArrowRight" size={13} /></button>}
        </li>
      ))}
    </ul>
  );
}

const STATE_CHIP = {
  act: { icon: 'CircleDot', label: 'Needs your decision', cls: 'chipAct' },
  hold: { icon: 'CircleCheck', label: 'No change needed', cls: 'chipOk' },
  blocked: { icon: 'CircleAlert', label: 'Needs data first', cls: 'chipWarn' },
  decided: { icon: 'CircleCheck', label: 'Approved', cls: 'chipOk' },
  late: { icon: 'Clock', label: 'Past the time to change it', cls: 'chipMuted' },
  live: { icon: 'Activity', label: 'Under way', cls: 'chipMuted' },
  over: { icon: 'Moon', label: 'Over', cls: 'chipMuted' },
};

/**
 * Service's "before the shift" call for the date and service in view: the
 * same decision, card id and record Today shows. Approve makes the one task;
 * "Keep the schedule" is Today's decline. Hidden for a room with nothing to
 * check (no own data and no schedule entered).
 */
export function ShiftCall({ date, meal, back = null }) {
  const cv = useCv();
  const room = CV_D.room;
  const x = useStaffingInputs();
  const dec = React.useMemo(() => (date && meal ? staffingDecision(x.room, { ...x, date, meal }) : null), [x.room, x.fences, x.cc, x.tasks, x.entries, x.today, x.nowMin, date, meal]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useStaffingQueue(x);
  const [busy, setBusy] = React.useState(false);
  const [why, setWhy] = React.useState(false);
  const [msg, setMsg] = React.useState(/** @type {{ tone: string, text: string }|null} */ (null));
  React.useEffect(() => { setMsg(null); setWhy(false); }, [date, meal]);
  const eligible = !!(room.fromToast || room.serviceOwn || (room.shifts || []).length);
  // Once the service is under way (or over) Service's live call and the outcome below it take over.
  if (!dec || !eligible || ['closed', 'live', 'over'].includes(dec.state)) return null;
  const qs = q.stateOf(date, meal);
  const kept = qs === 'declined';
  const chip = kept ? { icon: 'CircleMinus', label: 'You kept the schedule', cls: 'chipMuted' } : STATE_CHIP[dec.state] || STATE_CHIP.hold;
  const fix = (f) => cv.go('inputs', { kind: f.kind, date: f.date, meal: f.meal, back: 'service' });
  const approve = async () => {
    if (busy) return;
    setBusy(true);
    const r = await approveStaffing(dec);
    setBusy(false);
    setMsg(r.ok ? { tone: 'ok', text: `Approved: ${dec.title}. Nothing changes until someone makes it in your schedule and tells the person. It’s on Today under Being handled.` } : { tone: 'bad', text: `Not approved. ${r.error}` });
  };
  const keep = async () => {
    if (busy) return;
    setBusy(true);
    const r = await q.run('refuse', date, meal, { reason: 'not_now', summary: `${dec.label} ${date}: kept the schedule` });
    setBusy(false);
    setMsg(r.ok ? { tone: 'ok', text: 'Kept the schedule. Saved with your name; Today shows the same.' } : { tone: 'bad', text: r.error || 'Not saved.' });
  };
  const undo = async () => {
    setBusy(true);
    const r = await q.run('undo', date, meal, { summary: `${dec.label} ${date}: back on the list` });
    setBusy(false);
    setMsg(r.ok ? null : { tone: 'bad', text: r.error || 'Not saved.' });
  };
  const when = `${dec.label} · ${shortDate(date)}`;
  return (
    <section className={`cv-card ${s.call}`} aria-labelledby="shift-call-h">
      <div className={s.callHead}>
        <span className={s.callOver}><Icon name="CalendarClock" size={15} />Before the shift · {when}</span>
        <span className={`${s.chip} ${s[chip.cls]}`}><Icon name={chip.icon} size={13} />{chip.label}</span>
        {back === 'today' && <button type="button" className={s.fix} onClick={() => cv.go('today', { card: dec.id })}><Icon name="ArrowLeft" size={13} />Back to Today</button>}
      </div>
      <h3 id="shift-call-h" className={s.callTitle}>{dec.state === 'decided' ? dec.task.title : dec.title}</h3>
      {dec.why && dec.state !== 'decided' && <p className={s.callWhy}>{dec.why}</p>}

      {dec.state === 'blocked' && <StaffingReadiness readiness={dec.readiness} onFix={fix} />}
      {['act', 'hold', 'late'].includes(dec.state) && <StaffingHours dec={dec} />}
      {dec.state === 'decided' && <StaffingOutcome task={dec.task} />}

      {dec.state === 'act' && !kept && (
        <div className={s.callActs}>
          <Button icon="Check" disabled={busy} onClick={approve}>{busy ? 'Checking…' : `Approve: ${dec.short}`}</Button>
          <Button variant="secondary" disabled={busy} onClick={keep}>Keep the schedule</Button>
          <Button variant="ghost" iconRight={why ? 'ChevronUp' : 'ChevronDown'} aria-expanded={why} onClick={() => setWhy(!why)}>Show me why</Button>
        </div>
      )}
      {dec.state === 'act' && dec.estimate && !why && (
        <p className={s.callMoney}><b>{usd(dec.estimate.cents)}</b> {dec.estimate.cost ? 'more labor' : 'less labor this shift'} <Claim k="est" label={dec.estimate.cost ? 'Estimated cost' : 'Estimated, before offsets'} /></p>
      )}
      {kept && <div className={s.callActs}><Button size="sm" variant="ghost" icon="Undo2" disabled={busy} onClick={undo}>Put it back</Button></div>}
      {(why || dec.state === 'hold') && dec.forecast && <StaffingEvidence dec={dec} />}
      {dec.state === 'hold' && dec.readiness?.items?.some((i) => i.state !== 'ready' && i.fix) && (
        <StaffingReadiness readiness={{ ...dec.readiness, items: dec.readiness.items.filter((i) => i.state !== 'ready') }} onFix={fix} />
      )}
      {msg && <p className={`${s.callMsg} ${msg.tone === 'bad' ? s.msgBad : s.msgOk}`} role="status"><Icon name={msg.tone === 'bad' ? 'CircleX' : 'CircleCheck'} size={15} />{msg.text}</p>}
    </section>
  );
}
