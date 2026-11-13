'use client';

import * as React from 'react';

import s from './week.module.css';

/* Interactive charts for This week. Plain SVG + a hover/focus tooltip:
   every mark can be hovered, tapped or reached with Tab, and each chart
   carries a screen-reader table of its values. Colours are design-system
   tokens: --cat-1 for the series, --money-up / --money-down for polarity. */

function useTip() {
  const [tip, setTip] = React.useState(null);
  const show = (i, x, y) => setTip({ i, x, y });
  const hide = () => setTip(null);
  return { tip, show, hide };
}

/** The chart's drawn width in CSS pixels, so text in the SVG stays at its real size on a phone. */
function useWidth(fallback = 1000) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(fallback);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => el.clientWidth && setW(el.clientWidth);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Tip({ tip, children }) {
  if (!tip) return null;
  return <div className={s.tip} style={{ left: `${tip.x}%`, top: tip.y }} role="status">{children}</div>;
}

function SrTable({ caption, rows }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>{rows.map(([k, v], i) => <tr key={i}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody>
    </table>
  );
}

/**
 * Weeks as bars, the current one highlighted; a dashed line marks the baseline.
 * @param {{ points: { label: string, value: number, current?: boolean }[], baseline?: number | null, baselineLabel?: string, fmt: (v: number) => string, height?: number, caption: string }} p
 */
export function WeekBars({ points, baseline = null, baselineLabel = 'baseline', fmt, height = 180, caption }) {
  const { tip, show, hide } = useTip();
  const [ref, W] = useWidth();
  const H = height, P = { l: 4, r: 4, t: 22, b: 26 };
  const vals = points.map((p) => p.value);
  const hi = Math.max(...vals, baseline ?? 0) * 1.08 || 1;
  const lo = Math.min(0, ...vals);
  const bw = (W - P.l - P.r) / points.length;
  const every = Math.max(1, Math.ceil(64 / bw));
  const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  return (
    <div className={s.chartWrap} ref={ref} onMouseLeave={hide}>
      <svg className="cv-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={caption}>
        <line className="axis" x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} />
        {points.map((p, i) => {
          const x = P.l + i * bw;
          const top = y(Math.max(0, p.value)), bot = y(Math.min(0, p.value));
          const on = tip?.i === i;
          return (
            <g key={i} tabIndex={0} role="img" aria-label={`${p.label}: ${fmt(p.value)}`} className={s.mark}
              onMouseEnter={() => show(i, ((x + bw / 2) / W) * 100, top)} onFocus={() => show(i, ((x + bw / 2) / W) * 100, top)} onBlur={hide}
              onClick={() => show(i, ((x + bw / 2) / W) * 100, top)}>
              <rect x={x} y={P.t} width={bw} height={H - P.t - P.b} fill="transparent" />
              <rect x={x + bw * 0.18} y={top} width={bw * 0.64} height={Math.max(2, bot - top)} rx={4}
                fill={p.current ? 'var(--accent)' : 'var(--cat-1)'} opacity={p.current || on ? 1 : 0.32} />
              {(p.current || ((points.length - 1 - i) % every === 0 && points.length - 1 - i >= every)) && <text x={i === points.length - 1 ? x + bw : x + bw / 2} y={H - 8} textAnchor={i === points.length - 1 ? 'end' : 'middle'} style={p.current ? { fill: 'var(--fg-1)', fontWeight: 700 } : undefined}>{p.current ? 'This week' : p.label}</text>}
              {p.current && <text x={x + bw / 2} y={top - 6} textAnchor="middle" className="lbl" style={{ fontWeight: 700, fill: 'var(--fg-1)' }}>{fmt(p.value)}</text>}
            </g>
          );
        })}
        {baseline != null && <>
          <line x1={P.l} x2={W - P.r} y1={y(baseline)} y2={y(baseline)} stroke="var(--fg-2)" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x={P.l + 2} y={P.t - 8} className="lbl" style={{ fill: 'var(--fg-2)' }}><tspan style={{ fill: 'var(--fg-1)' }}>- - </tspan>{baselineLabel} {fmt(baseline)}</text>
        </>}
      </svg>
      <Tip tip={tip}>{tip && <><b>{points[tip.i].current ? 'This week' : `Week of ${points[tip.i].label}`}</b><span>{fmt(points[tip.i].value)}</span>{baseline != null && <span className={s.tipSub}>{points[tip.i].value >= baseline ? '+' : '−'}{fmt(Math.abs(points[tip.i].value - baseline))} vs {baselineLabel}</span>}</>}</Tip>
      <SrTable caption={caption} rows={points.map((p) => [p.current ? 'This week' : p.label, fmt(p.value)])} />
    </div>
  );
}

/**
 * Where the money moved: baseline → each part → this week.
 * @param {{ start: { label: string, value: number }, parts: { key: string, label: string, value: number }[], end: { label: string, value: number }, fmt: (v: number, sign?: boolean) => string, caption: string, onPick?: (key: string) => void }} p
 */
