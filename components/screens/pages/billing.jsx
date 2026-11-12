'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, cvMoney, Pill, Callout, PageHead } from '../core';
import { useEngine, useSaved } from '../../engine';

/* ================================================================ Billing */
const $c = (c) => cvMoney(c / 100, { cents: true });
const monthName = (p) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/* A real group's invoices: this month so far, past months, finalize, pricing. */
function BillingReal() {
  const cv = useCv();
  const eng = useEngine();
  const isOwner = eng.viewer?.role === 'owner';
  const [b, setB] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [price, setPrice] = React.useState(null);
  const [, savePricing] = useSaved('pricing', null, { group: true });
  const load = React.useCallback(() => fetch('/api/billing', { credentials: 'same-origin' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setB(j); setPrice({ room: j.pricing.perRoomMonthlyCents / 100, fee: j.pricing.feePct }); }).catch((e) => setErr(e.message)), []);
  React.useEffect(() => { load(); }, [load]);
  const post = async (path, period, label) => {
    setBusy(period); setErr(null);
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ period }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setErr(j.error); return; }
    setB((x) => ({ ...x, invoices: j.invoices }));
    cv.toast(label);
  };
  if (err && !b) return <Callout tone="warn" icon="CircleX">{err}</Callout>;
  if (!b) return <span className="cv-small cv-muted">Loading invoices…</span>;
  const cur = b.invoices.find((i) => i.period === b.current);
  const past = b.invoices.filter((i) => i.period !== b.current);
  const Lines = ({ inv }) => (
    <div className="cv-diff">
      <div className="r h" style={{ gridTemplateColumns: 'minmax(0, 1fr) 140px' }}><span>Line</span><span style={{ textAlign: 'right' }}>Amount</span></div>
      {inv.lines.map((l) => <div key={l.label} className="r" style={{ gridTemplateColumns: 'minmax(0, 1fr) 140px' }}><span>{l.label}</span><span className="now" style={{ textAlign: 'right' }}>{$c(l.cents)}</span></div>)}
      <div className="r" style={{ gridTemplateColumns: 'minmax(0, 1fr) 140px', background: 'var(--surface-sunken)' }}><span style={{ fontWeight: 700 }}>Total</span><span className="now" style={{ textAlign: 'right' }}>{$c(inv.totalCents)}</span></div>
    </div>
  );
  return (
    <>
      {err && <Callout tone="warn" icon="CircleX">{err}</Callout>}
      <div className="cv-grid g-hero">
        {cur && (
          <section className="cv-card">
            <div className="cv-card-head"><span className="cv-h4">{monthName(cur.period)} so far</span><Pill icon="Hourglass">Draft · recalculated live</Pill></div>
            <Lines inv={cur} />
            <span className="cv-small cv-muted">Reconciled savings so far {$c(cur.reconciledCents)}: only tests that passed their 28 days, at the cautious end of what they proved, for the days they stayed proven.</span>
            {cur.accruals.length > 0 && <ul className="cv-ul">{cur.accruals.map((a) => <li key={a.windowId}><Icon name="BadgeCheck" size={14} />{a.title}: {a.days} days, {$c(a.cents)}</li>)}</ul>}
          </section>
        )}
        <section className="cv-card">
          <span className="cv-h4">Pricing</span>
          {price && (
            <div className="cv-col" style={{ gap: 8 }}>
              <label className="cv-row" style={{ gap: 8 }}><span className="cv-small" style={{ width: 160 }}>Per room, per month</span>$<input className="input" type="number" min="0" step="1" style={{ width: 110 }} value={price.room} disabled={!isOwner} onChange={(e) => setPrice({ ...price, room: e.target.value })} aria-label="Price per room per month" /></label>
              <label className="cv-row" style={{ gap: 8 }}><span className="cv-small" style={{ width: 160 }}>Fee on reconciled savings</span><input className="input" type="number" min="0" max="50" step="0.5" style={{ width: 110 }} value={price.fee} disabled={!isOwner} onChange={(e) => setPrice({ ...price, fee: e.target.value })} aria-label="Fee percent" />%</label>
              {isOwner && <span><Button size="sm" variant="secondary" onClick={() => { savePricing({ perRoomMonthlyCents: Math.round(Number(price.room) * 100), feePct: Number(price.fee) }, 'Pricing changed'); setTimeout(load, 700); cv.toast('Pricing saved. Drafts recalculate; finalized invoices never change.'); }}>Save pricing</Button></span>}
              <span className="cv-xs cv-faint">Set at onboarding. Finalized invoices keep the pricing they were issued with.</span>
            </div>
          )}
          {b.stripe ? <Callout icon="CreditCard">Finalized invoices go to Stripe, which emails a pay link. If Stripe is slow or down, the invoice stays final and sending retries on its own.</Callout> : <Callout icon="Info">Stripe isn&apos;t connected, so invoices live here. Add STRIPE_SECRET_KEY in Vercel to send them with a pay link.</Callout>}
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Invoices">
          <table className="cv-table">
            <thead><tr><th>Month</th><th className="r">Reconciled savings</th><th className="r">Invoice</th><th className="r">You kept, net</th><th>Status</th><th /></tr></thead>
            <tbody>
              {past.length === 0 && <tr><td colSpan={6} className="cv-small cv-muted">No past months yet. Each month is drafted on the 2nd and finalized once your accountant approves the package.</td></tr>}
              {past.map((i) => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 600 }}>{monthName(i.period)}</td>
                  <td className="r">{$c(i.reconciledCents)}</td>
                  <td className="r">{$c(i.totalCents)}</td>
                  <td className={`r ${i.reconciledCents - i.totalCents >= 0 ? 'cv-up' : 'cv-down'}`}>{cvMoney((i.reconciledCents - i.totalCents) / 100, { cents: true, sign: true })}</td>
                  <td>{i.status !== 'final' ? <Pill icon="Hourglass">Draft</Pill>
                    : i.stripeUrl ? <Pill tone="good" icon="BadgeCheck"><a href={i.stripeUrl} target="_blank" rel="noreferrer">Final · pay link</a></Pill>
                    : i.delivery === 'pending' ? <span title={i.deliveryError ?? 'Sending to Stripe'}><Pill icon="Clock">Final · sending{i.deliveryAttempts ? `, try ${i.deliveryAttempts + 1}` : ''}</Pill></span>
                    : i.delivery === 'failed' ? <span title={i.deliveryError ?? ''}><Pill tone="bad" icon="TriangleAlert">Final · Stripe stopped</Pill></span>
                    : <Pill tone="good" icon="BadgeCheck">Final</Pill>}</td>
                  <td>{i.status === 'final' && i.delivery === 'failed' && isOwner && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => post('/api/billing/retry', i.period, 'Sent to Stripe again.')}>Retry</Button>}
                  {i.status !== 'final' && isOwner && (
                    <span className="cv-row nowrap" style={{ gap: 6 }}>
                      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => post('/api/billing/draft', i.period, 'Recalculated.')}>Recalculate</Button>
                      <Button size="sm" disabled={!!busy} onClick={() => post('/api/billing/finalize', i.period, `${monthName(i.period)} finalized.`)}>Finalize</Button>
                    </span>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Callout icon="Info">A month finalizes only after your accountant approves its package on the Accountant screen; an open dispute holds it. If a verified saving is later reversed, the fee on any days billed after the reversal comes back as a credit on the next invoice.</Callout>
    </>
  );
}

