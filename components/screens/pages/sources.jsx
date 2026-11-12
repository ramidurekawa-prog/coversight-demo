'use client';

import { Button } from '../../kit';
import { ToastConnectionLine } from '../live';
import { useCv, cvMoney, CV_D, CV_ROOM, Pill, Callout, PageHead } from '../core';

/* ================================================================ Sources */
function CvSources() {
  const cv = useCv();
  /* A Toast export more than 8 days old is stale, whatever else is true. */
  const age = (end) => Math.round((Date.now() - Date.parse(`${end}T23:59:59Z`)) / 864e5);
  const CV_FEEDS = CV_D.feeds.map((f) => (f.dataEnd && age(f.dataEnd) > 8 ? { ...f, state: 'stale', note: `The newest week is ${age(f.dataEnd)} days old. Tests pause until the next export is uploaded.` } : f));
  const fixes = CV_FEEDS.filter((f) => f.risk > 0);
  const total = CV_FEEDS.reduce((s, f) => s + f.risk, 0);
  const tone = { healthy: ["good", "CircleCheck", "Healthy"], stale: ["warn", "Clock", "Stale"], partial: ["warn", "CircleDot", "Partial"], off: ["neutral", "CircleMinus", "Not connected"] };
  return (
    <div className="cv-page">
      <PageHead over={`Sources · ${CV_ROOM.name}`} q="Can I trust these numbers?"
        sub="Freshness for each feed from its last successful sync, and the dollars each one puts at risk. If two feeds touch the same dollar, it's counted once, under the feed that would fix it first." />
      <ToastConnectionLine />
      <div className="cv-grid g3">
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Feeds healthy</span><span className="cv-fig md">{CV_FEEDS.filter((f) => f.state === "healthy").length} of {CV_FEEDS.length}</span></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Weekly value at risk</span><span className="cv-fig md cv-exp">{cvMoney(total)}</span><span className="cv-xs cv-faint">counted once across feeds</span></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Fixes that clear it</span><span className="cv-fig md">{fixes.length}</span><span className="cv-xs cv-faint">{fixes.length ? `about ${fixes.length * 3} minutes` : "nothing at risk"}</span></div>
      </div>
      <section className="cv-card flush">
        {CV_FEEDS.map((f, i) => {
          const [t, ic, lb] = tone[f.state];
          return (
            <div key={f.name} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, padding: "14px 18px", borderTop: i ? "1px solid var(--border)" : 0, alignItems: "center" }}>
              <div className="cv-col" style={{ gap: 4 }}>
                <div className="cv-row" style={{ gap: 8 }}><span style={{ fontWeight: 600 }}>{f.name}</span><Pill tone={t} icon={ic}>{lb}</Pill><span className="cv-xs cv-faint">Last success: {f.last}</span></div>
                <span className="cv-small cv-muted">{f.what}{f.note ? `. ${f.note}` : ""}</span>
              </div>
              <div className="cv-row" style={{ justifyContent: "flex-end" }}>
                {f.risk > 0 && <span className="cv-num cv-exp" style={{ fontWeight: 600 }}>{cvMoney(f.risk)}/wk at risk</span>}
                {f.manual && <Pill tone="info" icon="PencilLine">Manual</Pill>}
                {f.fix && f.input && <Button size="sm" variant={f.risk || f.state === "stale" ? "primary" : "secondary"} onClick={() => cv.go("inputs", f.input === "toast" ? undefined : { kind: f.input })}>{f.fix}</Button>}
                {f.fix && !f.input && <Button size="sm" variant="secondary" onClick={() => cv.go("connect")}>How to connect</Button>}
              </div>
            </div>
          );
        })}
      </section>
      <Callout icon="Info">There&apos;s no overall completeness score here on purpose: a single percentage hides a feed that stopped three weeks ago. Each feed says when it last brought in data.</Callout>
    </div>
  );
}

export { CvSources };
