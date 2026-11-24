'use client';

import * as React from 'react';
import { InvoiceChecks } from './purchasing.checks';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_INVOICES, CV_PRICE_LEG, CV_MIX_LEG, Claim, Money, Callout, PageHead, cvScale } from '../core';

/* ================================================================ Purchasing */
function CvPurchasing() {
  const cv = useCv();
  const before = CV_INVOICES.reduce((s, r) => s + r.p0 * r.q0, 0);
  const after = CV_INVOICES.reduce((s, r) => s + r.p1 * r.q1, 0);
  const rows = [...CV_INVOICES].sort((a, b) => b.priceLeg - a.priceLeg);
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
      {CV_D.room.fromToast && !CV_D.inputs.invoices && <Callout tone="warn" icon="FileSpreadsheet"><span>Toast doesn&apos;t carry invoices, so these lines are still the sample&apos;s, scaled to your sales. <button className="cv-link" onClick={() => cv.go('inputs', { kind: 'invoices' })}>Enter your invoice lines</button> to see your own vendors.</span></Callout>}
      <InvoiceChecks />
      <div className="cv-grid">
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
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
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

export { CvPurchasing };
