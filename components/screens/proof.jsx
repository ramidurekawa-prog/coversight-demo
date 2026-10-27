'use client';

import * as React from 'react';

import { Icon, Button, Tabs } from '../kit';
import { useCv, cvMoney, CV_DAILY, CV_DAYS_TO_DATE, CV_LOCS, CV_SALMON_WK, CV_PROOF, CV_OUTCOME, Claim, Money, Pill, Outcome, Callout, Interval, PageHead, cvScale } from './core';

/* Coversight — proof surfaces: Proof, Verification packet, Accountant, Savings ledger,
   Comparison, Sources, System. */

/* ================================================================ Proof */
function CvProof() {
  const cv = useCv();
  const [scope, setScope] = React.useState(cv.loc === "all" ? "all" : cv.loc);
  React.useEffect(() => setScope(cv.loc === "all" ? "all" : cv.loc), [cv.loc]);
  const rows = CV_PROOF.filter((p) => scope === "all" || p.loc === scope);
  const count = (ks) => rows.filter((r) => ks.includes(r.outcome)).length;
  // A paused claim (guardrail amber) accrues nothing this week, so it is not bookable now.
  const bookable = rows.reduce((s, r) => s + (r.paused ? 0 : r.bookable), 0);
  return (
    <div className="cv-page wide">
      <PageHead over="Proof" q="What have we actually proven?"
        sub="Every claimed dollar with its controls, interval, gates and how long it lasts. The ones that failed stay on screen with the reason, because a ledger that only goes up isn't a ledger."
        right={<>
          <Tabs value={scope} onChange={setScope} tabs={[{ value: "all", label: "All rooms" }, { value: "oakland", label: "Oakland" }, { value: "berkeley", label: "Berkeley" }, { value: "walnut", label: "Walnut Creek" }]} />
        </>} />
      <div className="cv-life">
        {[["Verified", ["verified", "limited"]], ["In testing", ["testing"]], ["Data failure", ["data"]], ["Reversed", ["reversed"]], ["Inconclusive", ["inconclusive"]], ["Directional only", ["directional"]]].map(([k, ks]) => (
          <div key={k}><span className="n">{count(ks)}</span><span className="k">{k}</span></div>
        ))}
      </div>
      <div className="cv-row" style={{ justifyContent: "space-between" }}>
        <div className="cv-row" style={{ gap: 8 }}>
          <span className="cv-small cv-muted">Bookable now</span>
          <span className="cv-fig md cv-up">{cvMoney(bookable)}<span className="cv-small cv-faint" style={{ fontFamily: "var(--font-sans)", fontWeight: 400 }}>/wk</span></span>
          <Claim k="book" />
        </div>
        <Button variant="secondary" icon="FileOutput" onClick={() => cv.go("accountant")}>Package for your accountant</Button>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Change</th><th>Room</th><th>Outcome</th><th className="r">Bookable /wk</th><th className="r">Measured interval</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="cv-tr" tabIndex={0} onClick={() => cv.go("packet", { id: p.id })} onKeyDown={(e) => { if (e.key === "Enter") cv.go("packet", { id: p.id }); }}>
                  <td style={{ maxWidth: 380 }}>
                    <div className="cv-col" style={{ gap: 3 }}>
                      <span style={{ fontWeight: 600 }}>{p.title}</span>
                      <span className="cv-xs cv-faint" style={{ lineHeight: 1.45 }}>{p.lever} · {p.reason || p.limitation || p.checkpoint || p.method}</span>
                    </div>
                  </td>
                  <td>{CV_LOCS.find((l) => l.id === p.loc).short}</td>
                  <td><Outcome k={p.outcome} /></td>
                  <td className="r">{p.outcome === "reversed" ? <span className="cv-down">−{cvMoney(p.removed)} removed</span> : p.paused ? <span className="cv-faint">{cvMoney(p.bookable)} paused</span> : cvMoney(p.bookable)}</td>
                  <td className="r">{p.lo != null ? `${cvMoney(p.lo)} – ${cvMoney(p.hi)}` : "—"}</td>
                  <td className="cv-small cv-muted">{p.held}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Callout icon="Scale">"We couldn't tell" and "it didn't work" are different facts. Inconclusive is a failure of the test design, and says nothing about the change. No measurable effect is the most useful record there is for learning what to try next.</Callout>
    </div>
  );
}

