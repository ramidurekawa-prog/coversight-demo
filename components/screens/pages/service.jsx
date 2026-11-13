'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_NOW, Claim, Money, Pill, Callout, PageHead, cvScale, SampleNote } from '../core';
import { DenseService } from '../dense-sections';
import { bandSpread, clockLabel, cutApprovalId, DINNER_FROM, fencesOf, hhmm, isCutFor, localNow, servicePlan, SLOT_MIN } from '../../../lib/data/page/service.js';
import s from './service.module.css';

const FULL_DAY = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const days = (d) => `${FULL_DAY[d] ?? d}s`;
const dayOf = (d) => FULL_DAY[d] ?? d;
const POLL_MS = 120_000;

/* ================================================================ pieces shared by every way in */

/** Covers per 15 minutes tonight against the comparable nights, with the forecast band and now. */
function PaceChart({ comp, actual, now, factor, spread, start, cutSlot }) {
  const W = 340, H = 156, P = { l: 24, r: 10, t: 14, b: 22 };
  const n = comp.length;
  const top = Math.max(4, Math.ceil(Math.max(...comp, ...actual, ...comp.map((c) => c * factor * (1 + spread))) / 2) * 2);
  const x = cvScale(0, n - 1, P.l, W - P.r);
  const y = cvScale(0, top, H - P.b, P.t);
  const from = Math.max(0, now - 1);
  const fc = comp.map((c, i) => (i < from ? null : i === from && actual[from] != null ? actual[from] : c * factor));
  const up = [], lo = [];
  comp.forEach((c, i) => { if (i >= now) { up.push([x(i), y(c * factor * (1 + spread))]); lo.unshift([x(i), y(c * factor * (1 - spread))]); } });
  const ticks = [];
  for (let i = 0; i < n; i += 4) ticks.push(i);
  const label = (i) => clockLabel(start + i * SLOT_MIN).replace(' pm', '').replace(' am', '');
  const mid = Math.round(top / 2);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Covers per 15 minutes tonight: ${actual.reduce((a, b) => a + b, 0)} so far, against a comparable night`}>
      {[0, mid, top].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 6} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
      {up.length > 1 && <polygon points={[...up, ...lo].map((p) => p.join(',')).join(' ')} fill="var(--accent)" opacity="0.14" />}
      <polyline points={comp.map((c, i) => `${x(i)},${y(c)}`).join(' ')} fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 3" />
      <polyline points={fc.map((c, i) => c != null && `${x(i)},${y(c)}`).filter(Boolean).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 3" />
      {actual.length > 0 && <polyline points={actual.map((c, i) => `${x(i)},${y(c)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      {now > 0 && now <= n && <>
        <line x1={x(now - 1)} x2={x(now - 1)} y1={P.t - 6} y2={H - P.b} stroke="var(--fg-3)" strokeWidth="1" />
        <circle cx={x(now - 1)} cy={y(actual[now - 1] ?? 0)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
        <text x={x(now - 1)} y={P.t - 8} textAnchor="middle" className="lbl">now</text>
      </>}
      {cutSlot != null && cutSlot < n && <>
        <line x1={x(cutSlot)} x2={x(cutSlot)} y1={P.t} y2={H - P.b} stroke="var(--warning-600)" strokeWidth="1" strokeDasharray="3 3" />
        <text x={x(cutSlot) + 4} y={P.t + 8} style={{ fill: 'var(--warning-600)' }}>{label(cutSlot)} cut</text>
      </>}
      {ticks.map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{label(i)}</text>)}
    </svg>
  );
}

function Legend() {
  return (
    <div className="cv-legend">
      <span><i className="line" style={{ background: 'var(--accent)' }} />Tonight</span>
      <span><i style={{ background: 'var(--accent)', opacity: 0.25 }} />Forecast band</span>
      <span><i className="line" style={{ background: 'var(--fg-3)' }} />Comparable night</span>
    </div>
  );
}

function StatusRow({ day, time, live, source }) {
  return (
    <div className={s.status}>
      <span className={s.day}>{day}</span>
      <span className={s.source}><span className={`${s.dot} ${live ? s.live : ''}`} />{source}{time ? ` · ${time}` : ''}</span>
    </div>
  );
}

