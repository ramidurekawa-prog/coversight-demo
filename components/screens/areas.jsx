'use client';

/* Shared by more than one page (see components/screens/pages/). Page threads
   don't edit this file: ask for a shared change so it lands once. */

import { Icon } from '../kit';
import { CV_D, Pill, cvScale } from './core';

/* Operating areas (V3, from the "map of restaurant inefficiencies" sheets).
 * Every area runs the same closed loop (detect → understand → act → verify),
 * and every diagnostic screen answers the same four things: what data it
 * needs, the chart that shows it, what to tell the GM in plain English, and
 * the fix, plus how we'll know the fix worked. All figures come from the
 * current room's data (CV_D). */

/* ================================================================ the loop */
const CV_LOOP = [
  { k: 'detect', label: 'Detect', icon: 'ScanSearch', sub: 'A detector finds it in your data' },
  { k: 'understand', label: 'Understand', icon: 'ChartColumn', sub: 'The chart, the cause and the dollars' },
  { k: 'act', label: 'Act', icon: 'MousePointerClick', sub: 'One fix, approved in the app' },
  { k: 'verify', label: 'Verify', icon: 'BadgeCheck', sub: 'Measured against matched controls' },
];
const CV_STAGE_IDX = { none: -1, detect: 0, understand: 1, act: 2, verify: 3 };

/** The four-step loop with the current step highlighted. `notes` overrides each step's sub-line. */
function LoopStrip({ stage, notes = {} }) {
  const at = CV_STAGE_IDX[stage];
  return (
    <ol className="cv-loop" aria-label="Where this is in the loop">
      {CV_LOOP.map((s, i) => (
        <li key={s.k} className={i < at ? 'done' : i === at ? 'on' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="n">{i < at ? <Icon name="Check" size={14} /> : <Icon name={s.icon} size={14} />}</span>
          <span className="cv-col" style={{ gap: 1 }}>
            <b>{s.label}</b>
            <span className="cv-xs cv-muted">{notes[s.k] || s.sub}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const CV_FEED_TONE = { healthy: ['good', 'CircleCheck'], stale: ['warn', 'Clock'], partial: ['warn', 'CircleDot'], off: ['neutral', 'CircleMinus'] };
function FeedChip({ name }) {
  const f = CV_D.feeds.find((x) => x.name === name);
  const [tone, icon] = f ? CV_FEED_TONE[f.state] : ['neutral', 'CircleMinus'];
  return <Pill tone={tone} icon={f?.manual ? 'PencilLine' : icon}>{name}</Pill>;
}

/** The reference sheets' diagnostic method, as one card. */
function Diagnose({ data, manager, fix, verify }) {
  return (
    <section className="cv-card cv-diag">
      <div className="cv-diag-row">
        <span className="cv-over"><Icon name="Database" size={13} />Data it needs</span>
        <div className="cv-row" style={{ gap: 6 }}>{data.map((d) => <FeedChip key={d} name={d} />)}</div>
      </div>
      <div className="cv-diag-row">
        <span className="cv-over"><Icon name="MessageSquareQuote" size={13} />What to tell the GM</span>
        <p className="cv-quote">&ldquo;{manager}&rdquo;</p>
      </div>
      <div className="cv-diag-row">
        <span className="cv-over"><Icon name="Wrench" size={13} />The fix</span>
        <span className="cv-small" style={{ lineHeight: 1.5 }}>{fix}</span>
      </div>
      <div className="cv-diag-row">
        <span className="cv-over"><Icon name="RefreshCcw" size={13} />How we&apos;ll know it worked</span>
        <span className="cv-small" style={{ lineHeight: 1.5 }}>{verify}</span>
      </div>
    </section>
  );
}

function ControlChart({ series, mean, ucl, lcl, unit = '%', labels }) {
  const W = 560, H = 190, P = { l: 34, r: 16, t: 14, b: 26 };
  const lo = Math.min(lcl, ...series) * 0.96, hi = Math.max(ucl, ...series) * 1.03;
  const x = cvScale(0, series.length - 1, P.l, W - P.r);
  const y = cvScale(lo, hi, H - P.b, P.t);
  const path = series.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Control chart">
      {[[ucl, 'UCL'], [mean, 'mean'], [lcl, 'LCL']].map(([v, k]) => (
        <g key={k}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke={k === 'mean' ? 'var(--border-strong)' : 'var(--money-down)'} strokeDasharray={k === 'mean' ? '' : '4 4'} />
          <text x={P.l - 4} y={y(v) + 3} textAnchor="end">{k === 'mean' ? `${v.toFixed(1)}${unit}` : k}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {series.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === series.length - 1 ? 4.5 : 3} fill={v > ucl || v < lcl ? 'var(--money-down)' : i === series.length - 1 ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" strokeWidth="1.5" />)}
      {labels && labels.map((l, i) => (i % 3 === 0 || i === labels.length - 1) && <text key={l} className="lbl" x={x(i)} y={H - 8} textAnchor="middle">{l}</text>)}
    </svg>
  );
}

export { CV_LOOP, CV_STAGE_IDX, LoopStrip, CV_FEED_TONE, FeedChip, Diagnose, ControlChart };
