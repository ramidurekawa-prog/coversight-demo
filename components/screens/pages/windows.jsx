'use client';

import * as React from 'react';
import { Icon, Button, Tabs } from '../../kit';
import { useCv, cvMoney, CV_D, CV_ROOM, Claim, Pill, Callout, Interval, PageHead, cvScale } from '../core';
import { leverReport } from '../../../lib/data/levers.js';
import { windowState, METHOD_LABEL, MAGNITUDE_FLOOR_PCT } from '../../../lib/data/pilot.js';
import { LEVER_METRIC } from '../../../lib/data/readers.js';
import { engine, useEngine } from '../../engine';
import { pilotOf, locOf } from '../live';

/* ================================================================ Test windows */
const STATUS = {
  running: { label: 'Running', tone: 'info', icon: 'Timer' },
  waiting: { label: 'Waiting on data', tone: 'warn', icon: 'CirclePause' },
  verified: { label: 'Verified', tone: 'good', icon: 'BadgeCheck' },
  rejected: { label: 'Rejected', tone: 'bad', icon: 'CircleX' },
  reversed: { label: 'Reversed', tone: 'bad', icon: 'Undo2' },
  stopped: { label: 'Stopped', tone: 'neutral', icon: 'CircleMinus' },
};
const fmtUnit = (p, v, signed = false) => {
  const s = signed && v > 0 ? '+' : '';
  if (p.unit === '$') return `${s}${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(Math.abs(p.baseline) < 100 ? 2 : 0)}`;
  return `${s}${v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)} ${p.unit}`;
};
const dollars = (c) => Math.round(c / 100);

