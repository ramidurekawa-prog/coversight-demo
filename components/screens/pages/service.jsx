'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_NOW, Claim, Money, Pill, PageHead, cvScale } from '../core';
import { DenseService } from '../dense-sections';
import { bandSpread, clockLabel, cutApprovalId, DINNER_FROM, fencesOf, hhmm, isCutFor, localNow, MIN_CALIBRATED, servicePlan, SLOT_MIN } from '../../../lib/data/page/service.js';
import s from './service.module.css';

const FULL_DAY = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const days = (d) => `${FULL_DAY[d] ?? d}s`;
const dayOf = (d) => FULL_DAY[d] ?? d;
const POLL_MS = 120_000;
const short = (min) => clockLabel(min).replace(' pm', '').replace(' am', '');

/* ================================================================ the visual pieces */

/** The big status chip: two or three words, colour plus icon. */
const STATUS = {
  good: ['CircleCheck', s.st_good],
  warn: ['TriangleAlert', s.st_warn],
  accent: ['UserMinus', s.st_accent],
  neutral: ['Activity', s.st_neutral],
};
function StatusCard({ tone, label, sub }) {
  const [icon, cls] = STATUS[tone] || STATUS.neutral;
  return (
    <section className={`${s.kpi} ${s.statusCard} ${cls}`} role="status" aria-live="polite">
      <span className={s.kpiLabel}>Tonight</span>
      <span className={s.statusBig}><Icon name={icon} size={26} />{label}</span>
      {sub && <span className={s.kpiSub}>{sub}</span>}
    </section>
  );
}

/** Covers so far as a big number, with a bar showing where it sits in the expected range. */
function CoversCard({ label, value, lo, hi, max, sub, marker = true }) {
  const top = Math.max(max ?? hi * 1.25, value * 1.1, 1);
  const pct = (v) => `${Math.min(100, (v / top) * 100)}%`;
  const where = value > hi ? s.over : value < lo ? s.under : s.inside;
  return (
    <section className={s.kpi} aria-label={`${label}: ${value}, expected ${lo} to ${hi}`}>
      <span className={s.kpiLabel}>{label}</span>
      <span className={s.big}>{value}</span>
      <div className={s.gauge} aria-hidden="true">
        <span className={s.range} style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
        {marker && <span className={`${s.marker} ${where}`} style={{ left: pct(value) }} />}
      </div>
      <span className={s.kpiSub}>{sub}</span>
    </section>
  );
}

/** Servers on the floor as seats: filled are needed, open are spare, dashed is the one to release. */
function ServersCard({ on, need, release, sub }) {
  if (on == null) return <section className={s.kpi}><span className={s.kpiLabel}>Servers</span><span className={s.big}>—</span><span className={s.kpiSub}>{sub || 'No clock-ins yet'}</span></section>;
  return (
    <section className={s.kpi} aria-label={`${on} servers on, ${need} needed`}>
      <span className={s.kpiLabel}>Servers</span>
      <span className={s.big}>{on}<span className={s.bigOf}> on · {need} needed</span></span>
      <span className={s.bigSeats} aria-hidden="true">
        {Array.from({ length: Math.min(on, 12) }, (_, i) => <span key={i} className={`${s.bigSeat} ${i < need ? '' : release && i === on - 1 ? s.gone : s.spare}`} />)}
      </span>
      {sub && <span className={s.kpiSub}>{sub}</span>}
    </section>
  );
}

/**
 * Covers every 15 minutes: tonight, the comparable night and the forecast band.
 * Hover, tap or arrow-key along it to read any quarter hour; the chips turn
 * layers on and off.
 */
