'use client';

/* Small interactive charts for the weekly meeting. Plain SVG on the design
 * tokens: hover, tap or tab to a mark to read it; every chart also has a
 * text label so a screen reader gets the same numbers. */

import * as React from 'react';
import { Claim } from '../core';
import { usd } from '../../../lib/data/page/meeting';
import s from './meeting.module.css';

const signedUsd = (v) => `${v >= 0 ? '+' : '−'}${usd(Math.abs(v))}`;

/** Readout line above a chart: shows the active mark, or the default text. */
function Readout({ children }) {
  return <div className={s.readout} aria-live="polite">{children}</div>;
}

/** The rendered width of a box, so chart text stays at its real size at any width. */
function useWidth(fallback) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(fallback);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => { const x = Math.round(e.contentRect.width); if (x > 0) setW(x); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Weekly contribution after food and labour, last `n` weeks, with the 4-week average. */
export function WeekBars({ rows, n = 12, h = 150 }) {
  const data = rows.slice(-n);
  const [on, setOn] = React.useState(data.length - 1);
  const [box, W] = useWidth(560);
  if (!data.length) return null;
  const P = { l: 4, r: 4, t: 16, b: 18 };
  const max = Math.max(...data.map((r) => r.earned)) * 1.08 || 1;
  const bw = (W - P.l - P.r) / data.length;
  const y = (v) => h - P.b - (v / max) * (h - P.t - P.b);
  const prior = rows.slice(-5, -1);
  const avg = prior.length ? prior.reduce((t, r) => t + r.earned, 0) / prior.length : null;
  const r = data[on] || data[data.length - 1];
  const prev = data[on - 1];
  return (
    <div className={s.chartBox} ref={box}>
      <Readout>
        <b>Week of {r.label}</b>
        <span className={s.readNum}>{usd(r.earned)}</span>
        {prev && <span className={r.earned >= prev.earned ? s.up : s.down}>{signedUsd(r.earned - prev.earned)} vs week before</span>}
      </Readout>
      <svg className="cv-chart" viewBox={`0 0 ${W} ${h}`} role="group" aria-label={`Contribution after food and labour, last ${data.length} weeks`}>
        {avg != null && (
          <g>
            <line x1={P.l} x2={W - P.r} y1={y(avg)} y2={y(avg)} stroke="var(--fg-3)" strokeDasharray="3 4" />
            <text x={W - P.r} y={y(avg) - 4} textAnchor="end">4-wk avg {usd(avg)}</text>
          </g>
        )}
        {data.map((d, i) => {
          const last = i === data.length - 1;
          return (
            <g key={d.iso || d.label} tabIndex={0} role="img" className={s.mark}
              aria-label={`Week of ${d.label}: ${usd(d.earned)}`}
              onMouseEnter={() => setOn(i)} onFocus={() => setOn(i)} onClick={() => setOn(i)}>
              <rect x={P.l + i * bw} y={P.t} width={bw} height={h - P.t - P.b} fill="transparent" />
              <rect x={P.l + i * bw + bw * 0.18} y={y(d.earned)} width={bw * 0.64} height={h - P.b - y(d.earned)} rx="3"
                fill={i === on ? 'var(--accent)' : last ? 'var(--accent-subtle)' : 'var(--border-strong)'} />
              {(i === 0 || last || i === on) && <text className="lbl" x={P.l + i * bw + bw / 2} y={h - 4} textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** What moved last week against the 4-week average: sales, food, labour, as signed bars. */
export function Drivers({ rows }) {
  const last = rows[rows.length - 1];
  const prior = rows.slice(-5, -1);
  if (!last || !prior.length) return null;
  const avg = (k) => prior.reduce((t, r) => t + r[k], 0) / prior.length;
  const parts = [
    ['Sales', last.net - avg('net')],
    ['Food cost', -(last.food - avg('food'))],
    ['Labour', -(last.labour - avg('labour'))],
  ];
  const max = Math.max(...parts.map(([, v]) => Math.abs(v))) || 1;
  return (
    <ul className={s.drivers} aria-label="What moved contribution against the 4-week average">
      {parts.map(([k, v]) => (
        <li key={k}>
          <span className={s.drvName}>{k}</span>
          <span className={s.drvTrack} aria-hidden="true">
            <span className={`${s.drvBar} ${v >= 0 ? s.drvUp : s.drvDown}`} style={{ width: `${(Math.abs(v) / max) * 50}%`, [v >= 0 ? 'left' : 'right']: '50%' }} />
          </span>
          <span className={`${s.drvVal} ${v >= 0 ? s.up : s.down}`}>{signedUsd(Math.round(v))}</span>
        </li>
      ))}
    </ul>
  );
}

/** Decisions on the table as value bars, each with its range and claim. */
export function ValueBars({ rows, active, onPick }) {
  const max = Math.max(...rows.map((r) => r.hi || r.value)) || 1;
  const Row = onPick ? 'button' : 'div';
  return (
    <ul className={s.valueBars}>
      {rows.map((r) => (
        <li key={r.id}>
          <Row {...(onPick ? { type: 'button', onClick: () => onPick(active === r.id ? null : r.id), 'aria-expanded': active === r.id } : {})} className={`${s.vbBtn} ${active === r.id ? s.vbOn : ''} ${onPick ? '' : s.vbStatic}`}>
            <span className={s.vbHead}>
              <span className={s.vbTitle}>{r.title}</span>
              {onPick && <span className={s.vbVal}>{usd(r.value)}<small>/wk</small></span>}
            </span>
            <span className={s.vbTrack} aria-hidden="true">
              {r.lo != null && r.hi != null && <span className={s.vbRange} style={{ left: `${(r.lo / max) * 100}%`, width: `${((r.hi - r.lo) / max) * 100}%` }} />}
              <span className={s.vbBar} style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            {onPick && <span className={s.vbMeta}>
              <Claim k={r.claim} />
              {r.p != null && <span>{Math.round(r.p * 100)}% chance it verifies</span>}
              {r.lo != null && r.hi != null && <span>range {usd(r.lo)}–{usd(r.hi)}</span>}
            </span>}
          </Row>
        </li>
      ))}
    </ul>
  );
}

/** The meeting's time, split by segment. Tap a segment to filter the agenda list. */
export function TimeBar({ items, segments, active, onPick }) {
  const by = Object.keys(segments).map((k) => ({ k, mins: items.filter((x) => x.seg === k).reduce((t, x) => t + x.mins, 0), n: items.filter((x) => x.seg === k).length })).filter((x) => x.n);
  const total = by.reduce((t, x) => t + x.mins, 0) || 1;
  return (
    <div className={s.timeBar} role="group" aria-label="Agenda time by part">
      {by.map((x) => (
        <button key={x.k} type="button" className={`${s.tbSeg} ${s[`tb${x.k}`]} ${active && active !== x.k ? s.tbDim : ''}`} style={{ flex: x.mins / total }}
          aria-pressed={active === x.k} onClick={() => onPick(active === x.k ? null : x.k)}
          aria-label={`${segments[x.k].label}: ${x.n} item${x.n === 1 ? '' : 's'}, ${Math.round(x.mins)} min`}>
          <b>{x.k}</b><span>{Math.round(x.mins)}m</span>
        </button>
      ))}
    </div>
  );
}

/** A donut for follow-through: how many done, open, overdue, deferred. */
export function Ring({ parts, size = 112, label }) {
  const total = parts.reduce((t, p) => t + p.n, 0);
  const r = 42, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${label}: ${parts.map((p) => `${p.n} ${p.label}`).join(', ')}`} className={s.ring}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth="12" />
      {total > 0 && parts.filter((p) => p.n).map((p) => {
        const len = (p.n / total) * c;
        const el = <circle key={p.label} cx="50" cy="50" r={r} fill="none" stroke={p.color} strokeWidth="12" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 50 50)" />;
        off += len;
        return el;
      })}
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className={s.ringNum}>{total}</text>
    </svg>
  );
}

/** The last eight weeks of meetings: a bar per meeting (its length), a gap for a missed week. */
export function MeetingWeeks({ history, now = new Date(), active, onPick }) {
  const monday = (d) => { const x = new Date(d); const day = (x.getUTCDay() + 6) % 7; x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - day); return x.getTime(); };
  const thisWeek = monday(now);
  const weeks = Array.from({ length: 8 }, (_, k) => thisWeek - (7 - k) * 7 * 864e5);
  const byWeek = new Map();
  for (const m of history || []) { const w = monday(m.at); if (!byWeek.has(w)) byWeek.set(w, m); }
  const max = Math.max(15, ...[...byWeek.values()].map((m) => m.mins || 0));
  return (
    <div className={s.weeks} role="group" aria-label="Meetings in the last 8 weeks">
      {weeks.map((w) => {
        const m = byWeek.get(w);
        const lbl = new Date(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        return m ? (
          <button key={w} type="button" className={`${s.wk} ${active === m.id ? s.wkOn : ''}`} onClick={() => onPick(active === m.id ? null : m.id)} aria-pressed={active === m.id}
            aria-label={`Week of ${lbl}: met, ${m.mins ?? '?'} min`}>
            <span className={s.wkBar} style={{ height: `${Math.max(12, ((m.mins || 1) / max) * 100)}%` }} />
            <span className={s.wkLbl}>{lbl}</span>
          </button>
        ) : (
          <span key={w} className={s.wk} aria-label={`Week of ${lbl}: no meeting`} role="img">
            <span className={`${s.wkBar} ${s.wkMiss}`} />
            <span className={s.wkLbl}>{lbl}</span>
          </span>
        );
      })}
    </div>
  );
}

/** A big headline number with its label and claim. */
export function BigNum({ label, value, claim, sub, tone }) {
  return (
    <div className={s.big}>
      <span className={s.bigLabel}>{label}</span>
      <span className={`${s.bigVal} ${tone ? s[tone] : ''}`}>{value}</span>
      {(claim || sub) && <span className={s.bigSub}>{claim && <Claim k={claim} />}{sub}</span>}
    </div>
  );
}
