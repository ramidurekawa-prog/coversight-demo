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
        <li><Icon name="Activity" size={15} />The forecast band has to narrow until one fewer server is safe even at its top edge. Early in service it&apos;s too wide, so it waits.</li>
        <li><Icon name="BellOff" size={15} />One suggestion per service at most. On a normal night it stays silent, because alert fatigue is what kills engagement.</li>
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
  const lc = L?.call;

  // What tonight's call is, from the live pace when Toast is live, else from the plan.
  const cutAt = L ? (lc.mode === 'cut' ? lc.at : null) : plan?.cutFrom != null ? plan.cutFrom * 60 : null;
  const servers = L ? lc.serversNow : plan?.cutFrom != null ? Math.round(plan.hours.find((h) => h.hour === plan.cutFrom).servers) : null;
  const value = L ? lc.value : plan ? Math.round(plan.idleHours * plan.wage) : 0;
  const title = cutAt != null ? `${today.day} ${today.date}: one fewer server from ${clockLabel(cutAt)} to close` : '';

  const approve = async () => {
    if (cutAt == null || busy) return;
    setBusy(true);
    try {
      let a;
      if (server) {
        a = (await call('/api/page/service/cut', { method: 'POST', body: JSON.stringify({ roomId: CV_D.id, date: today.date, at: hhmm(cutAt) }) })).approval;
      } else {
        a = { approvalId: cutApprovalId(today.date, cutAt), title, system: '7shifts', diff: [[`${today.day} ${clockLabel(cutAt)} to close`, `${servers} servers`, `${servers - 1} servers`]] };
      }
      await engine.createTask(a.approvalId, a);
      setNight({ date: today.date, answer: 'yes', at: hhmm(cutAt), approvalId: a.approvalId }, `${today.day}: one fewer server from ${clockLabel(cutAt)}`);
      cv.toast('Approved. The steps for 7shifts are on Today.');
    } catch (err) {
      cv.toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const decline = () => { setNight({ date: today.date, answer: 'no', at: cutAt != null ? hhmm(cutAt) : null }, `${today.day}: kept everyone on`); cv.toast('Kept everyone on. Logged as declined.'); };
  const reopen = async () => {
    if (task?.status === 'open') await engine.taskAction(task.id, 'cancel');
    setNight({ date: today.date, answer: 'ask', at: null }, 'Service answer reopened');
  };

  const source = L ? 'Live from Toast' : `Plan from your last ${plan?.weeks ?? 4} ${days(today.day)}`;
  const time = L ? clockLabel(today.minutes) : null;
  const dayName = `${FULL_DAY[today.day] ?? today.day} dinner`;

  const answered = (
    task ? (
      <div className="cv-row" style={{ gap: 8 }}>
        <Pill tone="info" icon="ListChecks">{task.status === 'open' ? 'Approved · steps on Today' : 'Made in 7shifts'}</Pill>
        <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('today')}>Open Today</Button>
        {task.status === 'open' && <Button size="sm" variant="ghost" icon="Undo2" onClick={reopen}>Undo</Button>}
      </div>
    ) : answer === 'no' ? (
      <div className="cv-row" style={{ gap: 8 }}><Pill icon="CircleMinus">Kept everyone on</Pill><Button size="sm" variant="ghost" icon="Undo2" onClick={reopen}>Change my answer</Button></div>
    ) : null
  );
  const ask = (yes) => answered || (
    <div className={s.actions}>
      <Button className="btn-lg" icon="Check" onClick={approve} disabled={busy}>{yes}</Button>
      <Button className="btn-lg" variant="secondary" onClick={decline} disabled={busy}>Not tonight</Button>
    </div>
  );

  let card;
  if (L) {
    const upper = `${lc.needTop} server${lc.needTop === 1 ? '' : 's'}`;
    if (lc.mode === 'cut') card = <CallCard tone="cut" over="One suggestion" title={`One fewer server from ${clockLabel(lc.at)}`} body={<>Covers are pacing {Math.abs(lc.pace)}% {lc.pace < 0 ? 'under' : 'over'} a comparable {dayOf(today.day)}. Even at the top of the band, {lc.serversNow - 1} servers cover the rest of the night. About {cvMoney(lc.value)} of wages tonight. <Claim k="mod" /></>}>{ask(`Yes, cut one at ${clockLabel(lc.at)}`)}</CallCard>;
    else if (lc.mode === 'wait') card = <CallCard tone="wait" over="Not yet" title="Watching, not acting yet" body={`Covers are ${Math.abs(lc.pace)}% ${lc.pace < 0 ? 'under' : 'over'} a comparable ${dayOf(today.day)}, but the band is still wide: at its top, ${upper} are needed. Checking again at ${clockLabel(lc.checkAt)}.`} />;
    else if (lc.mode === 'early') card = <CallCard tone="idle" over="Not yet" title={today.minutes < L.win.start ? `Service starts at ${clockLabel(L.win.start)}` : 'Too early to call'} body={`The first hour is too noisy to act on. The first call comes at ${clockLabel(lc.checkAt)}.`} />;
    else if (lc.mode === 'late') card = <CallCard tone="idle" over="No suggestion" title="Past the latest same-night cut" body={`Your fence stops same-night cuts after ${clockLabel(fences.cutBy)}. Tonight's covers still count toward next week's plan.`} />;
    else if (lc.mode === 'unknown') card = <CallCard tone="idle" over="No suggestion" title="No clock-ins to count yet" body="Toast shows no servers clocked in tonight, so there's nothing safe to suggest. Pacing still runs." />;
    else card = <CallCard tone="quiet" over="No suggestion" title="Nothing to do tonight" body={lc.why === 'floor' ? `One fewer would take dinner under your fence of ${fences.minDinner} servers.` : `Covers are ${Math.abs(lc.pace)}% ${lc.pace < 0 ? 'under' : 'over'} a comparable ${dayOf(today.day)}. At the forecast, ${lc.needMid} server${lc.needMid === 1 ? '' : 's'} are needed, so everyone on is right.`} />;
  } else if (plan) {
    if (plan.cutFrom != null) card = <CallCard tone="cut" over="Tonight's plan" title={`One fewer server from ${clockLabel(plan.cutFrom * 60)} to close`} body={<>On recent {days(today.day)} every hour from {clockLabel(plan.cutFrom * 60)} had a spare server: about {plan.idleHours} server-hour{plan.idleHours === 1 ? '' : 's'}, {cvMoney(value)} at your blended wage. <Claim k="mod" /></>}>{ask('Approve the cut')}</CallCard>;
    else if (plan.blocked) card = <CallCard tone="quiet" over="Held by a fence" title="Keep everyone on tonight" body={plan.blocked.text} />;
    else card = <CallCard tone="quiet" over="Tonight's plan" title="Keep everyone on tonight" body={`Every hour to close has used its servers on recent ${days(today.day)}.`} />;
  }

  const liveNote = !server ? null
    : live == null ? <Callout icon="Loader">Checking Toast for tonight…</Callout>
    : live.live ? null
    : live.why === 'not-connected' ? <Callout icon="PlugZap">Live pacing turns on when Toast is connected for this room. Until then, tonight is planned from the same weekday in your data. <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => cv.go('connect')}>Connect Toast</Button></Callout>
    : live.why === 'no-history' ? <Callout icon="Hourglass">Live pacing needs at least two recent {days(today.day)} from the Toast sync to compare against. It starts on its own once they&apos;re in; until then, tonight is planned from your data.</Callout>
    : <Callout tone="warn" icon="TriangleAlert">{live.message || 'Couldn’t reach Toast just now.'} Showing tonight&apos;s plan instead.</Callout>;

  return (
    <div className="cv-page">
      <PageHead over={`Service · ${CV_ROOM.name}`} q={L ? 'Is tonight going the way it should?' : 'How many servers does tonight need?'}
        sub={L ? `Covers every 15 minutes from Toast, against the last ${L.weeks} ${days(today.day)}, and at most one staffing call. Refreshes every two minutes.`
          : `From your Toast data through ${CV_D.room.fromToast.end}: each hour on recent ${days(today.day)}, the covers you served and the servers on the floor, against this room's own pace${plan ? ` of ${plan.rate.toFixed(1)} covers per server-hour` : ''}.`} />
      {!server && <Callout icon="Info">Live pacing during service needs the Toast API sync. Until it&apos;s on, this plans tonight from the same weekday in your data.</Callout>}
      {liveNote}
      {!plan && !L ? <Callout icon="Clock">Not enough {dayOf(today.day)} dinners with servers on the floor in your data yet (needs TimeEntries.csv and 20+ busy hours).</Callout> : (
        <div className="cv-phone-stage">
          <div className="cv-phone" aria-label="Tonight">
            <span className="notch" />
            <StatusRow day={dayName} time={time} live={!!L} source={source} />
            {L ? (
              <section className="cv-card">
                {(() => { const p = { so: L.actual.reduce((a, b) => a + b, 0), cmp: L.comp.slice(0, L.actual.length).reduce((a, b) => a + b, 0), pace: lc.pace }; return <PaceHero {...p} />; })()}
                <PaceChart comp={L.comp} actual={L.actual} now={L.actual.length} factor={lc.factor} spread={lc.spread} start={L.win.start} cutSlot={lc.mode === 'cut' ? (lc.at - L.win.start) / SLOT_MIN : null} />
                <Legend />
              </section>
            ) : (
              <section className="cv-card">
                <div className="cv-row" style={{ justifyContent: 'space-between' }}><span className="cv-xs cv-faint">Tonight hour by hour</span><span className="cv-xs cv-faint">{plan.rate.toFixed(1)} covers / server-hour</span></div>
                <HourStrip plan={plan} cutFrom={plan.cutFrom} />
                <SeatKey />
              </section>
            )}
            {card}
            <Tiles items={L ? [
              ['Servers on', lc.serversNow ?? '—', lc.needTop ? `need ${lc.needMid === lc.needTop ? lc.needTop : `${lc.needMid}–${lc.needTop}`}` : 'from clock-ins'],
              ['Band', `±${Math.round(lc.spread * 100)}%`, 'narrows as it goes'],
              ['Pace', `${lc.rate ? lc.rate.toFixed(1) : '—'}`, 'covers / server-h'],
            ] : [
              ['Spare', `${plan.hours.reduce((t, h) => t + h.idle, 0)} srv-h`, `on a ${dayOf(today.day)}`],
              ['Peak hour', clockLabel(plan.hours.reduce((a, b) => (b.covers > a.covers ? b : a)).hour * 60), `${Math.max(...plan.hours.map((h) => h.covers))} covers`],
              ['Weeks read', plan.weeks, `${days(today.day)}`],
            ]} />
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
      <PageHead over={`The only screen a manager opens during service · ${CV_ROOM.name}`} q="Is tonight going the way it should?"
        sub="Live pacing against a comparable night, a forecast with its band, and at most one staffing call. Built for a phone in one hand." />
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
            <CallCard tone="cut" over="One suggestion" title={sv.title} body={<>{sv.body} Saves <Money id="service-cut">{cvMoney(sv.value)}</Money> tonight. <Claim k="mod" /></>}>
              {state === 'ask' ? (
                <div className={s.actions}>
                  <Button className="btn-lg" icon="Check" onClick={() => cv.approve(sv.approval, () => setState('yes', sv.title))}>{CV_D.ownData ? 'Yes, cut one server at 8' : sv.yes}</Button>
                  <Button variant="secondary" className="btn-lg" onClick={() => { setState('no', `${sv.title}: declined`); cv.toast('Kept everyone on. Logged as declined.'); }}>Not tonight</Button>
                </div>
              ) : (
                <div className="cv-row" style={{ gap: 8 }}>
                  {state === 'yes' ? <Pill tone="info" icon="ListChecks">Approved · steps on Today</Pill> : <Pill icon="CircleMinus">Kept everyone on</Pill>}
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
