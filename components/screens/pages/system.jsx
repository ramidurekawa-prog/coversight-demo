'use client';

import * as React from 'react';
import { PlatformHealth } from '../live';
import { Crew } from '../crew';
import { useEngine, useSaved } from '../../engine';
import { CV_D, CV_ROOM, Pill, Callout, PageHead } from '../core';

/* ================================================================ System (autonomy and the crew) */
const LEVER_NEED = {
  Labour: "A4 needs a full quarter at A3 without an un-caught reversal",
  Menu: "A2 needs write access to Toast menus and a preview of the change",
  Purchasing: "A3 needs a verified renegotiation at this room",
  Controls: "A2 needs a measured comp rate at this room",
  Throughput: "A1 needs waitlist data, so a recommendation can rest on a measured figure",
};
const cvLevers = () => Object.entries(CV_D.room.autonomy).map(([k, [now, earned]]) => ({ k, now, earned, need: LEVER_NEED[k] }));
function CvSystem() {
  const CV_LEVERS = cvLevers();
  const eng = useEngine();
  const [levels, saveLevels] = useSaved('autonomy', Object.fromEntries(CV_LEVERS.map((l) => [l.k, l.now])));
  const setLevels = (fn) => saveLevels(fn, 'Autonomy changed');
  const [real, setReal] = React.useState(null);
  React.useEffect(() => {
    if (eng.mode !== 'server') return;
    fetch('/api/activity', { credentials: 'same-origin' }).then((r) => r.json()).then((b) => setReal(b.activity || [])).catch(() => setReal([]));
  }, [eng.mode]);
  const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const LV = ["Observes", "Recommends", "Drafts", "Executes within a fence", "Holds the line"];
  return (
    <div className="cv-page wide">
      <PageHead over="System" q="Who is doing what, and how much rope do they have?"
        sub="Autonomy is granted per lever and per room, never globally. Each level is earned by evidence, and any guardrail breach drops that lever back to recommending." />
      <PlatformHealth />
      <Callout icon="Info">Autonomy is saved per room, but in practice every lever is at most <b>Recommends</b> today: Coversight can&apos;t write to Toast or 7shifts yet, so an approval becomes a guided task (Today) rather than a change made for you.</Callout>
      <section className="cv-card">
        <div className="cv-card-head"><span className="cv-h4">Autonomy at {CV_ROOM.name}</span><span className="cv-small cv-faint">A0 observes · A1 recommends · A2 drafts · A3 executes within a fence · A4 holds the line</span></div>
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
      <Crew />
      {real && (
        <section className="cv-card flush">
          <div className="cv-row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", justifyContent: "space-between" }}>
            <span className="cv-h4">What people and jobs did</span><Pill icon="ScrollText">From the audit log</Pill>
          </div>
          <div className="cv-feed" style={{ maxHeight: 320, overflowY: "auto" }}>
            {real.length ? real.map((e, i) => <div key={i} className="ev"><span className="t">{when(e.at)}</span><span className="a">{e.who}</span><span className="m">{e.what}{e.room ? ` · ${e.room}` : ''}</span></div>) : <div className="ev"><span className="m">Nothing yet.</span></div>}
          </div>
        </section>
      )}
    </div>
  );
}

export { CvSystem };