/* ================================================================ Verification packet */
function cvGates(p) {
  const base = [
    ["Measurement plan registered before the change", "registered 14 days before", "ok"],
    ["Evidence the change happened", "7shifts diff, 9 of 9 services", "ok"],
    ["Window at least as long as policy", "6 of 6 weeks", "ok"],
    ["Matched control services", "9 services · balance 0.06", "ok"],
    ["Parallel trends before the change", "placebo p = 0.71", "ok"],
    ["Enough data to see the effect", "detectable $40 ≤ expected $112", "ok"],
    ["Interval excludes zero", "lower bound $97 > $0", "ok"],
    ["Guardrails held", "covers +0.4% · ticket 13.8 min", "ok"],
    ["Source data complete", "99.2% of services", "ok"],
    ["No competing explanation", "no other change on the lever", "ok"],
    ["One lever key per dollar", "no overlapping claim", "ok"],
    ["Multiplier frozen at verify", "hash 7f3a…c21", "ok"],
  ];
  const set = (i, v, s) => { base[i] = [base[i][0], v, s]; };
  if (p.outcome === "limited") { set(2, "4 of 6 weeks", "warn"); set(6, `lower bound $${p.lo} > $0`, "ok"); }
  if (p.outcome === "testing") { [2, 5, 6, 7, 11].forEach((i) => set(i, "pending until Nov 3", "warn")); set(2, "3 of 3 weeks · in progress", "warn"); }
  if (p.outcome === "data") { set(8, "recipe costs 18 days old", "no"); [5, 6, 11].forEach((i) => set(i, "not computed", "warn")); }
  if (p.outcome === "reversed") { set(7, "turn time 54 min > 52 guard", "no"); set(11, "removed Aug 24", "no"); }
  if (p.outcome === "inconclusive") { set(5, "needed 9 services, had 4", "no"); set(6, "−$58 to $186", "no"); set(3, "4 services · balance 0.19", "warn"); }
  if (p.outcome === "directional") { set(6, "−$12 to $94", "no"); }
  return base;
}
function CvPacket({ params }) {
  const cv = useCv();
  const p = CV_PROOF.find((r) => r.id === (params && params.id)) || CV_PROOF[0];
  const gates = cvGates(p);
  const passed = gates.filter((g) => g[2] === "ok").length;
  const loc = CV_LOCS.find((l) => l.id === p.loc);
  return (
    <div className="cv-page">
      <button className="cv-link" onClick={() => cv.go("proof")}><Icon name="ArrowLeft" size={14} />All proof</button>
      <PageHead over={`Verification packet · ${loc.name} · ${p.lever}`} q={p.title}
        right={<><Outcome k={p.outcome} /><Button variant="secondary" size="sm" icon="Download" onClick={() => cv.toast("Packet exported as a re-runnable bundle.")}>Export</Button></>} />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">What can be claimed</span><Claim k={p.bookable ? "book" : "none"} /></div>
          <div className="cv-row" style={{ alignItems: "baseline", gap: 12 }}>
            <span className={`cv-fig xl ${p.bookable ? "cv-up" : ""}`}>{p.id === "thu-prep" ? <Money id="thu-prep">${p.bookable}</Money> : `$${p.bookable}`}</span>
            <span className="cv-muted">per week{p.bookable ? ", the lower bound" : ""}</span>
          </div>
          {p.lo != null && p.outcome !== "testing" && <Interval lo={p.lo} pt={p.point} hi={p.hi} min={Math.min(0, p.lo) - 20} max={p.hi + 40} />}
          {p.outcome === "testing" && <Callout tone="info" icon="Timer">Running estimate {cvMoney(p.point)}/wk, interval {cvMoney(p.lo)} to {cvMoney(p.hi)}. It crosses zero, so nothing accrues until the window closes on Nov 3.</Callout>}
          {p.reason && p.outcome !== "testing" && <Callout tone={p.outcome === "reversed" ? "bad" : p.outcome === "data" || p.paused ? "warn" : ""} icon={p.paused ? "CirclePause" : CV_OUTCOME[p.outcome].icon}>{p.reason}</Callout>}
          {p.limitation && <Callout tone="warn" icon="TriangleAlert">Limitation, shown wherever this claim appears: {p.limitation}.</Callout>}
        </section>
        <section className="cv-card">
          <span className="cv-h4">The record</span>
          <dl className="cv-kv">
            <dt>Method</dt><dd style={{ fontFamily: "var(--font-sans)", textAlign: "right" }}>{p.method}</dd>
            <dt>Owner</dt><dd style={{ fontFamily: "var(--font-sans)" }}>{p.owner}</dd>
            <dt>{p.outcome === "verified" || p.outcome === "limited" ? "Accruing since" : "Started"}</dt><dd>{p.since}</dd>
            <dt>Status</dt><dd style={{ fontFamily: "var(--font-sans)" }}>{p.held}</dd>
            <dt>How long it lasts</dt><dd style={{ fontFamily: "var(--font-sans)" }}>{p.persist}</dd>
            <dt>Gates passed</dt><dd>{passed} of 12</dd>
          </dl>
        </section>
      </div>
      <section className="cv-card flush">
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }} className="cv-row">
          <span className="cv-h4">Twelve gates</span><span className="cv-small cv-faint">Every one is a rule. The explanation is written about the verdict and can't change it.</span>
        </div>
        <div className="cv-gates">
          {gates.map(([k, v, s]) => (
            <div key={k} className="cv-gate">
              <Icon name={s === "ok" ? "CircleCheck" : s === "no" ? "CircleX" : "CircleDot"} size={18} className={s} />
              <span>{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </div>
      </section>
      {p.id === "thu-prep" && (
        <div className="cv-grid g2">
          <section className="cv-card">
            <span className="cv-h4">Evidence it happened</span>
            <div className="cv-diff">
              <div className="r h"><span>Thursday</span><span>Before</span><span>After</span></div>
              <div className="r"><span>Prep start</span><span className="was">6:30 am</span><span className="now">8:00 am</span></div>
              <div className="r"><span>Prep hours</span><span className="was">14.0 h</span><span className="now">8.0 h</span></div>
              <div className="r"><span>Covers</span><span className="was">118</span><span className="now">118.5</span></div>
            </div>
          </section>
          <section className="cv-card">
            <span className="cv-h4">After verification</span>
            <ul className="cv-ul">
              <li><Icon name="Activity" size={15} />Monitored weekly for 26 weeks. No drift so far, so it accrues at the full rate.</li>
              <li><Icon name="Lock" size={15} />The rate was frozen on Jun 22. A better model later can't re-price it.</li>
              <li><Icon name="Archive" size={15} />Retires into your baseline after 52 weeks, on Jun 21, 2027. After that it's held, not saved.</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

/* ================================================================ Accountant */
const CV_RECON = [
  { claim: "Trim Tuesday close, back of house", room: "Walnut Creek", acct: "6020 Hourly labour, BOH", op: 1637, rec: 1447, status: "Reconciled, with a timing note", tone: "good", icon: "BadgeCheck" },
  { claim: "Pull Thursday prep start back to 8:00", room: "Oakland", acct: "6020 Hourly labour, BOH", op: 416, rec: 416, status: "Reconciled", tone: "good", icon: "BadgeCheck" },
  { claim: "Reset the bar comp policy", room: "Walnut Creek", acct: "4090 Comps and discounts", op: 38, rec: 0, status: "Not yet eligible", tone: "neutral", icon: "Hourglass" },
  { claim: "Purchasing lever mapping", room: "Oakland", acct: "5010 or 5020?", op: 0, rec: 0, status: "Mapping exception", tone: "warn", icon: "TriangleAlert" },
  { claim: "Cut one Friday dinner server (August)", room: "Berkeley", acct: "6010 Hourly labour, FOH", op: -555, rec: -555, status: "Restated, credit issued", tone: "bad", icon: "Undo2" },
];
function CvAccountant() {
  const cv = useCv();
  const [state, setState] = React.useState("open");
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
        right={state === "open" ? <><Button variant="secondary" onClick={() => setState("dispute")}>Dispute a line</Button><Button icon="Check" onClick={() => { setState("approved"); cv.toast("September package approved. Fee basis locked at $1,863."); }}>Approve package</Button></> : <Pill tone={state === "approved" ? "good" : "warn"} icon={state === "approved" ? "BadgeCheck" : "MessageSquareWarning"}>{state === "approved" ? "Approved Oct 27" : "Dispute open"}</Pill>} />
      {state === "dispute" && (
        <section className="cv-card">
          <label htmlFor="cv-dispute" className="cv-small" style={{ fontWeight: 600 }}>What doesn't match your books?</label>
          <textarea id="cv-dispute" rows={3} className="input" style={{ width: "100%", padding: 10, borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--fg-1)", font: "inherit" }} defaultValue="6020 for Walnut Creek shows $1,402 after the Sep 30 accrual, not $1,447." />
          <div className="cv-row"><Button size="sm" onClick={() => { setState("open"); cv.toast("Dispute sent. The line is frozen until it's resolved."); }}>Send dispute</Button><Button size="sm" variant="ghost" onClick={() => setState("open")}>Cancel</Button></div>
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
        <div className="cv-tablewrap">
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

/* ================================================================ Savings ledger */
const CV_WEEKS = ["Jun 22", "Jun 29", "Jul 6", "Jul 13", "Jul 20", "Jul 27", "Aug 3", "Aug 10", "Aug 17", "Aug 24", "Aug 31", "Sep 7", "Sep 14", "Sep 21", "Sep 28", "Oct 5", "Oct 12", "Oct 19"];
const CV_SERIES = [
  { key: "thu", loc: "oakland", label: "Oakland · Thursday prep", color: "var(--cat-1)", vals: CV_WEEKS.map(() => 97) },
  { key: "wcclose", loc: "walnut", label: "Walnut Creek · Tuesday close", color: "var(--cat-2)", vals: CV_WEEKS.map((_, i) => (i >= 9 ? 382 : 0)) },
  { key: "wccomp", loc: "walnut", label: "Walnut Creek · comp reset", color: "var(--cat-3)", vals: CV_WEEKS.map((_, i) => (i >= 14 && i < 17 ? 88 : 0)) },
  { key: "bkfri", loc: "berkeley", label: "Berkeley · Friday server (reversed)", color: "var(--money-down)", vals: CV_WEEKS.map((_, i) => (i >= 6 && i <= 8 ? -185 : 0)), reversed: true },
];
function LedgerChart({ series }) {
  const W = 1000, H = 250, P = { l: 48, r: 10, t: 14, b: 30 };
  const n = CV_WEEKS.length, bw = (W - P.l - P.r) / n;
  const tops = CV_WEEKS.map((_, i) => series.reduce((s, ser) => s + Math.max(0, ser.vals[i]), 0));
  const bots = CV_WEEKS.map((_, i) => series.reduce((s, ser) => s + Math.min(0, ser.vals[i]), 0));
  const max = Math.max(100, ...tops) * 1.1, min = Math.min(0, ...bots) * 1.15;
  const y = cvScale(min, max, H - P.b, P.t);
  const step = max > 400 ? 200 : max > 150 ? 100 : 25;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly banked savings by change">
      {ticks.map((v) => <g key={v}><line className={v === 0 ? "axis" : "grid"} x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">{cvMoney(v)}</text></g>)}
      {CV_WEEKS.map((w, i) => {
        let acc = 0;
        const x0 = P.l + i * bw + bw * 0.16, bwid = bw * 0.68;
        return (
          <g key={w}>
            {series.map((s) => {
              const v = s.vals[i];
              if (!v) return null;
              if (v < 0) return <rect key={s.key} x={x0} y={y(0)} width={bwid} height={y(v) - y(0)} fill="none" stroke={s.color} strokeDasharray="3 2" strokeWidth="1.5" rx="2" />;
              const r = <rect key={s.key} x={x0} y={y(acc + v)} width={bwid} height={y(acc) - y(acc + v)} fill={s.color} rx="2" />;
              acc += v;
              return r;
            })}
            {i % 3 === 0 && <text x={x0 + bwid / 2} y={H - 10} textAnchor="middle">{w}</text>}
          </g>
        );
      })}
    </svg>
  );
}
function CvLedger() {
  const cv = useCv();
  const [cad, setCad] = React.useState("week");
  const scope = cv.loc;
  const series = CV_SERIES.filter((s) => scope === "all" || s.loc === scope);
  const d = CV_DAILY;
  const CAD = {
    day: { fig: cvMoney(Math.round(d)), say: "Today you banked $14 from one change that is holding.", math: "Σ (weekly lower bound ÷ 7) × persistence = 97 ÷ 7 × 1.00", note: "An accrual of a rate already proven, not a new measurement." },
    week: { fig: "$97", say: "$97 this week. Nothing new verified, nothing reversed.", math: "seven daily accruals + any window that closed this week", note: "The only cadence where a new number can be born." },
    month: { fig: cvMoney(Math.round(d * 26)), say: `October so far: ${cvMoney(Math.round(d * 26))} over 26 days, against $349 of subscription.`, math: "Σ of the month's daily accruals, never weekly × 4.33", note: "Months differ in length, and the ledger simply reflects that." },
    quarter: { fig: cvMoney(Math.round(d * 92)), say: `Q3: ${cvMoney(Math.round(d * 92))} banked. The Thursday prep standard was re-tested in September and held.`, math: "Σ of 92 days + the re-verification sweep", note: "One re-test per standard per quarter." },
    year: { fig: cvMoney(Math.round(d * CV_DAYS_TO_DATE)), say: `${cvMoney(Math.round(d * CV_DAYS_TO_DATE))} since June 22. The first annual reconciliation against your books is in June 2027.`, math: "Σ of days, then checked against the margin your P&L actually shows", note: "If the claim ever exceeds the improvement, it's capped and the gap is shown." },
  };
  const c = CAD[cad];
  return (
    <div className="cv-page wide">
      <PageHead over={`Savings ledger · ${CV_LOCS.find((l) => l.id === scope).name}`} q="What has this been worth, at every zoom level?"
        sub="Measured once, over weeks. Everything after that is bookkeeping on that one measurement: the day is the week spread out, the month is its days added up." />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head">
            <Tabs value={cad} onChange={setCad} tabs={["day", "week", "month", "quarter", "year"].map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))} />
            <Claim k="book" />
          </div>
          <span className="cv-xs cv-faint">Rosewood Oakland</span>
          <span className="cv-fig xl cv-up">{c.fig}</span>
          <p className="cv-h4" style={{ fontWeight: 600 }}>"{c.say}"</p>
          <div className="cv-formula" style={{ fontSize: "var(--text-xs)" }}>{c.math}</div>
          <span className="cv-small cv-muted">{c.note}</span>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Two numbers that never merge</span>
          <div className="cv-col" style={{ gap: 4 }}>
            <div className="cv-row"><Claim k="obs" /><span style={{ fontWeight: 600 }}>Earned</span></div>
            <span className="cv-small cv-muted">What the business made, from its own register. It exists whether or not we do.</span>
          </div>
          <div className="cv-col" style={{ gap: 4 }}>
            <div className="cv-row"><Claim k="book" /><span style={{ fontWeight: 600 }}>Saved</span></div>
            <span className="cv-small cv-muted">What changed because of a change we recommended, measured against matched controls. Never a share of earned, never a target percentage.</span>
          </div>
        </section>
      </div>
      <section className="cv-card">
        <div className="cv-card-head">
          <span className="cv-h4">Banked each week</span>
          <span className="cv-small cv-faint">Switch rooms in the top bar</span>
        </div>
        <LedgerChart series={series.length ? series : CV_SERIES} />
        <div className="cv-legend">
          {(series.length ? series : CV_SERIES).map((s) => <span key={s.key}><i style={s.reversed ? { border: `1.5px dashed ${s.color}`, background: "transparent" } : { background: s.color }} />{s.label}</span>)}
        </div>
        {(scope === "all" || scope === "walnut") && <Callout tone="warn" icon="PauseCircle">Walnut Creek's comp reset stopped accruing the week of Oct 19. Its control chart is outside the limit, and nothing accrues while a guardrail is amber.</Callout>}
        {(scope === "all" || scope === "berkeley") && <Callout tone="bad" icon="Undo2">Berkeley's Friday server cut was removed back to Aug 3, the day turn time started to slip, not the day anyone noticed. The $555 left every figure and was credited.</Callout>}
      </section>
      <section className="cv-card">
        <span className="cv-h4">The life of one saved dollar</span>
        <div className="cv-life">
          {[["Nothing yet", "Tuesday dinner", "In testing. Accrues nothing."], ["Accrues", "Thursday prep", "Window closed clean. Bills on the lower bound."], ["Decays", "None yet", "A short half-life accrues less, automatically."], ["Reverses", "Berkeley Friday", "Dollars leave from the day the metric turned."], ["Retires", "Jun 2027", "After 52 weeks it's held, not saved."], ["Is defended", "Later", "A held standard is worth what its drift would cost."]].map(([k, who, t]) => (
            <div key={k}><span style={{ fontWeight: 700 }}>{k}</span><span className="cv-xs" style={{ color: "var(--accent)", fontWeight: 600 }}>{who}</span><span className="k" style={{ lineHeight: 1.4 }}>{t}</span></div>
          ))}
        </div>
      </section>
      <Callout icon="ShieldCheck">Six rules, each one costs us money in the short run. Nothing accrues before its window closes. Nothing accrues while a guardrail is amber. One lever key per dollar. The invoice uses the lower bound. A reversal removes dollars retroactively. The annual total is capped at what your books show.</Callout>
    </div>
  );
}

/* ================================================================ Comparison */
const CV_CMP = [
  { k: "Labour, share of sales", u: "%", v: [25.3, 27.9, 24.1], better: "low", f: (x) => x.toFixed(1) + "%" },
  { k: "Margin per cover", u: "$", v: [13.41, 12.08, 13.92], better: "high", f: (x) => "$" + x.toFixed(2) },
  { k: "Comps and voids, share of sales", u: "%", v: [1.1, 1.4, 2.3], better: "low", f: (x) => x.toFixed(1) + "%" },
  { k: "Friday lunch ticket time", u: "min", v: [14, 19, 15], better: "low", f: (x) => x + " min" },
  { k: "Seat-hours used", u: "%", v: [31, 38, 27], better: "high", f: (x) => x + "%" },
  { k: "Banked per manager-hour", u: "$", v: [48, 0, 71], better: "high", f: (x) => "$" + x },
];
const CV_SHAPES = [
  { loc: "Oakland", draw: (x, y) => <circle cx={x} cy={y} r="6" fill="var(--cat-1)" /> },
  { loc: "Berkeley", draw: (x, y) => <rect x={x - 5.5} y={y - 5.5} width="11" height="11" fill="var(--cat-2)" /> },
  { loc: "Walnut Creek", draw: (x, y) => <path d={`M${x} ${y - 7} L${x + 7} ${y + 5} L${x - 7} ${y + 5} Z`} fill="var(--cat-3)" /> },
];
function CvComparison() {
  return (
    <div className="cv-page">
      <PageHead over="Comparison" q="Which of my rooms runs best?"
        sub="Your three rooms, compared with each other. Peer benchmarks unlock when there are 40 comparable rooms in the network. Until then, we won't pretend to compare you with rooms like yours." />
      <div className="cv-legend" style={{ fontSize: "var(--text-sm)" }}>
        {CV_SHAPES.map((s) => <span key={s.loc}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">{s.draw(8, 8)}</svg>Rosewood {s.loc}</span>)}
      </div>
      <section className="cv-card flush">
        {CV_CMP.map((m, idx) => {
          const lo = Math.min(...m.v), hi = Math.max(...m.v), pad = (hi - lo) * 0.25 || 1;
          const x = cvScale(lo - pad, hi + pad, 20, 380);
          const best = m.better === "low" ? m.v.indexOf(lo) : m.v.indexOf(hi);
          return (
            <div key={m.k} style={{ display: "grid", gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr) minmax(0, 260px)", gap: 16, alignItems: "center", padding: "14px 18px", borderTop: idx ? "1px solid var(--border)" : 0 }} className="cv-cmp-row">
              <div className="cv-col" style={{ gap: 2 }}><span style={{ fontWeight: 600 }}>{m.k}</span><span className="cv-xs cv-faint">{m.better === "low" ? "Lower is better" : "Higher is better"}</span></div>
              <svg className="cv-chart" viewBox="0 0 400 30" style={{ height: 30 }} aria-hidden="true">
                <line x1="20" x2="380" y1="15" y2="15" className="axis" />
                {m.v.map((v, i) => <g key={i}>{CV_SHAPES[i].draw(x(v), 15)}</g>)}
              </svg>
              <div className="cv-row nowrap" style={{ justifyContent: "flex-end", gap: 14 }}>
                {m.v.map((v, i) => (
                  <span key={i} className="cv-num cv-small" style={{ minWidth: 64, textAlign: "right", fontWeight: i === best ? 700 : 400 }}>
                    {i === best && <Icon name="Crown" size={12} style={{ marginRight: 4, color: "var(--accent)", verticalAlign: -1 }} />}{m.f(v)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>
      <Callout icon="Lightbulb">Walnut Creek gets the most out of each manager-hour, because its two labour changes both verified. Berkeley's only verified change reversed, so its figure is $0, and the ranker now weights Friday cuts at Berkeley lower.</Callout>
    </div>
  );
}

/* ================================================================ Sources */
const CV_FEEDS = [
  { name: "Toast", what: "Sales, items, voids, comps, covers", last: "2 minutes ago", state: "healthy", risk: 0 },
  { name: "7shifts", what: "Schedules and clock-ins", last: "18 hours ago", state: "stale", risk: 370, note: "The access token expired. Labour verification is degraded, which puts the Tuesday dinner test at risk.", fix: "Reconnect" },
  { name: "Recipe costs", what: "Plate costs, uploaded as CSV", last: "18 days ago", state: "stale", risk: CV_SALMON_WK, note: "Too old to price the salmon from. The plate-cost test is quarantined and the salmon price move can't verify.", fix: "Upload CSV" },
  { name: "Kitchen display", what: "Ticket times by station", last: "1 hour ago", state: "partial", risk: 0, note: "Exporting daily totals only, not each ticket. Ticket-time changes can be estimated, not measured.", fix: "Fix export" },
  { name: "Invoices", what: "Vendor invoices from your inbox", last: "3 days ago", state: "healthy", risk: 0 },
  { name: "QuickBooks Online", what: "Ledger, for reconciliation", last: "Sep 30 close", state: "healthy", risk: 0 },
  { name: "Waitlist", what: "Guests turned away or waiting", last: "Not connected", state: "off", risk: 0, note: "Without it, faster turns can never be claimed.", fix: "Connect" },
];
function CvSources() {
  const cv = useCv();
  const total = CV_FEEDS.reduce((s, f) => s + f.risk, 0);
  const tone = { healthy: ["good", "CircleCheck", "Healthy"], stale: ["warn", "Clock", "Stale"], partial: ["warn", "CircleDot", "Partial"], off: ["neutral", "CircleMinus", "Not connected"] };
  return (
    <div className="cv-page">
      <PageHead over="Sources · Rosewood Oakland" q="Can I trust these numbers?"
        sub="Freshness for each feed from its last successful sync, and the dollars each one puts at risk. If two feeds touch the same dollar, it's counted once, under the feed that would fix it first." />
      <div className="cv-grid g3">
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Feeds healthy</span><span className="cv-fig md">3 of 7</span></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Weekly value at risk</span><span className="cv-fig md cv-exp">{cvMoney(total)}</span><span className="cv-xs cv-faint">counted once across feeds</span></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Fixes that clear it</span><span className="cv-fig md">2</span><span className="cv-xs cv-faint">about 6 minutes</span></div>
      </div>
      <section className="cv-card flush">
        {CV_FEEDS.map((f, i) => {
          const [t, ic, lb] = tone[f.state];
          return (
            <div key={f.name} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, padding: "14px 18px", borderTop: i ? "1px solid var(--border)" : 0, alignItems: "center" }}>
              <div className="cv-col" style={{ gap: 4 }}>
                <div className="cv-row" style={{ gap: 8 }}><span style={{ fontWeight: 600 }}>{f.name}</span><Pill tone={t} icon={ic}>{lb}</Pill><span className="cv-xs cv-faint">Last success: {f.last}</span></div>
                <span className="cv-small cv-muted">{f.what}{f.note ? `. ${f.note}` : ""}</span>
              </div>
              <div className="cv-row" style={{ justifyContent: "flex-end" }}>
                {f.risk > 0 && <span className="cv-num cv-exp" style={{ fontWeight: 600 }}>{cvMoney(f.risk)}/wk at risk</span>}
                {f.fix && <Button size="sm" variant={f.risk ? "primary" : "secondary"} onClick={() => cv.toast(`${f.name}: ${f.fix.toLowerCase()} started.`)}>{f.fix}</Button>}
              </div>
            </div>
          );
        })}
      </section>
      <Callout icon="Info">There's no overall completeness score here on purpose. Today's 76% is a weighted average of twelve constants. It isn't 76% of records or 76% confidence, and a feed that stopped three weeks ago still reads healthy.</Callout>
    </div>
  );
}

/* ================================================================ System (agents) */
const CV_AGENTS = [
  ["Orchestration", "Routes work between agents and opens tasks", "Propose"],
  ["Data quality", "Watches every feed for staleness and gaps", "Read"],
  ["Opportunity detection", "Runs the detectors and resolves overlaps", "Propose"],
  ["Recommendation", "Ranks candidates by durable value per hour", "Propose"],
  ["Action planning", "Drafts the schedule, price or par change", "Draft"],
  ["Execution evidence", "Proves the change actually happened", "Read"],
  ["Experiment design", "Registers the measurement plan before the change", "Draft"],
  ["Control selection", "Finds matched services and items", "Read"],
  ["Measurement", "Runs the estimator when a window closes", "Read"],
  ["Guardrail", "Watches counter-metrics and drops autonomy on a breach", "Act within fence"],
  ["Verification decision", "Deterministic rules produce the verdict. Not an agent.", "Rules only"],
  ["Accounting reconciliation", "Bridges claims to the ledger and proposes mappings", "Propose"],
  ["Persistence monitoring", "Fits decay after verification and flags drift", "Read"],
  ["Operator copilot", "Answers the GM in plain language", "Read"],
  ["Accountant copilot", "Answers the controller with lineage", "Read"],
  ["Portfolio intelligence", "Learns which levers verify, across rooms", "Read"],
];
const CV_EVENTS = [
  ["Guardrail", "Tuesday dinner: turn time 47 min, inside the 52-minute guard"],
  ["Data quality", "7shifts: still no successful sync since 1:12 am"],
  ["Opportunity detection", "Ran 7 detectors on Oakland. No new findings above threshold"],
  ["Persistence monitoring", "Thursday prep: week 18 on target, decay rate 0.0"],
  ["Recommendation", "Re-ranked Oakland candidates after salmon refusal window"],
  ["Accounting reconciliation", "Proposed mapping 5010 and 5020 for purchasing, 92% confidence"],
  ["Execution evidence", "Tuesday dinner: 7shifts diff confirms 4 servers, Oct 20"],
  ["Control selection", "Matched 3 Berkeley Tuesdays for the Tuesday dinner test"],
  ["Orchestration", "Opened task: upload recipe costs, assigned to Maria Reyes"],
  ["Operator copilot", "Answered: \"Why is the salmon test stuck?\""],
];
const CV_LEVERS = [
  { k: "Labour", now: 2, earned: 3, need: "A4 needs a full quarter at A3 without an un-caught reversal" },
  { k: "Menu", now: 1, earned: 1, need: "A2 needs write access to Toast menus and a preview of the change" },
  { k: "Purchasing", now: 1, earned: 2, need: "A3 needs a verified renegotiation at this room" },
  { k: "Controls", now: 1, earned: 1, need: "A2 needs a measured comp rate at this room" },
  { k: "Throughput", now: 0, earned: 0, need: "A1 needs waitlist data, so a recommendation can rest on a measured figure" },
];
function CvSystem() {
  const [levels, setLevels] = React.useState(() => Object.fromEntries(CV_LEVERS.map((l) => [l.k, l.now])));
  const [feed, setFeed] = React.useState(() => CV_EVENTS.slice(0, 4).map((e, i) => ({ id: i, t: `7:1${4 - i} pm`, a: e[0], m: e[1] })));
  React.useEffect(() => {
    let n = 4;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const iv = setInterval(() => {
      const e = CV_EVENTS[n % CV_EVENTS.length];
      setFeed((f) => [{ id: n, t: "just now", a: e[0], m: e[1] }, ...f.map((x, i) => (i === 0 && x.t === "just now" ? { ...x, t: "7:15 pm" } : x))].slice(0, 12));
      n += 1;
    }, 3800);
    return () => clearInterval(iv);
  }, []);
  const LV = ["Observes", "Recommends", "Drafts", "Executes within a fence", "Holds the line"];
  return (
    <div className="cv-page wide">
      <PageHead over="System" q="Who is doing what, and how much rope do they have?"
        sub="Autonomy is granted per lever and per room, never globally. Each level is earned by evidence, and any guardrail breach drops that lever back to recommending." />
      <section className="cv-card">
        <div className="cv-card-head"><span className="cv-h4">Autonomy at Rosewood Oakland</span><span className="cv-small cv-faint">A0 observes · A1 recommends · A2 drafts · A3 executes within a fence · A4 holds the line</span></div>
        <div className="cv-col" style={{ gap: 14 }}>
          {CV_LEVERS.map((l) => (
            <div key={l.k} style={{ display: "grid", gridTemplateColumns: "minmax(0, 140px) minmax(0, 320px) minmax(0, 1fr)", gap: 16, alignItems: "center" }} className="cv-lever-row">
              <span style={{ fontWeight: 600 }}>{l.k}</span>
              <div className="cv-dial" role="radiogroup" aria-label={`${l.k} autonomy`}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <button key={i} role="radio" aria-checked={levels[l.k] === i} className={`${levels[l.k] === i ? "on" : ""} ${i <= l.earned ? "earned" : ""}`} disabled={i > l.earned}
                    title={i > l.earned ? l.need : LV[i]} onClick={() => setLevels((s) => ({ ...s, [l.k]: i }))}>A{i}</button>
                ))}
              </div>
              <span className="cv-small cv-muted">{LV[levels[l.k]]}. {l.earned < 4 ? l.need + "." : ""}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="cv-grid g2">
        <section className="cv-card flush">
          <div className="cv-row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", justifyContent: "space-between" }}>
            <span className="cv-h4">Sixteen roles</span><span className="cv-xs cv-faint">Most can only read or propose</span>
          </div>
          <div className="cv-tablewrap" style={{ maxHeight: 460, overflowY: "auto" }}>
            <table className="cv-table">
              <tbody>
                {CV_AGENTS.map(([n, w, a]) => (
                  <tr key={n}><td><div className="cv-col" style={{ gap: 2 }}><span style={{ fontWeight: 600 }}>{n}</span><span className="cv-xs cv-faint">{w}</span></div></td><td className="r"><Pill tone={a === "Act within fence" ? "warn" : a === "Rules only" ? "info" : "neutral"} icon={a === "Read" ? "Eye" : a === "Propose" ? "Lightbulb" : a === "Draft" ? "PenLine" : a === "Rules only" ? "Scale" : "Zap"}>{a}</Pill></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="cv-card flush">
          <div className="cv-row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", justifyContent: "space-between" }}>
            <span className="cv-h4">What they're doing</span><Pill icon="FlaskConical">Simulated</Pill>
          </div>
          <div className="cv-feed" aria-live="polite">
            {feed.map((e) => <div key={e.id} className="ev"><span className="t">{e.t}</span><span className="a">{e.a}</span><span className="m">{e.m}</span></div>)}
          </div>
        </section>
      </div>
      <Callout icon="Ban">Eleven things no agent may do, ever. Two of them: create a material account mapping without a named person, and book a saving that hasn't passed every gate. Automated changes carry the same proof burden as human ones.</Callout>
    </div>
  );
}

export { CvProof, CvPacket, CvAccountant, CvLedger, CvComparison, CvSources, CvSystem };