function PaceHero({ so, cmp, pace }) {
  const under = pace < 0;
  return (
    <>
      <div className="cv-row" style={{ justifyContent: 'space-between' }}>
        <span className="cv-xs cv-faint">Covers so far</span>
        <span className={`${s.paceChip} ${under ? 'cv-down' : 'cv-up'}`}>{under ? '▼' : '▲'} {Math.abs(pace)}% vs comparable</span>
      </div>
      <div className={s.hero}>
        <span className="cv-fig lg">{so}</span>
        <span className="cv-small cv-faint">of {Math.round(cmp)} by now on a comparable night</span>
      </div>
    </>
  );
}

const CALL_LOOK = { cut: ['UserMinus', s.cut], wait: ['Hourglass', s.wait], quiet: ['CircleCheck', s.quiet], idle: ['Clock', s.idle] };

/** The one call for tonight, and the answer to it. */
function CallCard({ tone, over, title, body, children }) {
  const [icon, cls] = CALL_LOOK[tone] || CALL_LOOK.idle;
  return (
    <section className={`cv-card ${s.call} ${cls}`} aria-live="polite">
      <div className={s.callHead}><span className={s.callIcon}><Icon name={icon} size={15} /></span><span className="cv-xs cv-faint">{over}</span></div>
      <span className={s.callTitle}>{title}</span>
      {body && <span className={s.callBody}>{body}</span>}
      {children}
    </section>
  );
}

function Tiles({ items }) {
  return (
    <div className={s.tiles}>
      {items.map(([k, v, t]) => <div key={k} className={s.tile}><span className="cv-xs cv-faint">{k}</span><span className={s.v}>{v}</span><span className="cv-xs cv-faint">{t}</span></div>)}
    </div>
  );
}

/** The fences that bound tonight's call, read from the room's saved fences. */
function FenceCard({ fences, hit }) {
  const cv = useCv();
  return (
    <section className="cv-card">
      <div className="cv-card-head"><span className="cv-h4">Fences holding tonight</span><Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('fences')}>Change</Button></div>
      <div className={s.fences}>
        <div className={`${s.fence} ${hit === 'floor' ? s.on : ''}`}><span className="cv-xs cv-faint">Fewest servers on dinner</span><span className={s.v}>{fences.minDinner}</span></div>
        <div className={`${s.fence} ${hit === 'late' ? s.on : ''}`}><span className="cv-xs cv-faint">Latest same-night cut</span><span className={s.v}>{clockLabel(fences.cutBy)}</span></div>
      </div>
      <span className="cv-xs cv-faint">The server checks these again when a cut is approved. A cut past them is refused, whoever asks.</span>
    </section>
  );
}

function WhyCard() {
  return (
    <section className="cv-card">
      <span className="cv-h4">Why it speaks up only when it does</span>
      <ul className="cv-ul">
        <li><Icon name="Activity" size={15} />The forecast band comes from how far off the forecast was on your own recent nights, not a fixed percentage. A release is suggested only if it&apos;s safe at the band&apos;s top edge.</li>
        <li><Icon name="BellOff" size={15} />One suggestion per service at most, and one alert. On a normal night it stays silent.</li>
        <li><Icon name="ShieldCheck" size={15} />Approving creates a task, never a change. A release counts only once Toast clock-ins show it, and you&apos;re warned if covers climb past the band afterwards.</li>
        <li><Icon name="Fence" size={15} />Your fences always win: the fewest servers on dinner and the latest same-night cut.</li>
      </ul>
    </section>
  );
}

