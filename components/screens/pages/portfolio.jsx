'use client';

import { useCv, cvMoney, CV_GROUP, CV_NOW, Claim, Pill, Callout, PageHead } from '../core';
import { useEngine } from '../../engine';
import { tmpl } from '../../../lib/data/model';
import { DensePortfolio } from '../dense-sections';

const M_fillLower = (t, tokens) => { const x = tmpl(t, tokens); return x.charAt(0).toLowerCase() + x.slice(1); };

/* ================================================================ Portfolio */
function CvPortfolio() {
  const cv = useCv();
  const G = CV_GROUP;
  const eng = useEngine();
  const real = eng.mode === "server" && eng.org && !eng.org.sample;
  /* A real group: banked and tests come from its own test windows, freshness from its own Toast data. */
  const age = (end) => Math.round((Date.now() - Date.parse(`${end}T23:59:59Z`)) / 864e5);
  const CV_ROOMS = real ? G.rows.map((r) => {
    const ws = (eng.windows || []).filter((w) => w.roomId === r.id);
    const t = r.d.room.fromToast;
    const stale = t ? (age(t.end) > 8 ? 1 : 0) : 0;
    return { ...r, banked: Math.round(ws.filter((w) => w.status === "verified").reduce((x, w) => x + w.bookedCents / 100, 0)), tests: ws.filter((w) => w.status === "running" || w.status === "waiting").length, alarms: ws.filter((w) => w.status === "reversed").length, stale,
      note: t ? `Own Toast data to ${t.end}${stale ? `, ${age(t.end)} days old` : ""}` : "Sample numbers until its Toast data is loaded" };
  }) : G.rows;
  const banked = real ? CV_ROOMS.reduce((x, r) => x + r.banked, 0) : G.banked;
  const earned = G.earned;
  const weakest = [...CV_ROOMS].sort((a, b) => a.banked - b.banked || a.earned - b.earned)[0];
  const attention = CV_ROOMS.filter((r) => r.alarms || r.stale).length;
  const nRooms = CV_ROOMS.length;
  const words = ["", "one", "both", "all three", "all four", "all five", "all six"];
  return (
    <div className="cv-page wide">
      <PageHead over={`${eng.org?.name ?? "Rosewood Restaurant Group"} · ${real ? "this week" : CV_NOW.week}`} q={nRooms === 1 ? "How is the room doing this week?" : `How are ${words[nRooms] || `all ${nRooms}`} rooms doing this week?`}
        sub="One line per room, so an owner with several rooms sees where to spend this week's attention." />
      <div className="cv-grid g3">
        <div className="cv-card" style={{ gap: 6 }}><div className="cv-row" style={{ justifyContent: "space-between" }}><span className="cv-xs cv-faint">Banked this week, all rooms</span><Claim k="book" /></div><span className="cv-fig lg cv-up">{cvMoney(banked)}</span><span className="cv-xs cv-faint">{real ? "Verified tests, at their lower bound" : G.paused ? `${cvMoney(G.paused)} paused this week while a guardrail is amber` : "Nothing paused"}</span></div>
        <div className="cv-card" style={{ gap: 6 }}><div className="cv-row" style={{ justifyContent: "space-between" }}><span className="cv-xs cv-faint">Earned this week, all rooms</span><Claim k="obs" /></div><span className="cv-fig lg">{cvMoney(earned)}</span><span className="cv-xs cv-faint">Contribution margin from your registers</span></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Needs your attention</span><span className="cv-fig lg">{attention}</span><span className="cv-xs cv-faint">{real ? `${CV_ROOMS.reduce((x, r) => x + r.alarms, 0)} reversed · ${CV_ROOMS.filter((r) => r.stale).length} room${CV_ROOMS.filter((r) => r.stale).length === 1 ? "" : "s"} with stale Toast data` : `${G.alarms} alarm${G.alarms === 1 ? "" : "s"} · ${G.stale} stale feed${G.stale === 1 ? "" : "s"} across ${CV_ROOMS.filter((r) => r.stale).length} rooms`}</span></div>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Room</th><th className="r">Banked /wk</th><th className="r">Earned /wk</th><th>Alarms</th><th>Tests in flight</th><th>Feeds</th><th>What's happening</th></tr></thead>
            <tbody>
              {CV_ROOMS.map((r) => (
                <tr key={r.id} className="cv-tr" onClick={() => { cv.pickRoom(r.id); cv.go("week"); }}>
                  <td style={{ fontWeight: 600 }}>{r.d.profile.name}</td>
                  <td className="r">{cvMoney(r.banked)}</td>
                  <td className="r">{cvMoney(Math.round(r.earned))}</td>
                  <td>{r.alarms ? <Pill tone="warn" icon="Siren">{r.alarms} {real ? "reversed" : "alarm"}</Pill> : <Pill tone="good" icon="ShieldCheck">Quiet</Pill>}</td>
                  <td className="cv-num">{r.tests}</td>
                  <td>{r.stale ? <Pill tone="warn" icon="Clock">{real ? "Stale" : `${r.stale} stale`}</Pill> : real && !r.d.room.fromToast ? <Pill icon="FlaskConical">Sample</Pill> : <Pill tone="good" icon="CircleCheck">Healthy</Pill>}</td>
                  <td className="cv-small cv-muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {!real && <Callout icon="Lightbulb">{weakest.name} earns the least and has {weakest.banked ? `only ${cvMoney(weakest.banked)}` : "nothing"} banked. {weakest.d.queue[0] ? <> This week&apos;s best use of your time there: {M_fillLower(weakest.d.queue[0].title, weakest.d.tokens)}.</> : null}</Callout>}
      <Callout icon="MousePointerClick">Click a room to open its week. Every screen follows the room you pick.</Callout>
      <DensePortfolio />
    </div>
  );
}

export { CvPortfolio };
