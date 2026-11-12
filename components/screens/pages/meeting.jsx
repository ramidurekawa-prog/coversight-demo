'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, cvFill, CV_D, CV_ROOM, Pill, PageHead } from '../core';
import { engine, useEngine, useSaved } from '../../engine';

/* ================================================================ Weekly meeting */
function meetingSummary(log, at) {
  const when = new Date(at || Date.now()).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return { subject: `${CV_ROOM.name}: weekly meeting, ${when}`, body: `Weekly meeting at ${CV_ROOM.name}, ${when}.\n\n${log.map((l) => `• ${l}`).join('\n')}\n\nFrom Coversight.` };
}

function MeetingSend({ log, at }) {
  const cv = useCv();
  const eng = useEngine();
  const m = meetingSummary(log, at);
  return (
    <div className="cv-row" style={{ gap: 8 }}>
      <a className="btn btn-secondary btn-sm" href={`mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`} onClick={() => { if (eng.mode === 'server') engine.draftEmail({ kind: 'gm-note', subject: m.subject, body: m.body }).catch(() => null); cv.toast('Opening the summary in your email.'); }}><Icon name="Mail" size={14} /> Email the summary</a>
    </div>
  );
}

function CvMeeting() {
  const cv = useCv();
  const eng = useEngine();
  const real = eng.mode === 'server' && eng.org && !eng.org.sample;
  const CV_AGENDA = CV_D.meeting.map((a) => ({ ...a, body: cvFill(a.body) }));
  const [i, setI] = React.useState(-1);
  const [left, setLeft] = React.useState(0);
  const [decision, setDecision] = React.useState(null);
  const [log, setLog] = React.useState([]);
  const [last, setLast] = useSaved('meeting', null);
  React.useEffect(() => {
    if (i < 0 || i >= CV_AGENDA.length) return;
    setLeft(CV_AGENDA[i].mins * 60);
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [i]);
  const next = () => {
    const nextLog = [...log, CV_AGENDA[i].k + (CV_AGENDA[i].decision ? `: ${decision || "deferred"}` : "")];
    setLog(nextLog);
    if (i === CV_AGENDA.length - 1) setLast({ log: nextLog, at: new Date().toISOString() }, `Weekly meeting finished: ${nextLog.length} items logged`);
    setI(i + 1);
  };
  const done = i >= CV_AGENDA.length;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="cv-page" style={{ maxWidth: 900 }}>
      <PageHead over={`Tuesday 9:00 · ${CV_ROOM.name} · Owner + ${CV_ROOM.gm} · 15 minutes`} q="The weekly meeting"
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
                    {a.decision.map((d) => (
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
          <span className="cv-small cv-muted">Saved with the time. Send it to whoever wasn&apos;t in the room.</span>
          <MeetingSend log={log} />
          <Button size="sm" variant="ghost" onClick={() => { setI(-1); setLog([]); setDecision(null); }}>{real ? 'Close' : 'Reset the demo'}</Button>
        </section>
      )}
      {i < 0 && last && (
        <section className="cv-card">
          <span className="cv-h4">Last meeting · {new Date(last.at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          <ul className="cv-ul">{last.log.map((l) => <li key={l}><Icon name="Check" size={15} />{l}</li>)}</ul>
          <div className="cv-row"><MeetingSend log={last.log} at={last.at} /><Button size="sm" variant="ghost" icon="Undo2" onClick={() => setLast(null, "Meeting record cleared")}>Clear the record</Button></div>
        </section>
      )}
      {!real && <div className="cv-grid g3">
        {[["Meetings held", "7 of last 8"], ["Average length", "14 min"], ["Decisions made per meeting", "1.3"]].map(([k, v]) => (
          <div key={k} className="cv-card" style={{ gap: 4 }}><span className="cv-xs cv-faint">{k}</span><span className="cv-fig md">{v}</span></div>
        ))}
      </div>}
    </div>
  );
}

export { CvMeeting };
