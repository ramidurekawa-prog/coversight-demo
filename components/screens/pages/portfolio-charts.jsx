'use client';

/* All rooms: the page's own charts. Plain SVG, sized by viewBox, with a hover
   and keyboard layer and an off-screen table of the same numbers. Rooms keep
   their colour by position in the group (the entity), never by rank. */
import * as React from 'react';

import { cvMoney } from '../core';
import s from './portfolio.module.css';

export const roomColor = (i) => `var(--pf-s${(i % 6) + 1})`;
const pct = (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const short$ = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : cvMoney(Math.round(v)));

/** A small trend line for a tile. Gaps (weeks without data) break the line. */
export function Spark({ values, color = 'var(--accent)', label }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return <span className={s.sparkEmpty}>Not enough weeks yet</span>;
  const w = 120, h = 32, vs = pts.map(([, v]) => v);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (i) => (i / (values.length - 1)) * (w - 4) + 2, y = (v) => h - 3 - ((v - lo) / span) * (h - 6);
  let d = '', prev = -2;
  for (const [i, v] of pts) { d += `${i === prev + 1 ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; prev = i; }
  const [li, lv] = pts.at(-1);
  return (
    <span className={s.sparkBox}>
      <svg className={s.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={s.sparkDot} style={{ left: `${(x(li) / w) * 100}%`, top: `${(y(lv) / h) * 100}%`, background: color }} />
    </span>
  );
}

/** Contribution per restaurant, one bar each, biggest scale shared. Hover, focus or tap a bar for its numbers; click opens the room. */
export function RoomBars({ rooms, order, onOpen }) {
  const [hot, setHot] = React.useState(null);
  const rows = rooms.filter((r) => r.money.contribution.value != null);
  const missing = rooms.filter((r) => r.money.contribution.value == null);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.money.contribution.value)));
  return (
    <div className={s.bars}>
      {rows.map((r) => {
        const m = r.money, c = m.change;
        const on = hot === r.id;
        return (
          <button key={r.id} type="button" className={`${s.barRow} ${on ? s.hot : ''}`} onMouseEnter={() => setHot(r.id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(r.id)} onBlur={() => setHot(null)} onClick={() => onOpen(r.id)}
            aria-label={`${r.name}: ${cvMoney(Math.round(m.contribution.value))} contribution, ${pct(m.revenue.value ? m.contribution.value / m.revenue.value : null)} margin. Open its week.`}>
            <span className={s.barName}><i style={{ background: roomColor(order.indexOf(r.id)) }} />{r.short}</span>
            <span className={s.barTrack}><span className={s.barFill} style={{ width: `${(Math.max(0, m.contribution.value) / max) * 100}%` }} /></span>
            <span className={`${s.barVal} cv-num`}>{short$(m.contribution.value)}</span>
            {on && (
              <span className={s.tip} role="presentation">
                <b>{r.name}</b>
                <span>Revenue <em>{cvMoney(Math.round(m.revenue.value))}</em></span>
                <span>Contribution <em>{cvMoney(Math.round(m.contribution.value))}</em></span>
                <span>Margin <em>{pct(m.revenue.value ? m.contribution.value / m.revenue.value : null)}</em></span>
                {c && !c.unavailable && <span>vs its normal <em className={c.marginPts >= 0 ? 'cv-up' : 'cv-down'}>{c.marginPts >= 0 ? '+' : '−'}{Math.abs(c.marginPts).toFixed(1)} pts</em></span>}
                <span>Food <em>{pct(m.foodPct)}</em> · Labour <em>{pct(m.labourPct)}</em></span>
              </span>
            )}
          </button>
        );
      })}
      {missing.map((r) => (
        <div key={r.id} className={`${s.barRow} ${s.barMissing}`}>
          <span className={s.barName}><i style={{ background: roomColor(order.indexOf(r.id)) }} />{r.short}</span>
          <span className={s.barTrack} />
          <span className={`${s.barVal} cv-faint`}>{r.state === 'sample' ? 'Sample' : r.state === 'offline' ? 'Offline' : r.money.labour.status === 'unavailable' && r.money.complete ? 'No payroll' : 'No data'}</span>
        </div>
      ))}
    </div>
  );
}

/** Contribution margin by week, one line per room and a dashed group line. Crosshair and tooltip on hover, arrows on keyboard; the legend turns rooms on and off. */
export function MarginLines({ rooms, order, group }) {
  const [hidden, setHidden] = React.useState(() => new Set());
  const [at, setAt] = React.useState(null);
  const svgRef = React.useRef(null);
  const boxRef = React.useRef(null);
  const [W, setW] = React.useState(560);
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lines = rooms.map((r) => ({ id: r.id, name: r.short, color: roomColor(order.indexOf(r.id)), pts: r.money.series.map((p) => (p?.margin ?? null)) }))
    .filter((l) => l.pts.some((v) => v != null));
  const shown = lines.filter((l) => !hidden.has(l.id));
  const g = group.map((p) => p?.margin ?? null);
  const labels = (rooms.find((r) => r.money.series.some(Boolean))?.money.series || []).map((p) => p?.label || '');
  const n = Math.max(labels.length, g.length);
  if (!lines.length || n < 2) return <div className={s.chartEmpty}>Margin trends appear once a room has two weeks of its own sales and payroll.</div>;
  const all = [...shown.flatMap((l) => l.pts), ...g].filter((v) => v != null);
  const lo = Math.floor((Math.min(...all) - 0.01) * 100) / 100, hi = Math.ceil((Math.max(...all) + 0.01) * 100) / 100;
  const H = W < 420 ? 180 : 210, L = 40, R = W < 420 ? 58 : 84, T = 10, B = 24;
  const x = (i) => L + (i / (n - 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const path = (pts) => { let d = '', prev = -2; pts.forEach((v, i) => { if (v == null) return; d += `${i === prev + 1 ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; prev = i; }); return d; };
  const ticks = [lo, (lo + hi) / 2, hi];
  const move = (e) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const vx = ((e.clientX - box.left) / box.width) * W;
    setAt(Math.max(0, Math.min(n - 1, Math.round(((vx - L) / (W - L - R)) * (n - 1)))));
  };
  const key = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setAt((a) => Math.max(0, (a ?? n - 1) - 1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setAt((a) => Math.min(n - 1, (a ?? n - 2) + 1)); }
    if (e.key === 'Escape') setAt(null);
  };
  /* Direct labels at the right end, nudged apart so they never collide. */
  const ends = shown.map((l) => ({ l, v: [...l.pts].reverse().find((v) => v != null) })).filter((e) => e.v != null).map((e) => ({ ...e, yy: y(e.v) })).sort((a, b) => a.yy - b.yy);
  ends.forEach((e, i) => { if (i && e.yy - ends[i - 1].yy < 13) e.yy = ends[i - 1].yy + 13; });
  return (
    <div className={s.lineWrap}>
      <div className={s.legend} role="group" aria-label="Show or hide restaurants">
        {lines.map((l) => (
          <button key={l.id} type="button" aria-pressed={!hidden.has(l.id)} className={hidden.has(l.id) ? s.off : ''} onClick={() => setHidden((h) => { const nx = new Set(h); if (nx.has(l.id)) nx.delete(l.id); else nx.add(l.id); return nx; })}>
            <i style={{ background: l.color }} />{l.name}
          </button>
        ))}
        {g.some((v) => v != null) && <span className={s.legendGroup}><i />Group</span>}
      </div>
      <div className={s.lineBox} ref={boxRef}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={s.lineSvg} tabIndex={0} role="img" aria-label="Contribution margin by week for each restaurant. Use the arrow keys to read each week."
          onMouseMove={move} onMouseLeave={() => setAt(null)} onKeyDown={key} onBlur={() => setAt(null)} onTouchStart={(e) => move(e.touches[0])}>
          {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={s.grid} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className={s.axis}>{pct(t, 0)}</text></g>)}
          {[0, Math.floor((n - 1) / 2), n - 1].map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className={s.axis}>{labels[i]}</text>)}
          {g.some((v) => v != null) && <path d={path(g)} fill="none" stroke="var(--fg-3)" strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
          {shown.map((l) => <path key={l.id} d={path(l.pts)} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
          {ends.map((e) => <text key={e.l.id} x={W - R + 6} y={e.yy + 4} className={s.endLabel}>{e.l.name}</text>)}
          {at != null && <line x1={x(at)} x2={x(at)} y1={T} y2={H - B} className={s.cross} />}
          {at != null && shown.map((l) => (l.pts[at] != null ? <circle key={l.id} cx={x(at)} cy={y(l.pts[at])} r="4" fill={l.color} stroke="var(--surface)" strokeWidth="2" /> : null))}
        </svg>
        {at != null && (
          <div className={s.lineTip} style={{ left: `${(x(at) / W) * 100}%` }} aria-live="polite">
            <b>Week of {labels[at]}</b>
            {shown.map((l) => <span key={l.id}><i style={{ background: l.color }} />{l.name}<em>{pct(l.pts[at])}</em></span>)}
            {g[at] != null && <span><i className={s.dash} />Group<em>{pct(g[at])}</em></span>}
          </div>
        )}
      </div>
      <table className={s.sr}>
        <caption>Contribution margin by week</caption>
        <thead><tr><th scope="col">Week</th>{lines.map((l) => <th key={l.id} scope="col">{l.name}</th>)}<th scope="col">Group</th></tr></thead>
        <tbody>{labels.map((lb, i) => <tr key={i}><th scope="row">{lb}</th>{lines.map((l) => <td key={l.id}>{pct(l.pts[i])}</td>)}<td>{pct(g[i])}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
