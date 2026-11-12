'use client';

import { Icon, Button } from '../../kit';
import { useEngine } from '../../engine';
import { useCv, cvMoney, CV_D, CV_LOCS, CV_PROOF, CV_OUTCOME, Claim, Money, Outcome, Callout, Interval, PageHead } from '../core';

/* ================================================================ Verification packet */
function cvGates(p) {
  const base = [
    ["Measurement plan registered before the change", "registered 14 days before", "ok"],
    ["Evidence the change happened", "7shifts diff, 9 of 9 services", "ok"],
    ["Window at least as long as policy", "6 of 6 weeks", "ok"],
    ["Matched control services", "9 services · balance 0.06", "ok"],
    ["Parallel trends before the change", "placebo p = 0.71", "ok"],
    ["Enough data to see the effect", `detectable $${Math.round((p.point || 100) * 0.36)} ≤ expected $${p.point || 0}`, "ok"],
    ["Interval excludes zero", `lower bound $${p.lo ?? 0} > $0`, "ok"],
    ["Guardrails held", "covers +0.4% · ticket 13.8 min", "ok"],
    ["Source data complete", "99.2% of services", "ok"],
    ["No competing explanation", "no other change on the lever", "ok"],
    ["One lever key per dollar", "no overlapping claim", "ok"],
    ["Multiplier frozen at verify", "hash 7f3a…c21", "ok"],
  ];
  const set = (i, v, s) => { base[i] = [base[i][0], v, s]; };
  if (p.outcome === "limited") { set(2, "4 of 6 weeks", "warn"); set(6, `lower bound $${p.lo} > $0`, "ok"); }
  if (p.outcome === "testing") { [2, 5, 6, 7, 11].forEach((i) => set(i, `pending until ${p.closes}`, "warn")); set(2, `${p.checkpoint || "in progress"}`, "warn"); }
  if (p.outcome === "data") { set(8, "source data stale or missing", "no"); [5, 6, 11].forEach((i) => set(i, "not computed", "warn")); }
  if (p.outcome === "reversed") { set(7, "guardrail breached", "no"); set(11, `removed ${p.held.replace("Reversed ", "")}`, "no"); }
  if (p.outcome === "inconclusive") { set(5, "underpowered", "no"); set(6, "interval crosses zero", "no"); set(3, "too few matched services", "warn"); }
  if (p.outcome === "directional") { set(6, "interval crosses zero", "no"); }
  return base;
}
function downloadJson(name, obj) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
  a.download = name;
  a.click();
}