function CvBilling() {
  const eng = useEngine();
  if (eng.mode === 'server' && eng.org && !eng.org.sample && eng.viewer?.role !== 'gm') {
    return (
      <div className="cv-page">
        <PageHead over={`Billing · ${eng.org.name}`} q="What did we charge, and on what?"
          sub="The subscription, plus a fee on reconciled savings only: tests that passed, at their cautious lower bound. Never on an estimate." />
        <BillingReal />
      </div>
    );
  }
  return <CvBillingSample />;
}

function CvBillingSample() {
  const fee = 0.15;
  const months = [["July", 430], ["August", 867], ["September", 1863]];
  const sub = 349 * 3;
  const sept = 1863;
  const total = sub + sept * fee;
  return (
    <div className="cv-page">
      <PageHead over="Billing · Rosewood Restaurant Group" q="What did we charge, and on what?"
        sub="The fee is charged on reconciled savings: the lesser of our measured lower bound and what your books show. Never on an estimate, never on a point estimate." />
      <Callout tone="warn" icon="FlaskConical">The sample group&apos;s billing story: $349 per room per month, plus 15% of reconciled savings. Your own group&apos;s invoices are computed from its own verified tests.</Callout>
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">September invoice</span><Pill tone="good" icon="BadgeCheck">Package approved Oct 27</Pill></div>
          <div className="cv-diff">
            <div className="r h" style={{ gridTemplateColumns: "minmax(0, 1fr) 140px" }}><span>Line</span><span style={{ textAlign: "right" }}>Amount</span></div>
            {[["Subscription, 3 rooms × $349", sub], [`Performance fee, 15% × $${sept.toLocaleString()} reconciled`, sept * fee], ["Credits", 0]].map(([k, v]) => (
              <div key={k} className="r" style={{ gridTemplateColumns: "minmax(0, 1fr) 140px" }}><span>{k}</span><span className="now" style={{ textAlign: "right" }}>{cvMoney(v, { cents: true })}</span></div>
            ))}
            <div className="r" style={{ gridTemplateColumns: "minmax(0, 1fr) 140px", background: "var(--surface-sunken)" }}><span style={{ fontWeight: 700 }}>Total</span><span className="now" style={{ textAlign: "right" }}>{cvMoney(total, { cents: true })}</span></div>
          </div>
          <span className="cv-small cv-muted">Reconciled savings ($1,863) minus everything billed ({cvMoney(total, { cents: true })}) leaves you {cvMoney(sept - total, { cents: true })} ahead this month.</span>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Credits and reversals</span>
          <Callout icon="Undo2">Berkeley's Friday server cut was reversed on Aug 24, before August was invoiced. Its $555 was removed first, so no fee was ever charged on it.</Callout>
          <span className="cv-small cv-muted">If a reversal lands after we've invoiced, the fee on it comes back as a credit on the next invoice, with the reason.</span>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Month</th><th className="r">Reconciled savings</th><th className="r">Subscription</th><th className="r">Performance fee</th><th className="r">You kept, net</th></tr></thead>
            <tbody>
              {months.map(([m, r]) => (
                <tr key={m}><td style={{ fontWeight: 600 }}>{m}</td><td className="r">{cvMoney(r)}</td><td className="r">{cvMoney(sub)}</td><td className="r">{cvMoney(r * fee, { cents: true })}</td><td className={`r ${r - sub - r * fee >= 0 ? "cv-up" : "cv-down"}`}>{cvMoney(r - sub - r * fee, { cents: true, sign: true })}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Callout icon="Info">July and August cost more than they saved. That's the first six weeks: tests take time to close. The coverage turned positive in September, when two changes were reconciled.</Callout>
    </div>
  );
}

export { CvBilling };
