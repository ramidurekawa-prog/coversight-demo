'use client';
// The Service page's charts: tonight's guests through closing, and a service
// hour by hour (covers, staffing or covers per server). Every value comes in
// as a prop from lib/data/page/service.js; nothing here computes a figure the
// rest of the page doesn't show.

import * as React from 'react';

import { cvScale } from '../core';
import { clockLabel, SLOT_MIN } from '../../../lib/data/page/service.js';
import s from './service.module.css';

const short = (min) => clockLabel(min).replace(/:00/, '').replace(' pm', ' PM').replace(' am', ' AM');

/** Draw at the box's real width so text stays the same size on a phone and a desktop. */
export function useWidth(initial = 760) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(initial);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const cum = (a) => { let t = 0; return a.map((x) => (t += x)); };
const fin = (v) => Number.isFinite(v);

/**
 * Guests through closing: served so far (ink), the expected finish (persimmon
 * dashes), a usual night (grey dashes) and the likely finish range (soft band).
 * Hover or arrow-key to read a time; click to pick it.
 * @param {{ L: any, sel: number | null, onSel: (min: number) => void, staffAt?: (min: number) => string | null, usual: string, refWord?: string }} p
 */
export function GuestsChart({ L, sel, onSel, staffAt, usual, refWord = 'usual' }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = React.useState(null);
  const n = L.comp.length;
  const H = W < 560 ? 240 : 290, P = { l: 40, r: 16, t: 20, b: 34 };
  const usualC = cum(L.comp);
  const served = cum(L.actual.slice(0, L.now));
  const so = served.length ? served[served.length - 1] : 0;
  const ahead = L.comp.map((c, i) => (i < L.now ? 0 : c * L.factor));
  const aheadC = cum(ahead);
  const exp = aheadC.map((x, i) => (i < L.now - 1 ? null : so + x));
  const hi = aheadC.map((x, i) => (i < L.now - 1 ? null : so + x * (1 + L.spread)));
  const lo = aheadC.map((x, i) => (i < L.now - 1 ? null : so + x * (1 - L.spread)));
  const top = Math.max(10, ...usualC, ...hi.filter(fin), so) * 1.06;
  const x = cvScale(0, n, P.l, W - P.r); // slot i ends at x(i + 1)
  const y = cvScale(0, top, H - P.b, P.t);
  const pts = (arr) => arr.map((v, i) => (v == null ? null : `${x(i + 1)},${y(v)}`)).filter(Boolean).join(' ');
  const servedPts = [`${x(0)},${y(0)}`, ...served.map((v, i) => `${x(i + 1)},${y(v)}`)].join(' ');
  const band = [];
  for (let i = Math.max(0, L.now - 1); i < n; i++) band.push(`${x(i + 1)},${y(hi[i])}`);
  for (let i = n - 1; i >= Math.max(0, L.now - 1); i--) band.push(`${x(i + 1)},${y(lo[i])}`);
  const i = hover ?? (sel != null ? Math.min(n - 1, Math.max(0, Math.floor((sel - L.start) / SLOT_MIN))) : Math.max(0, L.now - 1));
  const at = L.start + (i + 1) * SLOT_MIN;
  const isDone = i < L.now;
  const tip = [
    `By ${clockLabel(at)}`,
    isDone ? `${served[i]} served · ${refWord} ${Math.round(usualC[i])}` : `About ${Math.round(exp[i] ?? 0)} expected · ${refWord} ${Math.round(usualC[i])}`,
    !isDone && fin(lo[i]) ? `Likely ${Math.round(lo[i])}–${Math.round(hi[i])}` : null,
    staffAt?.(at) ?? null,
  ].filter(Boolean);
  const TW = 200, TH = 14 + tip.length * 17;
  const tx = Math.min(W - P.r - TW, Math.max(P.l, x(i + 1) - TW / 2));
  const ticks = [];
  for (let k = 0; k <= n; k += W < 560 ? 8 : 4) ticks.push(k);
  const yTicks = [0, Math.round(top / 2 / 5) * 5, Math.round((top * 0.95) / 5) * 5];
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { setHover(Math.min(n - 1, i + 1)); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { setHover(Math.max(0, i - 1)); e.preventDefault(); }
    if (e.key === 'Enter' || e.key === ' ') { onSel(L.start + i * SLOT_MIN); e.preventDefault(); }
  };
  const cutX = L.mode === 'cut' && L.at != null ? x((L.at - L.start) / SLOT_MIN) : null;
  return (
    <div ref={ref} className={s.chartBox}>
      <svg className={`cv-chart ${s.chart}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" tabIndex={0} onKeyDown={onKey} onMouseLeave={() => setHover(null)}
        aria-label={`Guests through closing. ${tip.join('. ')}. Arrow keys move, Enter picks a time.`}>
        {cutX != null && <rect x={cutX} y={P.t} width={Math.max(0, x(n) - cutX)} height={H - P.t - P.b} fill="var(--cv-selected-bg)" opacity="0.7" />}
        {yTicks.map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        {band.length > 2 && <polygon points={band.join(' ')} fill="var(--accent)" opacity="0.1" />}
        <polyline points={`${x(0)},${y(0)} ${pts(usualC)}`} fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="5 5" />
        {L.now < n && <polyline points={pts(exp)} fill="none" stroke="var(--primary-active)" strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" />}
        <polyline points={servedPts} fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        {L.now > 0 && L.now < n && <line x1={x(L.now)} x2={x(L.now)} y1={P.t} y2={H - P.b} stroke="var(--fg-3)" strokeDasharray="2 4" />}
        {cutX != null && <>
          <line x1={cutX} x2={cutX} y1={P.t} y2={H - P.b} stroke="var(--primary)" strokeWidth="2" />
          <text x={cutX > W * 0.62 ? cutX - 6 : cutX + 6} y={P.t + 14} textAnchor={cutX > W * 0.62 ? 'end' : 'start'} style={{ fill: 'var(--fg-1)', fontWeight: 700 }}>{short(L.at)} · 1 can go home</text>
        </>}
        <line x1={x(i + 1)} x2={x(i + 1)} y1={P.t} y2={H - P.b} stroke="var(--fg-2)" opacity="0.35" />
        <circle cx={x(i + 1)} cy={y(isDone ? served[i] : exp[i] ?? so)} r="5.5" fill={isDone ? 'var(--accent)' : 'var(--primary-active)'} stroke="var(--surface)" strokeWidth="2" />
        <g transform={`translate(${tx},${Math.max(2, Math.min(H - P.b - TH - 4, y(isDone ? served[i] : exp[i] ?? so) - TH - 14))})`} className={s.tip}>
          <rect width={TW} height={TH} rx="8" />
          {tip.map((t, k) => <text key={k} x="10" y={18 + k * 17} className={k ? '' : 'lbl'}>{t}</text>)}
        </g>
        {ticks.map((k) => <text key={k} x={x(k)} y={H - 10} textAnchor="middle">{short(L.start + k * SLOT_MIN)}</text>)}
        {L.comp.map((_, k) => <rect key={k} x={x(k)} y={P.t} width={x(k + 1) - x(k)} height={H - P.t - P.b} fill="transparent" style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHover(k)} onClick={() => onSel(L.start + k * SLOT_MIN)} />)}
      </svg>
      <div className="cv-legend">
        <span><i className={s.swServed} />Guests served</span>
        {L.now < n && <span><i className={s.swExpected} />Expected finish</span>}
        <span><i className={s.swUsual} />{usual}</span>
        {L.now < n && <span><i className={s.swBand} />Likely finish range</span>}
      </div>
    </div>
  );
}

/**
 * A service hour by hour, three ways:
 *  covers: a usual night (bars) and the busiest recent week (outline), with your count if you typed one;
 *  staff:  servers usually on (bars) against servers needed for the busiest week (tick); short is red, spare amber;
 *  perf:   guests per server each hour against the room's own average.
 * @param {{ rows: any[], mode: 'covers' | 'staff' | 'perf', sel: number | null, onSel: (hour: number) => void, cutFrom?: number | null, rate?: number | null, nowHour?: number | null, live?: Record<number, number> | null }} p
 */
export function HourChart({ rows, mode, sel, onSel, cutFrom = null, rate = null, nowHour = null, live = null, cc = false }) {
  const [ref, W] = useWidth();
  const H = W < 560 ? 230 : 270, P = { l: 40, r: 16, t: 26, b: 34 };
  const val = (r) => (mode === 'covers' ? r.usual : mode === 'staff' ? Math.round(r.servers) : r.perServer ?? 0);
  const tops = rows.map((r) => (mode === 'covers' ? Math.max(r.busiest, live?.[r.hour] ?? 0) : mode === 'staff' ? Math.max(Math.round(r.servers), r.need) : Math.max(r.perServer ?? 0, rate ?? 0)));
  const top = Math.max(mode === 'staff' ? 4 : 5, ...tops) * 1.15;
  const n = rows.length;
  const bw = (W - P.l - P.r) / Math.max(1, n);
  const y = cvScale(0, top, H - P.b, P.t);
  const yTicks = mode === 'staff' ? [0, Math.ceil(top / 2), Math.floor(top)] : [0, Math.round(top / 2), Math.round(top * 0.9)];
  const [hover, setHover] = React.useState(null);
  const pick = hover ?? sel;
  const onKey = (e) => {
    const k = rows.findIndex((r) => r.hour === pick);
    if (e.key === 'ArrowRight') { onSel(rows[Math.min(n - 1, k + 1)]?.hour ?? rows[0].hour); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { onSel(rows[Math.max(0, k - 1)]?.hour ?? rows[0].hour); e.preventDefault(); }
  };
  const label = mode === 'covers' ? 'Covers each hour' : mode === 'staff' ? 'Servers on and needed each hour' : 'Guests per server each hour';
  return (
    <div ref={ref} className={s.chartBox}>
      <svg className={`cv-chart ${s.chart}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" tabIndex={0} onKeyDown={onKey} onMouseLeave={() => setHover(null)} aria-label={`${label}. Arrow keys pick an hour.`}>
        {yTicks.map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        {mode === 'perf' && rate != null && <>
          <line x1={P.l} x2={W - P.r} y1={y(rate)} y2={y(rate)} stroke="var(--fg-1)" strokeDasharray="5 4" />
          <text x={W - P.r} y={y(rate) - 6} textAnchor="end" style={{ fill: 'var(--fg-1)', fontWeight: 600 }}>your average {rate.toFixed(1)}</text>
        </>}
        {rows.map((r, k) => {
          const x0 = P.l + k * bw, w = Math.min(64, bw * 0.56), cx = x0 + bw / 2;
          const v = val(r);
          const cut = cutFrom != null && r.hour >= cutFrom;
          const picked = r.hour === pick;
          const fill = mode === 'staff' ? (r.short ? 'var(--error-600)' : r.spare ? 'var(--warning-500)' : 'var(--accent)') : 'var(--accent)';
          return (
            <g key={r.hour} onMouseEnter={() => setHover(r.hour)} onClick={() => onSel(r.hour)} style={{ cursor: 'pointer' }}>
              <rect x={x0 + 2} y={P.t - 18} width={bw - 4} height={H - P.t - P.b + 18} rx="8" fill={picked ? 'var(--cv-selected-bg)' : cut ? 'var(--surface-sunken)' : 'transparent'} />
              {mode === 'covers' && <rect x={cx - w / 2} y={y(r.busiest)} width={w} height={y(0) - y(r.busiest)} rx="6" fill="none" stroke="var(--fg-3)" strokeDasharray="4 3" />}
              <rect x={cx - w / 2} y={y(v)} width={w} height={Math.max(0, y(0) - y(v))} rx="6" fill={fill} opacity={mode === 'staff' ? 0.9 : 0.85} />
              {mode === 'staff' && <line x1={cx - w / 2 - 6} x2={cx + w / 2 + 6} y1={y(r.need)} y2={y(r.need)} stroke="var(--fg-1)" strokeWidth="3" strokeLinecap="round" />}
              {mode === 'covers' && live?.[r.hour] != null && <circle cx={cx} cy={y(live[r.hour])} r="6" fill="var(--primary-active)" stroke="var(--surface)" strokeWidth="2" />}
              <text x={cx} y={Math.min(y(v), mode === 'staff' ? y(r.need) : y(v)) - 8} textAnchor="middle" className="lbl">{mode === 'perf' ? (r.perServer ?? '—') : mode === 'staff' ? `${v}/${r.need}` : v}</text>
              <text x={cx} y={H - 10} textAnchor="middle" style={r.hour === nowHour ? { fill: 'var(--fg-1)', fontWeight: 700 } : undefined}>{short(r.hour * 60)}</text>
            </g>
          );
        })}
      </svg>
      <div className="cv-legend">
        {mode === 'covers' && <><span><i className={s.swBar} />{cc ? 'Covercast forecast' : 'Usual covers'}</span><span><i className={s.swPeak} />{cc ? 'Top of the likely range' : 'Busiest recent week'}</span>{live && <span><i className={s.swDot} />Tonight</span>}</>}
        {mode === 'staff' && <><span><i className={s.swBar} />Servers usually on</span><span><i className={s.swNeed} />{cc ? 'Needed (Covercast)' : 'Needed (busiest week)'}</span><span><i className={s.swSpare} />Spare</span><span><i className={s.swShort} />Short</span></>}
        {mode === 'perf' && <><span><i className={s.swBar} />Guests per server</span>{rate != null && <span><i className={s.swNeed} />Your average</span>}</>}
      </div>
    </div>
  );
}
