'use client';

import * as React from 'react';

import { Icon } from '../../kit';
import { useCv, Claim, cvMoney } from '../core';
import { useDense } from '../dense-ui';
import s from './today.module.css';

/* Last service: the latest day of sales against the same weekday before, as
 * two numbers and a run chart. An optional section on Today. */

export const shortMoney = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(v)}`);
export const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const DOW = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const longDow = (d) => DOW[d] || d;
const signPct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;
/** Round axis steps: 1, 2 or 5 times a power of ten, about four ticks. */
const niceStep = (span) => { const raw = span / 4; const p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw); };
export const isoMinus = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

/** Width of an element, kept up to date. */
function useWidth() {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Net sales on the last eight of one weekday, as a run chart: a line with
 * points on an axis that fits the data, the range of the seven before as a
 * band (solid edges) and their average as a dashed line, the latest point
 * marked and labelled.
 */
function RunChart({ days, stat, dow }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = React.useState(null);
  const H = 220, P = { l: 52, r: 18, t: 24, b: 30 };
  const vals = days.map((d) => d.net);
  const lo = Math.min(...vals, stat.lo), hi = Math.max(...vals, stat.hi);
  const step = niceStep((hi - lo) * 1.3 || hi * 0.2);
  const y0 = Math.floor((lo - step * 0.4) / step) * step, y1 = Math.ceil((hi + step * 0.4) / step) * step;
  const iw = Math.max(1, W - P.l - P.r);
  const x = (i) => P.l + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const ticks = [];
  for (let t = y0; t <= y1 + 1e-6; t += step) ticks.push(t);
  const last = days.length - 1;
  const where = vals[last] > stat.hi ? 'above the range of the 7 before' : vals[last] < stat.lo ? 'below the range of the 7 before' : 'inside the range of the 7 before';
  const label = `Net sales, last ${days.length} ${dow}s, latest ${cvMoney(Math.round(vals[last]))}, ${where}`;
  const shown = hover ?? last;
  return (
    <div ref={ref} className={s.run}>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
          <rect x={P.l} width={iw} y={y(stat.hi)} height={Math.max(1, y(stat.lo) - y(stat.hi))} className={s.runBand} />
          <line x1={P.l} x2={P.l + iw} y1={y(stat.hi)} y2={y(stat.hi)} className={s.runEdge} />
          <line x1={P.l} x2={P.l + iw} y1={y(stat.lo)} y2={y(stat.lo)} className={s.runEdge} />
          <line x1={P.l} x2={P.l + iw} y1={y(stat.avg)} y2={y(stat.avg)} className={s.runAvg} />
          {ticks.map((t) => <g key={t}><line x1={P.l} x2={P.l + iw} y1={y(t)} y2={y(t)} className={s.runGrid} /><text x={P.l - 8} y={y(t) + 4} textAnchor="end" className={s.runAxis}>{shortMoney(t)}</text></g>)}
          <line x1={P.l} x2={P.l + iw} y1={H - P.b} y2={H - P.b} className={s.runBase} />
          <polyline points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} className={s.runLine} />
          {days.map((d, i) => (
            <g key={d.iso}>
              <circle cx={x(i)} cy={y(d.net)} r={i === last ? 5.5 : i === hover ? 4.5 : 3.5} className={i === last ? s.runNow : s.runPt} />
              {(W >= 560 || i === last || (i % 2 === 0 && i < last - 1)) && <text x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} className={i === last ? s.runXNow : s.runAxis}>{dayLabel(d.iso)}</text>}
              <rect x={x(i) - iw / (2 * Math.max(1, last))} width={iw / Math.max(1, last)} y={P.t} height={H - P.t - P.b} fill="transparent"
                onMouseEnter={() => setHover(i)} />
            </g>
          ))}
          <text x={Math.min(x(shown), P.l + iw)} y={y(vals[shown]) - 11} textAnchor={shown === last ? 'end' : shown === 0 ? 'start' : 'middle'} className={s.runVal}>{cvMoney(Math.round(vals[shown]))}</text>
        </svg>
      )}
    </div>
  );
}

/**
 * The last day of sales against the same weekday in the weeks before: the
 * two numbers, and the run chart. Titled "Yesterday" only when the data's
 * last day is the day before the header's date; otherwise "Last service",
 * with how far the data runs. Colour only marks a figure outside the range of
 * the 7 before. Sample rooms only (real rooms have no daily detail here).
 */
export function Yesterday({ todayIso }) {
  const cv = useCv();
  const dense = useDense();
  if (!dense) return null;
  const day = dense.days.at(-1);
  const same = dense.days.filter((d) => d.dow === day.dow).slice(-8);
  if (same.length < 3) return null;
  const prior = same.slice(0, -1);
  const stat = (k) => {
    const vals = prior.map((d) => d[k]);
    return { lo: Math.min(...vals), hi: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length };
  };
  const net = stat('net'), cov = stat('covers');
  const tone = (v, st) => (v > st.hi ? s.up : v < st.lo ? s.down : s.flat);
  const isYesterday = day.iso === isoMinus(todayIso, 1);
  const verdict = day.net > net.hi ? `Higher than any of the ${prior.length} ${longDow(day.dow)}s before`
    : day.net < net.lo ? `Lower than any of the ${prior.length} ${longDow(day.dow)}s before`
      : `Normal for a ${longDow(day.dow)}`;
  const vsAvg = (day.net - net.avg) / net.avg;
  return (
    <section className={s.pulse} aria-labelledby="y-head">
      <div className={s.sectionHead}>
        <h3 id="y-head" className={s.sectionTitle}>{isYesterday ? 'Yesterday' : 'Last service'}</h3>
        <span className={s.sectionSub}>{day.dow}, {dayLabel(day.iso)}{isYesterday ? '' : ' · the latest day in your sales data'}</span>
        <span className={s.headEnd}><Claim k="obs" /></span>
      </div>
      <div className={s.pulseBody}>
        <div className={s.kpiCol}>
          <dl className={s.kpis}>
            <div>
              <dt>Net sales</dt>
              <dd><span className={s.kpiFig}>{cvMoney(Math.round(day.net))}</span></dd>
              <dd className={tone(day.net, net)}>{signPct((day.net - net.avg) / net.avg)} vs the usual {longDow(day.dow)}</dd>
            </div>
            <div>
              <dt>Covers</dt>
              <dd><span className={s.kpiFig}>{day.covers}</span></dd>
              <dd className={tone(day.covers, cov)}>{signPct((day.covers - cov.avg) / cov.avg)} vs the usual {longDow(day.dow)}</dd>
            </div>
          </dl>
          <p className={s.verdict}><b>{verdict}.</b> The {prior.length} before ran {shortMoney(net.lo)} to {shortMoney(net.hi)}; this was {Math.abs(vsAvg) < 0.005 ? 'right on' : `${(Math.abs(vsAvg) * 100).toFixed(1)}% ${vsAvg > 0 ? 'above' : 'below'}`} their average.</p>
        </div>
        <figure className={s.chart}>
          <figcaption className={s.chartHead}>Net sales, last {same.length} {longDow(day.dow)}s</figcaption>
          <RunChart days={same} stat={net} dow={longDow(day.dow)} />
          <div className={s.chartKey} aria-hidden="true">
            <span><i className={s.keyBand} />Range of the {prior.length} before: {shortMoney(net.lo)} to {shortMoney(net.hi)}</span>
            <span><i className={s.keyAvg} />Their average: {cvMoney(Math.round(net.avg))}</span>
            <span><i className={s.keyNow} />{isYesterday ? 'Yesterday' : 'Last service'}</span>
          </div>
        </figure>
      </div>
      <button type="button" className={s.textLink} onClick={() => cv.go('daily')}>Every day and hour in Daily detail<Icon name="ArrowRight" size={13} /></button>
    </section>
  );
}
