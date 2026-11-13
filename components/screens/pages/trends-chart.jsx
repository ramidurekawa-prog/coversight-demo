'use client';

import * as React from 'react';

import s from './trends.module.css';

/* Charts for the Trends page. Drawn at the size they're shown (a ResizeObserver
 * sets the viewBox to the real width), so labels stay legible in a half-width
 * card and on a phone. Hover or arrow keys move a crosshair; click or Enter
 * picks a week. */

function useWidth(fallback = 720) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(fallback);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => { const cw = Math.round(e.contentRect.width); if (cw > 0) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const scale = (d0, d1, r0, r1) => { const k = (r1 - r0) / ((d1 - d0) || 1); return (v) => r0 + (v - d0) * k; };

/** A path through the non-blank values, broken at blanks. */
function pathOf(vals, x, y, start) {
  let d = '', pen = false;
  vals.forEach((v, j) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(j + start).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/**
 * series: [{ key, label, color, vals (full length, may hold nulls), dash?, thin? }]
 * lim: { mean, ucl, lcl } or null · start: first visible index · baseTo: first judged index
 * sampleTo: weeks before this index are the sample's (own-data rooms) · marks: { [i]: 'bad' | 'good' }
 * noted: Set of indexes with a note · selected, onSelect(i) · fmt(v) for the axis and tooltip
 */
export function TrendChart({ labels, series, lim, start = 0, end, baseTo, sampleTo = 0, marks = {}, noted, events = [], selected, onSelect, fmt, height = 260, ariaLabel, tip, yLabel }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = React.useState(null);
  const n = end != null ? end + 1 : labels.length;
  const narrow = W < 520;
  const P = { l: narrow ? 46 : 60, r: 14, t: 16, b: 30 };
  const H = height;
  const vis = series.map((sr) => sr.vals.slice(start, n));
  const all = vis.flat().filter((v) => v != null);
  const extra = lim ? [lim.ucl, lim.lcl] : [];
  let lo = Math.min(...all, ...extra), hi = Math.max(...all, ...extra);
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = scale(start, n - 1, P.l, W - P.r);
  const y = scale(lo, hi, H - P.b, P.t);
  const step = (W - P.l - P.r) / Math.max(1, n - 1 - start);
  const ticks = [0.15, 0.5, 0.85].map((f) => lo + (hi - lo) * f);
  const every = Math.max(1, Math.ceil((n - start) / Math.max(3, Math.floor((W - P.l - P.r) / 74))));
  const at = hover ?? selected;
  const idxAt = (clientX, rect) => Math.max(start, Math.min(n - 1, Math.round(start + (clientX - rect.left - P.l) / step)));
  const onKey = (e) => {
    const cur = at ?? n - 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setHover(null); onSelect?.(Math.max(start, cur - 1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setHover(null); onSelect?.(Math.min(n - 1, cur + 1)); }
    if (e.key === 'Home') { e.preventDefault(); onSelect?.(start); }
    if (e.key === 'End') { e.preventDefault(); onSelect?.(n - 1); }
    if (e.key === 'Escape') { setHover(null); onSelect?.(null); }
  };
  const tipRight = at != null && x(at) > W * 0.55; // keep the tip beside the crosshair, never over it
  return (
    <div ref={ref} className={s.chartWrap}>
      <svg className={`cv-chart ${s.chart}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey}
        onMouseMove={(e) => setHover(idxAt(e.clientX, e.currentTarget.getBoundingClientRect()))} onMouseLeave={() => setHover(null)}
        onClick={(e) => onSelect?.(idxAt(e.clientX, e.currentTarget.getBoundingClientRect()))}>
        {sampleTo > start && <rect x={P.l} y={P.t} width={Math.max(0, x(sampleTo - 0.5) - P.l)} height={H - P.t - P.b} className={s.sampleZone} />}
        {sampleTo > start && <text className="lbl" x={P.l + 6} y={P.t + 12}>sample weeks, not judged</text>}
        {lim && <rect x={x(Math.max(start, sampleTo))} y={y(lim.ucl)} width={Math.max(0, W - P.r - x(Math.max(start, sampleTo)))} height={Math.max(0, y(lim.lcl) - y(lim.ucl))} className={s.band} />}
        {ticks.map((v, i) => <g key={i}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">{fmt(v, true)}</text></g>)}
        {lim && <>
          <line x1={P.l} x2={W - P.r} y1={y(lim.ucl)} y2={y(lim.ucl)} className={s.limit} />
          <line x1={P.l} x2={W - P.r} y1={y(lim.lcl)} y2={y(lim.lcl)} className={s.limit} />
          <line x1={P.l} x2={W - P.r} y1={y(lim.mean)} y2={y(lim.mean)} className={s.mean} />
          {!narrow && <text className="lbl" x={x(Math.max(start, sampleTo)) + 6} y={y(lim.ucl) - 5}>upper limit {fmt(lim.ucl)}</text>}
          {!narrow && <text className="lbl" x={x(Math.max(start, sampleTo)) + 6} y={y(lim.lcl) + 13}>lower limit {fmt(lim.lcl)}</text>}
        </>}
        {baseTo != null && baseTo > start && baseTo < n && <>
          <line x1={x(baseTo - 0.5)} x2={x(baseTo - 0.5)} y1={P.t} y2={H - P.b} className={s.divider} />
          <text className="lbl" x={x(baseTo - 0.5) + 6} y={P.t + 12}>judged weeks</text>
        </>}
        {at != null && <line x1={x(at)} x2={x(at)} y1={P.t} y2={H - P.b} className={s.cross} />}
        {series.map((sr) => (
          <g key={sr.key}>
            <path d={pathOf(sr.vals.slice(start, n), x, y, start)} fill="none" stroke={sr.color} strokeWidth={sr.bold ? 3 : sr.thin ? 1.5 : 2.25} strokeDasharray={sr.dash} strokeLinejoin="round" strokeLinecap="round" />
            {!sr.dash && Object.entries(marks).map(([i, kind]) => {
              const v = sr.vals[+i];
              if (+i < start || +i >= n || v == null) return null;
              return <circle key={i} cx={x(+i)} cy={y(v)} r="4.5" className={kind === 'good' ? s.markGood : s.markBad} />;
            })}
            {!sr.dash && noted && [...noted].map((i) => (i >= start && i < n && sr.vals[i] != null ? <circle key={`n${i}`} cx={x(i)} cy={y(sr.vals[i])} r="7.5" className={s.markNoted} /> : null))}
            {at != null && sr.vals[at] != null && <circle cx={x(at)} cy={y(sr.vals[at])} r="4" fill={sr.color} stroke="var(--surface)" strokeWidth="2" />}
            {at == null && sr.vals[n - 1] != null && (!sr.dash || sr.bold) && <circle cx={x(n - 1)} cy={y(sr.vals[n - 1])} r="4" fill={sr.color} stroke="var(--surface)" strokeWidth="2" />}
          </g>
        ))}
        {events.filter((e) => e.i >= start && e.i < n).map((e) => (
          <g key={`${e.kind}${e.i}`} className={e.kind === 'proof' ? s.evProof : s.evHoliday}>
            <title>{e.label}</title>
            {e.kind === 'proof' ? <path d={`M${x(e.i) - 5},${P.t - 2} L${x(e.i) + 5},${P.t - 2} L${x(e.i)},${P.t + 6} Z`} /> : <rect x={x(e.i) - 2.5} y={H - P.b + 2} width="5" height="5" rx="1" />}
          </g>
        ))}
        {yLabel && !narrow && <text className="lbl" x={4} y={P.t - 4}>{yLabel}</text>}
        {labels.map((l, i) => (i >= start && i < n && ((i - start) % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every * 0.6) ? <text key={i} x={x(i)} y={H - 9} textAnchor="middle">{l}</text> : null))}
      </svg>
      {at != null && (
        <div className={s.tip} style={tipRight ? { right: W - x(at) + 12 } : { left: x(at) + 12 }} aria-hidden="true">
          <b>{tip?.title?.(at) ?? labels[at]}</b>
          {series.map((sr) => sr.vals[at] != null && <span key={sr.key}><i style={{ background: sr.color }} />{sr.label} <em>{fmt(sr.vals[at])}</em></span>)}
          {tip?.extra?.(at)}
        </div>
      )}
    </div>
  );
}

/** A small line for a tile: the weeks shown, the last point dotted, a band for the limits. */
export function Spark({ vals, lim, color = 'var(--cat-1)', mark, height = 36, ariaLabel }) {
  const [ref, W] = useWidth(160);
  const H = height;
  const v = vals.filter((x) => x != null);
  const a11y = ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': 'true' };
  if (v.length < 2) return <span ref={ref} className={s.sparkWrap}><svg className={s.spark} width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...a11y} /></span>;
  // Scaled to the weeks shown, so a quiet series still reads; the band is clipped to the box.
  let lo = Math.min(...v), hi = Math.max(...v);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.02 || 1;
  lo -= pad; hi += pad;
  const x = scale(0, vals.length - 1, 3, W - 5);
  const y = scale(lo, hi, H - 4, 4);
  const last = vals.length - 1;
  return (
    <span ref={ref} className={s.sparkWrap}>
      <svg className={s.spark} width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...a11y}>
        {lim && <rect x="0" width={W} y={Math.max(0, y(lim.ucl))} height={Math.max(0, Math.min(H, y(lim.lcl)) - Math.max(0, y(lim.ucl)))} rx="3" className={s.sparkBand} />}
        {lim && y(lim.mean) > 0 && y(lim.mean) < H && <line x1="0" x2={W} y1={y(lim.mean)} y2={y(lim.mean)} className={s.mean} />}
        <path d={pathOf(vals, x, y, 0)} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        {vals[last] != null && <circle cx={x(last)} cy={y(vals[last])} r="3" className={mark === 'bad' ? s.markBad : mark === 'good' ? s.markGood : undefined} fill={mark ? undefined : color} />}
      </svg>
    </span>
  );
}
