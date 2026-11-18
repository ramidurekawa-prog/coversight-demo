'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_NOW, Claim, Money, Pill, PageHead, cvScale } from '../core';
import { DenseService } from '../dense-sections';
import { servicePace } from '../../../lib/data/model';
import { bandSpread, clockLabel, clockMinutes, cutApprovalId, DINNER_FROM, fencesOf, hhmm, isCutFor, localNow, manualNight, MIN_CALIBRATED, servicePlan, SLOT_MIN } from '../../../lib/data/page/service.js';
import s from './service.module.css';

const FULL_DAY = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const days = (d) => `${FULL_DAY[d] ?? d}s`;
const dayOf = (d) => FULL_DAY[d] ?? d;
const POLL_MS = 120_000;
const short = (min) => clockLabel(min).replace(' pm', '').replace(' am', '');

/* ================================================================ the visual pieces */

/**
 * The answer, at the top: what to do right now in one line, why in one more,
 * and the one persimmon button. Everything else on the page backs this up.
 */
const TONE_ICON = { act: 'UserMinus', good: 'CircleCheck', warn: 'TriangleAlert', neutral: 'Activity', wait: 'Hourglass' };
function Hero({ tone = 'neutral', kicker, title, sub, value, primary, secondary, state, why }) {
  const [open, setOpen] = React.useState(false);
  return (
    <section className={`${s.hero} ${s[`h_${tone}`] || ''}`} aria-labelledby="svc-hero" role="status" aria-live="polite">
      <div className={s.heroMain}>
        <span className={s.heroKicker}><Icon name={TONE_ICON[tone] || 'Activity'} size={16} />{kicker}</span>
        <h2 id="svc-hero" className={s.heroTitle}>{title}</h2>
        {sub && <p className={s.heroSub}>{sub}</p>}
        {why && (
          <>
            <button type="button" className={s.why} onClick={() => setOpen((v) => !v)} aria-expanded={open}><Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={15} />Why</button>
            {open && <div className={s.whyBox}>{why}</div>}
          </>
        )}
      </div>
      {(value || primary || state) && (
        <div className={s.heroSide}>
          {value}
          {state ?? (
            <div className={s.actions}>
              {primary}
              {secondary}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The dollar figure on a release: always potential, always Estimated. */
function Potential({ value, money }) {
  if (value == null) return <span className={s.kpiSub}>No wage rates in your data, so no dollar figure.</span>;
  return (
    <span className={s.potential}>
      <span className={s.potFig}>{money ?? cvMoney(value)}</span>
      <span className={s.kpiSub}>potential wages tonight, not saved yet <Claim k="est" /></span>
    </span>
  );
}

/** Covers so far as a big number, with a bar showing where it sits against a usual night. */
function CoversCard({ label, value, lo, hi, max, sub, marker = true }) {
  const top = Math.max(max ?? hi * 1.25, value * 1.1, 1);
  const pct = (v) => `${Math.min(100, (v / top) * 100)}%`;
  const where = value > hi ? s.over : value < lo ? s.under : '';
  return (
    <section className={s.kpi} aria-label={`${label}: ${value}, usual ${lo} to ${hi}`}>
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

/** Servers on the floor as seats: filled are needed, open are spare, dashed is the one to send home. */
function ServersCard({ on, need, release, sub }) {
  if (on == null) return <section className={s.kpi}><span className={s.kpiLabel}>Servers on now</span><span className={`${s.big} ${s.none}`}>—</span><span className={s.kpiSub}>{sub || 'No clock-ins yet'}</span></section>;
  return (
    <section className={s.kpi} aria-label={`${on} servers on, ${need} needed`}>
      <span className={s.kpiLabel}>Servers on now</span>
      <span className={s.big}>{on}<span className={s.bigOf}> on · {need} needed</span></span>
      <span className={s.bigSeats} aria-hidden="true">
        {Array.from({ length: Math.min(on, 12) }, (_, i) => <span key={i} className={`${s.bigSeat} ${i < need ? '' : release && i === on - 1 ? s.gone : s.spare}`} />)}
      </span>
      {sub && <span className={s.kpiSub}>{sub}</span>}
    </section>
  );
}

/**
 * Tonight against a usual night, every 15 minutes, with the likely range ahead
 * and the send-home time marked. Hover, tap or arrow-key along it to read a time.
 */
function PaceChart({ comp, actual, now, factor, spread, start, cutSlot, usual }) {
  const [sel, setSel] = React.useState(null);
  // Draw at the card's real width so the type stays the same size on a phone and a desktop.
  const box = React.useRef(null);
  const [W, setW] = React.useState(960);
  React.useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 560 ? 230 : 280, P = { l: 34, r: 12, t: 56, b: 30 };
  const n = comp.length;
  const f = Number.isFinite(factor) ? factor : 1;
  const top = Math.max(4, Math.ceil(Math.max(...comp, ...actual, ...comp.map((c) => c * f * (1 + spread))) / 2) * 2);
  const x = cvScale(0, n - 1, P.l, W - P.r);
  const y = cvScale(0, top, H - P.b, P.t);
  const from = Math.max(0, now - 1);
  const fc = comp.map((c, i) => (i < from ? null : i === from && actual[from] != null ? actual[from] : c * f));
  const up = [], lo = [];
  comp.forEach((c, i) => { if (i >= from) { up.push([x(i), y(c * f * (1 + spread))]); lo.unshift([x(i), y(c * f * (1 - spread))]); } });
  const ticks = [];
  for (let i = 0; i < n; i += W < 560 ? 8 : 4) ticks.push(i);
  const step = (W - P.l - P.r) / Math.max(1, n - 1);
  const i = sel ?? (now > 0 ? now - 1 : 0);
  const at = clockLabel(start + i * SLOT_MIN);
  const tip = i < actual.length
    ? [at, `Tonight ${actual[i]} · usual ${comp[i]}`]
    : [at, `Likely ${Math.round(comp[i] * f * (1 - spread))}–${Math.round(comp[i] * f * (1 + spread))} · usual ${comp[i]}`];
  const TW = 168;
  const tipX = Math.min(W - P.r - TW, Math.max(P.l, x(i) - TW / 2));
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { setSel(Math.min(n - 1, i + 1)); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { setSel(Math.max(0, i - 1)); e.preventDefault(); }
  };
  return (
    <div className={s.chartWrap} ref={box}>
      <svg className={`cv-chart ${s.chart}`} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} onKeyDown={onKey} onMouseLeave={() => setSel(null)}
        aria-label={`Covers every 15 minutes. ${tip.join(', ')}. Use the arrow keys to move.`}>
        {[0, Math.round(top / 2), top].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        {up.length > 1 && <polygon points={[...up, ...lo].map((q) => q.join(',')).join(' ')} fill="var(--accent)" opacity="0.1" />}
        <polyline points={comp.map((c, k) => `${x(k)},${y(c)}`).join(' ')} fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 4" />
        <polyline points={fc.map((c, k) => c != null && `${x(k)},${y(c)}`).filter(Boolean).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 4" opacity="0.7" />
        {actual.length > 0 && <polyline points={actual.map((c, k) => `${x(k)},${y(c)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {cutSlot != null && cutSlot < n && <>
          <line x1={x(cutSlot)} x2={x(cutSlot)} y1={P.t - 4} y2={H - P.b} stroke="var(--primary)" strokeWidth="2" />
          <text x={x(cutSlot) + 6} y={H - P.b - 8} style={{ fill: 'var(--fg-1)', fontWeight: 700 }}>send home {short(start + cutSlot * SLOT_MIN)}</text>
        </>}
        <line x1={x(i)} x2={x(i)} y1={P.t - 4} y2={H - P.b} stroke="var(--fg-2)" strokeWidth="1" opacity="0.4" />
        <circle cx={x(i)} cy={y(i < actual.length ? actual[i] : comp[i] * f)} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
        <g transform={`translate(${tipX},4)`} className={s.tip}>
          <rect width={TW} height="40" rx="8" />
          {tip.map((t, k) => <text key={k} x="10" y={16 + k * 15} className={k ? '' : 'lbl'}>{t}</text>)}
        </g>
        {ticks.map((k, j) => <text key={k} x={x(k)} y={H - 6} textAnchor="middle">{short(start + k * SLOT_MIN)}{j === 0 ? ' pm' : ''}</text>)}
        {comp.map((_, k) => <rect key={k} x={x(k) - step / 2} y={P.t} width={step} height={H - P.t - P.b} fill="transparent" onMouseEnter={() => setSel(k)} onClick={() => setSel(k)} />)}
      </svg>
      <div className="cv-legend">
        <span><i className={s.swTonight} />Tonight</span>
        <span><i className={s.swComp} />{usual}</span>
        <span><i className={s.swBand} />Likely range</span>
      </div>
    </div>
  );
}

/** A usual night hour by hour: bars for covers, seats for servers. Tap an hour to read it. */
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
              aria-label={`${clockLabel(x.hour * 60)}: usually ${x.covers} covers, up to ${x.peak}; ${on} servers on, ${x.need} needed`}>
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
        <span><span className={s.num}>{h.covers}</span> covers usually · up to <span className={s.num}>{h.peak}</span></span>
        <span><span className={s.num}>{Math.round(h.servers)}</span> on · <span className={s.num}>{h.need}</span> needed{h.idle ? ` · ${h.idle} spare` : ''}</span>
      </div>
      <div className="cv-legend">
        <span><i className={s.swBar} />Usual covers</span>
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
    <ul className={s.checks} aria-label="Checks before sending someone home">
      {checks.map((c) => (
        <li key={c.key} className={c.ok === true ? s.pass : c.ok === false ? s.fail : s.yours}>
          <Icon name={c.ok === true ? 'CircleCheck' : c.ok === false ? 'CircleX' : 'CircleHelp'} size={16} />
          <span><span className="sr-only">{c.ok === true ? 'Passes: ' : c.ok === false ? 'Fails: ' : 'Yours to check: '}</span>{c.label}{c.note ? <span className="cv-faint"> {c.note}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** Everything behind the answer, in one tap: the checks, hour by hour, your rules and how it works. */
function Details({ checks, plan, cutFrom, fences, extra, children }) {
  const cv = useCv();
  return (
    <details className={`cv-card ${s.details}`}>
      <summary><Icon name="ListChecks" size={18} /><span>Details</span><span className={s.detailsHint}>checks, hour by hour, your rules</span><Icon name="ChevronDown" size={18} className={s.chev} /></summary>
      <div className={s.detailsBody}>
        {checks?.length > 0 && <div className={s.block}><span className={s.blockTitle}>Checks before sending someone home</span><Checks checks={checks} /></div>}
        {plan && <div className={s.block}><span className={s.blockTitle}>A usual {dayOf(plan.day)}, hour by hour · last {plan.weeks} weeks</span><HourBars plan={plan} cutFrom={cutFrom} /></div>}
        <div className={s.block}>
          <span className={s.blockTitle}>Your rules</span>
          <div className={s.fences}>
            <div className={s.fence}><span className="cv-xs cv-faint">Fewest servers on dinner</span><span className={s.v}>{fences.minDinner}</span></div>
            <div className={s.fence}><span className="cv-xs cv-faint">Latest time to send someone home</span><span className={s.v}>{clockLabel(fences.cutBy)}</span></div>
          </div>
          <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('fences')}>Change rules</Button>
        </div>
        <div className={s.block}>
          <span className={s.blockTitle}>How it works</span>
          <ul className="cv-ul">
            <li><Icon name="Activity" size={15} />Tonight is compared with the same night on recent weeks. The likely range comes from how far off that guess was on your own past nights.</li>
            <li><Icon name="BellOff" size={15} />At most one suggestion and one alert a night. Someone goes home only if the rest still cover the busiest likely finish.</li>
            <li><Icon name="ShieldCheck" size={15} />Approving puts the steps on Today. Nothing changes in 7shifts until someone does it, and Toast clock-ins confirm it.</li>
            {extra}
          </ul>
        </div>
        {children}
      </div>
    </details>
  );
}

/** Tonight's count by hand, for when no live feed is on: covers so far and servers on the floor. */
function ManualCount({ saved, onSave, time, primary }) {
  const [covers, setCovers] = React.useState(saved?.covers ?? '');
  const [servers, setServers] = React.useState(saved?.servers ?? '');
  const ok = covers !== '' && Number.isInteger(+covers) && +covers >= 0 && +covers <= 5000 && (servers === '' || (Number.isInteger(+servers) && +servers >= 0 && +servers <= 200));
  return (
    <form className={`cv-card ${s.manualCard}`} onSubmit={(e) => { e.preventDefault(); if (ok) onSave(+covers, servers === '' ? null : +servers); }}>
      <div className="cv-card-head"><span className="cv-h4">Your count tonight</span><span className="cv-xs cv-faint">{saved ? `last saved at ${saved.atLabel}` : 'no live feed, so type it in'}</span></div>
      <div className={s.manualRow}>
        <label className={s.field}><span className="cv-xs cv-faint">Covers so far</span><input className="input" type="number" inputMode="numeric" min="0" max="5000" value={covers} onChange={(e) => setCovers(e.target.value)} required /></label>
        <label className={s.field}><span className="cv-xs cv-faint">Servers on now</span><input className="input" type="number" inputMode="numeric" min="0" max="200" value={servers} onChange={(e) => setServers(e.target.value)} /></label>
        <Button type="submit" variant={primary ? 'primary' : 'secondary'} icon="Check" disabled={!ok}>Save at {time}</Button>
      </div>
    </form>
  );
}

/** A small banner when something stops the page acting. */
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
  const L = live?.live ? live.night : null;
  // A manager's own count tonight, used only when there's no live feed.
  const [manualSaved, setManual] = useSaved('service.manual', null);
  const manualToday = manualSaved?.date === today.date ? manualSaved : null;
  const manual = !L && plan && manualToday ? manualNight({ plan, covers: manualToday.covers, servers: manualToday.servers, atMin: clockMinutes(manualToday.at) ?? today.minutes }) : null;
  const saveManual = (covers, servers) => {
    const at = hhmm(today.minutes);
    setManual({ date: today.date, at, covers, servers }, `Tonight's count at ${clockLabel(today.minutes)}: ${covers} covers${servers != null ? `, ${servers} servers` : ''}`);
    cv.toast('Saved your count.');
  };
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
      cv.toast('Approved. The 7shifts steps are on Today. Nothing has changed in 7shifts yet.');
    } catch (err) {
      cv.toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const decline = () => { setNight({ date: today.date, answer: 'no', at: cutAt != null ? hhmm(cutAt) : null }, `${today.day}: kept everyone on`); cv.toast('Kept everyone on tonight. Saved.'); };
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

  let hero, kpis, chart = null, checks = [], act = null;
  if (L) {
    const lo = Math.round(lc.cmp * (1 - lc.spread)), hi = Math.round(lc.cmp * (1 + lc.spread));
    const vs = `${Math.abs(lc.pace)}% ${lc.pace < 0 ? 'under' : 'over'} a usual ${dayOf(today.day)}`;
    kpis = [
      <CoversCard key="c" label="Covers so far" value={lc.so} lo={lo} hi={hi} sub={lc.now ? `usual by now: ${lo}–${hi}` : 'service not started'} marker={lc.now > 0} />,
      <ServersCard key="s" on={lc.serversNow} need={lc.needTop ?? lc.needMid ?? 0} release={lc.mode === 'cut'} sub={lc.needTop != null && lc.needMid !== lc.needTop ? `${lc.needMid}–${lc.needTop} needed across the likely range` : 'clocked in on Toast'} />,
    ];
    chart = { node: <PaceChart comp={L.comp} actual={L.actual} now={L.actual.length} factor={lc.factor} spread={lc.spread} start={L.win.start} usual={`Usual ${dayOf(today.day)}`} cutSlot={lc.mode === 'cut' ? (lc.at - L.win.start) / SLOT_MIN : null} />,
      note: lc.band?.calibrated ? `usual = last ${L.weeks} ${days(today.day)}` : `usual = last ${L.weeks} ${days(today.day)} · range still learning` };
    checks = lc.checks;
    if (lc.mode === 'cut') {
      act = { title: `Send 1 server home at ${clockLabel(lc.at)}`, sub: `Covers are ${vs}. ${lc.serversNow - 1} servers still cover the busiest likely finish.` };
      hero = { tone: 'act', kicker: 'Do this now' };
    } else if (lc.mode === 'stale') hero = { tone: 'warn', kicker: 'Toast is late', title: 'No call until Toast catches up', sub: `No new orders since ${L.dataThrough != null ? clockLabel(L.dataThrough) : 'service started'}. Check the room yourself.` };
    else if (L.health.tone === 'warn') hero = { tone: 'warn', kicker: 'Busier than usual', title: 'Keep everyone on', sub: `Covers are ${vs}.` };
    else if (lc.mode === 'wait') hero = { tone: 'wait', kicker: 'Watching', title: lc.why === 'history' ? 'Looks quiet, but too few past nights to act' : `Looks quiet. Next check ${clockLabel(lc.checkAt)}`, sub: lc.why === 'history' ? `Needs ${MIN_CALIBRATED} recent ${days(today.day)}; has ${L.weeks}. Keep everyone on.` : `Covers are ${vs}, but the range is still too wide to send anyone home.` };
    else if (lc.mode === 'late') hero = { tone: 'good', kicker: 'Nothing to do', title: 'Keep everyone on', sub: `It's past your latest time to send someone home (${clockLabel(fences.cutBy)}).` };
    else if (lc.mode === 'unknown') hero = { tone: 'neutral', kicker: 'No servers clocked in', title: 'No staffing call yet', sub: 'Nobody with a server job is clocked in on Toast.' };
    else if (lc.mode === 'early') hero = { tone: 'neutral', kicker: 'Service just starting', title: `First check at ${clockLabel(lc.checkAt)}`, sub: 'Too early to tell how tonight is going.' };
    else hero = { tone: 'good', kicker: 'On track', title: 'Keep everyone on', sub: lc.mode === 'quiet' ? `Covers are ${vs}, but everyone on is needed.` : `Covers are ${vs}.` };
  } else if (plan) {
    const typical = plan.hours.reduce((t, x) => t + x.covers, 0), peakTotal = plan.hours.reduce((t, x) => t + x.peak, 0);
    const peakHour = plan.hours.reduce((a, b) => (b.peak > a.peak ? b : a));
    kpis = manual ? [
      <CoversCard key="c" label="Covers so far" value={manual.covers} lo={manual.typical} hi={Math.max(manual.busiest, manual.typical)} sub={`usual by now ${manual.typical} · busiest week ${manual.busiest}`} marker />,
      <ServersCard key="s" on={manual.servers} need={manual.need ?? 0} release={false} sub={manual.need == null ? 'no plan for this hour' : manual.staff === 'short' ? 'fewer than the busiest week needed' : 'from your count'} />,
    ] : [
      <CoversCard key="c" label={`Covers on a usual ${dayOf(today.day)}`} value={typical} lo={typical} hi={peakTotal} max={peakTotal * 1.15} sub={`up to ${peakTotal} in the busiest week`} marker />,
      <ServersCard key="s" on={Math.round(peakHour.servers)} need={peakHour.need} release={false} sub={`at the ${clockLabel(peakHour.hour * 60)} peak`} />,
    ];
    checks = [
      { key: 'peak', label: 'Every hour after had a spare server, even in its busiest week', ok: plan.spareFrom != null },
      { key: 'history', label: `At least ${MIN_CALIBRATED} recent ${days(today.day)}`, ok: plan.weeks >= MIN_CALIBRATED },
      { key: 'floor', label: `At least ${fences.minDinner} servers stay on dinner`, ok: plan.blocked?.why !== 'floor' },
      { key: 'cutBy', label: `Before ${clockLabel(fences.cutBy)}, your latest time`, ok: plan.blocked?.why !== 'late' },
      { key: 'live', label: 'Tonight’s real covers', ok: null, note: 'This is a plan from recent weeks. Look at the room first.' },
      { key: 'roles', label: 'Sections and roles stay covered', ok: null, note: 'Toast doesn’t show sections.' },
    ];
    const crowded = manual?.tone === 'warn';
    if (plan.cutFrom != null && !crowded) {
      act = { title: `Plan to send 1 server home at ${clockLabel(plan.cutFrom * 60)}`, sub: `On each of the last ${plan.weeks} ${days(today.day)}, every hour from then had a spare server, even the busiest week. Check the room first.` };
      hero = { tone: 'act', kicker: manual ? manual.label : 'Tonight’s plan' };
    } else if (crowded) hero = { tone: 'warn', kicker: manual.label, title: 'Keep everyone on', sub: `Your count of ${manual.covers} is above the busiest recent ${dayOf(today.day)} by now (${manual.busiest}).` };
    else hero = { tone: 'good', kicker: manual ? manual.label : 'Tonight’s plan', title: 'Keep everyone on', sub: plan.blocked ? plan.blocked.text : `Every hour on recent ${days(today.day)} used all its servers.` };
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
    : live.why === 'not-connected' ? <Note icon="PlugZap" action={<Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('connect')}>Connect Toast</Button>}>Toast isn’t connected. Type your count below, or connect Toast to track tonight live.</Note>
    : live.why === 'no-history' ? <Note icon="Hourglass">Live tracking starts once two recent {days(today.day)} are synced from Toast. Type your count below until then.</Note>
    : <Note tone="warn" icon="TriangleAlert">{live.message || 'Couldn’t reach Toast.'} Type your count below.</Note>;

  if (!plan && !L) {
    return (
      <div className="cv-page">
        <PageHead over={`Service · ${CV_ROOM.name} · ${dayName}`} q="How is service going?" />
        <Hero tone="neutral" kicker="Not enough data yet" title="Add Toast data to start" sub={`Needs Toast orders and time entries for ${days(today.day)} (20+ busy hours).`}
          primary={<Button className={s.cta} iconRight="ArrowRight" onClick={() => cv.go('inputs')}>Add data</Button>} />
      </div>
    );
  }

  const why = act ? <><Checks checks={checks} /><span className="cv-xs cv-muted">{L ? 'If covers climb past the range after, you’ll get a warning to call them back.' : 'Based on recent weeks, not tonight. If it’s busy, keep everyone on.'}</span></> : null;
  return (
    <div className="cv-page">
      <PageHead over={`Service · ${CV_ROOM.name} · ${dayName} · ${clockLabel(today.minutes)}`} q="How is service going?" />
      <div className={s.mode}>{modeLine}</div>
      {banner}
      <Hero tone={hero.tone} kicker={hero.kicker} title={act?.title ?? hero.title} sub={act?.sub ?? hero.sub} why={why}
        value={act && <Potential value={value} />}
        state={act ? actState : undefined}
        primary={act && <Button className={s.cta} icon="Check" onClick={approve} disabled={busy}>{busy ? 'Checking…' : 'Approve'}</Button>}
        secondary={act && <Button className={s.ctaAlt} variant="secondary" onClick={decline} disabled={busy}>Not tonight</Button>} />
      {!L && plan && <ManualCount key={manualToday?.at ?? 'new'} primary={!act || !!actState} saved={manualToday && { ...manualToday, atLabel: clockLabel(clockMinutes(manualToday.at)) }} onSave={saveManual} time={clockLabel(today.minutes)} />}
      <div className={s.kpis}>{kpis}</div>
      {chart && (
        <section className={`cv-card ${s.chartCard}`}>
          <div className="cv-card-head"><span className="cv-h4">Tonight vs a usual {dayOf(today.day)}</span><span className="cv-xs cv-faint">{chart.note}</span></div>
          {chart.node}
        </section>
      )}
      <Details checks={act ? null : checks} plan={plan && { ...plan, day: today.day }} cutFrom={L ? null : plan?.cutFrom} fences={fences} />
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
  const sp = servicePace(sv) ?? { so: 0, usual: 0, factor: 1, pace: 0 };
  const spread = sv.mode === 'wait' ? 0.2 : bandSpread(sv.now, sv.comp.length) * 0.65;
  const start = DINNER_FROM * 60;
  const cutSlot = sv.mode === 'cut' ? 12 : null;
  const lo = Math.round(sp.usual * (1 - spread)), hi = Math.round(sp.usual * (1 + spread));
  const tile = (k) => sv.tiles.find((t) => t[0] === k);
  const on = +(tile('Servers on')?.[1] ?? 0) || null;
  const need = +((tile('Servers on')?.[2] ?? '').match(/\d+/)?.[0] ?? 0);
  const day = sv.day.split(' ')[0];
  const vs = `${Math.abs(sp.pace)}% ${sp.pace < 0 ? 'under' : 'over'} a usual ${day}`;
  const actState = sv.mode !== 'cut' || state === 'ask' ? null : (
    <div className={s.stateBox}>
      {state === 'yes' ? <Pill tone="info" icon="Hourglass">Approved · steps are on Today</Pill> : <Pill icon="CircleMinus">Kept everyone on</Pill>}
      <div className={s.actions}>
        {state === 'yes' && <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('today')}>Open Today</Button>}
        <Button size="sm" variant="ghost" icon="Undo2" onClick={() => setState('ask', `${sv.title}: answer reopened`)}>Change</Button>
      </div>
    </div>
  );
  const hero = sv.mode === 'cut'
    ? { tone: 'act', kicker: 'Do this now', title: sv.title.replace('Cut one server', 'Send 1 server home'), sub: `Covers are ${vs}. ${need} servers still cover the busiest likely finish.` }
    : sv.mode === 'wait'
      ? { tone: 'wait', kicker: 'Watching', title: 'Looks quiet. Next check 7:45', sub: `Covers are ${vs}, but the range is still too wide to send anyone home.` }
      : { tone: 'good', kicker: 'On track', title: 'Keep everyone on', sub: `Covers are ${vs}. Everyone on is needed.` };
  return (
    <div className="cv-page">
      <PageHead over={`Service · ${CV_ROOM.name} · ${sv.day} · ${CV_NOW.time}`} q="How is service going?" />
      <div className={s.mode}><span className={s.dot} />Sample night · a fixed scene, not live data</div>
      <Hero {...hero} why={sv.mode === 'cut' ? <span className="cv-sm">{sv.body}</span> : null}
        value={sv.mode === 'cut' && <Potential value={sv.value} money={<Money id="service-cut">{cvMoney(sv.value)}</Money>} />}
        state={sv.mode === 'cut' ? actState : undefined}
        primary={sv.mode === 'cut' && <Button className={s.cta} icon="Check" onClick={() => cv.approve(sv.approval, () => setState('yes', sv.title))}>Approve</Button>}
        secondary={sv.mode === 'cut' && <Button className={s.ctaAlt} variant="secondary" onClick={() => { setState('no', `${sv.title}: declined`); cv.toast('Kept everyone on. Saved.'); }}>Not tonight</Button>} />
      <div className={s.kpis}>
        <CoversCard label="Covers so far" value={sp.so} lo={lo} hi={hi} sub={`usual by now: ${lo}–${hi}`} />
        <ServersCard on={on} need={need} release={sv.mode === 'cut' && state === 'ask'} sub="clocked in" />
      </div>
      <section className={`cv-card ${s.chartCard}`}>
        <div className="cv-card-head"><span className="cv-h4">Tonight vs a usual {day}</span><span className="cv-xs cv-faint">sample · range ±{Math.round(spread * 100)}%</span></div>
        <PaceChart comp={sv.comp} actual={sv.actual} now={sv.now} factor={sp.factor} spread={spread} start={start} cutSlot={cutSlot} usual={`Usual ${day}`} />
      </section>
      <Details fences={fences} extra={<li><Icon name="Smartphone" size={15} />Switch rooms in the top bar: one has someone to send home, one is on track, one is waiting.</li>}>
        <div className={s.block}>
          <span className={s.blockTitle}>On the floor</span>
          <div className={s.miniTiles}>
            {sv.tiles.filter((t) => t[0] !== 'Servers on').map(([k, v, t]) => <div key={k} className={s.mini}><span className="cv-xs cv-faint">{k}</span><span className={s.v}>{v}</span><span className="cv-xs cv-faint">{t}</span></div>)}
          </div>
        </div>
        <DenseService />
      </Details>
    </div>
  );
}

function CvService() {
  if (CV_D.room.fromToast) return <ServiceOwn />;
  return <ServiceSample />;
}

export { CvService };
