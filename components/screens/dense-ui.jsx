'use client';

import * as React from 'react';

import { Icon, Tabs } from '../kit';
import { CV_D, Claim, cvMoney, cvScale, useCv } from './core';
import { byMonth, densify, heat, HOURS, DOW } from '../../lib/data/dense';

/* Shared pieces that put the sample's daily and hourly detail on each screen.
 * Every block renders nothing when the room runs on its own data (densify
 * returns null), so no screen ever shows invented days for a real restaurant. */

export const useDense = () => densify(CV_D.room);
export { byMonth, heat, DOW, HOURS };

const money = (v) => cvMoney(Math.round(v));
const pct = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(((a - b) / b) * 100).toFixed(1)}%` : '—');
export { pct };

/** A titled card with a link to the full daily view. */
export function DenseCard({ title, sub, right, children, claim = 'obs' }) {
  const cv = useCv();
  return (
    <section className="cv-card" data-dense="1">
      <div className="cv-card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="cv-col" style={{ gap: 2 }}><span className="cv-h4">{title}</span>{sub && <span className="cv-xs cv-faint">{sub}</span>}</div>
        <div className="cv-row" style={{ gap: 10 }}>{right}<Claim k={claim} /></div>
      </div>
      {children}
      <button className="cv-link cv-small" style={{ alignSelf: 'flex-start' }} onClick={() => cv.go('daily')}>Every day and hour <Icon name="ArrowRight" size={12} /></button>
    </section>
  );
}

/** Weekday × hour grid. `field` is any key heat() returns. */
export function HeatGrid({ grid, field, fmt, highlight }) {
  const vals = grid.flatMap((r) => r.cells.map((c) => c[field]));
  const max = Math.max(...vals) || 1;
  return (
    <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Weekday by hour">
      <table className="cv-table" style={{ fontSize: 'var(--text-xs)' }}>
        <thead><tr><th />{HOURS.map((h) => <th key={h} className="r">{h > 12 ? `${h - 12}p` : `${h}${h === 12 ? 'p' : 'a'}`}</th>)}</tr></thead>
        <tbody>
          {grid.map((r) => (
            <tr key={r.dow} style={highlight === r.dow ? { outline: '2px solid var(--accent)', outlineOffset: -2 } : undefined}>
              <td style={{ fontWeight: 600 }}>{r.dow}</td>
              {r.cells.map((c) => {
                const t = c[field] / max;
                return <td key={c.hour} className="r cv-num" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(t * 70)}%, transparent)`, color: t > 0.6 ? 'var(--accent-fg, #fff)' : undefined }}>{fmt(c[field])}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small bar chart over a run of values (days or months). */
export function Bars({ vals, labels, fmt, height = 120, color = 'var(--cat-1)', compare }) {
  const W = 1000, H = height, P = { l: 52, r: 8, t: 8, b: 20 };
  const hi = Math.max(...vals, ...(compare || []).filter((v) => v != null)) * 1.05 || 1;
  const bw = (W - P.l - P.r) / vals.length;
  const y = cvScale(0, hi, H - P.b, P.t);
  const every = Math.ceil(vals.length / 8);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${vals.length} bars`}>
      {[hi / 2, hi].map((v, i) => <g key={i}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 6} y={y(v) + 3} textAnchor="end">{fmt(v)}</text></g>)}
      {vals.map((v, i) => <rect key={i} x={P.l + i * bw + 1} y={y(v)} width={Math.max(1, bw - 2)} height={H - P.b - y(v)} fill={color} opacity={0.85} />)}
      {compare && <path d={compare.map((v, i) => (v == null ? '' : `${i && compare[i - 1] != null ? 'L' : 'M'}${P.l + i * bw + bw / 2},${y(v)}`)).join(' ')} fill="none" stroke="var(--fg-2)" strokeWidth="1.5" strokeDasharray="3 3" />}
      {labels.map((l, i) => (i % every === 0 || i === labels.length - 1) && <text key={i} x={P.l + i * bw + bw / 2} y={H - 5} textAnchor="middle">{l}</text>)}
    </svg>
  );
}

export function Spark({ vals, w = 140, h = 24, color = 'var(--cat-2)' }) {
  const lo = Math.min(...vals), hi = Math.max(...vals), s = hi - lo || 1;
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${h - 2 - ((v - lo) / s) * (h - 4)}`).join(' ')} fill="none" stroke={color} strokeWidth="1.25" /></svg>;
}

export const monthName = (k) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const sameDayLastYear = (dense, iso) => {
  const t = new Date(Date.parse(`${iso}T12:00:00Z`) - 364 * 864e5).toISOString().slice(0, 10);
  return dense.days.find((d) => d.iso === t) ?? null;
};
export { money };

/** A segmented control for a grid field. */
export function FieldTabs({ value, onChange, fields }) {
  return <Tabs value={value} onChange={onChange} tabs={fields.map(([v, l]) => ({ value: v, label: l }))} />;
}