export function Waterfall({ start, parts, end, fmt, caption, height = 220 }) {
  const { tip, show, hide } = useTip();
  const steps = [];
  let run = start.value;
  steps.push({ key: 'start', label: start.label, short: start.short, from: 0, to: start.value, kind: 'total', value: start.value });
  for (const p of parts) { steps.push({ key: p.key, label: p.label, short: p.short, from: run, to: run + p.value, kind: p.value >= 0 ? 'up' : 'down', value: p.value }); run += p.value; }
  steps.push({ key: 'end', label: end.label, short: end.short, from: 0, to: end.value, kind: 'total', value: end.value });
  const [ref, W] = useWidth();
  const H = height, P = { l: 4, r: 4, t: 26, b: 30 };
  const all = steps.flatMap((x) => [x.from, x.to]);
  // Zoom to where the movement is, so a 2% change is visible; the totals are drawn from a broken axis.
  const minV = Math.min(...all.filter((v) => v !== 0)), maxV = Math.max(...all);
  const pad = (maxV - minV) * 0.6 || maxV * 0.05 || 1;
  const lo = Math.max(0, minV - pad), hi = maxV + pad * 0.4;
  const y = (v) => P.t + (1 - (Math.max(lo, v) - lo) / (hi - lo)) * (H - P.t - P.b);
  const bw = (W - P.l - P.r) / steps.length;
  const narrow = bw < 110;
  const fill = { total: 'var(--cat-1)', up: 'var(--money-up)', down: 'var(--money-down)' };
  return (
    <div className={s.chartWrap} ref={ref} onMouseLeave={hide}>
      <svg className="cv-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={caption}>
        {steps.map((st, i) => {
          const x = P.l + i * bw;
          const top = y(Math.max(st.from, st.to)), bot = st.kind === 'total' ? H - P.b : y(Math.min(st.from, st.to));
          const on = tip?.i === i;
          const at = () => show(i, ((x + bw / 2) / W) * 100, top);
          return (
            <g key={st.key} tabIndex={0} role="img" aria-label={`${st.label}: ${st.kind === 'total' ? fmt(st.value) : fmt(st.value, true)}`} className={s.mark} onMouseEnter={at} onFocus={at} onBlur={hide} onClick={at}>
              <rect x={x} y={P.t} width={bw} height={H - P.t - P.b} fill="transparent" />
              <rect x={x + bw * 0.16} y={top} width={bw * 0.68} height={Math.max(3, bot - top)} rx={4} fill={fill[st.kind]} opacity={st.kind === 'total' ? (on ? 0.9 : 0.55) : on ? 1 : 0.85} />
              {st.kind === 'total' && <path d={`M${x + bw * 0.16},${H - P.b - 10} l${bw * 0.68},0`} stroke="var(--surface)" strokeWidth="3" strokeDasharray="6 5" />}
              {i < steps.length - 1 && <line x1={x + bw * 0.84} x2={x + bw * 1.16} y1={y(st.kind === 'total' ? st.value : st.to)} y2={y(st.kind === 'total' ? st.value : st.to)} stroke="var(--fg-3)" strokeDasharray="2 3" />}
              <text x={x + bw / 2} y={top - 8} textAnchor="middle" className="lbl" style={{ fontWeight: 700, fill: st.kind === 'total' ? 'var(--fg-1)' : fill[st.kind] }}>{st.kind === 'total' ? fmt(st.value) : fmt(st.value, true)}</text>
              <text x={x + bw / 2} y={H - 10} textAnchor="middle" style={{ fill: 'var(--fg-2)' }}>{narrow && st.short ? st.short : st.label}</text>
            </g>
          );
        })}
      </svg>
      <Tip tip={tip}>{tip && (() => {
        const st = steps[tip.i];
        return st.kind === 'total' ? <><b>{st.label}</b><span>{fmt(st.value)} contribution</span></>
          : <><b>{st.label}</b><span>{fmt(st.value, true)} to contribution</span><span className={s.tipSub}>{st.value >= 0 ? 'Helped' : 'Cost'} this week</span></>;
      })()}</Tip>
      <SrTable caption={caption} rows={steps.map((st) => [st.label, st.kind === 'total' ? fmt(st.value) : fmt(st.value, true)])} />
    </div>
  );
}

/** A 28-day test window: the bar fills to the current day; checkpoints every 7 days. */
export function TestTrack({ day, waiting, label }) {
  const pct = Math.max(2, Math.min(100, (day / 28) * 100));
  return (
    <div className={s.track28} role="img" aria-label={`${label}: day ${day} of 28`}>
      <span className={s.track28Fill} style={{ width: `${pct}%`, background: waiting ? 'var(--warning-600)' : 'var(--accent)' }} />
      {[7, 14, 21, 28].map((d) => <span key={d} className={`${s.track28Mark} ${day >= d ? s.track28Done : ''}`} style={{ left: `${(d / 28) * 100}%` }} title={`Checkpoint, day ${d}`} />)}
      <span className={s.track28Lbls} aria-hidden="true">{[0, 7, 14, 21, 28].map((d) => <span key={d}>{d === 28 ? 'Day 28' : d}</span>)}</span>
    </div>
  );
}

/** A small horizontal meter: part of a whole, e.g. what's verified of the change. */
export function Meter({ parts, label }) {
  const total = parts.reduce((t, p) => t + Math.max(0, p.value), 0) || 1;
  return (
    <div className="cv-decomp" role="img" aria-label={label} style={{ height: 10 }}>
      {parts.map((p) => <span key={p.label} title={p.label} style={{ width: `${(Math.max(0, p.value) / total) * 100}%`, background: p.color }} />)}
    </div>
  );
}
