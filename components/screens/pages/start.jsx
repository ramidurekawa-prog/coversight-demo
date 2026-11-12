'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, CV_DS, Claim, Callout, PageHead } from '../core';
import { useEngine } from '../../engine';

/* ================================================================ First six weeks */
/* A real group's first weeks: a checklist read from what has actually happened. */
function StartReal() {
  const cv = useCv();
  const eng = useEngine();
  const [team, setTeam] = React.useState(null);
  const [mail, setMail] = React.useState(null);
  React.useEffect(() => {
    fetch('/api/team', { credentials: 'same-origin' }).then((r) => r.json()).then(setTeam).catch(() => setTeam({ people: [] }));
    fetch('/api/outbox', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then(setMail).catch(() => setMail(null));
  }, []);
  const rooms = Object.values(CV_DS.rooms);
  const own = rooms.filter((r) => r.fromToast).length;
  const estimated = rooms.reduce((t, r) => t + r.menu.filter((m) => m.costEstimated).length, 0);
  const ws = eng.windows || [];
  const acts = eng.actions || {};
  const fences = Object.values(acts).some((a) => a?.fences);
  const approved = acts['']?.billing?.status === 'approved';
  const steps = [
    { k: 'Created the group', s: 'done', go: 'team' },
    { k: `Loaded Toast data for every room (${own} of ${rooms.length})`, s: own === rooms.length ? 'done' : own ? 'now' : 'next', go: 'inputs' },
    { k: estimated ? `Entered plate costs (${estimated} dishes still estimated)` : 'Entered plate costs for every dish', s: own && !estimated ? 'done' : own ? 'now' : 'next', go: 'inputs' },
    { k: 'Invited your GMs and accountant', s: team ? (team.people.length > 1 ? 'done' : 'now') : 'next', go: 'team' },
    { k: 'Set your fences and alerts', s: fences ? 'done' : 'next', go: 'fences' },
    { k: 'Started the first 28-day test', s: ws.length ? 'done' : own ? 'now' : 'next', go: 'windows' },
    { k: 'First test verified (around 4 weeks after it starts)', s: ws.some((w) => w.status === 'verified') ? 'done' : ws.length ? 'now' : 'next', go: 'proof' },
    { k: 'Accountant approved a month', s: approved ? 'done' : 'next', go: 'accountant' },
    { k: 'Email turned on for alerts and invites', s: mail?.provider ? 'done' : 'next', go: 'system' },
  ];
  const done = steps.filter((x) => x.s === 'done').length;
  return (
    <div className="cv-page">
      <PageHead over={`First six weeks · ${eng.org?.name ?? ''}`} q="What happens between signing up and the first proven dollar?"
        sub="Read from what has actually happened in your group. Each step links to where it's done." />
      <div className="progress"><span style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <span className="cv-small cv-muted">{done} of {steps.length} done</span>
      <section className="cv-card">
        {steps.map((x) => (
          <div key={x.k} className="cv-row nowrap" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <Icon name={x.s === 'done' ? 'CircleCheck' : x.s === 'now' ? 'CircleDot' : 'Circle'} size={18} className={x.s === 'done' ? 'ok' : ''} />
            <span className="cv-small" style={{ flex: 1, fontWeight: x.s === 'now' ? 700 : 400 }}>{x.k}</span>
            {x.s !== 'done' && <Button size="sm" variant={x.s === 'now' ? 'primary' : 'ghost'} onClick={() => cv.go(x.go)}>Go</Button>}
          </div>
        ))}
      </section>
      <Callout icon="Info">The first weeks usually cost more than they save: tests take 28 days to close, and only closed tests can be billed.</Callout>
    </div>
  );
}

function CvStart() {
  const eng = useEngine();
  if (eng.mode === 'server' && eng.org && !eng.org.sample) return <StartReal />;
  return <CvStartSample />;
}

function CvStartSample() {
  const cv = useCv();
  const steps = [
    { when: "Jul 6", k: "Connected Toast, 7shifts and your invoice inbox", s: "done" },
    { when: "Jul 7", k: "Built a baseline from 13 weeks of history", s: "done" },
    { when: "Jul 8", k: "First findings, as estimates", s: "done" },
    { when: "Jul 14", k: "First weekly plan chosen (2 manager-hours)", s: "done" },
    { when: "Jul 27", k: "First change starts: Tuesday close, back of house", s: "now" },
    { when: "Aug 10", k: "First checkpoint", s: "next" },
    { when: "Aug 24", k: "First window closes: first dollar you can bank", s: "next" },
  ];
  return (
    <div className="cv-page">
      <PageHead over="First six weeks · how Walnut Creek looked on Jul 20, two weeks after connecting" q="What do I get before anything is proven?"
        sub="Nothing is counted as saved until a test closes, and the first one takes about six weeks. So the first six weeks have to be useful on their own: findings, prevented costs, data fixes and tests in flight." />
      <div className="cv-grid g4">
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Banked so far</span><span className="cv-fig md">$0</span><span className="cv-xs cv-faint">Expected. Nothing counts until a window closes.</span></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Prevented so far</span><span className="cv-fig md cv-up">$96</span><div className="cv-row" style={{ gap: 6 }}><Claim k="obs" /><span className="cv-xs cv-faint">never counted as saved</span></div></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Findings</span><span className="cv-fig md cv-exp">5</span><div className="cv-row" style={{ gap: 6 }}><Claim k="est" /><span className="cv-xs cv-faint">$1,140/wk</span></div></div>
        <div className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">Data problems fixed</span><span className="cv-fig md">2</span><span className="cv-xs cv-faint">KDS export, recipe costs</span></div>
      </div>
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <span className="cv-h4">Where you are</span>
          <div className="cv-col" style={{ gap: 0 }}>
            {steps.map((s, i) => (
              <div key={s.k} style={{ display: "grid", gridTemplateColumns: "64px 22px minmax(0, 1fr)", gap: 10, alignItems: "start", padding: "8px 0" }}>
                <span className="cv-xs cv-num cv-faint" style={{ paddingTop: 2 }}>{s.when}</span>
                <Icon name={s.s === "done" ? "CircleCheck" : s.s === "now" ? "CircleDot" : "Circle"} size={18} color={s.s === "done" ? "var(--success-600)" : s.s === "now" ? "var(--accent)" : "var(--fg-3)"} />
                <span className="cv-small" style={{ fontWeight: s.s === "now" ? 700 : 400, color: s.s === "next" ? "var(--fg-2)" : "var(--fg-1)" }}>{s.k}{s.s === "now" && <span className="cv-faint" style={{ fontWeight: 400 }}> · you are here</span>}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Useful already</span>
          <ul className="cv-ul">
            <li><Icon name="ShieldCheck" size={15} />Two overtime moves before Thursday kept $96 of premium from happening. We show it, and we never bill it.</li>
            <li><Icon name="Truck" size={15} />Valley Greens raised romaine 29.7%. That's a phone call you can make today, no test needed.</li>
            <li><Icon name="Cable" size={15} />Your kitchen display was exporting hourly averages only. Fixed, so ticket times can now be measured.</li>
            <li><Icon name="Timer" size={15} />The first test is registered before it starts, so nobody can move the goalposts later.</li>
          </ul>
          <Callout icon="Info">Slow on purpose. A restaurant week is noisy, and a saving has to stand out from an ordinary busy or quiet night before we'll put it on an invoice.</Callout>
        </section>
      </div>
      <section className="cv-card">
        <span className="cv-h4">Setup checklist</span>
        <div className="cv-grid g3">
          {[["Toast", "Connected", true], ["7shifts", "Connected, write-back on", true], ["Invoice inbox", "Forwarding set up", true], ["Recipe costs, top 15 items", "Uploaded Jul 9", true], ["QuickBooks Online", "Connect for reconciliation", false], ["Fences", "Set your limits", false]].map(([k, v, ok]) => (
            <div key={k} className="cv-row nowrap" style={{ gap: 10, alignItems: "flex-start" }}>
              <Icon name={ok ? "CircleCheck" : "Circle"} size={18} color={ok ? "var(--success-600)" : "var(--fg-3)"} />
              <div className="cv-col" style={{ gap: 2 }}><span style={{ fontWeight: 600 }}>{k}</span><span className="cv-xs cv-faint">{v}</span></div>
            </div>
          ))}
        </div>
        <div className="cv-row"><Button size="sm" onClick={() => cv.go("fences")}>Set your fences</Button><Button size="sm" variant="secondary" onClick={() => cv.go("sources")}>See every feed</Button></div>
      </section>
    </div>
  );
}

export { CvStart };
