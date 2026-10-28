'use client';

import * as React from 'react';

import { Icon, Button, Tabs } from '../kit';
import { CV_PAGES } from '../../lib/pages';
import { useCv, cvMoney, CV_NOW, CV_PERSIST, cvPlanCandidates, cvChoosePlan, CV_SALMON_WK, Claim, Pill, Callout, Interval, PageHead } from './core';
import { LoopStrip } from './areas';

/* Coversight — screens added in v2: First six weeks, Portfolio, Weekly meeting,
   Finding detail, Fences & alerts, Billing, the Ask panel, and the
   "What's missing" build view (platform gaps → waves → screens). */

/* ================================================================ platform gaps */
const CV_GAPS = [
  { n: 1, title: "Engine computes intervals and picks matched controls itself", state: "Interval is posted by a caller; the Rosewood row is inserted, not produced by the pipeline", value: "The whole \"bill on the lower bound\" promise", effort: "M", grade: "A", wave: 0 },
  { n: 2, title: "All 10 verification outcomes recorded", state: "3 of 10 expressible; \"couldn't tell\" and \"didn't work\" look the same", value: "Ranker learning; honest Proof", effort: "S", grade: "A", wave: 0 },
  { n: 3, title: "Per-feed freshness from last successful sync", state: "76% score averages twelve constants; a dead feed reads healthy", value: "Trust on first open", effort: "S", grade: "A", wave: 0 },
  { n: 4, title: "7shifts read + write-back", state: "Read-only; token goes stale", value: "Labour is the first lever ready for autonomy", effort: "M", grade: "A", wave: 1 },
  { n: 5, title: "Measured service rate replaces 14 covers/server-hour", state: "Constant; this room's best is 5.29", value: "Flips labour from 137 h idle to 37 h short", effort: "S", grade: "A", wave: 0 },
  { n: 6, title: "Invoice ingestion + price/mix decomposition", state: "No purchasing detector", value: "≈$1.3k per 28 days at Rosewood", effort: "M", grade: "B", wave: 3 },
  { n: 7, title: "Elasticity from the room's own price history", state: "Volume assumed to hold when price moves", value: "Menu goes from $11.9k claimed to ≈$1k real", effort: "M", grade: "B", wave: 3 },
  { n: 8, title: "Control-chart alerting with a stated false-alarm rate", state: "Drift found at month end", value: "Days, not quarters; no alert fatigue", effort: "M", grade: "B", wave: 1 },
  { n: 9, title: "QuickBooks Online + P&L bridge", state: "Specified, unbuilt", value: "A fee basis an accountant signs", effort: "L", grade: "B", wave: 4 },
  { n: 10, title: "Persistence and decay after verification", state: "No 26-week monitoring", value: "Stops counting one dollar forever", effort: "M", grade: "C", wave: 4 },
  { n: 11, title: "Approval, fence and autonomy records", state: "No agents exist; 10 of 16 greenfield", value: "Fewer manager-hours per banked dollar", effort: "L", grade: "C", wave: 2 },
  { n: 12, title: "Waitlist feed", state: "None, so faster turns are always $0", value: "≈$1k/mo ceiling at Rosewood", effort: "S", grade: "D", wave: 5 },
  { n: 13, title: "Invoicing on the reconciled figure, with credits", state: "No billing surface", value: "The commercial model, made visible", effort: "M", grade: "C", wave: 4 },
  { n: 14, title: "Notification service (one message per service)", state: "No push or SMS", value: "Service screen only works if the phone buzzes", effort: "M", grade: "B", wave: 1 },
  { n: 15, title: "Copilot answers only from records, with lineage", state: "\"Ask SKC\" button with no grounding contract", value: "Plain-language access without new risk", effort: "M", grade: "C", wave: 5 },
  { n: 16, title: "Kitchen display ticket-level export", state: "Hourly station averages only", value: "Ticket times measured, not estimated", effort: "S", grade: "C", wave: 3 },
  { n: 17, title: "Usage variance: depletion × recipe vs counts + invoices", state: "No theoretical-vs-actual; counts are monthly", value: "Waste, portioning and pours become a lever", effort: "M", grade: "B", wave: 3 },
  { n: 18, title: "Per-person exception limits (voids, comps, discounts)", state: "Comp chart exists for one bar; nothing per person", value: "Register leakage found in days, with a known false-alarm rate", effort: "S", grade: "B", wave: 1 },
  { n: 19, title: "Delivery statement ingestion + channel contribution", state: "Channel totals only; no commissions or refunds", value: "Channel pricing tests with takeout as control", effort: "M", grade: "C", wave: 3 },
  { n: 20, title: "Review and loyalty feeds", state: "Guest retention has no data", value: "Ties order errors to repeat visits", effort: "M", grade: "D", wave: 5 },
];
const CV_WAVES = [
  { w: 0, name: "Make the number real", weeks: "1–3", owner: "Engineer + Claude Code", done: "The Rosewood $97 comes out of the pipeline with an interval; a dead feed reads stale" },
  { w: 1, name: "Close the labour loop", weeks: "3–6", owner: "Engineer", done: "One real \"cut one server at 8\" approved on a phone writes back and opens a window" },
  { w: 2, name: "Weeks 0–6 and the meeting", weeks: "4–7", owner: "You (design) + Claude Code", done: "A new tenant gets useful value on day 1 with $0 banked" },
  { w: 3, name: "New levers", weeks: "6–10", owner: "Engineer", done: "Purchasing split reconciles to invoices to the cent; menu prices from data or refuses; usage gaps tie counts to invoices" },
  { w: 4, name: "The accountant", weeks: "10–14", owner: "Engineer + a pilot's controller", done: "One September-style package signed by a real controller; invoice cites it" },
  { w: 5, name: "Scale extras", weeks: "14+", owner: "Engineer", done: "Waitlist connected at one room; copilot answers cite records" },
];
const CV_PAGE_DEPS = {
  today: [3, 4], service: [4, 5, 8, 14], week: [1, 3, 8], portfolio: [1, 3, 8], meeting: [1, 8, 11], plan: [2, 7],
  finding: [2, 6, 7], menu: [7], labour: [4, 5], throughput: [12], purchasing: [6], proof: [1, 2], packet: [1, 2, 10],
  ledger: [1, 9, 10], accountant: [9], billing: [9, 13], comparison: [2], sources: [3], start: [3, 4, 6], fences: [11, 14], system: [11],
  coverage: [3, 16, 17, 18, 19, 20], inventory: [6, 17], kitchen: [12, 16], controls: [8, 18], channels: [19],
};
const CV_GRADE_TONE = { A: "bad", B: "warn", C: "info", D: "neutral" };

