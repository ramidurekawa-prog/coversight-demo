'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, cvMoney, CV_D, CV_GROUP, CV_PERSIST, cvChoosePlan, Claim, Pill, Callout, Interval, PageHead } from '../core';
import { engine, useEngine, useSaved } from '../../engine';
import { LoopStrip } from '../areas';
import { findingBlocked, findingStatus, findingTest } from '../../../lib/data/findings';

/* ================================================================ Finding detail */
/** Evidence for any finding, built from the rows it was computed from. */
function cvEvidence(c, d) {
  if (c.kind === "price") {
    const m = d.menu.menu.find((x) => x.key === c.item);
    return { detector: "Menu margin + price response", evidence: [["Weeks observed", "52"], ["Price now", cvMoney(m.price, { cents: true })], ["Plate cost", `${cvMoney(m.cost, { cents: true })} (${Math.round((m.cost / m.price) * 100)}% food cost)`], ["Sold per week", String(m.units)], ["Price response", `${m.e < 0 ? "−" : ""}${Math.abs(m.e).toFixed(2)} ± ${m.se.toFixed(2)}`], ["Plates lost at the new price", `about ${Math.round(c.move.lost)} a week`]],
      overlap: c.item === "salmon" ? "The vendor price rise on salmon is counted first. This price move is valued after it, so one dollar can't be claimed by both findings." : `No other finding touches the ${m.name.toLowerCase()}.` };
  }
  if (c.kind === "vendor") {
    const rows = c.skus.map((k) => d.inv.invoices.find((r) => r.item === k)).filter(Boolean);
    return { detector: "Invoice price/mix decomposition", evidence: [["Invoice lines read", `${d.inv.invoices.length}, last 28 days vs the 28 before`], ...rows.map((r) => [`${r.item}, unit price`, `${cvMoney(r.p0, { cents: true })} → ${cvMoney(r.p1, { cents: true })} per ${r.unit}`]), ["Vendor's share of these increases", `${cvMoney(Math.round(rows.reduce((s, r) => s + r.priceLeg, 0)))} per 28 days`], ["Typical win-back", "60%"]],
      overlap: "Counted before any price move on the same dish, which is valued after it." };
  }
  if (c.kind === "usage") {
    const rows = d.usage.rows.filter((r) => c.skus.includes(r.item));
    return { detector: "Theoretical vs actual usage", evidence: rows.map((r) => [r.label, `${(r.pct * 100).toFixed(1)}% over (tolerance ${(r.tol * 100).toFixed(0)}%), ${cvMoney(Math.round(r.dollars))} in 28 days`]),
      overlap: "Shares a lever key with any plate-cost test on the same items. Whichever verifies first claims the dollars." };
  }
  if (c.kind === "voids" || c.kind === "comps") {
    const k = c.kind === "voids" ? "postVoid" : "comps";
    const t = d.staff.types[k];
    return { detector: "Per-person control limits", evidence: [...t.signals.map((p) => [p.name, `${(p[`${k}Rate`] * 100).toFixed(2)}% vs limit ${(p[`${k}Ucl`] * 100).toFixed(2)}%`]), ["Rest of the room", `${(t.base * 100).toFixed(2)}%`], ["Over the limit, 28 days", cvMoney(Math.round(t.excess))]],
      overlap: "Register exceptions have their own lever key. Nothing else claims them." };
  }
  if (c.kind === "markup") {
    return { detector: "Channel contribution", evidence: [["Delivery share of sales", `${(d.chan.deliveryShare * 100).toFixed(1)}%`], ...d.chan.delivery.map((x) => [`${x.name} keeps, per $100`, `$${x.per100.toFixed(0)}`]), ["Range if 0 to 1 in 6 orders leave", `${cvMoney(Math.round(d.chan.markupLo))} to ${cvMoney(Math.round(d.chan.markupHi))}/wk`]],
      overlap: "Channel pricing has its own lever key; dine-in prices are untouched." };
  }
  return null;
}
function CvFinding({ params }) {
  const cv = useCv();
  const want = params && params.id;
  /* A finding belongs to one room. Opening another room's finding switches the room. */
  const owner = CV_GROUP.rooms.find((r) => r.candidates.some((x) => x.id === want));
  React.useEffect(() => { if (owner && owner.id !== CV_D.id) engine.setRoom(owner.id); }, [owner]);
  const d = owner || CV_D;
  const cands = d.candidates;
  const c = cands.find((x) => x.id === want) || cands[0];
  const ev = cvEvidence(c, d);
  const [dismissed, setDismissed] = useSaved("findings", {});
  const until = dismissed[c.id] && dismissed[c.id] > new Date().toISOString() ? dismissed[c.id] : null;
  const { chosen } = cvChoosePlan(cands, d.room.managerHours);
  const eng = useEngine();
  const test = findingTest(c);
  const st = findingStatus(c, eng.windows, d.id);
  const blocked = findingBlocked(c, d.room);
  const [starting, setStarting] = React.useState(false);
  const STATE = {
    testing: { pill: <Pill tone="info" icon="Timer">Being tested</Pill>, verify: st.window ? `Test running since ${String(st.window.startedAt ?? "").slice(0, 10)}` : "Test running" },
    verified: { pill: <Pill tone="good" icon="BadgeCheck">Verified</Pill>, verify: "Verified by its test" },
    reversed: { pill: <Pill tone="warn" icon="Undo2">Reversed</Pill>, verify: "Verified, then it slipped back" },
    ended: { pill: <Pill icon="Hourglass">Last test ended unproven</Pill>, verify: "The last test didn't prove it" },
  }[st.state];
  const verifyNote = c.prevent ? "Prevented cost: never counted" : st.state === "untestable" ? "No metric for this is read from your data yet" : STATE ? STATE.verify : `${Math.round(c.p * 100)}% chance it verifies`;
  const start = async () => {
    setStarting(true);
    const r = await engine.startWindow(test.lever, { roomId: d.id, dish: test.dish });
    setStarting(false);
    cv.toast(r.ok ? "Test started. The baseline is frozen; each new week of data is a checkpoint." : r.error);
  };
  return (
    <div className="cv-page">
      <button className="cv-link" onClick={() => cv.go("plan")}><Icon name="ArrowLeft" size={14} />The plan</button>
      <PageHead over={`Finding · ${c.lever} · ${d.profile.name}`} q={c.title} right={STATE ? STATE.pill : chosen.has(c.id) ? <Pill tone="good" icon="Check">Chosen this week</Pill> : <Pill icon="Clock">Not chosen this week</Pill>} />
      <LoopStrip stage={STATE ? "verify" : chosen.has(c.id) ? "act" : "understand"} notes={{ detect: ev ? ev.detector : "Found in your data", understand: c.claim === "obs" ? "Read straight from your systems" : "Modelled from your own history", act: STATE ? "Done" : chosen.has(c.id) ? "In this week's plan" : "Waiting for manager time", verify: verifyNote }} />
      {blocked && <Callout tone="warn" icon="TriangleAlert">{blocked} Until then this figure is shown for context only, and Coversight won't put it in front of you as a change to make.</Callout>}
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
          <span className="cv-xs cv-faint">{chosen.has(c.id) ? `It fits inside this week's ${d.room.managerHours} manager-hours.` : `Higher-value-per-hour actions filled this week's ${d.room.managerHours} manager-hours first.`}</span>
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
      ) : <Callout icon="Info">{c.claim === "obs" && c.value === 0 ? "Worth $0 on purpose: the data that would make it measurable isn't connected yet." : "Evidence for this finding comes from the schedule and the matched services behind it."}</Callout>}
      <div className="cv-row">
        {blocked ? <Button onClick={() => cv.go("inputs", { kind: "recipes" })}>Enter recipe costs</Button> : <>
          {c.kind === "price" && <Button onClick={() => cv.approve(`price:${c.item}:${c.to}`)}>Review the price change</Button>}
          {c.kind === "markup" && <Button onClick={() => cv.approve("delivery-markup")}>Review the markup</Button>}
        </>}
        {test && (st.state === "testing" ? <Button variant="secondary" iconRight="ArrowRight" onClick={() => cv.go("windows")}>See the test</Button>
          : !blocked && st.state !== "verified" && <Button variant="secondary" icon="FlaskConical" disabled={starting} onClick={start}>{st.state === "none" ? "Start a 28-day test" : "Test it again"}</Button>)}
        {until ? (
          <>
            <Pill icon="EyeOff">Dismissed until {new Date(until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Pill>
            <Button variant="ghost" icon="Undo2" onClick={() => { setDismissed((m) => { const n = { ...m }; delete n[c.id]; return n; }, `${c.title || c.id}: back on the plan`); cv.toast("Back on the plan."); }}>Bring it back</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => { setDismissed((m) => ({ ...m, [c.id]: new Date(Date.now() + 90 * 864e5).toISOString() }), `${c.title || c.id}: not for us`); cv.toast("Dismissed for 90 days. It's off the plan, and the ranker will learn from it."); }}>Not for us</Button>
        )}
      </div>
      {!test && !c.prevent && <span className="cv-xs cv-faint">Nothing in your data measures this lever week by week yet, so it can be done but not verified, and it's never billed.</span>}
    </div>
  );
}

export { CvFinding };
