'use client';

import * as React from 'react';

import { Tabs } from '../kit';
import { CV_D, CV_DS, CV_GROUP, CV_ROOM, Callout, Claim, PageHead, cvMoney, cvScale } from './core';
import { controlLimits } from '../../lib/data/model';

/* Trends: 52 weeks of the room's own history. The week of Oct 19 is the live
 * week (it moves with hand-entered data); earlier weeks are history. Control
 * limits come from the first 39 weeks, so the last quarter is judged against
 * a baseline it didn't shape. */

const ROOM_COLORS = { oakland: 'var(--cat-1)', berkeley: 'var(--cat-2)', walnut: 'var(--cat-3)' };

function LineChart({ series, labels, fmt, limits, matched, height = 210, ariaLabel }) {
  const W = 1000, H = height, P = { l: 56, r: 12, t: 12, b: 28 };
  const all = series.flatMap((s) => s.vals);
  const extra = limits ? [limits.ucl, limits.lcl] : [];
  let lo = Math.min(...all, ...extra), hi = Math.max(...all, ...extra);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const n = labels.length;
  const x = cvScale(0, n - 1, P.l, W - P.r);
  const y = cvScale(lo, hi, H - P.b, P.t);
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {ticks.map((v, i) => <g key={i}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">{fmt(v)}</text></g>)}
      {matched && matched.map((i) => <rect key={i} x={x(i) - 6} y={P.t} width={12} height={H - P.t - P.b} fill="var(--accent)" opacity="0.08" />)}
      {limits && <>
        <line x1={P.l} x2={W - P.r} y1={y(limits.ucl)} y2={y(limits.ucl)} stroke="var(--money-down)" strokeDasharray="4 4" />
        <line x1={P.l} x2={W - P.r} y1={y(limits.lcl)} y2={y(limits.lcl)} stroke="var(--money-down)" strokeDasharray="4 4" />
        <line x1={P.l} x2={W - P.r} y1={y(limits.mean)} y2={y(limits.mean)} stroke="var(--border-strong)" />
        <line x1={x(38.5)} x2={x(38.5)} y1={P.t} y2={H - P.b} stroke="var(--border-strong)" strokeDasharray="2 3" />
        <text className="lbl" x={x(38.5) + 6} y={P.t + 10}>baseline ends</text>
      </>}
      {series.map((s) => (
        <g key={s.key}>
          <path d={s.vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.thin ? 1.5 : 2.25} strokeDasharray={s.dash} />
          {limits && s.vals.map((v, i) => (v > limits.ucl || v < limits.lcl ? <circle key={i} cx={x(i)} cy={y(v)} r="4" fill="var(--money-down)" /> : null))}
          <circle cx={x(n - 1)} cy={y(s.vals[n - 1])} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
        </g>
      ))}
      {labels.map((l, i) => (i % 6 === 0 || i === n - 1) && <text key={i} x={x(i)} y={H - 8} textAnchor="middle">{l}</text>)}
    </svg>
  );
}

function Legend({ items }) {
  return <div className="cv-legend">{items.map(([label, color, dash]) => <span key={label}><i className="line" style={{ background: color, ...(dash ? { backgroundImage: 'none', borderTop: `2px dashed ${color}`, height: 0 } : {}) }} />{label}</span>)}</div>;
}

function CvTrends() {
  const [view, setView] = React.useState('room');
  const H = CV_D.hist.rows;
  const labels = CV_DS.weeks.map((w) => w.label);
  const last = H[H.length - 1];
  const avg = (f, a = 0, b = 51) => H.slice(a, b).reduce((s, r) => s + f(r), 0) / (b - a);
  const prime = H.map((r) => r.prime * 100);
  const primeLim = controlLimits(prime, 39);
  const exc = H.map((r) => r.excPct);
  const excLim = controlLimits(exc, 39);
  const outPrime = prime.slice(39).filter((v) => v > primeLim.ucl || v < primeLim.lcl).length;
  const ly = H[0];
  const groupEarned = CV_GROUP.rooms.map((d) => ({ key: d.id, color: ROOM_COLORS[d.id], label: d.profile.short, vals: d.hist.rows.map((r) => r.earned / d.profile.seats) }));
  return (
    <div className="cv-page wide">
      <PageHead over={`Trends · ${CV_ROOM.name} · 52 weeks, Oct 27 2025 to Oct 19 2026`} q="Is this room getting better or worse, and is any of it unusual?"
        sub="A year of weekly history. Seasonality is expected; what matters is a week outside its control limits, judged against a baseline the recent weeks didn't shape."
        right={<Tabs value={view} onChange={setView} tabs={[{ value: 'room', label: CV_ROOM.short }, { value: 'group', label: 'All rooms' }]} />} />
      <div className="cv-grid g4">
        {[
          ['Net sales, this week', cvMoney(Math.round(last.net)), `52-week average ${cvMoney(Math.round(avg((r) => r.net)))}`, 'obs'],
          ['Earned, this week', cvMoney(Math.round(last.earned)), `${last.earned >= ly.earned ? 'up' : 'down'} ${cvMoney(Math.abs(Math.round(last.earned - ly.earned)))} on Oct 27 last year`, 'obs'],
          ['Prime cost, this week', `${(last.prime * 100).toFixed(1)}%`, `baseline ${primeLim.mean.toFixed(1)}% ± ${(3 * primeLim.sd).toFixed(1)}`, 'obs'],
          ['Average check', cvMoney(last.check, { cents: true }), `${last.covers.toLocaleString('en-US')} covers this week`, 'obs'],
        ].map(([k, v, sub, cl]) => (
          <div key={k} className="cv-card" style={{ gap: 6 }}>
            <div className="cv-row" style={{ justifyContent: 'space-between' }}><span className="cv-xs cv-faint">{k}</span><Claim k={cl} /></div>
            <span className="cv-fig md">{v}</span>
            <span className="cv-xs cv-faint">{sub}</span>
          </div>
        ))}
      </div>
      {view === 'room' ? (
        <>
          <section className="cv-card">
            <div className="cv-card-head"><span className="cv-h4">Net sales and earned, weekly</span><Claim k="obs" /></div>
            <LineChart labels={labels} fmt={(v) => cvMoney(Math.round(v / 100) * 100)} matched={CV_DS.matchedWeeks} ariaLabel="Net sales and earned by week"
              series={[{ key: 'net', color: 'var(--accent)', vals: H.map((r) => r.net) }, { key: 'earned', color: 'var(--cat-2)', vals: H.map((r) => r.earned) }]} />
            <Legend items={[['Net sales', 'var(--accent)'], ['Earned (contribution)', 'var(--cat-2)']]} />
            <span className="cv-small cv-muted">Shaded weeks are the six matched weeks this week is compared with on This week. December and Thanksgiving show up as they should; that&apos;s seasonality, not a finding.</span>
          </section>
          <div className="cv-grid g2">
            <section className="cv-card">
              <div className="cv-card-head"><span className="cv-h4">Prime cost, share of sales</span><Claim k="obs" /></div>
              <LineChart labels={labels} fmt={(v) => `${v.toFixed(1)}%`} limits={primeLim} height={200} ariaLabel="Prime cost control chart" series={[{ key: 'prime', color: 'var(--accent)', vals: prime }]} />
              <span className="cv-small cv-muted">{outPrime ? `${outPrime} of the last 13 weeks fell outside the limits.` : 'Every one of the last 13 weeks stayed inside the limits.'} Food and labour together, from the register and the schedule.</span>
            </section>
            <section className="cv-card">
              <div className="cv-card-head"><span className="cv-h4">Food and labour, separately</span><Claim k="obs" /></div>
              <LineChart labels={labels} fmt={(v) => `${v.toFixed(0)}%`} height={200} ariaLabel="Food and labour share of sales"
                series={[{ key: 'food', color: 'var(--cat-1)', vals: H.map((r) => r.foodRate * 100) }, { key: 'lab', color: 'var(--cat-3)', vals: H.map((r) => r.labourRate * 100), dash: '6 3' }]} />
              <Legend items={[['Food cost %', 'var(--cat-1)'], ['Labour %', 'var(--cat-3)', true]]} />
            </section>
            <section className="cv-card">
              <div className="cv-card-head"><span className="cv-h4">Register exceptions, share of sales</span><Claim k="obs" /></div>
              <LineChart labels={labels} fmt={(v) => `${v.toFixed(1)}%`} limits={excLim} height={200} ariaLabel="Register exceptions control chart" series={[{ key: 'exc', color: 'var(--accent)', vals: exc }]} />
              <span className="cv-small cv-muted">Voids, comps and discounts together. Per-person limits are on Controls.</span>
            </section>
            <section className="cv-card">
              <div className="cv-card-head"><span className="cv-h4">Weighted margin per dish</span><Claim k="obs" /></div>
              <LineChart labels={labels} fmt={(v) => cvMoney(v, { cents: true })} height={200} ariaLabel="Weighted margin per dish by week" series={[{ key: 'wcm', color: 'var(--cat-2)', vals: H.map((r) => r.wcm) }]} />
              <span className="cv-small cv-muted">{H[38].wcm - last.wcm > 0.4 ? `Down ${cvMoney(H[38].wcm - last.wcm, { cents: true })} in 13 weeks while plate costs held: guests are drifting to lower-earning dishes.` : 'Steady: the menu mix isn\'t drifting.'}</span>
            </section>
          </div>
        </>
      ) : (
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Earned per seat, weekly, all three rooms</span><Claim k="obs" /></div>
          <LineChart labels={labels} fmt={(v) => cvMoney(Math.round(v))} ariaLabel="Earned per seat by room" series={groupEarned} />
          <Legend items={groupEarned.map((s) => [s.label, s.color])} />
          <span className="cv-small cv-muted">Per seat, so rooms of different sizes compare fairly. {groupEarned.map((s) => `${s.label} ${cvMoney(Math.round(s.vals[51]))}`).join(' · ')} this week.</span>
        </section>
      )}
      <Callout icon="Info">History here is the sample group&apos;s, generated with the same seasonality every year: a December peak, a January dip, Thanksgiving and Christmas weeks. Hand-entered data changes the live week only; past weeks are closed.</Callout>
    </div>
  );
}

export { CvTrends };