/* ================================================================ First six weeks */
function CvStart() {
  const cv = useCv();
  const steps = [
    { when: "Jul 6", k: "Connected Toast, 7shifts and your invoice inbox", s: "done" },
    { when: "Jul 7", k: "Built a baseline from 13 weeks of history", s: "done" },
    { when: "Jul 8", k: "First findings, as estimates", s: "done" },
    { when: "Jul 14", k: "First weekly plan chosen (2 manager-hours)", s: "done" },
    { when: "Jul 27", k: "First change starts: Tuesday close, back of house", s: "now" },
    { when: "Aug 10", k: "First checkpoint", s: "next" },
    { when: "Aug 24", k: "First window closes: first dollar you can bank", s: "next" },
  ];
  return (
    <div className="cv-page">
      <PageHead over="First six weeks · how Walnut Creek looked on Jul 20, two weeks after connecting" q="What do I get before anything is proven?"
        sub="Nothing is counted as saved until a test closes, and the first one takes about six weeks. So the first six weeks have to be useful on their own: findings, prevented costs, data fixes and tests in flight." />
      <div className="cv-grid g4">
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Banked so far</span><span className="cv-fig md">$0</span><span className="cv-xs cv-faint">Expected. Nothing counts until a window closes.</span></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Prevented so far</span><span className="cv-fig md cv-up">$96</span><div className="cv-row" style={{ gap: 6 }}><Claim k="obs" /><span className="cv-xs cv-faint">never counted as saved</span></div></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Findings</span><span className="cv-fig md cv-exp">5</span><div className="cv-row" style={{ gap: 6 }}><Claim k="est" /><span className="cv-xs cv-faint">$1,140/wk</span></div></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Data problems fixed</span><span className="cv-fig md">2</span><span className="cv-xs cv-faint">KDS export, recipe costs</span></div>
      </div>
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <span className="cv-h4">Where you are</span>
          <div className="cv-col" style={{ gap: 0 }}>
            {steps.map((s, i) => (
              <div key={s.k} style={{ display: "grid", gridTemplateColumns: "64px 22px minmax(0, 1fr)", gap: 10, alignItems: "start", padding: "8px 0" }}>
                <span className="cv-xs cv-num cv-faint" style={{ paddingTop: 2 }}>{s.when}</span>
                <Icon name={s.s === "done" ? "CircleCheck" : s.s === "now" ? "CircleDot" : "Circle"} size={18} color={s.s === "done" ? "var(--success-600)" : s.s === "now" ? "var(--accent)" : "var(--fg-3)"} />
                <span className="cv-small" style={{ fontWeight: s.s === "now" ? 700 : 400, color: s.s === "next" ? "var(--fg-2)" : "var(--fg-1)" }}>{s.k}{s.s === "now" && <span className="cv-faint" style={{ fontWeight: 400 }}> · you are here</span>}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Useful already</span>
          <ul className="cv-ul">
            <li><Icon name="ShieldCheck" size={15} />Two overtime moves before Thursday kept $96 of premium from happening. We show it, and we never bill it.</li>
            <li><Icon name="Truck" size={15} />Valley Greens raised romaine 29.7%. That's a phone call you can make today, no test needed.</li>
            <li><Icon name="Cable" size={15} />Your kitchen display was exporting hourly averages only. Fixed, so ticket times can now be measured.</li>
            <li><Icon name="Timer" size={15} />The first test is registered before it starts, so nobody can move the goalposts later.</li>
          </ul>
          <Callout icon="Info">Slow on purpose. A restaurant week is noisy, and a saving has to stand out from an ordinary busy or quiet night before we'll put it on an invoice.</Callout>
        </section>
      </div>
      <section className="cv-card">
        <span className="cv-h4">Setup checklist</span>
        <div className="cv-grid g3">
          {[["Toast", "Connected", true], ["7shifts", "Connected, write-back on", true], ["Invoice inbox", "Forwarding set up", true], ["Recipe costs, top 15 items", "Uploaded Jul 9", true], ["QuickBooks Online", "Connect for reconciliation", false], ["Fences", "Set your limits", false]].map(([k, v, ok]) => (
            <div key={k} className="cv-row nowrap" style={{ gap: 10, alignItems: "flex-start" }}>
              <Icon name={ok ? "CircleCheck" : "Circle"} size={18} color={ok ? "var(--success-600)" : "var(--fg-3)"} />
              <div className="cv-col" style={{ gap: 2 }}><span style={{ fontWeight: 600 }}>{k}</span><span className="cv-xs cv-faint">{v}</span></div>
            </div>
          ))}
        </div>
        <div className="cv-row"><Button size="sm" onClick={() => cv.go("fences")}>Set your fences</Button><Button size="sm" variant="secondary" onClick={() => cv.go("sources")}>See every feed</Button></div>
      </section>
    </div>
  );
}

/* ================================================================ Portfolio */
const CV_ROOMS = [
  { id: "oakland", name: "Oakland", banked: 97, earned: 18940, alarms: 0, tests: 1, stale: 2, note: "Tuesday dinner test, checkpoint 1 of 2" },
  { id: "berkeley", name: "Berkeley", banked: 0, earned: 14210, alarms: 0, tests: 0, stale: 1, note: "Friday server cut reversed; expo test inconclusive" },
  { id: "walnut", name: "Walnut Creek", banked: 382, earned: 16880, alarms: 1, tests: 0, stale: 0, note: "Comp reset paused: control chart outside its limit" },
];
function CvPortfolio() {
  const cv = useCv();
  const banked = CV_ROOMS.reduce((s, r) => s + r.banked, 0);
  const earned = CV_ROOMS.reduce((s, r) => s + r.earned, 0);
  return (
    <div className="cv-page wide">
      <PageHead over={`Rosewood Restaurant Group · ${CV_NOW.week}`} q="How are all three rooms doing this week?"
        sub="One line per room, so an owner with several rooms sees where to spend this week's attention." />
      <div className="cv-grid g3">
        <div className="cv-card" style={{ gap: 6 }}><div className="cv-row" style={{ justifyContent: "space-between" }}><span className="cv-xs cv-faint">Banked this week, all rooms</span><Claim k="book" /></div><span className="cv-fig lg cv-up">{cvMoney(banked)}</span><span className="cv-xs cv-faint">Walnut Creek's $88 comp reset is paused this week</span></div>
        <div className="cv-card" style={{ gap: 6 }}><div className="cv-row" style={{ justifyContent: "space-between" }}><span className="cv-xs cv-faint">Earned this week, all rooms</span><Claim k="obs" /></div><span className="cv-fig lg">{cvMoney(earned)}</span><span className="cv-xs cv-faint">Contribution margin from your registers</span></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Needs your attention</span><span className="cv-fig lg">2</span><span className="cv-xs cv-faint">1 alarm · 3 stale feeds across 2 rooms</span></div>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Room</th><th className="r">Banked /wk</th><th className="r">Earned /wk</th><th>Alarms</th><th>Tests in flight</th><th>Feeds</th><th>What's happening</th></tr></thead>
            <tbody>
              {CV_ROOMS.map((r) => (
                <tr key={r.id} className="cv-tr" onClick={() => cv.go("proof")}>
                  <td style={{ fontWeight: 600 }}>Rosewood {r.name}</td>
                  <td className="r">{cvMoney(r.banked)}</td>
                  <td className="r">{cvMoney(r.earned)}</td>
                  <td>{r.alarms ? <Pill tone="warn" icon="Siren">{r.alarms} alarm</Pill> : <Pill tone="good" icon="ShieldCheck">Quiet</Pill>}</td>
                  <td className="cv-num">{r.tests}</td>
                  <td>{r.stale ? <Pill tone="warn" icon="Clock">{r.stale} stale</Pill> : <Pill tone="good" icon="CircleCheck">Healthy</Pill>}</td>
                  <td className="cv-small cv-muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Callout icon="Lightbulb">Berkeley earns the least and has nothing banked. This week's best use of your time there is fixing the KDS export, so the next ticket-time test can actually be measured.</Callout>
    </div>
  );
}

/* ================================================================ Weekly meeting */
const CV_AGENDA = [
  { k: "What banked", mins: 2, icon: "BadgeCheck", body: "$97 at Oakland from Thursday prep, week 18 and holding. Walnut Creek's Tuesday close added $382. Nothing new verified, nothing reversed.", go: "ledger" },
  { k: "What alarmed", mins: 3, icon: "Siren", body: "Walnut Creek bar comps crossed the control limit on the Saturday Oct 17 close. Same bartender on 4 of 5 excursions. Accrual on the comp reset is paused.", go: "proof" },
  { k: "In flight", mins: 3, icon: "Timer", body: "Tuesday dinner with five servers: checkpoint 1 of 2 passed, turn time 47 min against the 52-minute guard. Window closes Nov 3.", go: "proof" },
  { k: "One decision", mins: 5, icon: "Gavel", body: `Raise the salmon from $28 to $30? About ${cvMoney(CV_SALMON_WK)}/wk, 61% chance it verifies. It needs current recipe costs first.`, decision: true },
  { k: "Commit this week's plan", mins: 2, icon: "Route", body: "Three actions fit 2 manager-hours: salmon price, ribeye price, renegotiate salmon and romaine.", go: "plan" },
];
function CvMeeting() {
  const cv = useCv();
  const [i, setI] = React.useState(-1);
  const [left, setLeft] = React.useState(0);
  const [decision, setDecision] = React.useState(null);
  const [log, setLog] = React.useState([]);
  React.useEffect(() => {
    if (i < 0 || i >= CV_AGENDA.length) return;
    setLeft(CV_AGENDA[i].mins * 60);
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [i]);
  const next = () => {
    setLog((l) => [...l, CV_AGENDA[i].k + (CV_AGENDA[i].decision ? `: ${decision || "deferred"}` : "")]);
    setI(i + 1);
  };
  const done = i >= CV_AGENDA.length;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="cv-page" style={{ maxWidth: 900 }}>
      <PageHead over="Tuesday 9:00 · Owner + GM · 15 minutes" q="The weekly meeting"
        sub="A fixed agenda the product fills in. You leave with one decision made and the week's plan committed."
        right={i < 0 ? <Button icon="Play" onClick={() => setI(0)}>Start the meeting</Button> : done ? <Pill tone="good" icon="CircleCheck">Finished in 15 min</Pill> : <span className="cv-fig md">{fmt(left)}</span>} />
      <section className="cv-card flush">
        {CV_AGENDA.map((a, n) => {
          const state = i < 0 ? "wait" : n < i ? "done" : n === i ? "now" : "wait";
          return (
            <div key={a.k} style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr) auto", gap: 14, padding: "16px 18px", borderTop: n ? "1px solid var(--border)" : 0, background: state === "now" ? "var(--accent-subtle)" : "transparent", alignItems: "start" }}>
              <span className={`cv-q-ico ${state === "done" ? "good" : state === "now" ? "accent" : ""}`}><Icon name={state === "done" ? "Check" : a.icon} size={18} /></span>
              <div className="cv-col" style={{ gap: 6 }}>
                <div className="cv-row" style={{ gap: 8 }}><span style={{ fontWeight: 700 }}>{a.k}</span><span className="cv-xs cv-faint cv-num">{a.mins} min</span></div>
                <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{a.body}</span>
                {a.decision && state === "now" && (
                  <div className="cv-row" style={{ gap: 6 }}>
                    {["Approve $30 after recipes upload", "Hold for two weeks", "Not for us"].map((d) => (
                      <Button key={d} size="sm" variant={decision === d ? "primary" : "secondary"} onClick={() => setDecision(d)}>{d}</Button>
                    ))}
                  </div>
                )}
              </div>
              <div className="cv-row" style={{ gap: 6 }}>
                {a.go && <Button size="sm" variant="ghost" onClick={() => cv.go(a.go)}>Open</Button>}
                {state === "now" && <Button size="sm" onClick={next} disabled={a.decision && !decision}>{n === CV_AGENDA.length - 1 ? "Finish" : "Next"}</Button>}
              </div>
            </div>
          );
        })}
      </section>
      {done && (
        <section className="cv-card">
          <span className="cv-h4">Logged from this meeting</span>
          <ul className="cv-ul">{log.map((l) => <li key={l}><Icon name="Check" size={15} />{l}</li>)}</ul>
          <span className="cv-small cv-muted">Sent to Maria and Marcus. The plan is committed, and the salmon decision is on Thursday's queue.</span>
          <Button size="sm" variant="secondary" onClick={() => { setI(-1); setLog([]); setDecision(null); }}>Reset the demo</Button>
        </section>
      )}
      <div className="cv-grid g3">
        {[["Meetings held", "7 of last 8"], ["Average length", "14 min"], ["Decisions made per meeting", "1.3"]].map(([k, v]) => (
          <div key={k} className="cv-card" style={{ gap: 4 }}><span className="cv-xs cv-faint">{k}</span><span className="cv-fig md">{v}</span></div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================ Finding detail */
const CV_FINDING_EVIDENCE = {
  salmon: { detector: "Menu margin + price response", evidence: [["Weeks observed", "13"], ["Price changes in your history", "4 ($24 → $26 → $27 → $28)"], ["Food cost now", "43%, up from 34% before the vendor increase"], ["Price response", "−0.80 ± 0.30"], ["Where lost orders go", "31% to the ribeye, which earns more"], ["Repeats", "3 weeks running"]],
    overlap: "The vendor price rise on salmon is counted first. This price move is valued after it, so one dollar can't be claimed by both findings." },
  ribeye: { detector: "Menu margin + price response", evidence: [["Weeks observed", "13"], ["Price changes in your history", "3 ($38 → $40 → $42)"], ["Price response", "−0.31 ± 0.14"], ["Units after the last rise", "−2% vs matched weeks"], ["Repeats", "3 weeks running"]],
    overlap: "No other finding touches the ribeye." },
  vendor: { detector: "Invoice price/mix decomposition", evidence: [["Invoices read", "14 months"], ["Salmon, unit price", "$11.40 → $13.65 per lb"], ["Romaine, unit price", "$38.00 → $49.29 per case"], ["Vendor's share of the increase", "$1,286 per 28 days"], ["Typical win-back", "60%"]],
    overlap: "Counted before the salmon price move, which is valued net of it." },
};
function CvFinding({ params }) {
  const cv = useCv();
  const cands = cvPlanCandidates();
  const c = cands.find((x) => x.id === (params && params.id)) || cands[0];
  const ev = CV_FINDING_EVIDENCE[c.id];
  const { chosen } = cvChoosePlan(cands, 2);
  return (
    <div className="cv-page">
      <button className="cv-link" onClick={() => cv.go("plan")}><Icon name="ArrowLeft" size={14} />The plan</button>
      <PageHead over={`Finding · ${c.lever} · Rosewood Oakland`} q={c.title} right={chosen.has(c.id) ? <Pill tone="good" icon="Check">Chosen this week</Pill> : <Pill icon="Clock">Not chosen this week</Pill>} />
      <LoopStrip stage={chosen.has(c.id) ? "act" : "understand"} notes={{ detect: ev ? ev.detector : "Found in your data", understand: c.claim === "obs" ? "Read straight from your systems" : "Modelled from your own history", act: chosen.has(c.id) ? "In this week's plan" : "Waiting for manager time", verify: c.prevent ? "Prevented cost: never counted" : `${Math.round(c.p * 100)}% chance it verifies` }} />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">Expected effect</span><Claim k={c.claim} /></div>
          <span className="cv-fig lg">{cvMoney(Math.round(c.value))}/wk</span>
          {c.hi > c.lo && <Interval lo={Math.round(c.lo)} pt={Math.round(c.value)} hi={Math.round(c.hi)} min={0} max={Math.round(c.hi * 1.25)} billedLabel="if it verifies" />}
          <p className="cv-small" style={{ lineHeight: 1.55 }}>{c.why}</p>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Why it ranks where it does</span>
          <dl className="cv-kv">
            <dt>Chance it verifies</dt><dd>{Math.round(c.p * 100)}%</dd>
            <dt>How long it lasts</dt><dd style={{ fontFamily: "var(--font-sans)" }}>{CV_PERSIST[c.persist].label}</dd>
            <dt>Manager time</dt><dd>{c.hours * 60} min</dd>
            <dt>Value per manager-hour</dt><dd>{cvMoney(Math.round(c.perHour))}</dd>
          </dl>
          <span className="cv-xs cv-faint">{chosen.has(c.id) ? "It fits inside this week's 2 manager-hours." : "Higher-value-per-hour actions filled this week's 2 manager-hours first."}</span>
        </section>
      </div>
      {ev ? (
        <div className="cv-grid g2">
          <section className="cv-card">
            <span className="cv-h4">Evidence · {ev.detector}</span>
            <dl className="cv-kv">{ev.evidence.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
          </section>
          <section className="cv-card">
            <span className="cv-h4">Overlap with other findings</span>
            <Callout icon="Layers">{ev.overlap}</Callout>
            <span className="cv-xs cv-faint">One lever key per dollar. Overlapping findings can't both claim it.</span>
          </section>
        </div>
      ) : <Callout icon="Info">Detailed evidence for this finding isn't filled in for the mockup. In the product, every finding shows the rows it was computed from.</Callout>}
      <div className="cv-row">
        {c.id === "ribeye" && <Button onClick={() => cv.approve("ribeye")}>Review the price change</Button>}
        <Button variant="secondary" onClick={() => cv.toast("Dismissed for 90 days. The ranker will learn from it.")}>Not for us</Button>
      </div>
    </div>
  );
}

/* ================================================================ Fences & alerts */
function CvFences() {
  const cv = useCv();
  const [f, setF] = React.useState({ minDinner: 4, minAny: 3, cutBy: "8:30 pm", lockHours: 24, maxPrice: 8, priceGap: 6, maxPar: 15 });
  const [al, setAl] = React.useState({ push: true, sms: true, email: false, onePerService: true, quiet: true });
  const num = (k, label, unit, min, max) => (
    <div className="cv-row nowrap" style={{ justifyContent: "space-between", gap: 12 }}>
      <label htmlFor={`f-${k}`} className="cv-small">{label}</label>
      <div className="cv-row nowrap" style={{ gap: 6 }}>
        <input id={`f-${k}`} type="number" min={min} max={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: +e.target.value })} className="input"
          style={{ width: 72, height: 32, padding: "0 8px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--fg-1)", font: "inherit", textAlign: "right" }} />
        <span className="cv-xs cv-faint" style={{ width: 56 }}>{unit}</span>
      </div>
    </div>
  );
  const tog = (k, label, sub) => (
    <label className="cv-row nowrap" style={{ justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
      <span className="cv-col" style={{ gap: 2 }}><span className="cv-small">{label}</span>{sub && <span className="cv-xs cv-faint">{sub}</span>}</span>
      <input id={`a-${k}`} type="checkbox" checked={al[k]} onChange={(e) => setAl({ ...al, [k]: e.target.checked })} style={{ width: 18, height: 18, accentColor: "var(--primary)" }} />
    </label>
  );
  return (
    <div className="cv-page">
      <PageHead over="Fences & alerts · Rosewood Oakland" q="What may the system do without asking, and when does it speak up?"
        sub="Fences are hard limits. Every draft and every automated change is checked against them, and a breach drops that lever back to recommending." />
      <div className="cv-grid g2">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Labour</span><Pill icon="Gauge">A2 · Drafts</Pill></div>
          {num("minDinner", "Fewest servers on dinner", "servers", 1, 10)}
          {num("minAny", "Fewest servers at any open hour", "servers", 1, 10)}
          {num("lockHours", "No schedule change within", "hours", 0, 72)}
          <div className="cv-row nowrap" style={{ justifyContent: "space-between" }}>
            <label htmlFor="f-cutBy" className="cv-small">Latest same-night cut</label>
            <select id="f-cutBy" value={f.cutBy} onChange={(e) => setF({ ...f, cutBy: e.target.value })} className="input" style={{ height: 32, borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--fg-1)", font: "inherit", padding: "0 8px" }}>
              {["7:30 pm", "8:00 pm", "8:30 pm", "9:00 pm"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Menu and purchasing</span><Pill icon="Gauge">A1 · Recommends</Pill></div>
          {num("maxPrice", "Largest single price move", "%", 1, 25)}
          {num("priceGap", "Weeks between moves on one item", "weeks", 1, 26)}
          {num("maxPar", "Largest par change at once", "%", 1, 50)}
          <span className="cv-xs cv-faint">Price changes are always recommended, never automatic, until the lever earns A2.</span>
        </section>
        <section className="cv-card">
          <span className="cv-h4">How we reach you</span>
          {tog("push", "Push to the app", "Service suggestions and guardrail breaches")}
          {tog("sms", "Text message", "Guardrail breaches only")}
          {tog("email", "Email", "Weekly summary")}
        </section>
        <section className="cv-card">
          <span className="cv-h4">Keeping it quiet</span>
          {tog("onePerService", "At most one message per service", "Alert fatigue is what kills engagement")}
          {tog("quiet", "Silent when nothing crosses a limit", "Control charts target about one false alarm a quarter")}
          <Callout icon="Users">The GM gets service and labour messages. The owner gets alarms and the weekly summary. The controller gets period packages only.</Callout>
        </section>
      </div>
      <div className="cv-row"><Button icon="Check" onClick={() => cv.toast("Fences saved as version 4, effective now. Drafts re-check them every time.")}>Save fences</Button><span className="cv-xs cv-faint">Every change is versioned and shown on the verification packets it affects.</span></div>
    </div>
  );
}

/* ================================================================ Billing */
function CvBilling() {
  const fee = 0.15;
  const months = [["July", 430], ["August", 867], ["September", 1863]];
  const sub = 349 * 3;
  const sept = 1863;
  const total = sub + sept * fee;
  return (
    <div className="cv-page">
      <PageHead over="Billing · Rosewood Restaurant Group" q="What did we charge, and on what?"
        sub="The fee is charged on reconciled savings: the lesser of our measured lower bound and what your books show. Never on an estimate, never on a point estimate." />
      <Callout tone="warn" icon="FlaskConical">Example terms for the mockup: $349 per room per month, plus 15% of reconciled savings. Swap in your real pricing.</Callout>
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
        <div className="cv-tablewrap">
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

/* ================================================================ Ask panel */
const CV_ASK = [
  { q: "Why is the salmon test stuck?", a: "Recipe costs are 18 days old, so we can't tell what a salmon plate costs now. The test is quarantined, not failed. Upload this week's costs and it resumes; its window restarts from the upload.", src: [["Recipe costs", "uploaded Oct 9"], ["Verification packet · salmon plate cost", "data failure"]], go: "sources" },
  { q: "How do you know the $97 is real?", a: "Nine Thursdays after the change were compared with nine matched Thursdays at Berkeley and Walnut Creek that didn't change. The measured effect is $97 to $127 a week. We bill on $97, the bottom of that range.", src: [["Verification packet · Thursday prep", "12 of 12 gates"], ["7shifts schedules", "18 hours ago"]], go: "packet" },
  { q: "What should I do first this week?", a: "Raise the salmon to $30, but upload recipe costs first, or it can't verify. Then the ribeye to $44. Then call Bay Fish Co. and Valley Greens. Those three fit in about 2 manager-hours.", src: [["The plan", "ranked by value per hour"]], go: "plan" },
  { q: "Why are faster table turns worth $0?", a: "The room was full for five 15-minute intervals all week. Outside those, a faster turn seats nobody new. And without waitlist data we can't show anyone was turned away, so we claim nothing.", src: [["Toast · seat-hours", "2 min ago"]], go: "throughput" },
  { q: "Did Berkeley's server cut work?", a: "It looked like it for three weeks, then table turns slipped to 54 minutes against your 52-minute guard. We reversed it, removed $555 back to Aug 3, and the ranker now trusts Friday cuts at Berkeley less.", src: [["Verification packet · Berkeley Friday", "reversed Aug 24"]], go: "proof" },
];
function CvAsk({ onClose, go }) {
  const [sel, setSel] = React.useState(null);
  const [text, setText] = React.useState("");
  const [free, setFree] = React.useState(false);
  React.useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const item = sel != null ? CV_ASK[sel] : null;
  return (
    <>
      <div className="cv-scrim" onClick={onClose} />
      <aside className="cv-drawer" role="dialog" aria-label="Ask">
        <div className="hd">
          <div className="cv-col" style={{ gap: 4 }}><span className="cv-h3">Ask</span><span className="cv-xs cv-faint">Answers come only from your records, and each one shows which.</span></div>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        <div className="bd">
          {!item && !free && (
            <div className="cv-col" style={{ gap: 8 }}>
              <span className="cv-over">Try one</span>
              {CV_ASK.map((x, n) => (
                <button key={x.q} className="cv-pop opt" style={{ position: "static", boxShadow: "none", border: "1px solid var(--border)", padding: "10px 12px", minWidth: 0 }} onClick={() => setSel(n)}>
                  <Icon name="MessageCircle" size={15} />{x.q}
                </button>
              ))}
            </div>
          )}
          {item && (
            <div className="cv-col" style={{ gap: 14 }}>
              <span style={{ fontWeight: 700 }}>{item.q}</span>
              <p className="cv-small" style={{ lineHeight: 1.6 }}>{item.a}</p>
              <div className="cv-col" style={{ gap: 6 }}>
                <span className="cv-over">Records used</span>
                <dl className="cv-kv">{item.src.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd style={{ fontFamily: "var(--font-sans)" }}>{v}</dd></React.Fragment>)}</dl>
              </div>
              <div className="cv-row"><Button size="sm" onClick={() => { onClose(); go(item.go); }}>Open it</Button><Button size="sm" variant="ghost" onClick={() => setSel(null)}>Ask something else</Button></div>
            </div>
          )}
          {free && (
            <div className="cv-col" style={{ gap: 12 }}>
              <Callout icon="Info">This mockup answers the suggested questions. In the product, every answer cites the records it used, and when no record supports an answer it says so instead of guessing.</Callout>
              <Button size="sm" variant="ghost" onClick={() => { setFree(false); setText(""); }}>Back to suggestions</Button>
            </div>
          )}
          <form className="cv-row nowrap" style={{ marginTop: "auto", gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) { setSel(null); setFree(true); } }}>
            <input id="cv-ask" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your rooms" className="input"
              style={{ flex: 1, height: 38, padding: "0 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--fg-1)", font: "inherit", minWidth: 0 }} />
            <Button type="submit" icon="ArrowUp" aria-label="Ask" />
          </form>
        </div>
      </aside>
    </>
  );
}

/* ================================================================ What's missing (build view) */
function CvBuild({ focus, onOpen }) {
  const [grade, setGrade] = React.useState("all");
  const deps = focus ? CV_PAGE_DEPS[focus] || [] : null;
  const gaps = CV_GAPS.filter((g) => (grade === "all" || g.grade === grade) && (!deps || deps.includes(g.n)));
  const screensFor = (n) => Object.entries(CV_PAGE_DEPS).filter(([, d]) => d.includes(n)).map(([p]) => p);
  const counts = ["A", "B", "C", "D"].map((g) => [g, CV_GAPS.filter((x) => x.grade === g).length]);
  return (
    <div className="scroll" style={{ height: "100%", overflowY: "auto" }}>
      <div className="cv-page wide">
        <PageHead over="Build plan" q="What has to be built before the finished screens are real?"
          sub="The finished product is the front of the house. These are the platform gaps behind it, graded by what they block, in the order to build them. Every screen lists the gaps it depends on." />
        {deps && (
          <Callout tone="info" icon="Filter">
            <span>Showing the {deps.length === 1 ? "one gap" : `${deps.length} gaps`} behind <b>{CV_PAGES[focus].title}</b>. <button className="cv-link" onClick={() => onOpen(null)}>Show all gaps</button></span>
          </Callout>
        )}
        <div className="cv-grid g4">
          {counts.map(([g, n]) => (
            <div key={g} className="cv-card" style={{ gap: 6 }}>
              <div className="cv-row" style={{ justifyContent: "space-between" }}><Pill tone={CV_GRADE_TONE[g]} icon="Flag">Grade {g}</Pill><span className="cv-fig md">{n}</span></div>
              <span className="cv-xs cv-faint">{{ A: "Blocks the core promise. Do now.", B: "Needed before paying pilots.", C: "Needed to scale.", D: "Later." }[g]}</span>
            </div>
          ))}
        </div>
        <section className="cv-card flush">
          <div className="cv-row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", justifyContent: "space-between" }}>
            <span className="cv-h4">Platform gaps</span>
            <Tabs value={grade} onChange={setGrade} tabs={[{ value: "all", label: "All" }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }, { value: "D", label: "D" }]} />
          </div>
          <div className="cv-tablewrap">
            <table className="cv-table">
              <thead><tr><th>#</th><th>Gap</th><th>Today</th><th>Value at stake</th><th>Effort</th><th>Grade</th><th>Wave</th><th>Screens it unblocks</th></tr></thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.n}>
                    <td className="n">{g.n}</td>
                    <td style={{ fontWeight: 600, minWidth: 220 }}>{g.title}</td>
                    <td className="cv-small cv-muted" style={{ minWidth: 200 }}>{g.state}</td>
                    <td className="cv-small" style={{ minWidth: 170 }}>{g.value}</td>
                    <td className="n">{g.effort}</td>
                    <td><Pill tone={CV_GRADE_TONE[g.grade]} icon="Flag">{g.grade}</Pill></td>
                    <td className="n">{g.wave}</td>
                    <td style={{ minWidth: 180 }}>
                      <div className="cv-row" style={{ gap: 4 }}>
                        {screensFor(g.n).map((p) => <button key={p} className="cv-link" style={{ fontSize: "var(--text-xs)" }} onClick={() => onOpen(p, true)}>{CV_PAGES[p].title}</button>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="cv-card flush">
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><span className="cv-h4">Build waves</span></div>
          <div className="cv-tablewrap">
            <table className="cv-table">
              <thead><tr><th>Wave</th><th>Weeks</th><th>Gaps</th><th>Owner</th><th>Done when</th></tr></thead>
              <tbody>
                {CV_WAVES.map((w) => (
                  <tr key={w.w}>
                    <td style={{ fontWeight: 600, minWidth: 180 }}>{w.w} · {w.name}</td>
                    <td className="n">{w.weeks}</td>
                    <td className="n">{CV_GAPS.filter((g) => g.wave === w.w).map((g) => g.n).join(", ") || (w.w === 2 ? "screens" : "—")}</td>
                    <td className="cv-small">{w.owner}</td>
                    <td className="cv-small cv-muted" style={{ minWidth: 260 }}>{w.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="cv-card flush">
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><span className="cv-h4">Screens and what they wait on</span></div>
          <div className="cv-tablewrap">
            <table className="cv-table">
              <thead><tr><th>Screen</th><th>Gaps</th><th>Worst grade</th><th /></tr></thead>
              <tbody>
                {Object.entries(CV_PAGE_DEPS).map(([p, d]) => {
                  const worst = ["A", "B", "C", "D"].find((g) => d.some((n) => CV_GAPS[n - 1].grade === g));
                  return (
                    <tr key={p}>
                      <td style={{ fontWeight: 600 }}>{CV_PAGES[p].title}{CV_PAGES[p].added && <span className="cv-xs" style={{ marginLeft: 8, color: "var(--teal-700)", fontWeight: 700 }}>ADDED IN {CV_PAGES[p].added === true ? "V2" : CV_PAGES[p].added}</span>}</td>
                      <td className="n">{d.join(", ")}</td>
                      <td><Pill tone={CV_GRADE_TONE[worst]} icon="Flag">{worst}</Pill></td>
                      <td className="r"><button className="cv-link" onClick={() => onOpen(p, true)}>Open screen <Icon name="ArrowRight" size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export { CV_GAPS, CV_WAVES, CV_PAGE_DEPS, CV_GRADE_TONE, CvStart, CvPortfolio, CvMeeting, CvFinding, CvFences, CvBilling, CvAsk, CvBuild };
