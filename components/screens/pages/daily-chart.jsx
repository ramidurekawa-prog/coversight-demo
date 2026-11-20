'use client';

import * as React from 'react';

import { cvScale } from '../core';
import { addDays, lastYear } from '../../../lib/data/page/daily';
import s from './daily.module.css';

const W = 1000, H = 230, P = { l: 64, r: 14, t: 16, b: 28 };
const short = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const long = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * Every calendar day in the window (a day the data doesn't hold is a gap, not
 * a zero), its 7-day average, and the same weekday a year before. Hover or
 * arrow keys to read a day; click or Enter to open it.
 */
export function DayChart({ days, metric, from, to, notes, selected, onOpen }) {
  const byIso = React.useMemo(() => new Map(days.map((d) => [d.iso, d])), [days]);
  const end = to;
  const dates = React.useMemo(() => { const out = []; for (let d = from; d <= to && out.length < 800; d = addDays(d, 1)) out.push(d); return out; }, [from, to]);
  const vals = dates.map((iso) => { const d = byIso.get(iso); return d ? metric.get(d) : null; });
  const prior = dates.map((iso) => { const d = byIso.get(lastYear(iso)); return d ? metric.get(d) : null; });
  // 7-day rolling mean over the days held, so weekday swings don't hide the trend.
  const roll = vals.map((_, i) => { const w = vals.slice(Math.max(0, i - 6), i + 1).filter((v) => v != null); return w.length >= 4 ? w.reduce((a, b) => a + b, 0) / w.length : null; });
  const all = [...vals, ...prior].filter((v) => v != null);
  let lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all) : 1;
    const pad = (hi - lo) * 0.06 || 1; hi += pad; lo -= pad;
  const x = cvScale(0, Math.max(1, dates.length - 1), P.l, W - P.r), y = cvScale(lo, hi, H - P.b, P.t);
  const path = (arr) => arr.map((v, i) => (v == null ? '' : `${i && arr[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(' ');
  const every = Math.max(1, Math.ceil(dates.length / 8));
  const [at, setAt] = React.useState(null);
  const ref = React.useRef(null);
  const hasPrior = prior.some((v) => v != null);

  const pick = (e) => {
    const r = ref.current.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((vx - P.l) / (W - P.l - P.r)) * (dates.length - 1));
    setAt(Math.max(0, Math.min(dates.length - 1, i)));
  };
  const key = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setAt((a) => Math.max(0, Math.min(dates.length - 1, (a ?? dates.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1)))); }
    if ((e.key === 'Enter' || e.key === ' ') && at != null && byIso.get(dates[at])) { e.preventDefault(); onOpen(dates[at]); }
    if (e.key === 'Escape') setAt(null);
  };
  const cur = at != null ? dates[at] : null;
  const tipLeft = at != null ? (x(at) / W) * 100 : 0;
  const noteDays = dates.map((iso, i) => (notes[iso] ? i : null)).filter((i) => i != null);

  return (
    <div className={s.chartWrap}>
      <svg ref={ref} className={`cv-chart ${s.chartSvg}`} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0}
        aria-label={`${metric.label} by day, ${dates.length} days to ${long(end)}${hasPrior ? ', with the same weekday last year' : ''}. Use the arrow keys to read a day and Enter to open it.`}
        onMouseMove={pick} onMouseLeave={() => setAt(null)} onKeyDown={key} onBlur={() => setAt(null)}
        onClick={() => { if (cur && byIso.get(cur)) onOpen(cur); }}>
        {[lo + pad, (lo + hi) / 2, hi - pad].map((v, i) => <g key={i}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">{metric.fmt(v)}</text></g>)}
        {hasPrior && <path d={path(prior)} fill="none" stroke="var(--border-strong)" strokeWidth="1.25" strokeDasharray="3 3" />}
        <path d={path(vals)} fill="none" stroke="var(--cat-1)" strokeWidth="1" opacity="0.45" />
        <path d={path(roll)} fill="none" stroke="var(--cat-1)" strokeWidth="2.25" />
        {noteDays.map((i) => <circle key={i} cx={x(i)} cy={P.t - 4} r="3.5" fill="var(--warning-500)" />)}
        {selected && dates.includes(selected) && <line x1={x(dates.indexOf(selected))} x2={x(dates.indexOf(selected))} y1={P.t} y2={H - P.b} stroke="var(--accent)" strokeWidth="2" opacity="0.7" />}
        {dates.map((iso, i) => (i % every === 0 || i === dates.length - 1) && (i === dates.length - 1 || dates.length - 1 - i >= every * 0.6) && <text key={iso} x={x(i)} y={H - 8} textAnchor="middle">{short(iso)}</text>)}
        {cur && <>
          <line x1={x(at)} x2={x(at)} y1={P.t} y2={H - P.b} stroke="var(--fg-3)" strokeWidth="1" />
          {vals[at] != null && <circle cx={x(at)} cy={y(vals[at])} r="4" fill="var(--surface)" stroke="var(--cat-1)" strokeWidth="2" />}
        </>}
      </svg>
      {cur && (
        <div className={s.tip} style={tipLeft > 60 ? { right: `${100 - tipLeft + 1}%` } : { left: `${tipLeft + 1}%` }} aria-hidden="true">
          <b>{long(cur)}</b>
          {vals[at] == null ? <span>{byIso.get(cur) ? 'Not measured this day.' : 'No data held for this day (not a zero).'}</span> : <>
            <div className={s.tipRow}><span>{metric.label}</span><span>{metric.fmt(vals[at])}</span></div>
            {roll[at] != null && <div className={s.tipRow}><span>7-day average</span><span>{metric.fmt(roll[at])}</span></div>}
            {prior[at] != null && <div className={s.tipRow}><span>Same weekday last year</span><span>{metric.fmt(prior[at])}</span></div>}
            {byIso.get(cur)?.complete === false && <span className="cv-down">Partial day</span>}
            <span className="cv-faint">Click to show this day</span>
          </>}
          {notes[cur] && <span className={s.tipNote}>{notes[cur].text}</span>}
        </div>
      )}
    </div>
  );
}
