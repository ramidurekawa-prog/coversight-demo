'use client';

import * as React from 'react';

import { Icon, Button, Tabs } from '../kit';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_LOCS, CV_MENU, CV_CM_WEIGHTED, cvPriceMove, cvPriceMoveInterval, CV_INVOICES, CV_PRICE_LEG, CV_MIX_LEG, CV_PROOF, Claim, Money, Pill, Outcome, Callout, Interval, PageHead, cvApproval, cvScale } from './core';

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
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Menu items by weekly units and contribution margin">
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
            {(on || (["salmon", "ribeye", "burger", "benedict"].includes(m.key) && !nearSel(m))) && (
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
        sub="One surface for margin, mix and pricing. Price response comes from your own price history, and the simulator refuses when there isn't enough of it." />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head">
            <span className="cv-h4">Every dish, by how often it sells and what it earns</span>
            <Claim k="obs" />
          </div>
          <MenuScatter sel={sel} onSel={setSel} />
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
            <Claim k="mod" />
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
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Dish</th><th className="r">Price</th><th className="r">Plate cost</th><th className="r">Food cost</th><th className="r">Margin</th><th className="r">Per week</th><th className="r">Elasticity</th><th className="r">+$1 is worth</th></tr></thead>
            <tbody>
              {CV_MENU.map((m) => {
                const up = cvPriceMove(m, m.price + 1);
                return (
                  <tr key={m.key} className={`cv-tr ${sel === m.key ? "sel" : ""}`} onClick={() => setSel(m.key)}>
                    <td><span style={{ fontWeight: 600 }}>{m.name}</span> <span className="cv-xs cv-faint">{m.balancing ? "balancing line" : m.cat}</span></td>
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
    </div>
  );
}

/* ================================================================ Labour */
function LabourChart({ d }) {
  const W = 560, H = 210, P = { l: 30, r: 10, t: 12, b: 28 };
  const n = d.hours.length, bw = (W - P.l - P.r) / n;
  const y = cvScale(0, 10, H - P.b, P.t);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Servers scheduled versus needed, ${d.label}`}>
      {[0, 2, 4, 6, 8, 10].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
      {d.hours.map((h, i) => {
        const x0 = P.l + i * bw + bw * 0.18, w = bw * 0.64;
        const s = d.sched[i], nd = d.need[i];
        return (
          <g key={h}>
            <rect x={x0} y={y(s)} width={w} height={y(0) - y(s)} rx="3" fill="var(--surface-sunken)" stroke="var(--border-strong)" />
            <rect x={x0 + w * 0.22} y={y(nd)} width={w * 0.56} height={y(0) - y(nd)} rx="2" fill="var(--accent)" />
            {s > nd && <text x={x0 + w / 2} y={y(s) - 5} textAnchor="middle" style={{ fill: "var(--exposure)", fontWeight: 600 }}>+{s - nd} idle</text>}
            {nd > s && <text x={x0 + w / 2} y={y(nd) - 5} textAnchor="middle" style={{ fill: "var(--money-down)", fontWeight: 600 }}>−{nd - s} short</text>}
            <text x={x0 + w / 2} y={H - 10} textAnchor="middle">{h}</text>
          </g>
        );
      })}
    </svg>
  );
}
function CvLabour() {
  const cv = useCv();
  const [day, setDay] = React.useState("sat");
  const L = CV_D.room.labour;
  const d = L[day];
  const lastLab = CV_D.proofs.filter((p) => p.lever === "Labour" && (p.outcome === "verified" || p.outcome === "limited"))[0];
  const idle = d.sched.reduce((s, v, i) => s + Math.max(0, v - d.need[i]), 0);
  const short = d.sched.reduce((s, v, i) => s + Math.max(0, d.need[i] - v), 0);
  return (
    <div className="cv-page wide">
      <PageHead over={`Labour · ${CV_ROOM.name} · ${CV_D.room.staff.length} people, ${cvMoney(Math.round(CV_D.week.labour))} this week`} q="How many people does each hour need, and did the last change work?"
        sub="Staffing from your measured service rate, with short hours shown beside idle ones. A schedule that only ever cuts is not one anyone should trust." />
      <div className="cv-grid g4">
        {[["Idle server-hours this week", `${L.kpis.idle} h`, "cv-exp", "obs"], ["Short server-hours this week", `${L.kpis.short} h`, "cv-down", "obs"], ["Your measured service rate", L.kpis.rate.toFixed(2), "", "obs"], ["Last change", lastLab ? `${cvMoney(lastLab.bookable)}/wk` : "$0", lastLab ? "cv-up" : "", lastLab ? "book" : "none"]].map(([k, v, c, cl]) => (
          <div key={k} className="cv-card" style={{ gap: 6 }}>
            <span className="cv-xs cv-faint">{k}</span>
            <span className={`cv-fig md ${c}`}>{k === "Last change" && lastLab ? <Money id={lastLab.id}>{v}</Money> : v}</span>
            <div className="cv-row" style={{ gap: 6 }}><Claim k={cl} />{k === "Your measured service rate" && <span className="cv-xs cv-faint">covers per server-hour</span>}</div>
          </div>
        ))}
      </div>
      <Callout icon="Info">{L.note}</Callout>
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head">
            <span className="cv-h4">{d.label}: scheduled vs needed</span>
            <Tabs value={day} onChange={setDay} tabs={[{ value: "tue", label: "Tuesday" }, { value: "sat", label: "Saturday" }]} />
          </div>
          <LabourChart d={d} />
          <div className="cv-legend">
            <span><i style={{ background: "var(--surface-sunken)", border: "1px solid var(--border-strong)" }} />Scheduled</span>
            <span><i style={{ background: "var(--accent)" }} />Needed, at your service rate with a safety margin</span>
          </div>
          <span className="cv-small cv-muted">This service: <b className="cv-num">{idle}</b> idle and <b className="cv-num">{short}</b> short server-hours.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Drafted for next week</span><Pill icon="Gauge">{cvApproval(L.draft.approval).level}</Pill></div>
          <div className="cv-diff">
            <div className="r h"><span>When</span><span>Now</span><span>Draft</span></div>
            {cvApproval(L.draft.approval).diff.map(([w, a, b]) => <div className="r" key={w}><span>{w}</span><span className="was">{a}</span><span className="now">{b}</span></div>)}
          </div>
          <p className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{L.draft.note}</p>
          <Button icon="Send" onClick={() => cv.approve(L.draft.approval)}>Review and publish</Button>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Recent labour changes</th><th>Room</th><th>Outcome</th><th className="r">Bookable /wk</th></tr></thead>
            <tbody>
              {CV_PROOF.filter((p) => p.lever === "Labour").map((p) => (
                <tr key={p.id} className="cv-tr" onClick={() => cv.go("packet", { id: p.id })}>
                  <td style={{ fontWeight: 600 }}>{p.title}</td>
                  <td>{CV_LOCS.find((l) => l.id === p.loc).short}</td>
                  <td><Outcome k={p.outcome} /></td>
                  <td className="r">{p.bookable ? cvMoney(p.bookable) : "$0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ================================================================ Throughput */
function CvThroughput() {
  const cv = useCv();
  const T = CV_D.room.throughput;
  const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return (
    <div className="cv-page">
      <PageHead over={`Throughput · ${CV_ROOM.name}`} q="Is the room constrained, and is a faster turn worth anything?"
        sub="A faster turn only earns money when the room is full and people are waiting. So the first number is how often the room is actually full." />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <span className="cv-over">Claimable from faster turns this week</span>
          <span className="cv-fig xl">$0</span>
          <p className="cv-sub">{T.fullNote} If every one of those turned faster, the ceiling is <b className="cv-num">{cvMoney(T.ceiling)}</b> a month. We can't claim any of it: without waitlist data there's no way to know anyone was turned away.</p>
          <div className="cv-row"><Button icon="Plug" onClick={() => cv.go("sources")}>Connect your waitlist</Button><span className="cv-xs cv-faint">Turns the ceiling into something we can measure.</span></div>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Room use</span>
          <dl className="cv-kv">
            <dt>Seat-hours used</dt><dd>{T.seatUse}%</dd>
            <dt>Best vs worst service</dt><dd>{T.bestWorst}×</dd>
            <dt>Intervals at capacity</dt><dd>{T.intervals} of {T.total}</dd>
            <dt>Seats</dt><dd>{CV_ROOM.seats}</dd>
          </dl>
          <Callout icon="Info">The old Watch screen applied a turn-time gain to every interval all week and showed {cvMoney(T.oldClaim)}. That number was never claimable.</Callout>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Day</th><th><span className="cv-row" style={{ gap: 6 }}><Icon name="Sun" size={13} />Lunch, share of time full</span></th><th><span className="cv-row" style={{ gap: 6 }}><Icon name="Moon" size={13} />Dinner, share of time full</span></th></tr></thead>
            <tbody>
              {T.constrained.map(([d, l, n]) => (
                <tr key={d}>
                  <td style={{ fontWeight: 600 }}>{d}</td>
                  {[l, n].map((v, i) => (
                    <td key={i}>
                      <div className="cv-row nowrap" style={{ gap: 10 }}>
                        <div className="cv-decomp" style={{ width: 160, flexShrink: 0 }}><span style={{ width: `${v * 3}%`, background: i ? "var(--cat-1)" : "var(--cat-2)" }} /></div>
                        <span className="cv-num cv-small">{v}%</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ================================================================ Purchasing */
function CvPurchasing() {
  const cv = useCv();
  const before = CV_INVOICES.reduce((s, r) => s + r.p0 * r.q0, 0);
  const after = CV_INVOICES.reduce((s, r) => s + r.p1 * r.q1, 0);
  const rows = [...CV_INVOICES].sort((a, b) => b.priceLeg - a.priceLeg);
  const calls = rows.slice(0, 2);
  const W = 560, H = 190, P = { l: 12, r: 12, t: 18, b: 34 };
  const lo = 0, hi = Math.max(before + CV_PRICE_LEG, after) * 1.1;
  const y = cvScale(lo, hi, H - P.b, P.t);
  const steps = [
    { k: "Previous 28 days", a: lo, b: before, c: "var(--border-strong)" },
    { k: "Vendor prices", a: before, b: before + CV_PRICE_LEG, c: "var(--money-down)" },
    { k: "What you bought", a: before + CV_PRICE_LEG, b: after, c: "var(--money-up)" },
    { k: "Last 28 days", a: lo, b: after, c: "var(--border-strong)" },
  ];
  const bw = (W - P.l - P.r) / steps.length;
  return (
    <div className="cv-page wide">
      <PageHead over={`Purchasing · ${CV_ROOM.name} · ${CV_INVOICES.length} invoice lines from ${new Set(CV_INVOICES.map((r) => r.vendor)).size} vendors`}
        q="Did food cost rise because vendors raised prices, or because you bought differently?"
        sub="Every invoice line split into the part the vendor did and the part you did. The two add up to the total by construction, so this needs no model." />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Every invoice line, last 28 days vs the 28 before</span><Claim k="obs" /></div>
          <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Purchases bridge from previous to last 28 days">
            {steps.map((s, i) => {
              const top = Math.max(s.a, s.b), bot = Math.min(s.a, s.b);
              const x0 = P.l + i * bw + bw * 0.2, w = bw * 0.6;
              const val = i === 0 ? before : i === 3 ? after : s.b - s.a;
              return (
                <g key={s.k}>
                  <rect x={x0} y={y(top)} width={w} height={Math.max(2, y(bot) - y(top))} rx="3" fill={s.c} />
                  <text x={x0 + w / 2} y={y(top) - 5} textAnchor="middle" style={{ fill: "var(--fg-1)", fontWeight: 600 }}>{i === 0 || i === 3 ? cvMoney(Math.round(val)) : cvMoney(Math.round(val), { sign: true })}</text>
                  <text className="lbl" x={x0 + w / 2} y={H - 12} textAnchor="middle">{s.k}</text>
                </g>
              );
            })}
          </svg>
          <span className="cv-small cv-muted">Vendors added <Money id="price-leg"><b className="cv-num">{cvMoney(Math.round(CV_PRICE_LEG))}</b></Money>. {CV_MIX_LEG < 0 ? `You bought a little less, which took off ${cvMoney(Math.round(-CV_MIX_LEG))}.` : `You bought a little more, which added ${cvMoney(Math.round(CV_MIX_LEG))}.`}</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Two calls worth making</span><Claim k="obs" /></div>
          {calls.map((r) => [r.vendor, `${r.item} up ${r.pct.toFixed(1)}%`, r]).map(([v, t, r]) => (
            <div key={r.item} className="cv-row nowrap" style={{ alignItems: "flex-start", gap: 12 }}>
              <span className="cv-q-ico warn"><Icon name="Truck" size={18} /></span>
              <div className="cv-col" style={{ gap: 2, flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{v}</span>
                <span className="cv-small cv-muted">{t}: {cvMoney(r.p0, { cents: true })} to {cvMoney(r.p1, { cents: true })} per {r.unit}</span>
              </div>
              <span className="cv-num cv-down" style={{ fontWeight: 600 }}>{cvMoney(Math.round(r.priceLeg), { sign: true })}</span>
            </div>
          ))}
          <p className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>Groups like yours win back about 60% of an increase this size. Once you do, the saving is the unit-price change on the next invoices, and the same check catches the next increase.</p>
          <Button icon="Mail" onClick={() => cv.toast(`Draft emails to ${calls.map((r) => r.vendor).join(" and ")} are in your outbox.`)}>Draft both emails</Button>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Item</th><th>Vendor</th><th className="r">Unit price before</th><th className="r">Now</th><th className="r">Change</th><th className="r">Vendor's part</th><th className="r">Your part</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item}>
                  <td style={{ fontWeight: 600 }}>{r.item} <span className="cv-xs cv-faint">per {r.unit}</span></td>
                  <td>{r.vendor}</td>
                  <td className="r">{cvMoney(r.p0, { cents: true })}</td>
                  <td className="r">{cvMoney(r.p1, { cents: true })}</td>
                  <td className={`r ${r.pct > 0.05 ? "cv-down" : r.pct < -0.05 ? "cv-up" : ""}`}>{Math.abs(r.pct) < 0.05 ? "−" : (r.pct > 0 ? "▲ " : "▼ ") + Math.abs(r.pct).toFixed(1) + "%"}</td>
                  <td className="r">{cvMoney(Math.round(r.priceLeg), { sign: true })}</td>
                  <td className="r">{cvMoney(Math.round(r.mixLeg), { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Callout icon="Info">Vendor prices are a group contract, so the same increases land in all three rooms. Switch rooms in the top bar to see each room's share, or add this week's invoice lines on the data inputs screen.</Callout>
    </div>
  );
}

export { CvMenu, CvLabour, CvThroughput, CvPurchasing };
