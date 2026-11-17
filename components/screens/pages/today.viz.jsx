'use client';

import * as React from 'react';

import s from './today.module.css';

/* Today's small visuals. Each one shows one comparison, and the number it
 * shows is always written beside it too, so nothing depends on colour or on
 * reading the shape alone (the SVGs are aria-hidden; their text isn't). */

/**
 * Recent values as a line across the card, with their dates at each end and
 * the comparison average as a labelled dashed line. The average is the same
 * one the card's comparison uses (passed in), so the picture and the words
 * always agree. The latest point is filled.
 */
export function Spark({ values, avg, first, last: lastLabel, caption, fmt = String, h = 44 }) {
  if (!values || values.length < 2) return null;
  const mean = avg ?? values.slice(0, -1).reduce((a, b) => a + b, 0) / (values.length - 1);
  const lo = Math.min(...values, mean), hi = Math.max(...values, mean);
  const span = hi - lo || 1;
  const W = 100;
  const x = (i) => (i / (values.length - 1)) * W;
  const y = (v) => 4 + (1 - (v - lo) / span) * (h - 8);
  const n = values.length - 1;
  return (
    <span className={s.sparkWrap}>
      <span className={s.sparkPlot} style={{ height: h }}>
        <svg className={s.spark} width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1={0} x2={W} y1={y(mean)} y2={y(mean)} className={s.sparkAvg} vectorEffect="non-scaling-stroke" />
          <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} className={s.sparkLine} vectorEffect="non-scaling-stroke" />
        </svg>
        <i className={s.sparkDot} style={{ left: `${x(n)}%`, top: y(values[n]) }} aria-hidden="true" />
        <span className={s.sparkAvgLbl} style={{ top: y(mean) }}>avg {fmt(mean)}</span>
      </span>
      <span className={s.sparkAxis}><span>{first}</span>{caption && <span className={s.sparkCap}>{caption}</span>}<span>{lastLabel}</span></span>
    </span>
  );
}

/** One value against a usual mark on the same scale: the bar is this period, the tick is usual. Both are labelled. */
export function MarkBar({ value, mark, max, fmt = String, label = 'This week', tickLabel = 'usual' }) {
  const top = max || Math.max(value, mark) * 1.35 || 1;
  const pc = (v) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  return (
    <span className={s.sparkWrap}>
      <span className={s.markBar} aria-hidden="true">
        <span className={s.markTrack}><span className={s.markFill} style={{ width: pc(value) }} /></span>
        <span className={s.markTick} style={{ left: pc(mark) }}><span className={s.markTickLbl}>{tickLabel} {fmt(mark)}</span></span>
      </span>
      <span className={s.sparkAxis}><span>{label} {fmt(value)}</span></span>
    </span>
  );
}

/**
 * Tonight's covers against a comparable night, per 15 minutes: the usual night
 * as a shaded shape across the whole service, tonight as a line up to now,
 * and when the usual rush is. Times come from the service's own slots.
 */
export function PaceCurve({ comp, actual, times, h = 56 }) {
  if (!comp?.length || !actual?.length) return null;
  const n = comp.length - 1;
  const top = Math.max(...comp, ...actual) * 1.1 || 1;
  const x = (i) => (i / n) * 100;
  const y = (v) => 3 + (1 - v / top) * (h - 6);
  const area = `0,${h} ${comp.map((v, i) => `${x(i)},${y(v)}`).join(' ')} 100,${h}`;
  const peak = Math.max(...comp);
  const p0 = comp.indexOf(peak), p1 = comp.lastIndexOf(peak);
  const endOf = (i) => times[i + 1] || times[i];
  const rush = `${times[p0]}–${endOf(p1)} pm`;
  const nowI = actual.length - 1;
  return (
    <span className={s.sparkWrap}>
      <span className={s.sparkPlot} style={{ height: h, width: '100%' }}>
        <svg className={s.spark} width="100%" height={h} viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
          <rect x={x(p0)} width={Math.max(0.8, x(p1 + 1) - x(p0))} y={0} height={h} className={s.curveRush} />
          <polygon points={area} className={s.curveUsual} />
          <polyline points={actual.map((v, i) => `${x(i)},${y(v)}`).join(' ')} className={s.sparkLine} vectorEffect="non-scaling-stroke" />
          <line x1={x(nowI)} x2={x(nowI)} y1={0} y2={h} className={s.curveNow} vectorEffect="non-scaling-stroke" />
        </svg>
        <i className={s.sparkDot} style={{ left: `${x(nowI)}%`, top: y(actual[nowI]) }} aria-hidden="true" />
      </span>
      <span className={s.sparkAxis} style={{ width: "100%" }}><span>{times[0]}</span><span className={s.sparkCap}>Usual rush {rush}</span><span>{times[n]}</span></span>
      <span className={s.curveKey}><span><i className={s.keyLine} />Tonight</span><span><i className={s.keyArea} />A comparable night</span></span>
    </span>
  );
}

/** Weekly refunds by app, as labelled bars on one scale. */
export function RefundBars({ rows }) {
  const top = Math.max(...rows.map((r) => r[1]), 1);
  const total = rows.reduce((t, r) => t + r[1], 0);
  return (
    <span className={s.refunds}>
      {rows.map(([name, v]) => (
        <span key={name} className={s.refundRow}>
          <span className={s.paceLbl}>{name}</span>
          <span className={s.paceTrack}><span className={s.paceNow} style={{ width: `${(v / top) * 100}%` }} /></span>
          <b className={s.paceVal}>${Math.round(v).toLocaleString('en-US')}</b>
        </span>
      ))}
      <span className={s.sparkAxis}><span>Refunds a week, by app · ${Math.round(total).toLocaleString('en-US')} in all</span></span>
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
