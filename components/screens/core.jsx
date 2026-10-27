'use client';

import * as React from 'react';

import { Icon, Button } from '../kit';

/* Coversight — finished-product mockup. Core: data, money helpers, claim chips,
   derivation drawer, approval modal, toast, shared chart bits.
   Data is the repo's Rosewood fixture (packages/db/src/rosewood) re-read through
   the honest models in the spec. Everything is static; nothing is fetched. */

const CvCtx = React.createContext(null);
const useCv = () => React.useContext(CvCtx);

/* ---------------------------------------------------------------- formatting */
const cvMoney = (n, opts = {}) => {
  const { cents = false, sign = false } = opts;
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const pre = n < 0 ? "−" : sign && n > 0 ? "+" : "";
  return `${pre}$${s}`;
};
const cvPct = (n, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
const cvRound = (n) => Math.round(n);

/* ---------------------------------------------------------------- the clock */
const CV_NOW = { label: "Tuesday, October 27, 2026", week: "Week of Oct 19 – 25", time: "7:15 pm" };
const CV_DAILY = 97 / 7; // the one Oakland lever accruing: Thursday prep, $97/wk bookable
const CV_ACCRUAL_START = "Jun 22";
const CV_DAYS_TO_DATE = 127; // Jun 22 → Oct 26 inclusive
const CV_SUB = 349;

/* ---------------------------------------------------------------- locations */
const CV_LOCS = [
  { id: "oakland", name: "Rosewood Oakland", short: "Oakland", seats: 84, addr: "4801 Telegraph Ave" },
  { id: "berkeley", name: "Rosewood Berkeley", short: "Berkeley", seats: 64, addr: "2120 Shattuck Ave" },
  { id: "walnut", name: "Rosewood Walnut Creek", short: "Walnut Creek", seats: 72, addr: "1380 N Main St" },
  { id: "all", name: "All three rooms", short: "All rooms", seats: 220, addr: "Rosewood Restaurant Group" },
];

/* ---------------------------------------------------------------- menu model
   Oakland's 15-item menu (names from the Rosewood fixture). Plate costs are
   set to realistic full-service food costs (22–42%); salmon runs hot at 43%
   after Bay Fish Co.'s 19.7% increase. Units/wk are Oakland. Elasticities are
   fitted from the room's own price history; `se` is the standard error.
   `null` = not enough price changes to price from data. */
const CV_MENU = [
  { key: "salmon", name: "Grilled Salmon", cat: "Food", price: 28, cost: 11.90, units: 142, e: -0.8, se: 0.3 },
  { key: "ribeye", name: "Ribeye Steak", cat: "Food", price: 42, cost: 17.60, units: 64, e: -0.31, se: 0.14 },
  { key: "chicken", name: "Roast Half Chicken", cat: "Food", price: 24, cost: 7.40, units: 118, e: -0.9, se: 0.3 },
  { key: "carbonara", name: "Pasta Carbonara", cat: "Food", price: 21, cost: 5.10, units: 142, e: -0.85, se: 0.25 },
  { key: "pizza", name: "Margherita Pizza", cat: "Food", price: 19, cost: 4.20, units: 166, e: -1.2, se: 0.3 },
  { key: "caesar", name: "Caesar Salad", cat: "Food", price: 15, cost: 3.90, units: 120, e: -1.1, se: 0.35 },
  { key: "burger", name: "Rosewood Burger", cat: "Food", price: 18, cost: 5.80, units: 188, e: -1.4, se: 0.3 },
  { key: "tacos", name: "Fish Tacos", cat: "Food", price: 17, cost: 5.95, units: 96, e: -1.3, se: 0.4 },
  { key: "risotto", name: "Mushroom Risotto", cat: "Food", price: 22, cost: 6.20, units: 58, e: -1.0, se: 0.5 },
  { key: "soup", name: "Heirloom Tomato Soup", cat: "Food", price: 9, cost: 2.10, units: 44, e: null, se: null },
  { key: "red", name: "House Red (glass)", cat: "Alcohol", price: 14, cost: 3.92, units: 210, e: -0.7, se: 0.2 },
  { key: "oldf", name: "Barrel Old Fashioned", cat: "Alcohol", price: 15, cost: 3.00, units: 132, e: -0.6, se: 0.2 },
  { key: "ipa", name: "Fog Line IPA (draft)", cat: "Alcohol", price: 9, cost: 2.25, units: 176, e: -0.8, se: 0.25 },
  { key: "lemonade", name: "Sparkling Lemonade", cat: "Non-alc", price: 6, cost: 1.10, units: 70, e: -1.5, se: 0.6 },
  { key: "torte", name: "Chocolate Torte", cat: "Dessert", price: 11, cost: 3.10, units: 62, e: -1.1, se: 0.4 },
];
CV_MENU.forEach((m) => { m.cm = +(m.price - m.cost).toFixed(2); });
const CV_CM_UNWEIGHTED = CV_MENU.reduce((s, m) => s + m.cm, 0) / CV_MENU.length;
const CV_CM_WEIGHTED = CV_MENU.reduce((s, m) => s + m.cm * m.units, 0) / CV_MENU.reduce((s, m) => s + m.units, 0);

/** Weekly contribution change from moving one item to `newPrice`, constant-elasticity demand. */
function cvPriceMove(item, newPrice, e = item.e) {
  if (e == null) return null;
  const q1 = item.units * Math.pow(newPrice / item.price, e);
  const before = item.cm * item.units;
  const after = (newPrice - item.cost) * q1;
  return { q1, before, after, delta: after - before, lost: item.units - q1 };
}
/** Point and interval (elasticity ± 1.64 se ≈ 90%) for a price move. */
function cvPriceMoveInterval(item, newPrice) {
  const p = cvPriceMove(item, newPrice);
  if (!p) return null;
  const a = cvPriceMove(item, newPrice, item.e - 1.64 * item.se).delta;
  const b = cvPriceMove(item, newPrice, Math.min(-0.05, item.e + 1.64 * item.se)).delta;
  return { ...p, lo: Math.min(a, b), hi: Math.max(a, b) };
}

/* ---------------------------------------------------------------- purchasing
   Invoice decomposition, last 28 days vs the 28 before. price leg = (p1 − p0) × q1;
   mix/quantity leg = (q1 − q0) × p0. The two sum to the total by construction. */
const CV_INVOICES = [
  { item: "Salmon fillet", unit: "lb", vendor: "Bay Fish Co.", p0: 11.40, p1: 13.65, q0: 410, q1: 388 },
  { item: "Romaine hearts", unit: "case", vendor: "Valley Greens", p0: 38.00, p1: 49.29, q0: 26, q1: 24 },
  { item: "Ribeye, choice", unit: "lb", vendor: "Hollis Meats", p0: 14.20, p1: 14.64, q0: 300, q1: 289 },
  { item: "Butter, unsalted", unit: "lb", vendor: "Valley Greens", p0: 4.10, p1: 4.35, q0: 220, q1: 230 },
  { item: "Arborio rice", unit: "lb", vendor: "Coast Dry Goods", p0: 2.60, p1: 2.60, q0: 90, q1: 84 },
  { item: "Heirloom tomatoes", unit: "lb", vendor: "Valley Greens", p0: 3.80, p1: 3.55, q0: 160, q1: 170 },
  { item: "Chicken, whole", unit: "lb", vendor: "Hollis Meats", p0: 3.15, p1: 3.15, q0: 640, q1: 660 },
];
CV_INVOICES.forEach((r) => {
  r.priceLeg = (r.p1 - r.p0) * r.q1;
  r.mixLeg = (r.q1 - r.q0) * r.p0;
  r.total = r.p1 * r.q1 - r.p0 * r.q0;
  r.pct = (r.p1 / r.p0 - 1) * 100;
});
const CV_PRICE_LEG = CV_INVOICES.reduce((s, r) => s + r.priceLeg, 0);
const CV_MIX_LEG = CV_INVOICES.reduce((s, r) => s + r.mixLeg, 0);

/* ---------------------------------------------------------------- the plan
   Candidates for Oakland this week. value = expected weekly effect (point).
   p = probability it verifies (from the outcome corpus). persist = how long it holds. */
const CV_PERSIST = {
  structural: { w: 1.0, label: "Structural" },
  holds: { w: 0.8, label: "Holds until next change" },
  upkeep: { w: 0.6, label: "Needs upkeep" },
  week: { w: 0.4, label: "This week only" },
};
function cvPlanCandidates() {
  const ribeye = cvPriceMoveInterval(CV_MENU[1], 44);
  const salmon = cvPriceMoveInterval(CV_MENU[0], 30);
  const carb = cvPriceMoveInterval(CV_MENU[3], 22);
  const vendor = CV_INVOICES[0].priceLeg / 4 * 0.6 + CV_INVOICES[1].priceLeg / 4 * 0.6; // win back 60% of the price leg
  return [
    { id: "ribeye", title: "Raise the ribeye from $42 to $44", lever: "Menu", value: ribeye.delta, lo: ribeye.lo, hi: ribeye.hi, p: 0.58, persist: "structural", hours: 0.5, claim: "mod",
      why: "Demand for the ribeye barely moves with price here (elasticity −0.31). The old engine valued this at $0." },
    { id: "salmon", title: "Raise the salmon from $28 to $30", lever: "Menu", value: salmon.delta, lo: salmon.lo, hi: salmon.hi, p: 0.61, persist: "structural", hours: 0.5, claim: "mod", needs: "recipes",
      why: `Food cost on the salmon is 43% since Bay Fish Co. raised prices. At $30 you'd sell about ${Math.round(cvPriceMoveInterval(CV_MENU[0], 30).lost)} fewer a week, and each one left earns $2 more. Needs current recipe costs to verify.` },
    { id: "vendor", title: "Renegotiate salmon and romaine", lever: "Purchasing", value: vendor, lo: vendor * 0.8, hi: vendor * 1.1, p: 0.85, persist: "holds", hours: 1.0, claim: "obs",
      why: "Bay Fish Co. raised salmon 19.7% and Valley Greens raised romaine 29.7%. Winning back 60% of that is typical." },
    { id: "satpeak", title: "Add one server back, Saturday 6–9 pm", lever: "Labour", value: 58, lo: 21, hi: 96, p: 0.55, persist: "upkeep", hours: 0.25, claim: "mod",
      why: "Saturday's peak is understaffed by 4 server-hours. Turns slow and covers walk." },
    { id: "ot", title: "Move 4 hours off Ana's week before Thursday", lever: "Labour", value: 44, lo: 44, hi: 44, p: 0.95, persist: "week", hours: 0.25, claim: "obs", prevent: true,
      why: "Ana is tracking to 44 hours. Moving 4 to Luis avoids $44 of overtime premium. This is prevented cost, so it is never counted as saved." },
    { id: "carb", title: "Raise the carbonara from $21 to $22", lever: "Menu", value: carb.delta, lo: carb.lo, hi: carb.hi, p: 0.52, persist: "structural", hours: 0.5, claim: "mod",
      why: "Smaller lift and a looser elasticity estimate. Worth doing once the two bigger price moves have read out." },
    { id: "shoulder", title: "Trim Wednesday 3–5 pm by one server", lever: "Labour", value: 38, lo: 4, hi: 71, p: 0.66, persist: "upkeep", hours: 0.5, claim: "mod",
      why: "Two idle server-hours most Wednesdays between lunch and dinner." },
    { id: "paystage", title: "Speed up the Friday pay stage", lever: "Throughput", value: 0, lo: 0, hi: 0, p: 0, persist: "structural", hours: 1.0, claim: "obs",
      why: "The room is full for 1 interval on Friday. A faster turn there seats nobody new, so it is worth $0." },
  ].map((c) => ({ ...c, edv: c.value * c.p * CV_PERSIST[c.persist].w, perHour: (c.value * c.p * CV_PERSIST[c.persist].w) / c.hours }));
}
function cvChoosePlan(cands, hours) {
  const sorted = [...cands].sort((a, b) => b.perHour - a.perHour);
  let used = 0;
  const chosen = new Set();
  sorted.forEach((c) => { if (c.perHour > 0 && used + c.hours <= hours + 1e-9) { chosen.add(c.id); used += c.hours; } });
  return { sorted, chosen, used };
}
const CV_EXPOSURE = cvPlanCandidates().filter((c) => !c.prevent).reduce((s, c) => s + c.value, 0);
/** The salmon $28 → $30 move, computed once so every screen quotes the same figures. */
const CV_SALMON = cvPriceMoveInterval(CV_MENU[0], 30);
const CV_SALMON_WK = Math.round(CV_SALMON.delta);
const CV_SALMON_LOST = Math.round(CV_SALMON.lost);

/* ---------------------------------------------------------------- proof rows */
const CV_PROOF = [
  { id: "thu-prep", loc: "oakland", lever: "Labour", title: "Pull Thursday prep start back to 8:00", outcome: "verified", bookable: 97, point: 112, lo: 97, hi: 127,
    since: "Jun 22", held: "18 weeks", persist: "Needs upkeep", method: "Difference-in-differences vs 9 matched Thursdays", owner: "Maria Reyes" },
  { id: "wc-close", loc: "walnut", lever: "Labour", title: "Trim Tuesday close, back of house, by 6 hours", outcome: "limited", bookable: 382, point: 445, lo: 382, hi: 508,
    since: "Aug 24", held: "9 weeks", persist: "Needs upkeep", method: "Matched control services, 4-week window", limitation: "Shorter window than policy (4 weeks, not 6)", owner: "Priya Shah" },
  { id: "wc-comps", loc: "walnut", lever: "Controls", title: "Reset the bar comp policy", outcome: "verified", bookable: 88, point: 101, lo: 88, hi: 114,
    since: "Sep 28", held: "Paused Oct 19", paused: true, reason: "Comps crossed the control limit on the Oct 17 close, so accrual is paused until they are back inside it.", persist: "Needs upkeep", method: "Control chart, 1 false alarm per quarter", owner: "Priya Shah" },
  { id: "tue-dinner", loc: "oakland", lever: "Labour", title: "Run Tuesday dinner with five servers, not six", outcome: "testing", bookable: 0, point: 288, lo: -40, hi: 610,
    since: "Oct 13", held: "Window closes Nov 3", persist: "—", method: "Matched control services, 3-week window", checkpoint: "Checkpoint 1 of 2 passed", owner: "Maria Reyes" },
  { id: "salmon-plate", loc: "oakland", lever: "Menu", title: "Trim the salmon plate cost", outcome: "data", bookable: 0, point: null,
    since: "Oct 6", held: "Quarantined", persist: "—", method: "Recipe-cost delta × units", reason: "Recipe costs are 18 days old. We can't tell what the plate costs now.", owner: "Maria Reyes" },
  { id: "bk-friday", loc: "berkeley", lever: "Labour", title: "Cut one Friday dinner server", outcome: "reversed", bookable: 0, point: 185, removed: 555,
    since: "Aug 3", held: "Reversed Aug 24", persist: "—", method: "Matched control services", reason: "Table turns breached the 52-minute guardrail (54 min observed). $555 removed from every figure, back to Aug 3.", owner: "Maria Reyes" },
  { id: "bk-expo", loc: "berkeley", lever: "Throughput", title: "Coach the Thursday expo hand-off", outcome: "inconclusive", bookable: 0, point: 64,
    since: "Sep 21", held: "Closed Oct 19", persist: "—", method: "Matched control services", reason: "Underpowered. The design needed 9 comparable services and had 4. This says nothing about whether coaching works.", owner: "Devon Clarke" },
  { id: "wc-club", loc: "walnut", lever: "Menu", title: "Trim the club sandwich portion", outcome: "directional", bookable: 0, point: 41,
    since: "Sep 14", held: "Closed Oct 12", persist: "—", method: "Difference-in-differences vs 6 comparable items", reason: "Moved the right way, but the interval crosses zero ($−12 to $94). No claim; it raises the prior for portion trims.", owner: "Priya Shah" },
];
const CV_OUTCOME = {
  verified: { label: "Verified", tone: "good", icon: "BadgeCheck" },
  limited: { label: "Verified with limitations", tone: "good", icon: "BadgeCheck" },
  testing: { label: "In testing", tone: "info", icon: "Timer" },
  data: { label: "Data failure", tone: "warn", icon: "DatabaseZap" },
  reversed: { label: "Reversed", tone: "bad", icon: "Undo2" },
  inconclusive: { label: "Inconclusive", tone: "neutral", icon: "CircleHelp" },
  directional: { label: "Directionally positive", tone: "neutral", icon: "TrendingUp" },
};

/* ---------------------------------------------------------------- derivations
   Every dollar on screen can open one of these. */
const CV_DERIV = {
  "banked-week": {
    title: "Banked this week", value: "$97", claim: "book",
    formula: "Σ over active verifications of (weekly lower bound ÷ 7) × persistence(t)\n= (97 ÷ 7) × 1.00 × 7 days\n= $97",
    inputs: [["Active verifications at Oakland", "1"], ["Thursday prep, weekly lower bound", "$97.00"], ["Persistence this week", "1.00"], ["Days in window", "7"]],
    sources: [["Verification packet · Thursday prep", "frozen Jun 22"], ["Toast · sales and covers", "2 min ago"], ["7shifts · scheduled hours", "18 hours ago"]],
    eq: "H-02 daily accrual", note: "This is accrual of a rate already proven. Nothing new was measured this week, so no new number was born.",
  },
  "thu-prep": {
    title: "Thursday prep change", value: "$97/wk", claim: "book",
    formula: "effect = (Δ RPLH treated − Δ RPLH control) × hours × loaded rate\npoint = $112/wk   90% interval = [$97, $127]\nbookable = lower bound = $97/wk",
    inputs: [["Treated services", "9 Thursdays"], ["Matched controls", "9 Thursdays, Berkeley + Walnut Creek"], ["Hours removed / wk", "6.0"], ["Loaded rate", "$18.50/hr"], ["Covers change", "+0.4% (held)"]],
    sources: [["7shifts · published schedules", "18 hours ago"], ["Toast · covers by service", "2 min ago"]],
    eq: "G-07 bookable = lower bound of the measured interval", note: "The multiplier was frozen when the window closed. A better model later cannot re-price this row.",
  },
  "earned-week": {
    title: "Earned this week", value: "$18,940", claim: "obs",
    formula: "contribution = net sales − food cost − hourly labour\n= $41,620 − $12,130 − $10,550\n= $18,940",
    inputs: [["Net sales", "$41,620"], ["Food cost (theoretical, recipe-based)", "$12,130"], ["Hourly labour (scheduled × rate)", "$10,550"], ["Covers", "1,412"]],
    sources: [["Toast · net sales", "2 min ago"], ["Recipe costs", "18 days old"], ["7shifts · labour", "18 hours ago"]],
    eq: "A-01 contribution margin", note: "This is your restaurant's number, not ours. It exists whether or not Coversight does, and it keeps every other figure honest.",
  },
  "margin-move": {
    title: "Margin change vs matched weeks", value: "+$410", claim: "mod",
    formula: "Δ = contribution this week − mean(contribution, 6 matched weeks)\n= $18,940 − $18,530\n= +$410",
    inputs: [["Matched weeks", "6 (same month last year, same weekday mix)"], ["Their mean contribution", "$18,530"], ["Of which we can account for", "$97"], ["Unexplained", "$313"]],
    sources: [["Toast · 13 weeks of history", "2 min ago"]],
    eq: "H-09 margin attribution", note: "We claim the $97 we measured. The other $313 is real, and we don't know its cause, so we don't claim it.",
  },
  "exposure": {
    title: "Estimated open exposure", value: `$${Math.round(CV_EXPOSURE)}/wk`, claim: "est",
    formula: "Σ expected weekly effect of open candidates after overlap resolution\n(prevented costs excluded)",
    inputs: cvPlanCandidates().filter((c) => !c.prevent).map((c) => [c.title, cvMoney(Math.round(c.value))]),
    sources: [["Toast · item sales and prices", "2 min ago"], ["Invoices · email inbox", "3 days ago"], ["7shifts", "18 hours ago"]],
    eq: "E-01 exposure", note: "Estimates, not savings. Nothing here can be invoiced, and it is never added to banked dollars.",
  },
  "coverage": {
    title: "September coverage", value: "1.2×", claim: "book",
    formula: "banked in September ÷ subscription\n= (97 ÷ 7 × 30 days) ÷ $349\n= $416 ÷ $349 = 1.19×",
    inputs: [["Days in September", "30"], ["Daily accrual", "$13.86"], ["Banked in September", "$416"], ["Subscription", "$349/mo"]],
    sources: [["Savings ledger", "closed Sep 30"]],
    eq: "H-05 coverage ratio", note: "A month is the sum of its days. Never weekly × 4.33.",
  },
  "to-date": {
    title: "Banked to date", value: cvMoney(Math.round(CV_DAILY * CV_DAYS_TO_DATE)), claim: "book",
    formula: `Σ daily accruals since ${CV_ACCRUAL_START}\n= (97 ÷ 7) × ${CV_DAYS_TO_DATE} days`,
    inputs: [["First accrual", CV_ACCRUAL_START], ["Days accrued", String(CV_DAYS_TO_DATE)], ["Reversals at Oakland", "0"]],
    sources: [["Savings ledger", "live"]], eq: "H-03 cumulative", note: "Reversals would remove dollars from the day the metric turned, not the day anyone noticed.",
  },
  "service-cut": {
    title: "Cut one server at 8:00", value: "$37 tonight", claim: "obs",
    formula: "hours removed × loaded rate\n= 2.0 h (8–10 pm) × $18.50\n= $37",
    inputs: [["Covers pacing vs comparable Tuesday", "−22%"], ["Nowcast, covers 8–10 pm", "17 (band 15–20)"], ["Servers needed at the upper band", "4"], ["Servers on now", "5"]],
    sources: [["Toast · live covers", "live"], ["7shifts · tonight's schedule", "write-back ready"]],
    eq: "C-04 square-root staffing", note: "Observed cost, not a model. It goes into the Tuesday test as an execution record.",
  },
  "price-leg": {
    title: "Vendor price movement", value: cvMoney(Math.round(CV_PRICE_LEG)), claim: "obs",
    formula: "price leg = Σ (unit price now − unit price before) × quantity now\nmix leg = Σ (quantity now − quantity before) × unit price before\nprice + mix = total change, by construction",
    inputs: CV_INVOICES.filter((r) => Math.abs(r.priceLeg) > 1).map((r) => [r.item, cvMoney(Math.round(r.priceLeg))]),
    sources: [["Invoices · email inbox", "3 days ago"]], eq: "B-14 invoice decomposition",
    note: "This is arithmetic, not inference. The saving, once you renegotiate, is the unit-price change on the next invoices.",
  },
};
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
const CV_APPROVALS = {
  "tue-cut": {
    title: "Cut one server at 8:00 tonight", where: "Rosewood Oakland · Tuesday dinner", level: "A2 · Drafts", system: "7shifts",
    diff: [["Jess M.", "5:00 – 10:00 pm", "5:00 – 8:00 pm"], ["Floor count 8–10 pm", "5 servers", "4 servers"]],
    fence: "Never below 4 servers on dinner. Never cut after 8:30 pm.",
    kill: ["Average turn time goes past 52 minutes", "Ticket time at the pass goes past 16 minutes", "Covers per server-hour goes past 7.5"],
    window: "Logged as an execution record in the Tuesday dinner test (closes Nov 3).", revert: "Jess is notified and kept on call until 8:30. One tap restores her shift.",
    value: "$37 tonight", claim: "obs",
  },
  "draft-schedule": {
    title: "Publish next week's drafted schedule", where: "Rosewood Oakland · Nov 2 – 8", level: "A2 · Drafts", system: "7shifts",
    diff: [["Tue 8–10 pm", "5 servers", "4 servers"], ["Wed 3–5 pm", "3 servers", "2 servers"], ["Sat 6–9 pm", "7 servers", "8 servers"], ["Net hours", "412 h", "413 h"]],
    fence: "Never below 3 servers at any open hour. No change inside 24 hours of a shift without the GM.",
    kill: ["Turn time past 52 minutes on any changed service", "Covers per server-hour past 7.5", "Two or more call-outs on a changed shift"],
    window: "Opens a 3-week monitoring window against matched services at Berkeley and Walnut Creek.", revert: "The previous schedule is kept as a version. Restore it in one step until Nov 1.",
    value: "+$18.50 net cost, protects Saturday's peak", claim: "mod",
  },
  "ribeye": {
    title: "Raise the ribeye from $42 to $44", where: "Rosewood Oakland · dinner menu", level: "A1 · Recommends", system: "Toast menu",
    diff: [["Ribeye Steak", "$42.00", "$44.00"], ["Menu reprint", "—", "Table cards only"]],
    fence: "Price moves under 8%. One price change per item per 6 weeks.",
    kill: ["Ribeye units drop more than 9% vs matched weeks", "Check average drops on tables that order it", "Comps on the ribeye rise"],
    window: "Opens a 6-week difference-in-differences window against items whose price did not move.", revert: "Restore $42 in Toast. The test closes as no claim.",
    value: "about $115/wk expected", claim: "mod",
  },
};

function ApprovalModal({ id, onClose, onConfirm }) {
  const a = CV_APPROVALS[id];
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

export { CvCtx, useCv, cvMoney, cvPct, cvRound, CV_NOW, CV_DAILY, CV_ACCRUAL_START, CV_DAYS_TO_DATE, CV_SUB, CV_LOCS, CV_MENU, CV_CM_UNWEIGHTED, CV_CM_WEIGHTED, cvPriceMove, cvPriceMoveInterval, CV_INVOICES, CV_PRICE_LEG, CV_MIX_LEG, CV_PERSIST, cvPlanCandidates, cvChoosePlan, CV_EXPOSURE, CV_SALMON, CV_SALMON_WK, CV_SALMON_LOST, CV_PROOF, CV_OUTCOME, CV_DERIV, CV_CLAIM, Claim, Money, Pill, Outcome, Callout, Interval, PageHead, DerivDrawer, ApprovalModal, CV_APPROVALS, cvScale, MiniBars };
