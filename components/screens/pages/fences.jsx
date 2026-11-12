'use client';

import * as React from 'react';
import { Button } from '../../kit';
import { useCv, CV_ROOM, Pill, Callout, PageHead } from '../core';
import { useSaved } from '../../engine';

/* ================================================================ Fences & alerts */
function CvFences() {
  const cv = useCv();
  const [saved, setSaved] = useSaved("fences", { version: 3, f: { minDinner: 4, minAny: 3, cutBy: "8:30 pm", lockHours: 24, maxPrice: 8, priceGap: 6, maxPar: 15 }, al: { push: true, sms: true, email: false, onePerService: true, quiet: true } });
  const [f, setF] = React.useState(saved.f);
  const [al, setAl] = React.useState(saved.al);
  const dirty = JSON.stringify(f) !== JSON.stringify(saved.f) || JSON.stringify(al) !== JSON.stringify(saved.al);
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
  const tog = (k, label, sub, off) => (
    <label className="cv-row nowrap" style={{ justifyContent: "space-between", gap: 12, cursor: off ? "not-allowed" : "pointer", opacity: off ? 0.6 : 1 }}>
      <span className="cv-col" style={{ gap: 2 }}><span className="cv-small">{label}</span>{sub && <span className="cv-xs cv-faint">{sub}</span>}</span>
      <input id={`a-${k}`} type="checkbox" checked={off ? false : al[k]} disabled={!!off} onChange={(e) => setAl({ ...al, [k]: e.target.checked })} style={{ width: 18, height: 18, accentColor: "var(--primary)" }} />
    </label>
  );
  return (
    <div className="cv-page">
      <PageHead over={`Fences & alerts · ${CV_ROOM.name}`} q="What may the system do without asking, and when does it speak up?"
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
          {tog("push", "In the app (the bell)", "Test results, reversed savings, changes that don't show up in Toast")}
          {tog("sms", "Text message", "Not available yet: needs a texting provider", true)}
          {tog("email", "Email", "The same alerts, to everyone who manages this room (sent once email is set up)")}
        </section>
        <section className="cv-card">
          <span className="cv-h4">Keeping it quiet</span>
          {tog("onePerService", "At most one email per person every 4 hours", "Alert fatigue is what kills engagement; the rest wait in the bell")}
          {tog("quiet", "Quiet hours, 10 pm to 7 am", "Email waits until morning")}
          <Callout icon="Users">The GM gets service and labour messages. The owner gets alarms and the weekly summary. The controller gets period packages only.</Callout>
        </section>
      </div>
      <div className="cv-row"><Button icon="Check" disabled={!dirty} onClick={() => { const version = saved.version + 1; setSaved({ version, f, al }, `Fences saved as version ${version}`); cv.toast(`Fences saved as version ${version}, effective now. Drafts re-check them every time.`); }}>Save fences</Button><span className="cv-xs cv-faint cv-num">v{saved.version}</span><span className="cv-xs cv-faint">Every change is versioned and shown on the verification packets it affects.</span></div>
    </div>
  );
}

export { CvFences };
