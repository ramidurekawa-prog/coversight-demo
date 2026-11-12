'use client';

import * as React from 'react';
import { Icon, Tabs } from '../../kit';
import { compareRooms, PEER_COHORT_MIN } from '../../../lib/data/compare';
import { useCv, CV_GROUP, Pill, Callout, PageHead, cvScale } from '../core';

/* ================================================================ Comparison */
/* One shape per room, by position, so colour is never the only cue. */
const CV_SHAPE_DRAW = [
  (x, y, c) => <circle cx={x} cy={y} r="6" fill={c} />,
  (x, y, c) => <rect x={x - 5.5} y={y - 5.5} width="11" height="11" fill={c} />,
  (x, y, c) => <path d={`M${x} ${y - 7} L${x + 7} ${y + 5} L${x - 7} ${y + 5} Z`} fill={c} />,
  (x, y, c) => <path d={`M${x} ${y - 7} L${x + 7} ${y} L${x} ${y + 7} L${x - 7} ${y} Z`} fill={c} />,
  (x, y, c) => <circle cx={x} cy={y} r="5" fill="none" stroke={c} strokeWidth="2.5" />,
  (x, y, c) => <rect x={x - 5} y={y - 5} width="10" height="10" fill="none" stroke={c} strokeWidth="2.5" />,
];
const cvShape = (i, x, y) => CV_SHAPE_DRAW[i % CV_SHAPE_DRAW.length](x, y, `var(--cat-${(i % 3) + 1})`);

function CvComparison() {
  const cv = useCv();
  const [weeks, setWeeks] = React.useState(8);
  const c = compareRooms(CV_GROUP.rooms.map((d) => ({ id: d.id, name: d.profile.short, history: d.room.history })), { weeks });
  const nameOf = Object.fromEntries(c.rooms.map((r) => [r.id, r.name]));
  return (
    <div className="cv-page">
      <PageHead over="Comparison" q="Which of my rooms runs best, and by how much?"
        sub="Your own rooms, compared on rates (share of sales, per cover) so size doesn't decide it. A room is called ahead only when the gap is bigger than its normal week-to-week swing." />
      {!c.ok ? <Callout icon="Info">{c.reason} Once a second room has data, its rates line up here.</Callout> : <>
        <div className="cv-row" style={{ justifyContent: 'space-between' }}>
          <div className="cv-legend" style={{ fontSize: "var(--text-sm)" }}>
            {c.rooms.map((r, i) => <span key={r.id}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">{cvShape(i, 8, 8)}</svg>{r.name}{r.weeks < weeks ? ` (${r.weeks} wk)` : ''}</span>)}
          </div>
          <Tabs value={String(weeks)} onChange={(v) => setWeeks(+v)} tabs={[{ value: '4', label: '4 weeks' }, { value: '8', label: '8 weeks' }, { value: '13', label: '13 weeks' }]} />
        </div>
        {c.top ? (
          <Callout icon="Lightbulb">
            The clearest gap over the last {weeks} weeks: <b>{c.top.label.toLowerCase()}</b> at {c.top.best.name} averages {c.top.f(c.top.best.mean)}, against {c.top.f(c.top.worst.mean)} at {c.top.worst.name}. That's {Number.isFinite(c.top.z) ? `${c.top.z.toFixed(1)}×` : 'well past'} their normal weekly swing, so it's a real difference worth asking about, not a lucky week.
            {c.top.screen && <> <button className="cv-link" onClick={() => cv.go(c.top.screen)}>Look into it <Icon name="ArrowRight" size={12} /></button></>}
          </Callout>
        ) : <Callout tone="good" icon="Scale">No gap between rooms is bigger than their normal week-to-week swing over the last {weeks} weeks. On these rates, the rooms are level.</Callout>}
        {c.unlike && <Callout icon="Ruler">The busiest room serves {c.sizeRatio.toFixed(1)}× the covers of the quietest. Totals are shown for context only; the scores use rates, which don't reward size.</Callout>}
        <section className="cv-card flush">
          {c.rows.map((m, idx) => {
            const all = m.per.flatMap((p) => (p.lo != null ? [p.lo, p.hi] : []));
            const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.15 || 1;
            const x = cvScale(lo - pad, hi + pad, 20, 380);
            return (
              <div key={m.k} style={{ display: "grid", gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr) minmax(0, 280px)", gap: 16, alignItems: "center", padding: "14px 18px", borderTop: idx ? "1px solid var(--border)" : 0 }} className="cv-cmp-row">
                <div className="cv-col" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{m.label}</span>
                  <span className="cv-xs cv-faint">{m.verdict === 'context' ? 'Context, not a score' : m.verdict === 'missing' ? 'Not every room has this' : m.verdict === 'clear' ? `${nameOf[m.leader]} ahead, beyond weekly swing` : `Level: within weekly swing (${m.better === 'low' ? 'lower' : 'higher'} is better)`}</span>
                </div>
                <svg className="cv-chart" viewBox="0 0 400 30" style={{ height: 30 }} role="img" aria-label={m.per.map((p) => `${p.name} ${p.mean != null ? m.f(p.mean) : 'no data'}`).join(', ')}>
                  <line x1="20" x2="380" y1="15" y2="15" className="axis" />
                  {m.per.map((p, i) => p.mean != null && <g key={p.id}>
                    <line x1={x(p.lo)} x2={x(p.hi)} y1={15} y2={15} stroke={`var(--cat-${(i % 3) + 1})`} strokeWidth="4" strokeOpacity="0.3" strokeLinecap="round" />
                    {cvShape(i, x(p.mean), 15)}
                  </g>)}
                </svg>
                <div className="cv-row nowrap" style={{ justifyContent: "flex-end", gap: 14 }}>
                  {m.per.map((p) => (
                    <span key={p.id} className="cv-num cv-small" style={{ minWidth: 64, textAlign: "right", fontWeight: p.id === m.leader ? 700 : 400 }}>
                      {p.id === m.leader && <Icon name="Crown" size={12} style={{ marginRight: 4, color: "var(--accent)", verticalAlign: -1 }} />}{p.mean != null ? m.f(p.mean) : '—'}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
        <span className="cv-xs cv-faint">Each dot is the room's average over the weeks shown; the faint bar is its range. "Ahead" means the gap to the next room beats the larger of the two rooms' week-to-week standard deviation.</span>
      </>}
      <section className="cv-card">
        <div className="cv-card-head"><span className="cv-h4">Against restaurants like yours</span><Pill icon="Lock">Not available</Pill></div>
        <p className="cv-small cv-muted" style={{ lineHeight: 1.55 }}>A peer benchmark needs at least {PEER_COHORT_MIN} comparable rooms (format, size, region), so that no single restaurant can be picked out of it. Coversight doesn't have that cohort, so it shows no outside benchmark at all rather than an invented one.</p>
      </section>
    </div>
  );
}

export { CvComparison };
