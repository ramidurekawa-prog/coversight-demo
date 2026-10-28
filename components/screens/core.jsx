'use client';

import * as React from 'react';

import { Icon, Button } from '../kit';
import { LOCS, NOW, SEED } from '../../lib/data/seed';
import * as M from '../../lib/data/model';

/* Coversight demo core: the current room's data (loaded from lib/data),
   money helpers, claim chips, derivation drawer, approval modal and shared
   chart bits. Nothing is fetched; the dataset is generated and deterministic. */

const CvCtx = React.createContext(null);
const useCv = () => React.useContext(CvCtx);

/* ---------------------------------------------------------------- formatting */
const cvMoney = M.money;
const cvPct = (n, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
const cvRound = (n) => Math.round(n);

/* ---------------------------------------------------------------- the data
   Everything below the formatting helpers is loaded from the dataset by
   cvLoad(ds, roomId): the room switcher and the data inputs call it again and
   every screen re-renders from the new values. The exports are live bindings,
   so importers always read the current room. */
const CV_NOW = NOW;
const CV_ACCRUAL_START = M.ACCRUAL_START;
const CV_DAYS_TO_DATE = M.DAYS_TO_DATE;
const CV_SUB = M.SUBSCRIPTION;
const CV_LOCS = LOCS;
const CV_PERSIST = M.PERSIST;
const cvPriceMove = M.priceMove;
const cvPriceMoveInterval = M.priceMoveInterval;
const cvChoosePlan = M.choosePlan;

let CV_DS, CV_D, CV_GROUP, CV_ROOM;
let CV_MENU, CV_CM_UNWEIGHTED, CV_CM_WEIGHTED, CV_INVOICES, CV_PRICE_LEG, CV_MIX_LEG;
let CV_EXPOSURE, CV_SALMON, CV_SALMON_WK, CV_SALMON_LOST, CV_PROOF, CV_DAILY;
let CV_DERIV = {};
let CV_APPROVALS = {};

/** Candidates for the current room this week, valued from its data. */
function cvPlanCandidates() { return CV_D.candidates; }

function cvLoad(ds, roomId) {
  CV_DS = ds;
  CV_D = M.deriveRoom(ds, roomId);
  CV_GROUP = M.deriveGroup(ds);
  CV_ROOM = CV_D.profile;
  CV_MENU = CV_D.menu.menu;
  CV_CM_UNWEIGHTED = CV_D.menu.cmUnweighted;
  CV_CM_WEIGHTED = CV_D.menu.cmWeighted;
  CV_INVOICES = CV_D.inv.invoices;
  CV_PRICE_LEG = CV_D.inv.priceLeg;
  CV_MIX_LEG = CV_D.inv.mixLeg;
  CV_EXPOSURE = CV_D.exposure;
  const salmon = CV_MENU.find((m) => m.key === "salmon");
  CV_SALMON = cvPriceMoveInterval(salmon, salmon.price + 2);
  CV_SALMON_WK = Math.round(CV_SALMON.delta);
  CV_SALMON_LOST = Math.round(CV_SALMON.lost);
  CV_PROOF = CV_D.allProof;
  CV_DAILY = CV_D.banked.daily;
  CV_DERIV = buildDeriv(CV_D);
  CV_APPROVALS = buildApprovals(CV_D);
}

const CV_OUTCOME = {
  verified: { label: "Verified", tone: "good", icon: "BadgeCheck" },
  limited: { label: "Verified with limitations", tone: "good", icon: "BadgeCheck" },
  testing: { label: "In testing", tone: "info", icon: "Timer" },
  data: { label: "Data failure", tone: "warn", icon: "DatabaseZap" },
  reversed: { label: "Reversed", tone: "bad", icon: "Undo2" },
  inconclusive: { label: "Inconclusive", tone: "neutral", icon: "CircleHelp" },
  directional: { label: "Directionally positive", tone: "neutral", icon: "TrendingUp" },
};

/** Text with {tokens} filled from the current room. */
function cvFill(str) { return M.tmpl(str, CV_D.tokens); }

/* ---------------------------------------------------------------- derivations
   Every dollar on screen can open one of these. */
function buildDeriv(d) {
  const room = d.profile;
  const w = d.week;
  const b = d.banked;
  const lead = b.lead;
  const out = {
    "banked-week": {
      title: "Banked this week", value: cvMoney(b.week), claim: "book",
      formula: `Σ over active verifications of (weekly lower bound ÷ 7) × persistence(t)\n= ${b.live.length ? b.live.map((p) => `(${p.bookable} ÷ 7) × 1.00 × 7 days`).join(" + ") : "nothing accruing"}\n= ${cvMoney(b.week)}`,
      inputs: [[`Active verifications at ${room.short}`, String(b.live.length)], ...b.live.map((p) => [`${p.title}, weekly lower bound`, cvMoney(p.bookable, { cents: true })]), ...(b.paused ? [["Paused this week (guardrail amber)", cvMoney(b.paused)]] : []), ["Days in window", "7"]],
      sources: [...b.live.map((p) => [`Verification packet · ${p.title}`, `frozen ${p.since}`]), ["Toast · sales and covers", "2 min ago"]],
      eq: "H-02 daily accrual", note: b.week ? "This is accrual of a rate already proven. Nothing new was measured this week, so no new number was born." : "Nothing is accruing. A change has to pass every gate before a dollar of it can be banked.",
    },
    "earned-week": {
      title: "Earned this week", value: cvMoney(Math.round(w.earned)), claim: "obs",
      formula: `contribution = net sales − food cost − hourly labour\n= ${cvMoney(Math.round(w.net))} − ${cvMoney(Math.round(w.food))} − ${cvMoney(Math.round(w.labour))}\n= ${cvMoney(Math.round(w.earned))}`,
      inputs: [["Menu sales (Σ price × plates)", cvMoney(Math.round(w.gross))], ["Comps and discounts", cvMoney(-Math.round(w.gross - w.net))], ["Net sales", cvMoney(Math.round(w.net))], [`Food cost (Σ plate cost × plates, ${d.menu.menu.length} dishes)`, cvMoney(Math.round(w.food))], [`Hourly labour (Σ hours × rate, ${d.room.staff.length} people)`, cvMoney(Math.round(w.labour))], ["Covers", w.covers.toLocaleString("en-US")]],
      sources: [["Toast · net sales", "2 min ago"], ["Recipe costs", d.feeds.find((f) => f.name === "Recipe costs").last], ["7shifts · labour", d.feeds.find((f) => f.name === "7shifts").last]],
      eq: "A-01 contribution margin", note: "This is your restaurant's number, not ours. It exists whether or not Coversight does, and it keeps every other figure honest.",
    },
    "margin-move": {
      title: "Margin change vs matched weeks", value: cvMoney(Math.round(d.hist.marginMove), { sign: true }), claim: "mod",
      formula: `Δ = contribution this week − mean(contribution, 6 matched weeks)\n= ${cvMoney(Math.round(w.earned))} − ${cvMoney(Math.round(d.hist.matchedMean))}\n= ${cvMoney(Math.round(d.hist.marginMove), { sign: true })}`,
      inputs: [["Matched weeks", "6 (early November last year, late September this year)"], ["Their mean contribution", cvMoney(Math.round(d.hist.matchedMean))], ["Of which we can account for", cvMoney(Math.round(d.claimable))], ["Unexplained", cvMoney(Math.round(d.unexplained))]],
      sources: [["Toast · 52 weeks of history", "2 min ago"]],
      eq: "H-09 margin attribution", note: `We claim the ${cvMoney(Math.round(d.claimable))} we measured. The rest is real, and we don't know its cause, so we don't claim it.`,
    },
    "exposure": {
      title: "Estimated open exposure", value: `${cvMoney(Math.round(d.exposure))}/wk`, claim: "est",
      formula: "Σ expected weekly effect of open candidates after overlap resolution\n(prevented costs excluded)",
      inputs: d.candidates.filter((c) => !c.prevent).map((c) => [c.title, cvMoney(Math.round(c.value))]),
      sources: [["Toast · item sales and prices", "2 min ago"], ["Invoices · email inbox", "3 days ago"], ["7shifts", d.feeds.find((f) => f.name === "7shifts").last]],
      eq: "E-01 exposure", note: "Estimates, not savings. Nothing here can be invoiced, and it is never added to banked dollars.",
    },
    "coverage": {
      title: "September coverage", value: `${b.coverage.toFixed(1)}×`, claim: "book",
      formula: `banked in September ÷ subscription\n= ${cvMoney(Math.round(b.sept))} ÷ $${M.SUBSCRIPTION} = ${b.coverage.toFixed(2)}×`,
      inputs: [["Days in September", "30"], ...b.accruing.filter((p) => p.septDays).map((p) => [`${p.title} (${p.septDays} days)`, cvMoney(Math.round((p.bookable / 7) * p.septDays))]), ["Banked in September", cvMoney(Math.round(b.sept))], ["Subscription", `$${M.SUBSCRIPTION}/mo`]],
      sources: [["Savings ledger", "closed Sep 30"]],
      eq: "H-05 coverage ratio", note: "A month is the sum of its days. Never weekly × 4.33.",
    },
    "to-date": {
      title: "Banked to date", value: cvMoney(Math.round(b.toDate)), claim: "book",
      formula: `Σ daily accruals since each change verified\n= ${b.accruing.length ? b.accruing.map((p) => `(${p.bookable} ÷ 7) × ${p.accrualDays} days`).join(" + ") : "nothing yet"}`,
      inputs: [...b.accruing.map((p) => [`${p.title}, since ${p.since}`, cvMoney(Math.round((p.bookable / 7) * p.accrualDays))]), [`Reversals at ${room.short}`, String(b.reversed.length)]],
      sources: [["Savings ledger", "live"]], eq: "H-03 cumulative", note: "Reversals remove dollars from the day the metric turned, not the day anyone noticed.",
    },
    "price-leg": {
      title: "Vendor price movement", value: cvMoney(Math.round(d.inv.priceLeg)), claim: "obs",
      formula: "price leg = Σ (unit price now − unit price before) × quantity now\nmix leg = Σ (quantity now − quantity before) × unit price before\nprice + mix = total change, by construction",
      inputs: d.inv.invoices.filter((r) => Math.abs(r.priceLeg) > 1).sort((a, c) => c.priceLeg - a.priceLeg).map((r) => [r.item, cvMoney(Math.round(r.priceLeg))]),
      sources: [["Invoices · email inbox", d.feeds.find((f) => f.name === "Invoices").last]], eq: "B-14 invoice decomposition",
      note: "This is arithmetic, not inference. The saving, once you renegotiate, is the unit-price change on the next invoices.",
    },
    "usage-week": {
      title: "Usage past tolerance", value: `${cvMoney(Math.round(d.usage.week))}/wk`, claim: "est",
      formula: "per item: unexplained = (open + received − close) − Σ plates × recipe qty − logged waste\ncounted only when unexplained ÷ theoretical > tolerance\nweekly = Σ unexplained × unit cost ÷ 4",
      inputs: d.usage.flagged.map((r) => [`${r.label} (${(r.pct * 100).toFixed(1)}% over)`, cvMoney(Math.round(r.dollars))]),
      sources: [["Toast · plates sold", "2 min ago"], ["Inventory counts", d.feeds.find((f) => f.name === "Inventory counts").last], ["Waste log", d.feeds.find((f) => f.name === "Waste log").last]],
      eq: "I-03 usage variance", note: "Manual counts carry about ±3% error, so a gap inside tolerance is never counted.",
    },
  };
  if (lead) {
    out[lead.id] = {
      title: lead.title, value: `${cvMoney(lead.bookable)}/wk`, claim: "book",
      formula: `effect measured against matched controls\npoint = ${cvMoney(lead.point)}/wk   90% interval = [${cvMoney(lead.lo)}, ${cvMoney(lead.hi)}]\nbookable = lower bound = ${cvMoney(lead.bookable)}/wk`,
      inputs: [["Method", lead.method], ["Accruing since", lead.since], ["Held", lead.held], ["Owner", lead.owner]],
      sources: [["Verification packet", `frozen ${lead.since}`]],
      eq: "G-07 bookable = lower bound of the measured interval", note: "The multiplier was frozen when the window closed. A better model later cannot re-price this row.",
    };
  }
  if (d.room.service.mode === "cut") {
    const s = d.room.service;
    out["service-cut"] = {
      title: s.title, value: `${cvMoney(s.value)} tonight`, claim: "obs",
      formula: `hours removed × loaded rate\n= 2.0 h (8–10 pm) × $18.50\n= ${cvMoney(s.value)}`,
      inputs: [["Covers pacing vs comparable night", `${s.pace}%`], ["Servers needed at the upper band", "4"], ["Servers on now", "5"]],
      sources: [["Toast · live covers", "live"], ["7shifts · tonight's schedule", "write-back ready"]],
      eq: "C-04 square-root staffing", note: "Observed cost, not a model. It goes into the running test as an execution record.",
    };
  }
  return out;
}
function cvDerivFor(id) { return CV_DERIV[id] || null; }

/* ---------------------------------------------------------------- primitives */
const CV_CLAIM = {
  est: { label: "Estimated", icon: "CircleDashed", tip: "A detector's view of money being lost. Never invoiced." },
  mod: { label: "Modelled", icon: "Sigma", tip: "Computed from your own history, before anything changed." },
  cau: { label: "Causal", icon: "GitCompareArrows", tip: "Measured against matched controls after the change." },
  book: { label: "Bookable", icon: "BadgeCheck", tip: "The lower bound of a measured interval. The only figure a fee can touch." },
  obs: { label: "Observed", icon: "Eye", tip: "Read directly from your systems. No model involved." },
  none: { label: "No claim", icon: "Ban", tip: "Nothing is claimed for this." },
};
function Claim({ k }) {
  const c = CV_CLAIM[k] || CV_CLAIM.none;
  return <span className={`cv-claim ${k}`} title={c.tip}><Icon name={c.icon} size={12} />{c.label}</span>;
}

/** A dollar figure that opens its derivation. */
function Money({ id, children, className = "" }) {
  const cv = useCv();
  if (!cvDerivFor(id)) return <span className={className}>{children}</span>;
  return <button type="button" className={`cv-money ${className}`} onClick={() => cv.openDeriv(id)} title="See how this is calculated">{children}</button>;
}

function Pill({ tone = "neutral", icon, children }) {
  return <span className={`cv-pill ${tone}`}>{icon && <Icon name={icon} size={13} />}{children}</span>;
}
function Outcome({ k }) {
  const o = CV_OUTCOME[k];
  return <Pill tone={o.tone} icon={o.icon}>{o.label}</Pill>;
}

function Callout({ tone = "", icon = "Info", children }) {
  return <div className={`cv-callout ${tone}`}><Icon name={icon} size={16} /><div>{children}</div></div>;
}

/** Interval with lower bound (billed) and point estimate. */
function Interval({ lo, pt, hi, min, max, billedLabel = "billed" }) {
  const span = max - min || 1;
  const x = (v) => `${((v - min) / span) * 100}%`;
  return (
    <div className="cv-col" style={{ gap: 4 }}>
      <div className="cv-interval" aria-label={`Interval ${cvMoney(lo)} to ${cvMoney(hi)}, point ${cvMoney(pt)}`}>
        <span className="track" />
        <span className="band" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
        <span className="lo" style={{ left: x(lo) }} />
        <span className="pt" style={{ left: x(pt) }} />
      </div>
      <div className="cv-interval-legend">
        <span><b>{cvMoney(lo)}</b> lower bound, {billedLabel}</span>
        <span>point <b>{cvMoney(pt)}</b></span>
        <span>upper <b>{cvMoney(hi)}</b></span>
      </div>
    </div>
  );
}

function PageHead({ over, q, sub, right }) {
  return (
    <div className="cv-head">
      <div className="cv-col" style={{ gap: 8 }}>
        {over && <span className="cv-over">{over}</span>}
        <h2 className="cv-q">{q}</h2>
        {sub && <p className="cv-sub">{sub}</p>}
      </div>
      {right && <div className="cv-row">{right}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- drawer */
function DerivDrawer({ id, onClose }) {
  const d = cvDerivFor(id);
  React.useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!d) return null;
  return (
    <>
      <div className="cv-scrim" onClick={onClose} />
      <aside className="cv-drawer" role="dialog" aria-label={`How ${d.title} is calculated`}>
        <div className="hd">
          <div className="cv-col" style={{ gap: 8 }}>
            <span className="cv-over">How this is calculated</span>
            <span className="cv-h3">{d.title}</span>
            <div className="cv-row"><span className="cv-fig md">{d.value}</span><Claim k={d.claim} /></div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        <div className="bd">
          <div className="cv-col" style={{ gap: 8 }}>
            <span className="cv-over">Formula · {d.eq}</span>
            <div className="cv-formula">{d.formula}</div>
          </div>
          <div className="cv-col" style={{ gap: 8 }}>
            <span className="cv-over">Inputs</span>
            <dl className="cv-kv">{d.inputs.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
          </div>
          <div className="cv-col" style={{ gap: 8 }}>
            <span className="cv-over">Sources</span>
            <dl className="cv-kv">{d.sources.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd style={{ fontFamily: "var(--font-sans)" }}>{v}</dd></React.Fragment>)}</dl>
          </div>
          <Callout icon="Info">{d.note}</Callout>
          <Callout icon="Scale">{CV_CLAIM[d.claim].label}: {CV_CLAIM[d.claim].tip}</Callout>
        </div>
      </aside>
    </>
  );
}

/* ---------------------------------------------------------------- approval modal
   One approval, a preview of exactly what will change, the fence, the
   counter-metrics that would kill it, and the revert. */
function buildApprovals(d) {
  const room = d.profile;
  const out = {
    "tue-cut": {
      title: "Cut one server at 8:00 tonight", where: `${room.name} · Tuesday dinner`, level: "A2 · Drafts", system: "7shifts",
      diff: [["Jess M.", "5:00 – 10:00 pm", "5:00 – 8:00 pm"], ["Floor count 8–10 pm", "5 servers", "4 servers"]],
      fence: "Never below 4 servers on dinner. Never cut after 8:30 pm.",
      kill: ["Average turn time goes past 52 minutes", "Ticket time at the pass goes past 16 minutes", "Covers per server-hour goes past 7.5"],
      window: "Logged as an execution record in the Tuesday dinner test (closes Nov 3).", revert: "Jess is notified and kept on call until 8:30. One tap restores her shift.",
      value: "$37 tonight", claim: "obs",
    },
    "draft-schedule": {
      title: "Publish next week's drafted schedule", where: `${room.name} · Nov 2 – 8`, level: "A2 · Drafts", system: "7shifts",
      diff: [["Tue 8–10 pm", "5 servers", "4 servers"], ["Wed 3–5 pm", "3 servers", "2 servers"], ["Sat 6–9 pm", "7 servers", "8 servers"], ["Net hours", "412 h", "413 h"]],
      fence: "Never below 3 servers at any open hour. No change inside 24 hours of a shift without the GM.",
      kill: ["Turn time past 52 minutes on any changed service", "Covers per server-hour past 7.5", "Two or more call-outs on a changed shift"],
      window: "Opens a 3-week monitoring window against matched services at the other two rooms.", revert: "The previous schedule is kept as a version. Restore it in one step until Nov 1.",
      value: "+$18.50 net cost, protects Saturday's peak", claim: "mod",
    },
    "bk-draft": {
      title: "Publish next week's drafted schedule", where: `${room.name} · Nov 2 – 8`, level: "A1 · Recommends", system: "7shifts",
      diff: [["Mon–Tue lunch", "3 servers", "2 servers"], ["Sat 6–9 pm", "6 servers", "8 servers"], ["Net hours", "318 h", "318 h"]],
      fence: "Never below 2 servers at lunch, 4 on weekend dinner. No Friday cuts until the reversal review closes.",
      kill: ["Turn time past 52 minutes on any changed service", "Lunch ticket time past 16 minutes"],
      window: "Opens a 4-week window against matched services at Oakland and Walnut Creek.", revert: "The previous schedule is kept as a version.",
      value: "Cost-neutral; moves 6 hours to the short peak", claim: "mod",
    },
    "wc-draft": {
      title: "Start Sunday brunch staff 30 minutes earlier", where: `${room.name} · Sunday Nov 8`, level: "A3 · Executes within a fence", system: "7shifts",
      diff: [["Line cook (Iris N.)", "10:00 am", "9:30 am"], ["Server (brunch open)", "10:00 am", "9:30 am"], ["Net hours", "301 h", "302 h"]],
      fence: "Brunch labour under 22% of brunch sales. Never more than one hour net added without the owner.",
      kill: ["Brunch labour past 22% of sales", "First-wave ticket time not improving after 3 Sundays"],
      window: "Opens a 6-week window against Sundays before the change.", revert: "One tap restores the old start times.",
      value: `about ${cvMoney(64)}/wk expected`, claim: "mod",
    },
    "void-reason": {
      title: "Require a reason code on post-send voids", where: `${room.name} · Toast permissions`, level: "A1 · Recommends", system: "Toast",
      diff: [["Void after the order is sent", "Server can void", "Manager PIN + reason code"], ["Void before send", "Server can void", "No change"]],
      fence: "Applies to post-send voids only. Never blocks a void; it only asks who and why.",
      kill: ["Ticket time at the pass goes past 16 minutes (managers pulled off the floor)", "Average void approval takes over 2 minutes"],
      window: "The control chart keeps running against the 13-week baseline, at 1 false alarm per quarter.",
      revert: "Turn the permission back off in Toast. Nothing else changes.",
      value: "No claim until it verifies", claim: "none",
    },
    "delivery-markup": {
      title: "Raise delivery prices 10%", where: `${room.name} · DoorDash and Uber Eats menus`, level: "A1 · Recommends", system: "Toast delivery menus",
      diff: [["DoorDash prices", "Dine-in prices", "+10%, rounded to $0.50"], ["Uber Eats prices", "Dine-in prices", "+10%, rounded to $0.50"], ["Dine-in and takeout", "—", "No change"]],
      fence: "Delivery prices at most 12% above dine-in. One delivery price change per 6 weeks.",
      kill: ["Delivery orders fall more than 20% against takeout", "App rating drops below 4.5", "Refund rate rises"],
      window: "Opens a 6-week test with takeout as the control channel.",
      revert: "Restore dine-in prices on both apps from Toast. The test closes as no claim.",
      value: `${cvMoney(Math.round(d.chan.markupLo))} to ${cvMoney(Math.round(d.chan.markupHi))}/wk estimated`, claim: "est",
    },
  };
  return out;
}

/** Look up an approval. "price:<dish>:<price>" builds one from the current menu. */
function cvApproval(id) {
  if (CV_APPROVALS[id]) return CV_APPROVALS[id];
  const m = /^price:([\w-]+):([\d.]+)$/.exec(id || "");
  if (!m) return null;
  const item = CV_MENU.find((x) => x.key === m[1]);
  if (!item) return null;
  const to = +m[2];
  const sim = cvPriceMoveInterval(item, to);
  return {
    title: `Change the ${item.name.toLowerCase()} from ${cvMoney(item.price, { cents: true })} to ${cvMoney(to, { cents: true })}`, where: `${CV_ROOM.name} · menu`, level: "A1 · Recommends", system: "Toast menu",
    diff: [[item.name, cvMoney(item.price, { cents: true }), cvMoney(to, { cents: true })], ["Menu reprint", "—", "Table cards only"]],
    fence: "Price moves under 8%. One price change per item per 6 weeks.",
    kill: [`${item.name} units drop more than ${Math.max(5, Math.round(Math.abs(item.e || 0.5) * 15))}% vs matched weeks`, "Check average drops on tables that order it", "Comps on the dish rise"],
    window: "Opens a 6-week difference-in-differences window against items whose price did not move.", revert: `Restore ${cvMoney(item.price)} in Toast. The test closes as no claim.`,
    value: sim ? `about ${cvMoney(Math.round(sim.delta))}/wk expected` : "not priceable from data", claim: "mod",
  };
}

function ApprovalModal({ id, onClose, onConfirm }) {
  const a = cvApproval(id);
  const [step, setStep] = React.useState("review");
  React.useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!a) return null;
  return (
    <>
      <div className="cv-scrim" style={{ zIndex: "var(--z-modal)" }} onClick={onClose} />
      <div className="cv-modal" role="dialog" aria-label={a.title}>
        <div className="hd">
          <div className="cv-col" style={{ gap: 6 }}>
            <span className="cv-over">{a.where}</span>
            <span className="cv-h3">{a.title}</span>
            <div className="cv-row"><Pill icon="Gauge">Autonomy {a.level}</Pill><Claim k={a.claim} /><span className="cv-small cv-muted">{a.value}</span></div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        {step === "review" ? (
          <>
            <div className="bd">
              <div className="cv-col" style={{ gap: 8 }}>
                <span className="cv-over">Exactly what changes in {a.system}</span>
                <div className="cv-diff">
                  <div className="r h"><span>What</span><span>Now</span><span>After</span></div>
                  {a.diff.map(([w, was, now]) => <div className="r" key={w}><span>{w}</span><span className="was">{was}</span><span className="now">{now}</span></div>)}
                </div>
              </div>
              <div className="cv-grid g2">
                <div className="cv-col" style={{ gap: 8 }}>
                  <span className="cv-over">Your fence</span>
                  <span className="cv-small">{a.fence}</span>
                </div>
                <div className="cv-col" style={{ gap: 8 }}>
                  <span className="cv-over">We stop and tell you if</span>
                  <ul className="cv-ul">{a.kill.map((k) => <li key={k}><Icon name="ShieldAlert" size={14} />{k}</li>)}</ul>
                </div>
              </div>
              <Callout icon="Timer">{a.window}</Callout>
              <Callout icon="Undo2">{a.revert}</Callout>
            </div>
            <div className="ft">
              <Button variant="ghost" onClick={onClose}>Not now</Button>
              <Button variant="secondary" onClick={onClose}>Edit first</Button>
              <Button icon="Check" onClick={() => { setStep("done"); onConfirm && onConfirm(id); }}>Approve and write back</Button>
            </div>
          </>
        ) : (
          <>
            <div className="bd">
              <Callout tone="good" icon="CircleCheck">Written back to {a.system}. The guardrails are watching, and you'll hear from us only if one trips.</Callout>
            </div>
            <div className="ft"><Button onClick={onClose}>Done</Button></div>
          </>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- tiny charts */
function cvScale(d0, d1, r0, r1) { const k = (r1 - r0) / ((d1 - d0) || 1); return (v) => r0 + (v - d0) * k; }

function MiniBars({ values, color = "var(--accent)", h = 48, neg = "var(--money-down)" }) {
  const w = 300, max = Math.max(...values.map(Math.abs)) || 1, bw = w / values.length;
  return (
    <svg className="cv-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height: h }} aria-hidden="true">
      {values.map((v, i) => { const bh = (Math.abs(v) / max) * (h - 4); return <rect key={i} x={i * bw + 2} y={h - bh} width={bw - 4} height={bh} rx="2" fill={v < 0 ? neg : color} />; })}
    </svg>
  );
}

cvLoad(SEED, "oakland");

export { CvCtx, useCv, cvMoney, cvPct, cvRound, cvLoad, cvFill, cvApproval, CV_DS, CV_D, CV_GROUP, CV_ROOM, CV_NOW, CV_DAILY, CV_ACCRUAL_START, CV_DAYS_TO_DATE, CV_SUB, CV_LOCS, CV_MENU, CV_CM_UNWEIGHTED, CV_CM_WEIGHTED, cvPriceMove, cvPriceMoveInterval, CV_INVOICES, CV_PRICE_LEG, CV_MIX_LEG, CV_PERSIST, cvPlanCandidates, cvChoosePlan, CV_EXPOSURE, CV_SALMON, CV_SALMON_WK, CV_SALMON_LOST, CV_PROOF, CV_OUTCOME, CV_DERIV, CV_CLAIM, Claim, Money, Pill, Outcome, Callout, Interval, PageHead, DerivDrawer, ApprovalModal, CV_APPROVALS, cvScale, MiniBars };