/** Tonight hour by hour from the plan: covers as a bar, servers as seats. */
function HourStrip({ plan, cutFrom }) {
  const max = Math.max(...plan.hours.map((h) => h.covers), 1);
  return (
    <div className={s.hours} role="table" aria-label="Tonight hour by hour">
      {plan.hours.map((h) => {
        const on = Math.round(h.servers);
        const cutting = cutFrom != null && h.hour >= cutFrom;
        return (
          <div key={h.hour} role="row" className={`${s.hourRow} ${cutting ? s.cutting : ''}`} aria-label={`${clockLabel(h.hour * 60)}: about ${h.covers} covers, ${on} servers on, ${h.need} needed`}>
            <span role="cell" className={s.hourLabel}>{clockLabel(h.hour * 60)}</span>
            <span role="cell" className={s.barTrack}><span className={s.bar} style={{ display: 'block', width: `${(h.covers / max) * 100}%` }} /></span>
            <span role="cell" className="cv-row nowrap" style={{ gap: 8 }}>
              <span className={s.seats} aria-hidden="true">{Array.from({ length: Math.min(on, 10) }, (_, i) => <span key={i} className={`${s.seat} ${i < h.need ? '' : cutting && i === on - 1 ? s.gone : s.spare}`} />)}</span>
              <span className={s.hourMeta}>{h.covers} cov</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SeatKey() {
  return (
    <div className="cv-legend">
      <span><i className={s.seat} style={{ borderRadius: '50%' }} />Server needed</span>
      <span><i className={`${s.seat} ${s.spare}`} style={{ borderRadius: '50%' }} />Spare on recent weeks</span>
      <span><i className={`${s.seat} ${s.gone}`} style={{ borderRadius: '50%' }} />The cut</span>
    </div>
  );
}

/* ================================================================ the room's own data (Toast export or live sync) */

async function call(path, init) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

/** Tonight live from Toast, refreshed every two minutes while the page is open and visible. */
function useLive(roomId, enabled) {
  const [live, setLive] = React.useState(null);
  React.useEffect(() => {
    if (!enabled) return undefined;
    let stop = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      call(`/api/page/service?roomId=${encodeURIComponent(roomId)}`).then((b) => { if (!stop) setLive(b); }).catch(() => { if (!stop) setLive((l) => l ?? { live: false, why: 'error' }); });
    };
    load();
    const t = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', load); };
  }, [roomId, enabled]);
  return live;
}

/** The three indicators at the top: pace against its expected range, service health, staffing. */
function Indicators({ items }) {
  return (
    <div className={s.tiles} role="list" aria-label="Service at a glance">
      {items.map(([k, v, t, tone]) => (
        <div key={k} role="listitem" className={`${s.tile} ${tone ? s[`t_${tone}`] : ''}`}><span className="cv-xs cv-faint">{k}</span><span className={s.v}>{v}</span><span className="cv-xs cv-faint">{t}</span></div>
      ))}
    </div>
  );
}

function Conclusion({ health }) {
  const icon = { warn: 'TriangleAlert', good: 'CircleCheck', accent: 'UserMinus', neutral: 'Activity' }[health.tone] || 'Activity';
  return <div className={`${s.conclusion} ${s[`c_${health.tone}`] || ''}`} role="status"><Icon name={icon} size={16} /><span>{health.text}</span></div>;
}

/** Every check a cut has to pass, with the ones the data can't answer shown as the manager's to make. */
function Checks({ checks }) {
  return (
    <ul className={s.checks} aria-label="Checks before a release">
      {checks.map((c) => (
        <li key={c.key} className={c.ok === true ? s.pass : c.ok === false ? s.fail : s.manual}>
          <Icon name={c.ok === true ? 'CircleCheck' : c.ok === false ? 'CircleX' : 'CircleHelp'} size={14} />
          <span><span className="sr-only">{c.ok === true ? 'Passes: ' : c.ok === false ? 'Fails: ' : 'Yours to check: '}</span>{c.label}{c.note ? <span className="cv-faint"> {c.note}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** The numbers behind the pacing chart, as a table for screen readers and anyone who wants them. */
function PaceTable({ comp, actual, start, spread, factor }) {
  return (
    <details className={s.details}>
      <summary>Numbers behind the chart</summary>
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Covers per 15 minutes">
        <table className="cv-table">
          <thead><tr><th>From</th><th className="r">Comparable</th><th className="r">Tonight</th><th className="r">Forecast range</th></tr></thead>
          <tbody>{comp.map((c, i) => (
            <tr key={i}><td>{clockLabel(start + i * SLOT_MIN)}</td><td className="r cv-num">{c}</td><td className="r cv-num">{actual[i] ?? '—'}</td><td className="r cv-num">{i < actual.length ? '—' : `${Math.round(c * factor * (1 - spread))}–${Math.round(c * factor * (1 + spread))}`}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

const EXEC_LOOK = { awaiting: ['Hourglass', 'Awaiting execution'], 'not-seen': ['Hourglass', 'Awaiting execution'], unconfirmed: ['CircleHelp', 'Can’t confirm from Toast'], confirmed: ['CircleCheck', 'Confirmed in Toast'], breach: ['TriangleAlert', 'Guardrail: covers above the band'] };

/** After approval: what's true, never more. A ticked task is "marked done", not "executed". */
function Execution({ task, execution, onUndo, onToday }) {
  const [icon, label] = execution ? EXEC_LOOK[execution.state] : task.status === 'open' ? ['Hourglass', 'Awaiting execution'] : ['ListChecks', 'Marked done on Today'];
  const tone = execution?.state === 'breach' ? 'bad' : execution?.state === 'confirmed' ? 'good' : 'info';
  return (
    <div className="cv-col" style={{ gap: 8 }}>
      <div className="cv-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Pill tone={tone} icon={icon}>{label}</Pill>
        {task.status !== 'open' && !execution && <span className="cv-xs cv-faint">Not yet confirmed from Toast clock-ins</span>}
      </div>
      <span className="cv-xs cv-muted">{execution?.text || 'A task with the 7shifts steps is on Today. Nothing changes in 7shifts until someone makes the change there.'}</span>
      <div className="cv-row" style={{ gap: 8 }}>
        <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={onToday}>Open Today</Button>
        {task.status === 'open' && <Button size="sm" variant="ghost" icon="Undo2" onClick={onUndo}>Undo approval</Button>}
      </div>
    </div>
  );
}

function ServiceOwn() {
  const cv = useCv();
  const eng = useEngine();
  const server = eng.mode === 'server';
  const live = useLive(CV_D.id, server);
  const today = live?.date ? { date: live.date, day: live.day, minutes: live.nowMin } : localNow(new Date());
  const [fencesSaved] = useSaved('fences', null);
  const fences = fencesOf(fencesSaved);
  const plan = servicePlan(CV_D.room, today.day, fencesSaved);
  const [saved, setNight] = useSaved('service.night', null);
  const night = saved?.date === today.date ? saved : null;
  const answer = night?.answer ?? 'ask';
  const task = (eng.tasks || []).find((t) => t.roomId === CV_D.id && isCutFor(t.approvalId, today.date) && t.status !== 'cancelled');
  const [busy, setBusy] = React.useState(false);
  const [review, setReview] = React.useState(false);
  const [evidence, setEvidence] = React.useState(false);
  const L = live?.live ? live.night : null;
  const lc = L?.call;

  // Tonight's one recommendation: from the live call when Toast is live, else from the plan.
  const cutAt = L ? (lc.mode === 'cut' ? lc.at : null) : plan?.cutFrom != null ? plan.cutFrom * 60 : null;
  const servers = L ? lc.serversNow : plan?.cutFrom != null ? Math.round(plan.hours.find((h) => h.hour === plan.cutFrom).servers) : null;
  const value = L ? lc.value : plan?.value ?? null;

  const approve = async () => {
    if (cutAt == null || busy) return;
    setBusy(true);
    try {
      let a;
      if (server) {
        a = (await call('/api/page/service/cut', { method: 'POST', body: JSON.stringify({ roomId: CV_D.id, date: today.date, at: hhmm(cutAt) }) })).approval;
      } else {
        a = { approvalId: cutApprovalId(today.date, cutAt), title: `${today.day} ${today.date}: one fewer server from ${clockLabel(cutAt)} to close`, system: '7shifts', diff: [[`${today.day} ${clockLabel(cutAt)} to close`, `${servers} servers`, `${servers - 1} servers`]] };
      }
      await engine.createTask(a.approvalId, a);
      setNight({ date: today.date, answer: 'yes', at: hhmm(cutAt), approvalId: a.approvalId }, `${today.day}: release one server from ${clockLabel(cutAt)} approved`);
      setReview(false);
      cv.toast('Approved. A task with the 7shifts steps is on Today. Nothing has changed in 7shifts yet.');
    } catch (err) {
      cv.toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const decline = () => { setNight({ date: today.date, answer: 'no', at: cutAt != null ? hhmm(cutAt) : null }, `${today.day}: kept everyone on`); setReview(false); cv.toast('Kept everyone on tonight. Your answer is saved.'); };
  const reopen = async () => {
    if (task?.status === 'open') await engine.taskAction(task.id, 'cancel');
    setNight({ date: today.date, answer: 'ask', at: null }, 'Service answer reopened');
  };

  const dayName = `${dayOf(today.day)} dinner`;
  const ago = (min) => (min <= 1 ? 'just now' : `${min} min ago`);
  const context = L
    ? `Live · Toast pulled every ${live.cadenceMin} min, last ${ago(Math.round((Date.now() - Date.parse(live.fetchedAt)) / 6e4))} · orders through ${L.dataThrough != null ? clockLabel(L.dataThrough) : 'none yet'} · ${L.weeks} comparable ${days(today.day)}`
    : `Planning · from your Toast data through ${CV_D.room.fromToast.end}, not tonight's live demand`;
  const staleNote = L?.stale ? <Callout tone="warn" icon="TriangleAlert">No new orders from Toast since {L.dataThrough != null ? clockLabel(L.dataThrough) : 'service started'}, while a comparable {dayOf(today.day)} would have had some. Live suggestions are paused until orders flow again.</Callout> : null;

  // Indicators, the conclusion, and the recommendation, for each mode.
  let indicators, health, rec = null, checks = [], why = null;
  if (L) {
    const lo = Math.round(lc.cmp * (1 - lc.spread)), hi = Math.round(lc.cmp * (1 + lc.spread));
    health = L.health;
    indicators = [
      ['Pace', `${lc.so} covers`, lc.now ? `expected ${lo}–${hi} by now` : 'service not started', lc.so > hi ? 'warn' : null],
      ['Service', { warn: 'Check', good: 'On track', accent: 'Light', neutral: lc.mode === 'early' ? 'Starting' : 'Slow' }[health.tone] ?? '—', 'kitchen times: no feed'],
      ['Staffing', lc.serversNow != null ? `${lc.serversNow} servers on` : 'No clock-ins', lc.needTop != null && lc.mode !== 'early' ? `need ${lc.needMid === lc.needTop ? lc.needTop : `${lc.needMid}–${lc.needTop}`}` : 'from Toast clock-ins'],
    ];
    checks = lc.checks;
    if (lc.mode === 'cut') rec = { at: lc.at, title: `Review an early release for one server from ${clockLabel(lc.at)}`, why: `Covers are pacing ${Math.abs(lc.pace)}% ${lc.pace < 0 ? 'under' : 'over'} the last ${L.weeks} ${days(today.day)}. Even at the top of the forecast band (±${Math.round(lc.spread * 100)}%), ${lc.serversNow - 1} servers cover each hour to close.`, source: `Toast orders and clock-ins tonight, against ${L.weeks} comparable ${days(today.day)}`, risk: 'If covers climb above the band after the release, you’d be one server short. This page watches for that and warns you.' };
    else if (lc.mode === 'wait') why = lc.why === 'history' ? `One fewer server looks safe, but there are only ${L.weeks} comparable ${days(today.day)} to size the band. It needs ${3}.` : `At the forecast, ${lc.needMid} servers are enough, but at the band's top ${lc.needTop} are needed. Checking again at ${clockLabel(lc.checkAt)}.`;
  } else if (plan) {
    const spare = plan.hours.reduce((t, h) => t + h.idle, 0);
    health = plan.cutFrom != null ? { tone: 'accent', text: 'Staffing may be above typical demand tonight.' } : { tone: 'good', text: plan.blocked ? 'Keep everyone on: a fence holds tonight.' : 'Keep everyone on tonight.' };
    indicators = [
      ['Typical covers', `${plan.hours.reduce((t, h) => t + h.covers, 0)}`, `on recent ${days(today.day)}`],
      ['Peak hour', clockLabel(plan.hours.reduce((a, b) => (b.peak > a.peak ? b : a)).hour * 60), `up to ${Math.max(...plan.hours.map((h) => h.peak))} covers`],
      ['Staffing', `${spare} spare srv-h`, 'sized for the busiest week'],
    ];
    checks = [
      { key: 'peak', label: 'Every hour from the cut had a spare even in its busiest week', ok: plan.spareFrom != null },
      { key: 'history', label: 'At least 3 recent weeks of this weekday', ok: plan.weeks >= 3 },
      { key: 'floor', label: `At least ${fences.minDinner} servers stay on dinner`, ok: plan.blocked?.why !== 'floor' },
      { key: 'cutBy', label: `Before your latest same-night cut (${clockLabel(fences.cutBy)})`, ok: plan.blocked?.why !== 'late' },
      { key: 'live', label: 'Tonight’s live demand', ok: null, note: 'This is a plan from recent weeks. Look at the room before you release anyone.' },
      { key: 'roles', label: 'Sections and roles stay covered', ok: null, note: 'Toast doesn’t say who covers which section.' },
    ];
    if (plan.cutFrom != null) rec = { at: plan.cutFrom * 60, title: `Plan an early release for one server from ${clockLabel(plan.cutFrom * 60)}`, why: `On each of the last ${plan.weeks} ${days(today.day)}, every hour from ${clockLabel(plan.cutFrom * 60)} to close had a spare server, even in its busiest week, at this room's pace of ${plan.rate.toFixed(1)} covers per server-hour.`, source: `Your Toast orders and time entries through ${CV_D.room.fromToast.end}`, risk: 'This is based on recent weeks, not tonight. If tonight is busier, keep everyone on.' };
    else if (plan.blocked) why = plan.blocked.text;
  }

  const benefit = value != null
    ? <>Potential: about {cvMoney(value)} of wages tonight, not saved until it happens. <Claim k="est" /></>
    : <>Potential saving not shown: your data has no wage rates for servers.</>;

  const recCard = rec && (
    <section className={`cv-card ${s.call} ${s.cut}`} aria-labelledby="svc-rec">
      <div className={s.callHead}><span className={s.callIcon}><Icon name="UserMinus" size={15} /></span><span className="cv-xs cv-faint">{L ? 'One recommendation' : 'Tonight’s plan'}</span></div>
      <span id="svc-rec" className={s.callTitle}>{rec.title}</span>
      <span className={s.callBody}>{rec.why}</span>
      <span className={s.callBody}>{benefit}</span>
      {task ? <Execution task={task} execution={L?.execution} onUndo={reopen} onToday={() => cv.go('today')} />
        : answer === 'no' ? <div className="cv-row" style={{ gap: 8 }}><Pill icon="CircleMinus">Kept everyone on tonight</Pill><Button size="sm" variant="ghost" icon="Undo2" onClick={reopen}>Change my answer</Button></div>
        : review ? (
          <div className={s.review}>
            <span className="cv-small" style={{ fontWeight: 600 }}>Before you approve</span>
            <Checks checks={checks} />
            <span className="cv-xs cv-muted"><b>Risk:</b> {rec.risk}</span>
            <span className="cv-xs cv-muted"><b>What happens next:</b> approving checks this again on fresh data, then puts a task with the 7shifts steps on Today. Nothing changes in 7shifts until someone makes the change there{L ? '; Coversight then confirms it from Toast clock-ins' : ''}.</span>
            <div className={s.actions}>
              <Button className="btn-lg" icon="Check" onClick={approve} disabled={busy}>{busy ? 'Checking…' : 'Approve and create the task'}</Button>
              <Button className="btn-lg" variant="secondary" onClick={() => setReview(false)} disabled={busy}>Back</Button>
            </div>
          </div>
        ) : (
          <>
            <div className={s.actions}>
              <Button className="btn-lg" icon="ClipboardCheck" onClick={() => setReview(true)}>Review change</Button>
              <Button className="btn-lg" variant="secondary" onClick={decline}>Not tonight</Button>
            </div>
            <Button size="sm" variant="ghost" icon={evidence ? 'ChevronUp' : 'ChevronDown'} onClick={() => setEvidence((x) => !x)} aria-expanded={evidence}>View evidence</Button>
            {evidence && <div className={s.review}><span className="cv-xs cv-muted"><b>Source:</b> {rec.source}.</span><Checks checks={checks} /></div>}
          </>
        )}
    </section>
  );
  const noRec = !rec && why && (
    <section className={`cv-card ${s.call} ${s.wait}`}>
      <div className={s.callHead}><span className={s.callIcon}><Icon name="Hourglass" size={15} /></span><span className="cv-xs cv-faint">No change suggested</span></div>
      <span className={s.callBody}>{why}</span>
    </section>
  );

  const liveNote = !server ? <Callout icon="Info">Live pacing needs the Toast API connected. Until then, this plans tonight from the same weekday in your data.</Callout>
    : live == null ? <Callout icon="Loader">Checking Toast for tonight…</Callout>
    : live.live ? null
    : live.why === 'not-connected' ? <Callout icon="PlugZap">Live pacing turns on when Toast is connected for this room. Until then, this is a plan from your data, not tonight&apos;s demand. <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('connect')}>Connect Toast</Button></Callout>
    : live.why === 'no-history' ? <Callout icon="Hourglass">Live pacing needs at least two recent {days(today.day)} from the Toast sync to compare against. It starts on its own once they&apos;re in.</Callout>
    : <Callout tone="warn" icon="TriangleAlert">{live.message || 'Couldn’t reach Toast just now.'} Showing tonight&apos;s plan instead.</Callout>;

  return (
    <div className="cv-page">
      <PageHead over={`Service · ${CV_ROOM.name} · ${dayName} · ${clockLabel(today.minutes)}`} q="How is service going?" sub={context} />
      {liveNote}
      {staleNote}
      {!plan && !L ? <Callout icon="Clock">Not enough {dayOf(today.day)} dinners with servers on the floor in your data yet. Upload Toast&apos;s TimeEntries.csv with your orders on Data inputs (it needs 20+ busy hours). <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('inputs')}>Data inputs</Button></Callout> : (
        <div className="cv-phone-stage">
          <div className="cv-phone" aria-label="Tonight">
            <span className="notch" />
            <StatusRow day={dayName} time={clockLabel(today.minutes)} live={!!L && !L.stale} source={L ? (L.stale ? 'Live · stale' : 'Live') : 'Planning'} />
            <Indicators items={indicators} />
            <Conclusion health={health} />
            {recCard}
            {noRec}
            {L ? (
              <section className="cv-card">
                <div className="cv-row" style={{ justifyContent: 'space-between' }}><span className="cv-xs cv-faint">Covers every 15 minutes</span><span className="cv-xs cv-faint">band ±{Math.round(lc.spread * 100)}% · {lc.band?.calibrated ? `backtested on ${lc.band.nights} nights` : 'not calibrated yet'}</span></div>
                <PaceChart comp={L.comp} actual={L.actual} now={L.actual.length} factor={lc.factor} spread={lc.spread} start={L.win.start} cutSlot={lc.mode === 'cut' ? (lc.at - L.win.start) / SLOT_MIN : null} />
                <Legend />
                <span className="cv-xs cv-faint">Rest of tonight: {lc.range[0]}–{lc.range[1]} more covers forecast.</span>
                <PaceTable comp={L.comp} actual={L.actual} start={L.win.start} spread={lc.spread} factor={lc.factor} />
              </section>
            ) : (
              <section className="cv-card">
                <div className="cv-row" style={{ justifyContent: 'space-between' }}><span className="cv-xs cv-faint">A typical {dayOf(today.day)}, hour by hour</span><span className="cv-xs cv-faint">{plan.rate.toFixed(1)} covers / server-hour</span></div>
                <HourStrip plan={plan} cutFrom={plan.cutFrom} />
                <SeatKey />
              </section>
            )}
          </div>
          <div className="cv-col" style={{ gap: 16 }}>
            {L && plan && (
              <section className="cv-card">
                <div className="cv-card-head"><span className="cv-h4">A typical {dayOf(today.day)}, hour by hour</span><span className="cv-xs cv-faint">last {plan.weeks} weeks</span></div>
                <HourStrip plan={plan} cutFrom={null} />
                <SeatKey />
              </section>
            )}
            <FenceCard fences={fences} hit={L ? (lc.why === 'floor' ? 'floor' : lc.mode === 'late' ? 'late' : null) : plan?.blocked?.why} />
            <WhyCard />
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================ the sample group */

function ServiceSample() {
  const cv = useCv();
  const sv = CV_D.room.service;
  const [state, setState] = useSaved('service', 'ask');
  const [fencesSaved] = useSaved('fences', null);
  const fences = fencesOf(fencesSaved);
  const so = sv.actual.reduce((a, b) => a + b, 0);
  const cmp = sv.comp.slice(0, sv.now).reduce((a, b) => a + b, 0);
  const spread = sv.mode === 'wait' ? 0.2 : bandSpread(sv.now, sv.comp.length) * 0.65;
  const start = DINNER_FROM * 60;
  const cutSlot = sv.mode === 'cut' ? 12 : null;
  const tone = sv.mode === 'cut' ? 'cut' : sv.mode === 'wait' ? 'wait' : 'quiet';
  return (
    <div className="cv-page">
      <PageHead over={`Service · ${CV_ROOM.name} · ${sv.day} · ${CV_NOW.time}`} q="How is service going?"
        sub="Sample night: a fixed scene on the sample group, not live data. On your own restaurant this page paces tonight from Toast and makes at most one staffing call." />
      <SampleNote what="Tonight’s pacing" />
      <div className="cv-phone-stage">
        <div className="cv-phone" aria-label="Tonight">
          <span className="notch" />
          <StatusRow day={sv.day} time={CV_NOW.time} source="Sample night" />
          <section className="cv-card">
            <PaceHero so={so} cmp={cmp} pace={sv.pace} />
            <PaceChart comp={sv.comp} actual={sv.actual} now={sv.now} factor={sv.factor} spread={spread} start={start} cutSlot={cutSlot} />
            <Legend />
          </section>
          {sv.mode === 'cut' ? (
            <CallCard tone="cut" over="One suggestion" title={sv.title} body={<>{sv.body} Potential: <Money id="service-cut">{cvMoney(sv.value)}</Money> of wages tonight, not saved until it happens. <Claim k="est" /></>}>
              {state === 'ask' ? (
                <div className={s.actions}>
                  <Button className="btn-lg" icon="ClipboardCheck" onClick={() => cv.approve(sv.approval, () => setState('yes', sv.title))}>Review change</Button>
                  <Button variant="secondary" className="btn-lg" onClick={() => { setState('no', `${sv.title}: declined`); cv.toast('Kept everyone on. Logged as declined.'); }}>Not tonight</Button>
                </div>
              ) : (
                <div className="cv-row" style={{ gap: 8 }}>
                  {state === 'yes' ? <Pill tone="info" icon="Hourglass">Approved · awaiting execution</Pill> : <Pill icon="CircleMinus">Kept everyone on</Pill>}
                  {state === 'yes' && <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('today')}>Open Today</Button>}
                  <Button size="sm" variant="ghost" icon="Undo2" onClick={() => setState('ask', `${sv.title}: answer reopened`)}>Change my answer</Button>
                </div>
              )}
            </CallCard>
          ) : (
            <CallCard tone={tone} over={sv.mode === 'quiet' ? 'No suggestion' : 'Not yet'} title={sv.title} body={sv.body} />
          )}
          <Tiles items={sv.tiles} />
        </div>
        <div className="cv-col" style={{ gap: 16 }}>
          <FenceCard fences={fences} />
          <WhyCard />
          <section className="cv-card">
            <span className="cv-h4">Tonight in the other rooms</span>
            <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>Each room runs the same rules. Switch rooms in the top bar: one has a cut ready, one is quiet, and one is waiting for the band to narrow.</span>
          </section>
          <Callout icon="Smartphone">Laid out for a phone first. Open this page on your phone to see it at full size.</Callout>
        </div>
      </div>
      <DenseService />
    </div>
  );
}

function CvService() {
  if (CV_D.room.fromToast) return <ServiceOwn />;
  return <ServiceSample />;
}

export { CvService };
