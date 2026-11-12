'use client';

import * as React from 'react';
import { Button } from '../../kit';
import { useEngine, useSaved } from '../../engine';
import { useCv, cvMoney, CV_LOCS, Pill, Callout, PageHead } from '../core';

/* ================================================================ Accountant */
const CV_RECON = [
  { claim: "Trim Tuesday close, back of house", room: "Walnut Creek", acct: "6020 Hourly labour, BOH", op: 1637, rec: 1447, status: "Reconciled, with a timing note", tone: "good", icon: "BadgeCheck" },
  { claim: "Pull Thursday prep start back to 8:00", room: "Oakland", acct: "6020 Hourly labour, BOH", op: 416, rec: 416, status: "Reconciled", tone: "good", icon: "BadgeCheck" },
  { claim: "Reset the bar comp policy", room: "Walnut Creek", acct: "4090 Comps and discounts", op: 38, rec: 0, status: "Not yet eligible", tone: "neutral", icon: "Hourglass" },
  { claim: "Purchasing lever mapping", room: "Oakland", acct: "5010 or 5020?", op: 0, rec: 0, status: "Mapping exception", tone: "warn", icon: "TriangleAlert" },
  { claim: "Cut one Friday dinner server (August)", room: "Berkeley", acct: "6010 Hourly labour, FOH", op: -555, rec: -555, status: "Restated, credit issued", tone: "bad", icon: "Undo2" },
];
const LEVER_NAMES = { overtime: 'Overtime', labour: 'Labour overstaff', void_comp: 'Voids & comps', menu_margin: 'Menu margin', mix: 'Mix shift', turns: 'Table turns' };
const DEFAULT_GL = { overtime: '6020 Wages, overtime', labour: '6010 Wages, hourly', void_comp: '4100 Sales, comps and voids', menu_margin: '4000 Food sales', mix: '4000 Food sales', turns: '4000 Food sales' };
const c$ = (c) => cvMoney(c / 100, { cents: true });
const mName = (p) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/* A real group's period package: what each verified test contributes, where it lands in the books, approve or dispute. */
function AccountantReal() {
  const cv = useCv();
  const eng = useEngine();
  const [b, setB] = React.useState(null);
  const [period, setPeriod] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [pkg, setPkg] = useSaved('billing', { status: 'open' }, { group: true });
  const [gl, setGl] = useSaved('glmap', {}, { group: true });
  const [draftGl, setDraftGl] = React.useState({});
  const [disputing, setDisputing] = React.useState(false);
  const [note, setNote] = React.useState('');
  React.useEffect(() => {
    fetch('/api/billing', { credentials: 'same-origin' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setB(j); const prev = j.invoices.find((i) => i.period !== j.current); setPeriod(prev?.period ?? j.current); }).catch((e) => setErr(e.message));
  }, []);
  if (err) return <Callout tone="warn" icon="CircleX">{err}</Callout>;
  if (!b || !period) return <span className="cv-small cv-muted">Loading the package…</span>;
  const inv = b.invoices.find((i) => i.period === period);
  const forThis = !pkg.period || pkg.period === period;
  const state = disputing ? 'dispute' : forThis ? pkg.status : 'open';
  const levers = [...new Set((eng.windows || []).filter((w) => w.status === 'verified' || w.status === 'reversed').map((w) => w.lever))];
  const winOf = (id) => (eng.windows || []).find((w) => w.id === id);
  const csv = () => {
    const rows = [['Period', 'Test', 'Room', 'Account', 'Days', 'Reconciled'], ...(inv?.accruals || []).map((a) => [period, a.title, a.roomId, gl[winOf(a.windowId)?.lever]?.account ?? '', a.days, (a.cents / 100).toFixed(2)]), ...(inv?.lines || []).map((l) => [period, l.label, '', '', '', (l.cents / 100).toFixed(2)])];
    const text = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = `coversight-package-${period}.csv`;
    a.click();
  };
  return (
    <>
      <div className="cv-row" style={{ gap: 8 }}>
        <span className="cv-small" style={{ fontWeight: 600 }}>Period</span>
        <select className="input" style={{ width: 'auto' }} value={period} onChange={(e) => { setPeriod(e.target.value); setDisputing(false); }} aria-label="Period">
          {b.invoices.map((i) => <option key={i.period} value={i.period}>{mName(i.period)}{i.status === 'final' ? ' · invoiced' : ''}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {state === 'open' && inv?.status !== 'final' && <><Button variant="secondary" onClick={() => { setNote(''); setDisputing(true); }}>Dispute a line</Button><Button icon="Check" onClick={() => { setPkg({ status: 'approved', period, at: new Date().toISOString() }, `${mName(period)} package approved`); cv.toast(`${mName(period)} approved. The owner can now finalize the invoice.`); }}>Approve package</Button></>}
        {state === 'approved' && <Pill tone="good" icon="BadgeCheck">Approved {pkg.at ? new Date(pkg.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</Pill>}
        {state === 'disputed' && <Pill tone="warn" icon="MessageSquareWarning">Dispute open</Pill>}
        {(state === 'approved' || state === 'disputed') && inv?.status !== 'final' && <Button size="sm" variant="ghost" icon="Undo2" onClick={() => setPkg({ status: 'open', period }, `${mName(period)} package reopened`)}>Reopen</Button>}
        <Button size="sm" variant="secondary" icon="Download" onClick={csv}>CSV</Button>
      </div>
      {state === 'disputed' && pkg.note && <Callout tone="warn" icon="MessageSquareWarning">Your dispute: {pkg.note}</Callout>}
      {state === 'dispute' && (
        <section className="cv-card">
          <label htmlFor="cv-dispute" className="cv-small" style={{ fontWeight: 600 }}>What doesn&apos;t match your books?</label>
          <textarea id="cv-dispute" rows={3} className="input" style={{ width: '100%', padding: 10 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          <div className="cv-row"><Button size="sm" disabled={!note.trim()} onClick={() => { setPkg({ status: 'disputed', note, period, at: new Date().toISOString() }, `Dispute on the ${mName(period)} package`); setDisputing(false); cv.toast('Dispute recorded. The invoice can’t be finalized until it’s resolved.'); }}>Send dispute</Button><Button size="sm" variant="ghost" onClick={() => setDisputing(false)}>Cancel</Button></div>
        </section>
      )}
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Package lines">
          <table className="cv-table">
            <thead><tr><th>Verified saving</th><th>Room</th><th>Account</th><th className="r">Days</th><th className="r">Reconciled</th></tr></thead>
            <tbody>
              {!inv?.accruals?.length && <tr><td colSpan={5} className="cv-small cv-muted">No verified savings accrued in {mName(period)}. Only tests that passed their 28 days count, at their cautious lower bound.</td></tr>}
              {(inv?.accruals || []).map((a) => (
                <tr key={a.windowId}><td style={{ fontWeight: 600 }}>{a.title}</td><td>{CV_LOCS.find((l) => l.id === a.roomId)?.short ?? a.roomId}</td><td className="cv-small">{gl[winOf(a.windowId)?.lever]?.account ?? <span className="cv-faint">not mapped</span>}</td><td className="r">{a.days}</td><td className="r">{c$(a.cents)}</td></tr>
              ))}
              {inv && <tr><td colSpan={4} style={{ fontWeight: 700 }}>Reconciled for {mName(period)}</td><td className="r" style={{ fontWeight: 700 }}>{c$(inv.reconciledCents)}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="cv-card">
        <div className="cv-card-head"><span className="cv-h4">Where savings land in your books</span><span className="cv-xs cv-faint">Only a named person confirms a mapping</span></div>
        {levers.length === 0 ? <span className="cv-small cv-muted">Nothing to map until a test verifies.</span> : levers.map((k) => (
          <div key={k} className="cv-row nowrap" style={{ gap: 8 }}>
            <span className="cv-small" style={{ width: 150, fontWeight: 600 }}>{LEVER_NAMES[k] || k}</span>
            <input className="input" style={{ flex: 1 }} value={draftGl[k] ?? gl[k]?.account ?? DEFAULT_GL[k] ?? ''} onChange={(e) => setDraftGl({ ...draftGl, [k]: e.target.value })} aria-label={`${LEVER_NAMES[k] || k} account`} />
            {gl[k] && !draftGl[k] ? <Pill tone="good" icon="CircleCheck">Confirmed {new Date(gl[k].at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Pill> : <Button size="sm" icon="Check" onClick={() => { const account = (draftGl[k] ?? DEFAULT_GL[k] ?? '').trim(); if (!account) return; setGl((m) => ({ ...m, [k]: { account, by: eng.viewer?.anonymous ? 'Guest' : 'you', at: new Date().toISOString() } }), `${LEVER_NAMES[k]} mapped to ${account}`); setDraftGl((d) => { const n = { ...d }; delete n[k]; return n; }); cv.toast('Mapping confirmed.'); }}>Confirm</Button>}
          </div>
        ))}
      </section>
    </>
  );
}

function CvAccountant() {
  const eng = useEngine();
  if (eng.mode === 'server' && eng.org && !eng.org.sample && eng.viewer?.role !== 'gm') {
    return (
      <div className="cv-page wide">
        <PageHead over={`For the group controller · ${eng.org.name}`} q="The period package"
          sub="Every verified saving in the month, at its cautious lower bound, where it lands in your books, and the approval the invoice waits on. Download it as CSV for your close." />
        <AccountantReal />
      </div>
    );
  }
  return <CvAccountantSample />;
}

function CvAccountantSample() {
  const cv = useCv();
  const [pkg, setPkg] = useSaved("billing", { status: "open" }, { group: true });
  const [disputing, setDisputing] = React.useState(false);
  const [note, setNote] = React.useState("6020 for Walnut Creek shows $1,402 after the Sep 30 accrual, not $1,447.");
  const state = disputing ? "dispute" : pkg.status;
  const [mapping, setMapping] = React.useState(null);
  const boxes = [
    { k: "Operational point estimate", v: 1907, rule: "context only" },
    { k: "Operational lower bound", v: 1637, rule: "the claim" },
    { k: "Ledger movement, 6020, September", v: 1447, rule: "observed in your books" },
    { k: "Timing: lands in October", v: -147, rule: "identified, not netted", minus: true },
    { k: "Variance: 2 unscheduled overtime hours, Sep 14", v: -43, rule: "explained, not absorbed", minus: true },
    { k: "Reconciled for September", v: 1447, rule: "lesser of the two", final: true },
  ];
  return (
    <div className="cv-page wide">
      <PageHead over="For the group controller · Rosewood Restaurant Group" q="September period package"
        sub="A package, not a dashboard login. Every claim with its source lineage, the evidence that the change happened, the method and interval, the bridge to your ledger, and every reversal in the period."
        right={state === "open" ? <><Button variant="secondary" onClick={() => setDisputing(true)}>Dispute a line</Button><Button icon="Check" onClick={() => { setPkg({ status: "approved", at: new Date().toISOString() }, "September package approved"); cv.toast("September package approved. Fee basis locked at $1,863."); }}>Approve package</Button></> : state === "dispute" ? null : <><Pill tone={state === "approved" ? "good" : "warn"} icon={state === "approved" ? "BadgeCheck" : "MessageSquareWarning"}>{state === "approved" ? `Approved ${pkg.at ? new Date(pkg.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}` : "Dispute open"}</Pill><Button size="sm" variant="ghost" icon="Undo2" onClick={() => setPkg({ status: "open" }, "September package reopened")}>Reopen</Button></>} />
      {state === "dispute" && (
        <section className="cv-card">
          <label htmlFor="cv-dispute" className="cv-small" style={{ fontWeight: 600 }}>What doesn't match your books?</label>
          <textarea id="cv-dispute" rows={3} className="input" style={{ width: "100%", padding: 10, borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--fg-1)", font: "inherit" }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          <div className="cv-row"><Button size="sm" disabled={!note.trim()} onClick={() => { setPkg({ status: "disputed", note, at: new Date().toISOString() }, "Dispute sent on the September package"); setDisputing(false); cv.toast("Dispute sent. The line is frozen until it's resolved."); }}>Send dispute</Button><Button size="sm" variant="ghost" onClick={() => setDisputing(false)}>Cancel</Button></div>
        </section>
      )}
      <section className="cv-card">
        <div className="cv-card-head">
          <div className="cv-col" style={{ gap: 2 }}><span className="cv-h4">The bridge, for one claim</span><span className="cv-small cv-faint">Walnut Creek · Tuesday close, back of house, 6 fewer hours · September, 30 days</span></div>
          <span className="cv-small cv-muted">Every step subtracts. None may add.</span>
        </div>
        <div className="cv-bridge">
          {boxes.map((b) => (
            <div key={b.k} className={`cv-bbox ${b.minus ? "minus" : ""} ${b.final ? "final" : ""}`}>
              <span className="k">{b.k}</span>
              <span className="v">{cvMoney(b.v)}</span>
              <span className="rule">{b.rule}</span>
            </div>
          ))}
        </div>
        <span className="cv-small cv-muted">Fee basis for this claim: <b className="cv-num">≤ $1,447</b>. If your books support less than our lower bound, the claim is capped at your figure and the gap is shown. We never argue with the books.</span>
      </section>
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Claim</th><th>Room</th><th>Account</th><th className="r">Operational</th><th className="r">Reconciled</th><th>Status</th></tr></thead>
            <tbody>
              {CV_RECON.map((r) => (
                <tr key={r.claim}>
                  <td style={{ fontWeight: 600 }}>{r.claim}</td>
                  <td>{r.room}</td>
                  <td className="cv-small">{r.acct}</td>
                  <td className="r">{r.op ? cvMoney(r.op) : "—"}</td>
                  <td className="r">{r.rec ? cvMoney(r.rec) : "—"}</td>
                  <td><Pill tone={r.tone} icon={r.icon}>{r.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="cv-card">
        <div className="cv-card-head"><span className="cv-h4">One mapping needs you</span><Pill tone="warn" icon="TriangleAlert">Blocks reconciliation for 5010</Pill></div>
        <p className="cv-small cv-muted" style={{ lineHeight: 1.55, maxWidth: "75ch" }}>The new purchasing lever needs to know where vendor price changes land. The reconciliation agent proposes <b>5010 Food cost, proteins</b> for salmon and <b>5020 Food cost, produce</b> for romaine, with 92% confidence from 14 months of your invoices. An agent can propose a mapping. Only a named person can confirm it, once per mapping.</p>
        {mapping ? <Callout tone={mapping === "ok" ? "good" : ""} icon={mapping === "ok" ? "CircleCheck" : "Pencil"}>{mapping === "ok" ? "Mapping confirmed by you, version 3, effective Oct 1." : "Opened in the mapping editor."}</Callout> :
          <div className="cv-row"><Button size="sm" icon="Check" onClick={() => setMapping("ok")}>Confirm mapping</Button><Button size="sm" variant="secondary" onClick={() => setMapping("edit")}>Change it</Button></div>}
      </section>
    </div>
  );
}

export { CvAccountant };