function PaceChart({ comp, actual, now, factor, spread, start, cutSlot }) {
  const [sel, setSel] = React.useState(null);
  const [show, setShow] = React.useState({ comp: true, band: true });
  const W = 640, H = 220, P = { l: 30, r: 12, t: 22, b: 26 };
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
  const step = (W - P.l - P.r) / Math.max(1, n - 1);
  const i = sel ?? (now > 0 ? now - 1 : 0);
  const at = clockLabel(start + i * SLOT_MIN);
  const tip = i < actual.length
    ? [`${at}`, `Tonight ${actual[i]}`, `Comparable ${comp[i]}`]
    : [`${at}`, `Forecast ${Math.round(comp[i] * factor * (1 - spread))}–${Math.round(comp[i] * factor * (1 + spread))}`, `Comparable ${comp[i]}`];
  const tipX = Math.min(W - P.r - 112, Math.max(P.l, x(i) - 56));
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { setSel(Math.min(n - 1, i + 1)); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { setSel(Math.max(0, i - 1)); e.preventDefault(); }
  };
  return (
    <div className={s.chartWrap}>
      <div className={s.chips} role="group" aria-label="Show on the chart">
        <button type="button" className={`${s.chip} ${s.chipOn}`} aria-pressed="true" disabled><i className={s.swTonight} />Tonight</button>
        <button type="button" className={`${s.chip} ${show.comp ? s.chipOn : ''}`} aria-pressed={show.comp} onClick={() => setShow((v) => ({ ...v, comp: !v.comp }))}><i className={s.swComp} />Comparable</button>
        <button type="button" className={`${s.chip} ${show.band ? s.chipOn : ''}`} aria-pressed={show.band} onClick={() => setShow((v) => ({ ...v, band: !v.band }))}><i className={s.swBand} />Forecast range</button>
      </div>
      <svg className={`cv-chart ${s.chart}`} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} onKeyDown={onKey} onMouseLeave={() => setSel(null)}
        aria-label={`Covers every 15 minutes. ${tip.join(', ')}. Use the arrow keys to move.`}>
        {[0, Math.round(top / 2), top].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
        {show.band && up.length > 1 && <polygon points={[...up, ...lo].map((p) => p.join(',')).join(' ')} fill="var(--accent)" opacity="0.16" />}
        {show.comp && <polyline points={comp.map((c, k) => `${x(k)},${y(c)}`).join(' ')} fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 3" />}
        {show.band && <polyline points={fc.map((c, k) => c != null && `${x(k)},${y(c)}`).filter(Boolean).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 3" />}
        {actual.length > 0 && <polyline points={actual.map((c, k) => `${x(k)},${y(c)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {cutSlot != null && cutSlot < n && <>
          <line x1={x(cutSlot)} x2={x(cutSlot)} y1={P.t} y2={H - P.b} stroke="var(--warning-600)" strokeWidth="1.5" strokeDasharray="3 3" />
          <text x={x(cutSlot) + 5} y={H - P.b - 6} style={{ fill: 'var(--warning-600)', fontWeight: 600 }}>release {short(start + cutSlot * SLOT_MIN)}</text>
        </>}
        <line x1={x(i)} x2={x(i)} y1={P.t} y2={H - P.b} stroke="var(--fg-2)" strokeWidth="1" opacity="0.5" />
        <circle cx={x(i)} cy={y(i < actual.length ? actual[i] : comp[i] * factor)} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
        <g transform={`translate(${tipX},${2})`} className={s.tip}>
          <rect width="112" height="44" rx="6" />
          {tip.map((t, k) => <text key={k} x="8" y={14 + k * 12} className={k ? '' : 'lbl'}>{t}</text>)}
        </g>
        {ticks.map((k) => <text key={k} x={x(k)} y={H - 8} textAnchor="middle">{short(start + k * SLOT_MIN)}</text>)}
        {comp.map((_, k) => <rect key={k} x={x(k) - step / 2} y={P.t} width={step} height={H - P.t - P.b} fill="transparent" onMouseEnter={() => setSel(k)} onClick={() => setSel(k)} />)}
      </svg>
    </div>
  );
}

/** A typical night hour by hour: bars for covers, seats for servers. Tap an hour to read it. */
function HourBars({ plan, cutFrom }) {
  const [sel, setSel] = React.useState(null);
  const max = Math.max(...plan.hours.map((h) => h.peak), 1);
  const h = plan.hours.find((x) => x.hour === sel) ?? plan.hours.reduce((a, b) => (b.peak > a.peak ? b : a));
  return (
    <div className={s.hourChart}>
      <div className={s.cols} role="group" aria-label="Hour by hour">
        {plan.hours.map((x) => {
          const on = Math.round(x.servers);
          const cutting = cutFrom != null && x.hour >= cutFrom;
          return (
            <button key={x.hour} type="button" className={`${s.col} ${x.hour === h.hour ? s.colSel : ''} ${cutting ? s.colCut : ''}`} onClick={() => setSel(x.hour)} aria-pressed={x.hour === h.hour}
              aria-label={`${clockLabel(x.hour * 60)}: typically ${x.covers} covers, up to ${x.peak}; ${on} servers on, ${x.need} needed`}>
              <span className={s.colSeats} aria-hidden="true">{Array.from({ length: Math.min(on, 8) }, (_, i) => <span key={i} className={`${s.seat} ${i < x.need ? '' : cutting && i === on - 1 ? s.gone : s.spare}`} />)}</span>
              <span className={s.colTrack} aria-hidden="true">
                <span className={s.colPeak} style={{ height: `${(x.peak / max) * 100}%` }} />
                <span className={s.colBar} style={{ height: `${(x.covers / max) * 100}%` }} />
              </span>
              <span className={s.colLabel}>{short(x.hour * 60)}</span>
            </button>
          );
        })}
      </div>
      <div className={s.readout} aria-live="polite">
        <b>{clockLabel(h.hour * 60)}</b>
        <span><span className={s.num}>{h.covers}</span> covers typical · up to <span className={s.num}>{h.peak}</span></span>
        <span><span className={s.num}>{Math.round(h.servers)}</span> on · <span className={s.num}>{h.need}</span> needed{h.idle ? ` · ${h.idle} spare` : ''}</span>
      </div>
      <div className="cv-legend">
        <span><i className={s.swBar} />Typical covers</span>
        <span><i className={s.swPeak} />Busiest week</span>
        <span><i className={s.seat} style={{ borderRadius: '50%' }} />Needed</span>
        <span><i className={`${s.seat} ${s.spare}`} style={{ borderRadius: '50%' }} />Spare</span>
      </div>
    </div>
  );
}

/** Every check a release has to pass. Ones the data can't answer are the manager's. */
function Checks({ checks }) {
  return (
    <ul className={s.checks} aria-label="Checks before a release">
      {checks.map((c) => (
        <li key={c.key} className={c.ok === true ? s.pass : c.ok === false ? s.fail : s.manual}>
          <Icon name={c.ok === true ? 'CircleCheck' : c.ok === false ? 'CircleX' : 'CircleHelp'} size={15} />
          <span><span className="sr-only">{c.ok === true ? 'Passes: ' : c.ok === false ? 'Fails: ' : 'Yours to check: '}</span>{c.label}{c.note ? <span className="cv-faint"> {c.note}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** "How this works": fences and rules, closed by default. */
function HowItWorks({ fences, extra }) {
  const cv = useCv();
  return (
    <details className={`cv-card ${s.how}`}>
      <summary><Icon name="CircleHelp" size={16} />How this works</summary>
      <div className={s.fences}>
        <div className={s.fence}><span className="cv-xs cv-faint">Fewest servers on dinner</span><span className={s.v}>{fences.minDinner}</span></div>
        <div className={s.fence}><span className="cv-xs cv-faint">Latest same-night release</span><span className={s.v}>{clockLabel(fences.cutBy)}</span></div>
      </div>
      <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('fences')}>Change fences</Button>
      <ul className="cv-ul">
        <li><Icon name="Activity" size={15} />The forecast range comes from how far off the forecast was on your own recent nights.</li>
        <li><Icon name="BellOff" size={15} />At most one suggestion and one alert per service. A release must be safe at the top of the range.</li>
        <li><Icon name="ShieldCheck" size={15} />Approving creates a task, never a change. It counts only once Toast clock-ins show it.</li>
        {extra}
      </ul>
    </details>
  );
}

/**
 * The one thing to do tonight: big title, potential value, two buttons.
 * Why, the checks and what happens next sit behind "Why?" and "Review".
 */
function ActionCard({ title, value, valueNode, why, checks, source, risk, next, state, onReview, onDecline, reviewing, onApprove, onBack, busy }) {
  const [open, setOpen] = React.useState(false);
  return (
    <section className={s.action} aria-labelledby="svc-act">
      <div className={s.actionMain}>
        <span className={s.kpiLabel}>Do this</span>
        <span id="svc-act" className={s.actionTitle}>{title}</span>
        {valueNode ?? (value != null
          ? <span className={s.actionValue}><span className={s.big}>{cvMoney(value)}</span><span className={s.kpiSub}>potential wages tonight, not saved yet <Claim k="est" /></span></span>
          : <span className={s.kpiSub}>No wage rates in your data, so no dollar figure.</span>)}
      </div>
      <div className={s.actionSide}>
        {state ? state : reviewing ? (
          <div className={s.review}>
            <Checks checks={checks} />
            <span className="cv-xs cv-muted">{risk}</span>
            <span className="cv-xs cv-muted">{next}</span>
            <div className={s.actions}>
              <Button className="btn-lg" icon="Check" onClick={onApprove} disabled={busy}>{busy ? 'Checking…' : 'Approve'}</Button>
              <Button className="btn-lg" variant="secondary" onClick={onBack} disabled={busy}>Back</Button>
            </div>
          </div>
        ) : (
          <>
            <div className={s.actions}>
              <Button className="btn-lg" icon="ClipboardCheck" onClick={onReview}>Review</Button>
              <Button className="btn-lg" variant="secondary" onClick={onDecline}>Not tonight</Button>
            </div>
            <button type="button" className={s.why} onClick={() => setOpen((v) => !v)} aria-expanded={open}><Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />Why?</button>
            {open && <div className={s.review}><span className="cv-xs cv-muted">{why}</span>{checks && <Checks checks={checks} />}{source && <span className="cv-xs cv-faint">Source: {source}</span>}</div>}
          </>
        )}
      </div>
    </section>
  );
}

/** A small banner when there's nothing to do, or something stops the page acting. */
function Note({ tone = 'neutral', icon = 'Info', children, action }) {
  return <div className={`${s.note} ${s[`n_${tone}`] || ''}`}><Icon name={icon} size={16} /><span>{children}</span>{action}</div>;
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

const EXEC = { awaiting: ['Hourglass', 'Awaiting execution', 'info'], 'not-seen': ['Hourglass', 'Awaiting execution', 'info'], unconfirmed: ['CircleHelp', 'Can’t confirm from Toast', 'warn'], confirmed: ['CircleCheck', 'Confirmed in Toast', 'good'], breach: ['TriangleAlert', 'Covers above range: consider calling back', 'bad'] };

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
      cv.toast('Approved. The 7shifts steps are on Today. Nothing has changed in 7shifts yet.');
    } catch (err) {
      cv.toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const decline = () => { setNight({ date: today.date, answer: 'no', at: cutAt != null ? hhmm(cutAt) : null }, `${today.day}: kept everyone on`); setReview(false); cv.toast('Kept everyone on tonight. Saved.'); };
  const reopen = async () => {
    if (task?.status === 'open') await engine.taskAction(task.id, 'cancel');
    setNight({ date: today.date, answer: 'ask', at: null }, 'Service answer reopened');
  };

  const dayName = `${dayOf(today.day)} dinner`;
  const ago = (min) => (min <= 1 ? 'just now' : `${min} min ago`);

  // The mode line: what this is, and how fresh.
  const modeLine = L
    ? <><span className={`${s.dot} ${L.stale ? '' : s.live}`} />Live from Toast · orders through {L.dataThrough != null ? clockLabel(L.dataThrough) : '—'} · updated {ago(Math.round((Date.now() - Date.parse(live.fetchedAt)) / 6e4))}</>
    : <><span className={s.dot} />Planning · recent {days(today.day)}, not tonight&apos;s live demand</>;

  let status, kpis, chart = null, checks = [], act = null, watch = null;
  if (L) {
    const lo = Math.round(lc.cmp * (1 - lc.spread)), hi = Math.round(lc.cmp * (1 + lc.spread));
    const h = L.health;
    status = { tone: h.tone, label: { warn: L.stale ? 'Data too old' : 'Busier than expected', good: 'On track', accent: 'One server spare', neutral: lc.mode === 'early' ? 'Just starting' : 'Quieter, all needed' }[h.tone] ?? 'On track', sub: `${lc.pace > 0 ? '+' : ''}${lc.pace}% vs a usual ${dayOf(today.day)}` };
    kpis = [
      <CoversCard key="c" label="Covers so far" value={lc.so} lo={lo} hi={hi} sub={lc.now ? `expected ${lo}–${hi} by now` : 'service not started'} marker={lc.now > 0} />,
      <ServersCard key="s" on={lc.serversNow} need={lc.needTop ?? lc.needMid ?? 0} release={lc.mode === 'cut'} sub={lc.needTop != null && lc.needMid !== lc.needTop ? `${lc.needMid}–${lc.needTop} needed across the range` : null} />,
    ];
    chart = <PaceChart comp={L.comp} actual={L.actual} now={L.actual.length} factor={lc.factor} spread={lc.spread} start={L.win.start} cutSlot={lc.mode === 'cut' ? (lc.at - L.win.start) / SLOT_MIN : null} />;
    checks = lc.checks;
    if (lc.mode === 'cut') act = { title: `Release 1 server at ${clockLabel(lc.at)}`, why: `Covers are ${Math.abs(lc.pace)}% ${lc.pace < 0 ? 'under' : 'over'} the last ${L.weeks} ${days(today.day)}. Even at the top of the range, ${lc.serversNow - 1} servers cover every hour to close.`, source: `Toast tonight vs ${L.weeks} comparable ${days(today.day)}` };
    else if (lc.mode === 'wait') watch = lc.why === 'history' ? `Looks light, but only ${L.weeks} comparable nights. Needs ${MIN_CALIBRATED} to suggest a release.` : `Watching. Checking again at ${clockLabel(lc.checkAt)}.`;
    else if (lc.mode === 'stale') watch = `No new Toast orders since ${L.dataThrough != null ? clockLabel(L.dataThrough) : 'service started'}. Suggestions paused.`;
    else if (lc.mode === 'late') watch = `Past your latest release time (${clockLabel(fences.cutBy)}).`;
    else if (lc.mode === 'unknown') watch = 'No servers clocked in on Toast, so no staffing call.';
    else if (lc.mode === 'early') watch = `First call at ${clockLabel(lc.checkAt)}.`;
  } else if (plan) {
    const typical = plan.hours.reduce((t, x) => t + x.covers, 0), peakTotal = plan.hours.reduce((t, x) => t + x.peak, 0);
    const peakHour = plan.hours.reduce((a, b) => (b.peak > a.peak ? b : a));
    status = plan.cutFrom != null ? { tone: 'accent', label: 'One server spare', sub: `from ${clockLabel(plan.cutFrom * 60)} on recent ${days(today.day)}` } : { tone: 'good', label: 'Keep everyone on', sub: plan.blocked ? 'a fence holds tonight' : `every hour used its servers` };
    kpis = [
      <CoversCard key="c" label={`Covers on a ${dayOf(today.day)}`} value={typical} lo={typical} hi={peakTotal} max={peakTotal * 1.15} sub={`typical · up to ${peakTotal} in the busiest week`} marker />,
      <ServersCard key="s" on={Math.round(peakHour.servers)} need={peakHour.need} release={false} sub={`at the ${clockLabel(peakHour.hour * 60)} peak`} />,
    ];
    checks = [
      { key: 'peak', label: 'Every hour from the release had a spare, even in its busiest week', ok: plan.spareFrom != null },
      { key: 'history', label: `At least ${MIN_CALIBRATED} recent ${days(today.day)}`, ok: plan.weeks >= MIN_CALIBRATED },
      { key: 'floor', label: `At least ${fences.minDinner} servers stay on dinner`, ok: plan.blocked?.why !== 'floor' },
      { key: 'cutBy', label: `Before ${clockLabel(fences.cutBy)}, your latest release`, ok: plan.blocked?.why !== 'late' },
      { key: 'live', label: 'Tonight’s live demand', ok: null, note: 'This is a plan from recent weeks. Look at the room first.' },
      { key: 'roles', label: 'Sections and roles stay covered', ok: null, note: 'Toast doesn’t show sections.' },
    ];
    if (plan.cutFrom != null) act = { title: `Plan to release 1 server at ${clockLabel(plan.cutFrom * 60)}`, why: `On each of the last ${plan.weeks} ${days(today.day)}, every hour from ${clockLabel(plan.cutFrom * 60)} had a spare server, even in its busiest week (${plan.rate.toFixed(1)} covers per server-hour).`, source: `Toast data through ${CV_D.room.fromToast.end}` };
    else if (plan.blocked) watch = plan.blocked.text;
  }

  const ex = L?.execution;
  const actState = task ? (
    <div className={s.stateBox}>
      {(() => { const [icon, label, tone] = ex ? EXEC[ex.state] : task.status === 'open' ? EXEC.awaiting : ['ListChecks', 'Marked done on Today', 'info']; return <Pill tone={tone} icon={icon}>{label}</Pill>; })()}
      {ex?.text && <span className="cv-xs cv-muted">{ex.text}</span>}
      <div className={s.actions}>
        <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('today')}>Open Today</Button>
        {task.status === 'open' && <Button size="sm" variant="ghost" icon="Undo2" onClick={reopen}>Undo</Button>}
      </div>
    </div>
  ) : answer === 'no' ? (
    <div className={s.stateBox}><Pill icon="CircleMinus">Kept everyone on</Pill><Button size="sm" variant="ghost" icon="Undo2" onClick={reopen}>Change</Button></div>
  ) : null;

  const banner = !server ? null
    : live == null ? <Note icon="Loader">Checking Toast…</Note>
    : live.live ? null
    : live.why === 'not-connected' ? <Note icon="PlugZap" action={<Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('connect')}>Connect Toast</Button>}>Connect Toast to pace tonight live.</Note>
    : live.why === 'no-history' ? <Note icon="Hourglass">Live pacing starts once two recent {days(today.day)} are synced.</Note>
    : <Note tone="warn" icon="TriangleAlert">{live.message || 'Couldn’t reach Toast.'} Showing the plan.</Note>;

  if (!plan && !L) {
    return (
      <div className="cv-page">
        <PageHead over={`Service · ${CV_ROOM.name} · ${dayName}`} q="How is service going?" />
        <Note icon="Clock" action={<Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('inputs')}>Data inputs</Button>}>Needs Toast orders and time entries for {days(today.day)} (20+ busy hours).</Note>
      </div>
    );
  }

  return (
    <div className="cv-page">
      <PageHead over={`Service · ${CV_ROOM.name} · ${dayName} · ${clockLabel(today.minutes)}`} q="How is service going?" />
      <div className={s.mode}>{modeLine}</div>
      {banner}
      <div className={s.kpis}>
        <StatusCard {...status} />
        {kpis}
      </div>
      {act && (
        <ActionCard title={act.title} value={value} why={act.why} checks={checks} source={act.source}
          risk={L ? 'If covers climb past the range after, you’d be one short. You’ll get a warning.' : 'Based on recent weeks, not tonight. If it’s busy, keep everyone on.'}
          next={`Approving re-checks it${L ? ' on fresh data' : ''}, then puts the 7shifts steps on Today. Nothing changes in 7shifts until someone does it${L ? '; Toast clock-ins confirm it' : ''}.`}
          state={actState} reviewing={review} busy={busy}
          onReview={() => setReview(true)} onBack={() => setReview(false)} onApprove={approve} onDecline={decline} />
      )}
      {!act && watch && <Note icon="Hourglass">{watch}</Note>}
      <section className={`cv-card ${s.chartCard}`}>
        <div className="cv-card-head"><span className="cv-h4">{L ? 'Covers every 15 minutes' : `A typical ${dayOf(today.day)}, hour by hour`}</span>
          <span className="cv-xs cv-faint">{L ? (lc.band?.calibrated ? `range ±${Math.round(lc.spread * 100)}% from ${lc.band.nights} past nights` : `range ±${Math.round(lc.spread * 100)}%, not yet calibrated`) : `last ${plan.weeks} weeks`}</span></div>
        {chart ?? <HourBars plan={plan} cutFrom={plan.cutFrom} />}
      </section>
      {L && plan && (
        <section className={`cv-card ${s.chartCard}`}>
          <div className="cv-card-head"><span className="cv-h4">A typical {dayOf(today.day)}, hour by hour</span><span className="cv-xs cv-faint">last {plan.weeks} weeks</span></div>
          <HourBars plan={plan} cutFrom={null} />
        </section>
      )}
      <HowItWorks fences={fences} />
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
  const lo = Math.round(cmp * (1 - spread)), hi = Math.round(cmp * (1 + spread));
  const tile = (k) => sv.tiles.find((t) => t[0] === k);
  const on = +(tile('Servers on')?.[1] ?? 0) || null;
  const need = +((tile('Servers on')?.[2] ?? '').match(/\d+/)?.[0] ?? 0);
  const status = sv.mode === 'cut' ? { tone: 'accent', label: 'One server spare' } : sv.mode === 'wait' ? { tone: 'neutral', label: 'Watching' } : { tone: 'good', label: 'On track' };
  const actState = sv.mode !== 'cut' || state === 'ask' ? null : (
    <div className={s.stateBox}>
      {state === 'yes' ? <Pill tone="info" icon="Hourglass">Approved · awaiting execution</Pill> : <Pill icon="CircleMinus">Kept everyone on</Pill>}
      <div className={s.actions}>
        {state === 'yes' && <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('today')}>Open Today</Button>}
        <Button size="sm" variant="ghost" icon="Undo2" onClick={() => setState('ask', `${sv.title}: answer reopened`)}>Change</Button>
      </div>
    </div>
  );
  return (
    <div className="cv-page">
      <PageHead over={`Service · ${CV_ROOM.name} · ${sv.day} · ${CV_NOW.time}`} q="How is service going?" />
      <div className={s.mode}><span className={s.dot} />Sample night · a fixed scene, not live data</div>
      <div className={s.kpis}>
        <StatusCard {...status} sub={`${sv.pace > 0 ? '+' : ''}${sv.pace}% vs a comparable night`} />
        <CoversCard label="Covers so far" value={so} lo={lo} hi={hi} sub={`expected ${lo}–${hi} by now`} />
        <ServersCard on={on} need={need} release={sv.mode === 'cut' && state === 'ask'} />
      </div>
      {sv.mode === 'cut' ? (
        <ActionCard title={sv.title.replace('Cut one server', 'Release 1 server')}
          valueNode={<span className={s.actionValue}><span className={s.big}><Money id="service-cut">{cvMoney(sv.value)}</Money></span><span className={s.kpiSub}>potential wages tonight, not saved yet <Claim k="est" /></span></span>}
          why={sv.body} state={actState}
          onReview={() => cv.approve(sv.approval, () => setState('yes', sv.title))}
          onDecline={() => { setState('no', `${sv.title}: declined`); cv.toast('Kept everyone on. Saved.'); }} />
      ) : <Note icon={sv.mode === 'wait' ? 'Hourglass' : 'CircleCheck'}>{sv.mode === 'wait' ? 'Watching. The range is still too wide to act.' : 'Nothing to do. Everyone on is needed.'}</Note>}
      <section className={`cv-card ${s.chartCard}`}>
        <div className="cv-card-head"><span className="cv-h4">Covers every 15 minutes</span><span className="cv-xs cv-faint">sample range ±{Math.round(spread * 100)}%</span></div>
        <PaceChart comp={sv.comp} actual={sv.actual} now={sv.now} factor={sv.factor} spread={spread} start={start} cutSlot={cutSlot} />
      </section>
      <div className={s.miniTiles}>
        {sv.tiles.filter((t) => t[0] !== 'Servers on').map(([k, v, t]) => <div key={k} className={s.mini}><span className="cv-xs cv-faint">{k}</span><span className={s.v}>{v}</span><span className="cv-xs cv-faint">{t}</span></div>)}
      </div>
      <HowItWorks fences={fences} extra={<li><Icon name="Smartphone" size={15} />Switch rooms in the top bar: one has a release ready, one is quiet, one is waiting.</li>} />
      <DenseService />
    </div>
  );
}

function CvService() {
  if (CV_D.room.fromToast) return <ServiceOwn />;
  return <ServiceSample />;
}

export { CvService };