function CheckpointChart({ p, w, controls }) {
  const W = 1000, H = 220, P = { l: 64, r: 16, t: 14, b: 28 };
  const pts = p.checkpoints.map((c) => ({ ...c, adj: c.observed - (controls ? c.controlDelta : 0) }));
  const vals = [p.baseline, ...pts.map((c) => c.observed), ...pts.map((c) => c.adj)];
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.2 || 1;
  const x = cvScale(0, 35, P.l, W - P.r), y = cvScale(lo - pad, hi + pad, H - P.b, P.t);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.metric}: baseline and weekly checkpoints`}>
      <line className="grid" x1={P.l} x2={W - P.r} y1={y(p.baseline)} y2={y(p.baseline)} strokeDasharray="4 3" />
      <text x={P.l - 6} y={y(p.baseline) + 3} textAnchor="end">{fmtUnit(p, p.baseline)}</text>
      <text className="lbl" x={W - P.r} y={y(p.baseline) - 6} textAnchor="end">baseline, 4 weeks before Start</text>
      <rect x={x(0)} y={P.t} width={x(28) - x(0)} height={H - P.b - P.t} fill="var(--accent)" opacity="0.05" />
      <line className="axis" x1={x(w.day)} x2={x(w.day)} y1={P.t} y2={H - P.b} stroke="var(--accent)" />
      {[0, 7, 14, 21, 28, 35].map((d) => <text key={d} x={x(d)} y={H - 8} textAnchor="middle">{d === 0 ? 'Start' : `day ${d}`}</text>)}
      {pts.map((c) => {
        const done = c.day <= w.day;
        return (
          <g key={c.day} opacity={done ? 1 : 0.3}>
            {controls && <line x1={x(c.day)} x2={x(c.day)} y1={y(c.observed)} y2={y(c.adj)} stroke="var(--fg-3)" strokeDasharray="2 2" />}
            <circle cx={x(c.day)} cy={y(c.observed)} r={controls ? 3.5 : 5} fill={controls ? 'var(--surface)' : 'var(--accent)'} stroke="var(--accent)" strokeWidth="1.5" />
            {controls && <circle cx={x(c.day)} cy={y(c.adj)} r="5" fill="var(--accent)" />}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------------------------------------------------------- the group's own tests */
const fmtM = (unit, v) => (v == null ? '—' : unit === '$/wk' ? `$${Math.round(v).toLocaleString('en-US')}` : `${(Math.round(v * 10) / 10).toLocaleString('en-US')} ${unit.replace('/wk', '').replace('/turn', '')}`);

function SeriesChart({ w }) {
  const W = 1000, H = 160, P = { l: 64, r: 16, t: 12, b: 24 };
  const pts = w.series || [];
  if (pts.length < 2) return null;
  const vals = [w.baseline, ...pts.map((p) => p.value)];
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.2 || 1;
  const x = cvScale(0, pts.length - 1, P.l, W - P.r), y = cvScale(lo - pad, hi + pad, H - P.b, P.t);
  const startIdx = pts.findIndex((p) => p.weekEnd > w.startedAt);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${w.title}: weekly values against the baseline`}>
      <line className="grid" x1={P.l} x2={W - P.r} y1={y(w.baseline)} y2={y(w.baseline)} strokeDasharray="4 3" />
      <text x={P.l - 6} y={y(w.baseline) + 3} textAnchor="end">{fmtM(w.unit, w.baseline)}</text>
      {startIdx > 0 && <rect x={x(startIdx - 0.5)} y={P.t} width={x(pts.length - 1) - x(startIdx - 0.5) + 8} height={H - P.b - P.t} fill="var(--accent)" opacity="0.06" />}
      <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={pts.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
      {pts.map((p, i) => <circle key={p.weekEnd} cx={x(i)} cy={y(p.value)} r={p.weekEnd > w.startedAt ? 5 : 3} fill={p.weekEnd > w.startedAt ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" />)}
      {pts.map((p, i) => (i % 2 === pts.length % 2 ? null : <text key={`t${p.weekEnd}`} x={x(i)} y={H - 6} textAnchor="middle">{p.weekEnd.slice(5)}</text>))}
    </svg>
  );
}

function YourTests() {
  const cv = useCv();
  const eng = useEngine();
  const [lever, setLever] = React.useState('labour');
  const [dish, setDish] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const room = CV_D.room;
  const mine = (eng.windows || []).filter((w) => w.roomId === CV_D.id);
  const report = leverReport(room, CV_D);
  const dishes = room.menu.filter((m) => room.levers?.priceHistory?.[m.key]);
  const start = async () => {
    setBusy(true);
    const r = await engine.startWindow(lever, { dish: lever === 'menu_margin' ? dish : undefined });
    setBusy(false);
    cv.toast(r.ok ? 'Test started. Baseline frozen at the last 4 weeks; each new week of Toast data is a checkpoint.' : r.error);
  };
  if (eng.mode !== 'server') return <Callout icon="Info">Real tests need the server. This preview runs in your browser only; the walk-through below shows how one runs.</Callout>;
  return (
    <section className="cv-card" aria-labelledby="your-tests">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 2 }}>
          <span className="cv-h4" id="your-tests">Tests at {CV_ROOM.short}</span>
          <span className="cv-xs cv-faint">Measured in weeks of {room.fromToast ? `your Toast data (through ${room.fromToast.end})` : 'this room’s data (sample until you load your Toast exports)'}. The daily proof loop records checkpoints and closes each one at day 28.</span>
        </div>
        <Pill icon="Timer">{mine.filter((w) => w.status === 'running' || w.status === 'waiting').length} running</Pill>
      </div>
      {mine.length === 0 && <span className="cv-small cv-muted">No tests here yet. Start one on the lever worth the most below, or from Today.</span>}
      {mine.map((w) => {
        const st = STATUS[w.status] || STATUS.running;
        return (
          <div key={w.id} className="cv-col" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div className="cv-row nowrap" style={{ gap: 10 }}>
              <span className="cv-col" style={{ gap: 2, flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{w.title}</span>
                <span className="cv-xs cv-faint">{LEVER_METRIC[w.lever]?.label} · {w.direction === 'down' ? 'down is better' : 'up is better'} · started on data to {w.startedAt} · day {w.day} of 28{w.staleDays > 9 && (w.status === 'running' || w.status === 'waiting') ? ` · no new data for ${w.staleDays} days` : ''}</span>
              </span>
              <Pill tone={st.tone} icon={st.icon}>{st.label}</Pill>
              {(w.status === 'running' || w.status === 'waiting') && <Button size="sm" variant="ghost" onClick={async () => { const r = await engine.stopWindow(w.id); cv.toast(r.ok ? 'Stopped. Nothing is booked from it.' : r.error); }}>Stop</Button>}
            </div>
            <SeriesChart w={w} />
            <dl className="cv-kv">
              <dt>Baseline (frozen)</dt><dd>{fmtM(w.unit, w.baseline)}</dd>
              <dt>Checkpoints</dt><dd>{w.checkpoints.length ? w.checkpoints.map((c) => `day ${c.day}: ${fmtM(w.unit, c.observed)}`).join(' · ') : 'none yet'}</dd>
              {w.method && <><dt>Method</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{METHOD_LABEL[w.method]}</dd></>}
              {w.pointCents != null && w.checkpoints.length >= 2 && <><dt>Measured, a week</dt><dd>${(w.pointCents / 100).toFixed(2)} point · ${(Math.max(0, w.lowCents) / 100).toFixed(2)} lower bound</dd></>}
              <dt>Booked</dt><dd><Claim k={w.status === 'verified' ? 'book' : 'none'} /> {w.status === 'verified' ? `$${(w.bookedCents / 100).toFixed(2)} a week` : '$0 until it verifies'}</dd>
            </dl>
          </div>
        );
      })}
      <div className="cv-row" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12, alignItems: 'center' }}>
        <span className="cv-small" style={{ fontWeight: 600 }}>Start a test</span>
        <select className="input" style={{ width: 'auto' }} value={lever} onChange={(e) => setLever(e.target.value)} aria-label="Lever to test">
          {report.map((l) => <option key={l.key} value={l.key}>{l.name} · {l.scope}{l.weekly > 0 ? ` · ~$${Math.round(l.weekly)}/wk` : ''}</option>)}
        </select>
        {lever === 'menu_margin' && (
          <select className="input" style={{ width: 'auto' }} value={dish} onChange={(e) => setDish(e.target.value)} aria-label="Dish">
            <option value="">Pick a dish…</option>
            {dishes.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
        )}
        <Button size="sm" icon="Play" disabled={busy || (lever === 'menu_margin' && !dish)} onClick={start}>{busy ? 'Starting…' : 'Start'}</Button>
      </div>
    </section>
  );
}

function CvWindows() {
  const cv = useCv();
  const roomId = cv.loc === 'all' ? CV_D.id : cv.loc;
  const p = pilotOf(roomId);
  const TODAY = 21;
  const [day, setDay] = React.useState(TODAY);
  const [controls, setControls] = React.useState(false);
  const [breach, setBreach] = React.useState(false);
  const [feedFailing, setFeedFailing] = React.useState(false);
  React.useEffect(() => { setDay(TODAY); setBreach(false); setFeedFailing(false); }, [roomId]);
  const w = windowState(p, { day, controls, breach, feedFailing });
  const st = STATUS[w.status];
  const e = w.effect;
  const d = w.recorded.map((c) => p.sign * (c.observed - p.baseline) - (controls ? p.sign * c.controlDelta : 0));
  const showInterval = e.n >= 2;
  return (
    <div className="cv-page wide">
      <PageHead over={`Test windows · ${locOf(roomId)?.name ?? CV_ROOM.name}`} q="Is the change working, and what can we book?"
        sub="A window opens when you press Start, a checkpoint lands with every new week of data, and at day 28 it closes Verified at the lower bound of its interval, or Rejected. Nothing is booked before then."
        right={cv.loc === 'all' && <Pill icon="Building2">{`Showing ${CV_ROOM.short}; pick a room in the top bar`}</Pill>} />

      <YourTests />

      <div className="cv-col" style={{ gap: 4 }}>
        <span className="cv-h4">How a window runs: the sample walk-through</span>
        <span className="cv-small cv-muted">The sample room&apos;s window, computed with the same estimator. Drag the day to run it forward.</span>
      </div>

      <section className="cv-card">
        <div className="cv-card-head">
          <div className="cv-col" style={{ gap: 2 }}>
            <span className="cv-over">{p.lever} · started {p.start.label} · closes Nov 3</span>
            <span className="cv-h4">{p.action}</span>
          </div>
          <Pill tone={st.tone} icon={st.icon}>{st.label}</Pill>
        </div>
        <dl className="cv-kv">
          <dt>Metric</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{p.metric} · {p.direction === 'down' ? 'down is better' : 'up is better'}</dd>
          <dt>Baseline (frozen at Start)</dt><dd>{fmtUnit(p, p.baseline)}</dd>
          <dt>Dollars per unit, fixed at Start</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{p.convert}</dd>
          <dt>Method</dt><dd style={{ fontFamily: 'var(--font-sans)' }}>{METHOD_LABEL[e.method]}</dd>
        </dl>
      </section>

      <section className="cv-card">
        <div className="cv-row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <label className="cv-col" style={{ gap: 4, flex: 1, minWidth: 220 }}>
            <span className="cv-small" style={{ fontWeight: 600 }}>Day {day} since Start{day === TODAY ? ' · today' : day > p.windowDays ? ' · after the window' : day > TODAY ? ' · ahead of today, from the sample' : ''}</span>
            <input type="range" min={0} max={35} step={1} value={day} onChange={(ev) => setDay(+ev.target.value)} aria-label="Day since Start" style={{ accentColor: "var(--accent)" }} />
          </label>
          <Tabs value={controls ? 'did' : 'ba'} onChange={(v) => setControls(v === 'did')} tabs={[{ value: 'ba', label: 'Platform today' }, { value: 'did', label: 'With matched controls' }]} />
        </div>
        <div className="cv-row cv-small" style={{ gap: 16 }}>
          <label className="cv-row nowrap" style={{ gap: 6 }}><input type="checkbox" checked={feedFailing} onChange={(ev) => setFeedFailing(ev.target.checked)} />Toast sync failing</label>
          <label className="cv-row nowrap" style={{ gap: 6 }}><input type="checkbox" checked={breach} onChange={(ev) => setBreach(ev.target.checked)} />Average check falls 7% after it closes</label>
        </div>
        <CheckpointChart p={p} w={w} controls={controls} />
        <span className="cv-xs cv-faint">{controls ? 'Hollow dots are the room as observed; solid dots subtract what matched control services did over the same stretch. ' : 'Each dot is one weekly checkpoint against the frozen baseline. '}The shaded band is the 28-day window.</span>
      </section>

      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">{w.status === 'verified' ? 'Booked, per week' : w.status === 'reversed' ? 'Removed' : 'Running estimate, per week'}</span><Claim k={w.status === 'verified' ? 'book' : e.n ? 'cau' : 'none'} /></div>
          <span className={`cv-fig xl ${w.status === 'verified' ? 'cv-up' : w.status === 'reversed' ? 'cv-down' : ''}`}>
            {w.status === 'verified' ? cvMoney(dollars(w.bookedCents)) : w.status === 'reversed' ? `−${cvMoney(dollars(e.bookableWeeklyCents))}` : e.n ? cvMoney(dollars(e.pointCents)) : '—'}
          </span>
          {showInterval && <Interval lo={dollars(e.lowCents)} pt={dollars(e.pointCents)} hi={dollars(e.highCents)} min={Math.min(0, dollars(e.lowCents)) - 10} max={dollars(e.highCents) + 10} billedLabel={w.status === 'verified' ? 'booked' : 'what would book'} />}
          {e.n === 1 && <Callout icon="Hourglass">One checkpoint has no spread to measure, so nothing would book yet.</Callout>}
          {e.n === 0 && <Callout icon="Timer">Window open. The first checkpoint lands on day 7 ({p.checkpoints[0].date}).</Callout>}
          {w.status === 'waiting' && <Callout tone="warn" icon="CirclePause">The Toast feed is failing, so the window waits rather than fails. The pilot runner already has an alert email; the window picks up from its cursor once credentials are updated.</Callout>}
          {w.status === 'rejected' && <Callout tone="bad" icon="CircleX">Closed Rejected: {w.gates.filter((g) => !g.ok).map((g) => g.label.toLowerCase()).join(', ')}. Nothing books.</Callout>}
          {w.status === 'reversed' && <Callout tone="bad" icon="Undo2">The weekly reverification found average check down {Math.abs(w.guard.rows[0].pct).toFixed(1)}%, past the 5% limit. The verified dollars are reversed.</Callout>}
        </section>
        <section className="cv-card">
          <span className="cv-h4">Four gates</span>
          <div className="cv-col" style={{ gap: 10 }}>
            {w.gates.map((g) => (
              <div key={g.key} className="cv-row nowrap" style={{ gap: 8, alignItems: 'flex-start' }}>
                <Icon name={g.ok ? 'CircleCheck' : g.pending ? 'CircleDot' : 'CircleX'} size={17} className={g.ok ? 'ok' : g.pending ? 'warn' : 'no'} />
                <div className="cv-col" style={{ gap: 2 }}><span className="cv-small" style={{ fontWeight: 600 }}>{g.label}</span><span className="cv-xs cv-faint">{g.detail}</span></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Checkpoint</th><th className="r">Observed</th><th className="r">Move vs baseline</th><th className="r">Control Δ</th><th className="r">Services</th><th className="r">Effect counted</th><th>State</th></tr></thead>
            <tbody>
              {p.checkpoints.map((c, i) => {
                const done = c.day <= day;
                const dpct = (p.sign * (c.observed - p.baseline) / Math.abs(p.baseline)) * 100;
                return (
                  <tr key={c.day} style={{ opacity: done ? 1 : 0.45 }}>
                    <td>{c.date} · day {c.day}</td>
                    <td className="r">{fmtUnit(p, c.observed)}</td>
                    <td className="r">{dpct >= 0 ? '+' : '−'}{Math.abs(dpct).toFixed(1)}%</td>
                    <td className="r">{controls ? fmtUnit(p, c.controlDelta, true) : '—'}</td>
                    <td className="r">{c.services}</td>
                    <td className="r">{done ? fmtUnit(p, d[i] ?? 0, true) : '—'}</td>
                    <td className="cv-small cv-muted">{done ? 'Recorded by the proof loop' : 'Due'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cv-grid g2">
        <section className="cv-card">
          <span className="cv-h4">The arithmetic</span>
          <div className="cv-formula" style={{ fontSize: 'var(--text-xs)' }}>
            {`d_i = ${p.sign > 0 ? '+' : '−'}(observed − baseline)${controls ? ` ${p.sign > 0 ? '−' : '+'} control Δ` : ''}\n`}
            {e.n ? `d = [${d.map((x) => x.toFixed(2)).join(', ')}]   n = ${e.n}\nmean = ${e.pointUnits.toFixed(2)}` : 'no checkpoints yet'}
            {e.n >= 2 ? `\n90% interval = mean ± t(${e.n - 1}) × sd/√n = [${e.lowUnits.toFixed(2)}, ${e.highUnits.toFixed(2)}]\n× ${p.centsPerUnitWeek}¢ per unit a week = [${cvMoney(dollars(e.lowCents))}, ${cvMoney(dollars(e.highCents))}]/wk\nbooks max($0, lower bound) = ${cvMoney(dollars(e.bookableWeeklyCents))}/wk` : ''}
          </div>
          <span className="cv-xs cv-faint">Gate 1 floor: each of the last two moves at least {MAGNITUDE_FLOOR_PCT}% of the baseline, with 5 or more services compared.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Weekly guardrail check</span><span className="cv-xs cv-faint">Set at this room's first window</span></div>
          <div className="cv-tablewrap"><table className="cv-table">
            <thead><tr><th>Guardrail</th><th className="r">Baseline</th><th className="r">This week</th><th>Limit</th><th /></tr></thead>
            <tbody>
              {w.guard.rows.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td>
                  <td className="r">{g.unit === '$' ? `$${g.base.toFixed(2)}` : `${g.base} min`}</td>
                  <td className="r">{g.unit === '$' ? `$${g.now.toFixed(2)}` : `${g.now} min`} <span className="cv-xs cv-faint">({g.pct >= 0 ? '+' : '−'}{Math.abs(g.pct).toFixed(1)}%)</span></td>
                  <td className="cv-small cv-muted">{g.limit}</td>
                  <td><Icon name={g.ok ? 'CircleCheck' : 'CircleX'} size={16} className={g.ok ? 'ok' : 'no'} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      </div>

      <Callout tone="warn" icon="TriangleAlert">
        Still to come: a window opens when you press Start (or when Toast confirms a price change), not on other evidence the change happened; no matched control rooms are subtracted yet, so every real window is a before/after; and "couldn't tell" and "didn't work" both close as Rejected. <button className="cv-link" onClick={() => cv.go('proof')}>See the Proof screen</button>
      </Callout>
    </div>
  );
}

export { CvWindows };
