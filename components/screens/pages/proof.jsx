'use client';

import * as React from 'react';
import { Button, Tabs } from '../../kit';
import { useEngine } from '../../engine';
import { useCv, cvMoney, CV_LOCS, CV_PROOF, Claim, Outcome, Callout, PageHead, SampleNote } from '../core';

/* Coversight — proof surfaces: Proof, Verification packet, Accountant, Savings ledger,
   Comparison, Sources, System. */

/* ================================================================ Proof */
const roomTabs = () => [{ value: "all", label: "All rooms" }, ...CV_LOCS.filter((l) => l.id !== "all").map((l) => ({ value: l.id, label: l.short }))];
const WIN_OUTCOME = { running: "testing", waiting: "data", verified: "verified", rejected: "inconclusive", reversed: "reversed" };

/** A real group's tests as proof rows (stopped tests aren't claims). */
function windowRows(windows) {
  return (windows || []).filter((w) => w.status !== "stopped").map((w) => ({
    id: w.id, real: true, title: w.title, loc: w.roomId, lever: w.lever.replace("_", " "), outcome: WIN_OUTCOME[w.status] || "testing",
    bookable: w.status === "verified" ? w.bookedCents / 100 : 0, lo: w.lowCents != null && w.checkpoints?.length >= 2 ? Math.max(0, w.lowCents) / 100 : null, hi: w.pointCents != null && w.checkpoints?.length >= 2 ? w.pointCents / 100 : null,
    method: w.status === "waiting" ? "waiting for the next week of Toast data" : w.status === "rejected" ? "didn’t move enough, for long enough, to count" : w.status === "reversed" ? "a guardrail broke after it verified" : `day ${w.day} of 28`,
    held: w.status === "verified" ? `since ${new Date(w.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : w.status === "running" ? `${w.checkpoints?.length ?? 0} of 4 checkpoints` : "",
  }));
}

function CvProof() {
  const cv = useCv();
  const eng = useEngine();
  const own = eng.mode === "server" && eng.org && !eng.org.sample;
  const [scope, setScope] = React.useState(cv.loc === "all" ? "all" : cv.loc);
  React.useEffect(() => setScope(cv.loc === "all" ? "all" : cv.loc), [cv.loc]);
  const rows = (own ? windowRows(eng.windows) : CV_PROOF).filter((p) => scope === "all" || p.loc === scope);
  const count = (ks) => rows.filter((r) => ks.includes(r.outcome)).length;
  // A paused claim (guardrail amber) accrues nothing this week, so it is not bookable now.
  const bookable = rows.reduce((s, r) => s + (r.paused ? 0 : r.bookable), 0);
  return (
    <div className="cv-page wide">
      <PageHead over="Proof" q="What have we actually proven?"
        sub={own ? "Every test this group has run: what it proved, at its cautious lower bound, and the ones that didn't, with the reason. Only Verified rows can be billed." : "Every claimed dollar with its controls, interval, gates and how long it lasts. The ones that failed stay on screen with the reason, because a ledger that only goes up isn't a ledger."}
        right={<>
          <Tabs value={scope} onChange={setScope} tabs={roomTabs()} />
      {!own && <SampleNote what="The verification history" why="Banked dollars come from tests that ran for weeks on the sample group. A real restaurant starts at $0 banked, and its first result lands after its first test window closes." />}
        </>} />
      {own && rows.length === 0 && <Callout icon="Timer">No tests yet. Start one from Today or Test windows; its result lands here when it closes at day 28.</Callout>}
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
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
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
                  <td>{CV_LOCS.find((l) => l.id === p.loc)?.short ?? p.loc}</td>
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

export { CvProof };