/* A real test window's packet: the gates it actually passed, from its own record. */
function RealPacket({ w }) {
  const cv = useCv();
  const n = w.checkpoints?.length ?? 0;
  const gates = [
    ["Baseline frozen before the change", `${w.baseline} at start, data to ${w.startedAt}`, "ok"],
    ["Watched the full window", `day ${w.day} of 28 · ${n} of 4 checkpoints`, w.day >= 28 && n >= 4 ? "ok" : "warn"],
    ["Source data current", w.status === "waiting" ? "no new week of data for over 9 days" : "a new week of data each week", w.status === "waiting" ? "no" : "ok"],
    ["Interval excludes zero", w.lowCents != null && n >= 2 ? `lower bound ${cvMoney(w.lowCents / 100, { cents: true })}/wk` : "not computed yet", w.lowCents > 0 ? "ok" : n >= 2 ? "no" : "warn"],
    ["Guardrails held", w.status === "reversed" ? "a guardrail broke after it verified" : "average check and turn time inside limits", w.status === "reversed" ? "no" : "ok"],
    ["Matched controls subtracted", "not yet: before/after against the frozen baseline", "warn"],
    ["Booked at the lower bound only", w.status === "verified" ? `${cvMoney(w.bookedCents / 100, { cents: true })}/wk` : "$0 until it verifies", w.status === "verified" ? "ok" : "warn"],
  ];
  const outcome = { running: "testing", waiting: "data", verified: "verified", rejected: "inconclusive", reversed: "reversed", stopped: "inconclusive" }[w.status] || "testing";
  return (
    <div className="cv-page">
      <button className="cv-link" onClick={() => cv.go("proof")}><Icon name="ArrowLeft" size={14} />All proof</button>
      <PageHead over={`Verification packet · ${CV_LOCS.find((l) => l.id === w.roomId)?.name ?? w.roomId}`} q={w.title}
        right={<><Outcome k={outcome} /><Button variant="secondary" size="sm" icon="Download" onClick={() => { downloadJson(`coversight-packet-${w.id.slice(0, 8)}.json`, { format: "coversight-packet/v1", exportedAt: new Date().toISOString(), window: w, gates: gates.map(([gate, detail, state]) => ({ gate, detail, state })), estimator: "lib/data/pilot.js measureEffect: two-sided 90% Student-t lower bound, never below $0" }); cv.toast("Packet downloaded: the window, every checkpoint, and the gates."); }}>Export</Button></>} />
      <section className="cv-card">
        <dl className="cv-kv">
          <dt>Metric</dt><dd style={{ fontFamily: "var(--font-sans)" }}>{w.metric} · {w.direction === "down" ? "down is better" : "up is better"}</dd>
          <dt>Checkpoints</dt><dd>{n ? w.checkpoints.map((c) => `day ${c.day}: ${c.observed}`).join(" · ") : "none yet"}</dd>
          {w.pointCents != null && n >= 2 && <><dt>Measured, a week</dt><dd>{cvMoney(w.pointCents / 100, { cents: true })} point · {cvMoney(Math.max(0, w.lowCents) / 100, { cents: true })} lower bound</dd></>}
        </dl>
      </section>
      <section className="cv-card flush">
        <div className="cv-tablewrap"><table className="cv-table"><tbody>
          {gates.map(([g, d, st]) => <tr key={g}><td style={{ fontWeight: 600 }}>{g}</td><td className="cv-small cv-muted">{d}</td><td><Icon name={st === "ok" ? "CircleCheck" : st === "no" ? "CircleX" : "CircleDot"} size={16} className={st === "ok" ? "ok" : st === "no" ? "no" : ""} /></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}

function CvPacket({ params }) {
  const cv = useCv();
  const eng = useEngine();
  const id = params && params.id;
  if (id && !CV_PROOF.some((r) => r.id === id) && /^[0-9a-f-]{36}$/.test(id)) {
    const w = (eng.windows || []).find((x) => x.id === id);
    return w ? <RealPacket w={w} /> : <div className="cv-page"><span className="cv-small cv-muted">{eng.mode === "pending" || eng.mode === "server" ? "Loading the packet…" : "This packet belongs to a real test and needs the server."}</span></div>;
  }
  const p = CV_PROOF.find((r) => r.id === id) || CV_PROOF[0];
  const gates = cvGates(p);
  const passed = gates.filter((g) => g[2] === "ok").length;
  const loc = CV_LOCS.find((l) => l.id === p.loc);
  return (
    <div className="cv-page">
      <button className="cv-link" onClick={() => cv.go("proof")}><Icon name="ArrowLeft" size={14} />All proof</button>
      <PageHead over={`Verification packet · ${loc.name} · ${p.lever}`} q={p.title}
        right={<><Outcome k={p.outcome} /><Button variant="secondary" size="sm" icon="Download" onClick={() => { downloadJson(`coversight-packet-${p.id}.json`, { format: "coversight-packet/v1", exportedAt: new Date().toISOString(), sample: true, packet: p, gates: gates.map(([gate, detail, state]) => ({ gate, detail, state })) }); cv.toast("Packet downloaded."); }}>Export</Button></>} />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">What can be claimed</span><Claim k={p.bookable ? "book" : "none"} /></div>
          <div className="cv-row" style={{ alignItems: "baseline", gap: 12 }}>
            <span className={`cv-fig xl ${p.bookable ? "cv-up" : ""}`}>{CV_D.banked.lead && CV_D.banked.lead.id === p.id ? <Money id={p.id}>${p.bookable}</Money> : `$${p.bookable}`}</span>
            <span className="cv-muted">per week{p.bookable ? ", the lower bound" : ""}</span>
          </div>
          {p.lo != null && p.outcome !== "testing" && <Interval lo={p.lo} pt={p.point} hi={p.hi} min={Math.min(0, p.lo) - 20} max={p.hi + 40} />}
          {p.outcome === "testing" && <Callout tone="info" icon="Timer">Running estimate {cvMoney(p.point)}/wk, interval {cvMoney(p.lo)} to {cvMoney(p.hi)}. It crosses zero, so nothing accrues until the window closes on {p.closes}.</Callout>}
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

export { CvPacket };
