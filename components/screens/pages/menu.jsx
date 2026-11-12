'use client';

import * as React from 'react';
import { Button } from '../../kit';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_MENU, CV_CM_WEIGHTED, cvPriceMove, cvPriceMoveInterval, Claim, Pill, Callout, Interval, PageHead, cvScale } from '../core';
import { DenseMenu } from '../dense-sections';

/* Coversight — the four levers: Menu, Labour, Throughput, Purchasing. */

/* ================================================================ Menu */
function MenuScatter({ sel, onSel }) {
  const W = 620, H = 300, P = { l: 44, r: 16, t: 14, b: 34 };
  const maxU = Math.ceil(Math.max(...CV_MENU.map((m) => m.units)) / 50) * 50 + 10, minCM = 0, maxCM = Math.ceil(Math.max(...CV_MENU.map((m) => m.cm)) / 4) * 4;
  const x = cvScale(0, maxU, P.l, W - P.r), y = cvScale(minCM, maxCM, H - P.b, P.t);
  const meanU = CV_MENU.reduce((s, m) => s + m.units, 0) / CV_MENU.length;
  // Hide a default label that would sit on top of the selected dish's label.
  const selItem = CV_MENU.find((m) => m.key === sel);
  const nearSel = (m) => selItem && m.key !== sel && Math.abs(m.units - selItem.units) < 30 && Math.abs(m.cm - selItem.cm) < 1.5;
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Menu items by weekly units and contribution margin. Each dish is a button.">
      {Array.from({ length: maxCM / 4 + 1 }, (_, i) => i * 4).map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">${v}</text></g>)}
      {Array.from({ length: Math.floor(maxU / 50) + 1 }, (_, i) => i * 50).map((v) => <text key={v} x={x(v)} y={H - 14} textAnchor="middle">{v}</text>)}
      <text className="lbl" x={W - P.r} y={H - 2} textAnchor="end">units per week →</text>
      <line x1={x(meanU)} x2={x(meanU)} y1={P.t} y2={H - P.b} className="axis" strokeDasharray="2 3" />
      <line x1={P.l} x2={W - P.r} y1={y(CV_CM_WEIGHTED)} y2={y(CV_CM_WEIGHTED)} stroke="var(--accent)" strokeWidth="1.5" />
      <text className="lbl" x={P.l + 6} y={y(CV_CM_WEIGHTED) - 5} textAnchor="start" style={{ fill: "var(--accent)" }}>Average margin, weighted by sales: ${CV_CM_WEIGHTED.toFixed(2)}</text>
      {CV_MENU.map((m) => {
        const on = sel === m.key;
        return (
          <g key={m.key} style={{ cursor: "pointer" }} onClick={() => onSel(m.key)} tabIndex={0} role="button" aria-label={`${m.name}, ${m.units} a week, $${m.cm.toFixed(2)} margin`}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSel(m.key); } }}>
            <circle cx={x(m.units)} cy={y(m.cm)} r={on ? 8 : 5.5} fill={on ? "var(--accent)" : "var(--surface)"} stroke={m.e == null ? "var(--fg-3)" : "var(--accent)"} strokeWidth="2" strokeDasharray={m.e == null ? "2 2" : undefined} />
            {(on || ((["salmon", "ribeye", "burger", "benedict"].includes(m.key) || m.added) && !nearSel(m))) && (
              <text className="lbl" x={m.units > maxU * 0.75 ? x(m.units) - 10 : x(m.units) + 10} y={m.units > maxU * 0.75 ? y(m.cm) - 10 : y(m.cm) + 4} textAnchor={m.units > maxU * 0.75 ? "end" : "start"} style={{ fontWeight: on ? 700 : 400, fill: on ? "var(--fg-1)" : "var(--fg-2)" }}>{m.name}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function CvMenu() {
  const cv = useCv();
  const [sel, setSel] = React.useState("salmon");
  const item = CV_MENU.find((m) => m.key === sel) || CV_MENU[0];
  const [price, setPrice] = React.useState(item.price + 2);
  React.useEffect(() => { setPrice(item.price + (item.price < 24 ? 1 : 2)); }, [sel]);
  const hist = CV_D.hist.rows;
  const slide = hist[38].wcm - hist[51].wcm;
  const hottest = CV_MENU.filter((m) => !m.balancing && m.cat !== "Alcohol").sort((a, b) => b.cost / b.price - a.cost / a.price)[0];
  const sim = cvPriceMoveInterval(item, price);
  const wide = item.se != null && item.se / Math.abs(item.e) > 0.4;
  return (
    <div className="cv-page wide">
      <PageHead over={`Menu · ${CV_ROOM.name} · ${CV_MENU.length} dishes`} q="What should this dish cost, and what happens if I change it?"
        sub={`One surface for margin, mix and pricing. Price response comes from your own price history, and the simulator refuses when there isn't enough of it.${CV_D.room.fromToast ? ` Prices and plates sold are from your Toast data through ${CV_D.room.fromToast.end}.` : ''}`} />
      {CV_MENU.some((m) => m.costEstimated) && <Callout tone="warn" icon="Calculator"><span>{CV_MENU.filter((m) => m.costEstimated).length} dishes have no plate cost yet, so their margins (and any price move on them) are <b>estimates</b> at your food-cost rate. <button className="cv-link" onClick={() => cv.go('inputs', { kind: 'recipes' })}>Enter plate costs</button></span></Callout>}
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head">
            <span className="cv-h4">Every dish, by how often it sells and what it earns</span>
            <Claim k="obs" />
          </div>
          <MenuScatter sel={item.key} onSel={setSel} />
          <div className="cv-legend">
            <span><i className="line" style={{ background: "var(--accent)" }} />Weighted by units: what a dish actually earns on average</span>
            <span><i className="ring" style={{ borderColor: "var(--fg-3)", borderStyle: "dashed" }} />Not enough price history</span>
          </div>
        </section>

        <section className="cv-card">
          <div className="cv-card-head">
            <div className="cv-col" style={{ gap: 2 }}>
              <span className="cv-over">Price simulator</span>
              <span className="cv-h4">{item.name}</span>
            </div>
            <Claim k={item.costEstimated ? "est" : "mod"} />
          </div>
          <dl className="cv-kv">
            <dt>Price now</dt><dd>{cvMoney(item.price, { cents: true })}</dd>
            <dt>Plate cost</dt><dd>{cvMoney(item.cost, { cents: true })}</dd>
            <dt>Food cost</dt><dd>{Math.round((item.cost / item.price) * 100)}%</dd>
            <dt>Margin per plate</dt><dd>{cvMoney(item.cm, { cents: true })}</dd>
            <dt>Sold per week</dt><dd>{item.units}</dd>
            <dt>Price response (elasticity)</dt><dd>{item.e == null ? "not measurable" : `${item.e.toFixed(2)} ± ${item.se.toFixed(2)}`}</dd>
          </dl>
          {item.e == null ? (
            <Callout tone="warn" icon="Ban">We won't price this from data. {item.balancing ? "This line rolls up sides and add-ons, so it has no single price to learn from." : `The ${item.name.toLowerCase()} hasn't had enough price changes to learn its price response from.`} Change it on judgement, and we'll measure what happens.</Callout>
          ) : (
            <>
              <div className="cv-col" style={{ gap: 6 }}>
                <label htmlFor="cv-price" className="cv-small" style={{ fontWeight: 600 }}>New price: <span className="cv-num">{cvMoney(price, { cents: true })}</span></label>
                <input id="cv-price" className="cv-range" type="range" min={item.price - 3} max={item.price + 4} step="0.5" value={price} onChange={(e) => setPrice(+e.target.value)} />
              </div>
              <div className="cv-grid g2" style={{ gap: 10 }}>
                <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">Sold per week</span><span className="cv-num" style={{ fontWeight: 600 }}>{Math.round(sim.q1)} <span className="cv-faint" style={{ fontWeight: 400 }}>({sim.lost >= 0 ? "−" : "+"}{Math.abs(Math.round(sim.lost))})</span></span></div>
                <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">Weekly margin change</span><span className={`cv-num ${sim.delta >= 0 ? "cv-up" : "cv-down"}`} style={{ fontWeight: 600 }}>{cvMoney(Math.round(sim.delta), { sign: true })}</span></div>
              </div>
              {price !== item.price && <Interval lo={Math.round(sim.lo)} pt={Math.round(sim.delta)} hi={Math.round(sim.hi)} min={Math.min(0, Math.round(sim.lo)) - 20} max={Math.round(sim.hi) + 30} billedLabel="if it verifies" />}
              {wide && <Callout tone="warn" icon="TriangleAlert">The price response is loosely measured for this dish. Expect a wide result, and a longer test.</Callout>}
              {price / item.price - 1 > 0.08 && <Callout tone="warn" icon="Fence">That's more than your 8% fence on price moves. We'd ask you to confirm it twice.</Callout>}
              {price !== item.price && price / item.price - 1 <= 0.08 && sim.delta > 0 && <Button icon="Check" onClick={() => cv.approve(`price:${item.key}:${price}`)}>Review this change</Button>}
            </>
          )}
        </section>
      </div>

      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Dish</th><th className="r">Price</th><th className="r">Plate cost</th><th className="r">Food cost</th><th className="r">Margin</th><th className="r">Per week</th><th className="r">Elasticity</th><th className="r">+$1 is worth</th></tr></thead>
            <tbody>
              {CV_MENU.map((m) => {
                const up = cvPriceMove(m, m.price + 1);
                return (
                  <tr key={m.key} className={`cv-tr ${sel === m.key ? "sel" : ""}`} onClick={() => setSel(m.key)}>
                    <td><span style={{ fontWeight: 600 }}>{m.name}</span> <span className="cv-xs cv-faint">{m.balancing ? "balancing line" : m.cat}</span>{m.costEstimated && <> <Pill tone="warn" icon="Calculator">cost estimated</Pill></>}</td>
                    <td className="r">{cvMoney(m.price, { cents: true })}</td>
                    <td className="r">{cvMoney(m.cost, { cents: true })}</td>
                    <td className={`r ${m.cost / m.price > 0.38 ? "cv-exp" : ""}`}>{Math.round((m.cost / m.price) * 100)}%</td>
                    <td className="r">{cvMoney(m.cm, { cents: true })}</td>
                    <td className="r">{m.units}</td>
                    <td className="r">{m.e == null ? "—" : m.e.toFixed(2)}</td>
                    <td className="r">{up ? cvMoney(Math.round(up.delta), { sign: true }) : "won't price"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {slide > 0.4 ? (
        <Callout icon="Shuffle">At {CV_ROOM.short}, the weighted margin slid from {cvMoney(hist[38].wcm, { cents: true })} to {cvMoney(hist[51].wcm, { cents: true })} per dish in 13 weeks while plate costs held. That's a mix problem, not a cost problem: guests are choosing cheaper-to-earn dishes. Menu placement is the lever here, not price.</Callout>
      ) : (
        <Callout icon="Flame">The hottest plate at {CV_ROOM.short} is the {hottest.name.toLowerCase()} at {Math.round((hottest.cost / hottest.price) * 100)}% food cost. Plate costs come from your recipe-cost upload; refresh them on the data inputs screen and every margin here recomputes.</Callout>
      )}
      <Callout icon="Calculator">The "sides and add-ons" line closes the menu to the register: it's whatever the {CV_MENU.length - 1} named dishes don't account for in this week's sales and food cost, so the totals here always match Earned.</Callout>
      <DenseMenu />
    </div>
  );
}

export { CvMenu };
