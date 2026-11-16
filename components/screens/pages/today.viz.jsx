'use client';

import * as React from 'react';

import s from './today.module.css';

/* Today's small visuals. Each one shows one comparison, and the number it
 * shows is always written beside it too, so nothing depends on colour or on
 * reading the shape alone (the SVGs are aria-hidden; their text isn't). */

/** A tiny line: recent values, their average dashed, the latest point filled. */
export function Spark({ values, w = 112, h = 32 }) {
  if (!values || values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i) => 3 + (i / (values.length - 1)) * (w - 6);
  const y = (v) => 3 + (1 - (v - lo) / span) * (h - 6);
  const prior = values.slice(0, -1);
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  const last = values.length - 1;
  return (
    <svg className={s.spark} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <line x1={3} x2={w - 3} y1={y(avg)} y2={y(avg)} className={s.sparkAvg} />
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} className={s.sparkLine} />
      <circle cx={x(last)} cy={y(values[last])} r={3.5} className={s.sparkNow} />
    </svg>
  );
}

/** One value against a usual mark on the same scale: the bar is this week, the tick is usual. */
export function MarkBar({ value, mark, max, tickLabel = 'usual' }) {
  const top = max || Math.max(value, mark) * 1.35 || 1;
  const pc = (v) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  return (
    <span className={s.markBar} aria-hidden="true">
      <span className={s.markTrack}><span className={s.markFill} style={{ width: pc(value) }} /></span>
      <span className={s.markTick} style={{ left: pc(mark) }}><span className={s.markTickLbl}>{tickLabel}</span></span>
    </span>
  );
}

/** Two bars on one scale: usual and tonight. */
export function PaceBars({ factor }) {
  const now = Math.max(0, factor);
  const top = Math.max(1, now);
  return (
    <span className={s.pace} aria-hidden="true">
      <span className={s.paceRow}><span className={s.paceLbl}>Usual</span><span className={s.paceTrack}><span className={s.paceUsual} style={{ width: `${(1 / top) * 100}%` }} /></span></span>
      <span className={s.paceRow}><span className={s.paceLbl}>Tonight</span><span className={s.paceTrack}><span className={s.paceNow} style={{ width: `${(now / top) * 100}%` }} /></span></span>
    </span>
  );
}

/** People: one mark per person scheduled; the ones beyond what's needed are hollow. */
export function People({ on, need, label = 'servers' }) {
  const n = Math.max(on, need);
  return (
    <span className={s.people}>
      <span className={s.peopleDots} aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={i < Math.min(on, need) ? s.pFill : i < on ? s.pExtra : s.pShort} />
        ))}
      </span>
      <span className={s.peopleTxt}><b>{on}</b> {label} on · <b>{need}</b> needed</span>
    </span>
  );
}

/** Hours against a limit (overtime past 40): the part past the limit is hatched. */
export function HoursBar({ hours, limit = 40 }) {
  const top = Math.max(hours, limit) * 1.1;
  return (
    <span className={s.people}>
      <span className={s.hoursBar} aria-hidden="true">
        <span className={s.hoursIn} style={{ width: `${(Math.min(hours, limit) / top) * 100}%` }} />
        {hours > limit && <span className={s.hoursOver} style={{ left: `${(limit / top) * 100}%`, width: `${((hours - limit) / top) * 100}%` }} />}
        <span className={s.hoursTick} style={{ left: `${(limit / top) * 100}%` }} />
      </span>
      <span className={s.peopleTxt}><b>{hours}</b> hours scheduled · overtime after <b>{limit}</b></span>
    </span>
  );
}

/** How old a feed is against how fresh it should be. */
export function AgeBar({ days, fresh = 7 }) {
  const top = Math.max(days, fresh) * 1.1;
  return (
    <span className={s.people}>
      <span className={s.hoursBar} aria-hidden="true">
        <span className={s.hoursIn} style={{ width: `${(Math.min(days, fresh) / top) * 100}%` }} />
        {days > fresh && <span className={s.hoursOver} style={{ left: `${(fresh / top) * 100}%`, width: `${((days - fresh) / top) * 100}%` }} />}
        <span className={s.hoursTick} style={{ left: `${(fresh / top) * 100}%` }} />
      </span>
      <span className={s.peopleTxt}><b>{days} days</b> old · should be under <b>{fresh}</b></span>
    </span>
  );
}

/**
 * Staffing as one bar of equal segments, one per person: covered by the
 * forecast (solid), scheduled beyond it (hatched, potential excess) or needed
 * but not scheduled (outlined, short). The numbers are written beside it.
 */
export function StaffBar({ on, need, unit = 'servers' }) {
  const n = Math.max(on, need);
  const extra = Math.max(0, on - need);
  const short = Math.max(0, need - on);
  return (
    <span className={s.staff}>
      <span className={s.staffBar} aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={i < Math.min(on, need) ? s.segOn : i < on ? s.segExtra : s.segShort} />
        ))}
      </span>
      <span className={s.staffKey}>
        <span><b>{on}</b> scheduled</span>
        <span><b>{need}</b> forecast need</span>
        {extra > 0 && <span className={s.staffExtra}><i aria-hidden="true" /><b>{extra}</b> potential excess</span>}
        {short > 0 && <span className={s.staffShort}><i aria-hidden="true" /><b>{short}</b> short</span>}
      </span>
      <span className={s.srOnly}>{`${on} ${unit} scheduled, ${need} needed by the forecast.`}</span>
    </span>
  );
}
