'use client';

import * as React from 'react';

import { Icon, Button } from '../kit';
import { useCv, cvMoney, CV_NOW, CV_DAILY, CV_DAYS_TO_DATE, CV_PERSIST, cvPlanCandidates, cvChoosePlan, CV_EXPOSURE, CV_SALMON_WK, CV_SALMON_LOST, Claim, Money, Pill, Callout, Interval, PageHead, cvScale } from './core';

/* Coversight — weekly and daily surfaces: This week, Today, Service, The plan. */

/* ================================================================ This week */
function CvThisWeek() {
  const cv = useCv();
  const plan = cvChoosePlan(cvPlanCandidates(), 2);
  const chosen = plan.sorted.filter((c) => plan.chosen.has(c.id));
  const toDate = Math.round(CV_DAILY * CV_DAYS_TO_DATE);
  return (
    <div className="cv-page">
      <PageHead over={`Rosewood Oakland · ${CV_NOW.week}`} q="What happened this week, and what you're doing about it" />

      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head">
            <span className="cv-over">Banked this week</span>
            <Claim k="book" />
          </div>
          <div className="cv-row" style={{ alignItems: "baseline", gap: 14 }}>
            <span className="cv-fig xl cv-up"><Money id="banked-week">$97</Money></span>
            <span className="cv-muted">from one change that is holding</span>
          </div>
          <p className="cv-sub">Thursday prep now starts at 8:00, and it has held for 18 weeks. Nothing new verified this week, and nothing reversed.</p>
          <Interval lo={97} pt={112} hi={127} min={60} max={160} billedLabel="what we bill on" />
          <div className="cv-sep" />
          <div className="cv-row" style={{ gap: 24 }}>
            <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">Banked to date</span><span className="cv-num" style={{ fontWeight: 600 }}><Money id="to-date">{cvMoney(toDate)}</Money></span></div>
            <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">September vs subscription</span><span className="cv-num" style={{ fontWeight: 600 }}><Money id="coverage">1.2×</Money> <span className="cv-faint" style={{ fontWeight: 400 }}>of $349</span></span></div>
            <button className="cv-link" style={{ marginLeft: "auto" }} onClick={() => cv.go("packet", { id: "thu-prep" })}>See the proof <Icon name="ArrowRight" size={14} /></button>
          </div>
        </section>

        <section className="cv-card">
          <div className="cv-card-head">
            <span className="cv-over">Earned this week</span>
            <Claim k="obs" />
          </div>
          <span className="cv-fig lg"><Money id="earned-week">$18,940</Money></span>
          <p className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>Contribution margin from your own register. Earned and saved are kept apart, so a good month never inflates what we claim.</p>
          <div className="cv-col" style={{ gap: 8 }}>
            <div className="cv-row between" style={{ justifyContent: "space-between" }}>
              <span className="cv-small">Margin vs 6 matched weeks</span>
              <span className="cv-num cv-up" style={{ fontWeight: 600 }}><Money id="margin-move">+$410</Money></span>
            </div>
            <div className="cv-decomp" style={{ height: 12 }}>
              <span style={{ width: `${(97 / 410) * 100}%`, background: "var(--claim-book)" }} />
              <span style={{ width: `${(313 / 410) * 100}%`, background: "var(--border-strong)" }} />
            </div>
            <div className="cv-legend">
              <span><i style={{ background: "var(--claim-book)" }} />We can account for $97</span>
              <span><i style={{ background: "var(--border-strong)" }} />We can't explain $313, so we don't claim it</span>
            </div>
          </div>
        </section>
      </div>

      <section className="cv-card">
        <div className="cv-card-head">
          <div className="cv-col" style={{ gap: 4 }}>
            <span className="cv-h4">Chosen for this week</span>
            <span className="cv-small cv-faint">Picked to fit 2 manager-hours, by expected value that lasts</span>
          </div>
          <Button variant="secondary" size="sm" iconRight="ArrowRight" onClick={() => cv.go("plan")}>Open the plan</Button>
        </div>
        <div className="cv-col" style={{ gap: 0 }}>
          {chosen.map((c, i) => (
            <div key={c.id} className="cv-row nowrap" style={{ padding: "12px 0", borderTop: i ? "1px solid var(--border)" : 0, gap: 14 }}>
              <span className="cv-rank">{i + 1}</span>
              <div className="cv-col" style={{ flex: 1, gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{c.title}</span>
                <span className="cv-xs cv-faint">{c.lever} · {c.hours * 60} min · {Math.round(c.p * 100)}% chance it verifies{c.needs ? " · needs current recipe costs" : ""}</span>
              </div>
              <div className="cv-col" style={{ alignItems: "flex-end", gap: 4 }}>
                <span className="cv-num" style={{ fontWeight: 600 }}>{cvMoney(Math.round(c.value))}/wk</span>
                <Claim k={c.claim} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="cv-grid g2">
        <section className="cv-card">
          <span className="cv-h4">What alarmed</span>
          <Callout tone="good" icon="ShieldCheck">Nothing alarmed at Oakland. Every control chart moved a little and stayed inside its limits.</Callout>
          <div className="cv-row nowrap" style={{ alignItems: "flex-start", gap: 12 }}>
            <span className="cv-q-ico warn"><Icon name="Siren" size={18} /></span>
            <div className="cv-col" style={{ gap: 4 }}>
              <span style={{ fontWeight: 600 }}>Walnut Creek bar comps crossed the control limit</span>
              <span className="cv-small cv-muted">Started on the Saturday Oct 17 close. The comp policy reset from September is drifting, so accrual on it pauses until it's back inside the limit.</span>
              <button className="cv-link" onClick={() => cv.go("proof")}>See it in Proof <Icon name="ArrowRight" size={14} /></button>
            </div>
          </div>
        </section>
        <section className="cv-card">
          <span className="cv-h4">In flight</span>
          <div className="cv-row nowrap" style={{ alignItems: "flex-start", gap: 12 }}>
            <span className="cv-q-ico accent"><Icon name="Timer" size={18} /></span>
            <div className="cv-col" style={{ gap: 4, flex: 1 }}>
              <span style={{ fontWeight: 600 }}>Tuesday dinner with five servers, not six</span>
              <span className="cv-small cv-muted">Checkpoint 1 of 2 passed. The window closes Nov 3, and nothing accrues until it does.</span>
              <div className="progress" style={{ marginTop: 4 }}><span style={{ width: "55%" }} /></div>
            </div>
          </div>
          <div className="cv-row nowrap" style={{ alignItems: "flex-start", gap: 12 }}>
            <span className="cv-q-ico warn"><Icon name="DatabaseZap" size={18} /></span>
            <div className="cv-col" style={{ gap: 4 }}>
              <span style={{ fontWeight: 600 }}>Salmon plate-cost test is quarantined</span>
              <span className="cv-small cv-muted">Recipe costs are 18 days old. Upload this week's costs to resume it.</span>
              <button className="cv-link" onClick={() => cv.go("today")}>It's on today's list <Icon name="ArrowRight" size={14} /></button>
            </div>
          </div>
        </section>
      </div>

      <div className="cv-card sunken" style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <Claim k="est" />
        <span className="cv-small" style={{ flex: 1, minWidth: 220 }}>
          Estimated open exposure is <Money id="exposure"><b className="cv-num">{cvMoney(Math.round(CV_EXPOSURE))}/wk</b></Money> across 6 candidates. These are estimates, so they're never added to what you've banked.
        </span>
        <button className="cv-link" onClick={() => cv.go("plan")}>See the candidates <Icon name="ArrowRight" size={14} /></button>
      </div>
    </div>
  );
}

/* ================================================================ Today (work queue) */
const CV_QUEUE = [
  { id: "cut", tone: "accent", icon: "UserMinus", title: "Approve: cut one server at 8:00 tonight", mins: 2, claim: "obs", value: "$37 tonight",
    body: "Covers are pacing 22% under a comparable Tuesday, and the band has narrowed enough to act.", primary: "Review", approval: "tue-cut" },
  { id: "recipes", tone: "warn", icon: "FileSpreadsheet", title: "Upload this week's recipe costs", mins: 5, claim: "none", value: "Unblocks 2 actions",
    body: "Recipe costs are 18 days old. Two of this week's three chosen actions need them, and the salmon test is quarantined until they arrive.", primary: "Upload CSV" },
  { id: "7shifts", tone: "bad", icon: "PlugZap", title: "Reconnect 7shifts", mins: 1, claim: "none", value: "Protects the Tuesday test",
    body: "The access token went stale 18 hours ago. Labour verification is degraded until it's reconnected.", primary: "Reconnect" },
  { id: "salmon", tone: "", icon: "Fish", title: "Decide on the salmon price", mins: 4, claim: "mod", value: `about ${cvMoney(CV_SALMON_WK)}/wk`,
    body: `$28 to $30. You'd sell about ${CV_SALMON_LOST} fewer a week, and each one left earns $2 more.`, primary: "Open simulator", go: "menu", refuse: true },
  { id: "ot", tone: "good", icon: "CalendarClock", title: "Move 4 hours off Ana's week before Thursday", mins: 1, claim: "obs", value: "$44 prevented",
    body: "Ana is tracking to 44 hours. Moving 4 to Luis avoids the overtime premium. Prevented cost is never counted as saved.", primary: "Apply" },
];

function CvToday() {
  const cv = useCv();
  const [done, setDone] = React.useState({});
  const [refused, setRefused] = React.useState({});
  const left = CV_QUEUE.filter((q) => !done[q.id] && !refused[q.id]);
  const minsLeft = left.reduce((s, q) => s + q.mins, 0);
  const finish = (q, label) => { setDone((d) => ({ ...d, [q.id]: true })); cv.toast(label || `${q.title} — done`); };
  return (
    <div className="cv-page" style={{ maxWidth: 860 }}>
      <PageHead over={`Rosewood Oakland · ${CV_NOW.label}`} q="Clear this in fifteen minutes"
        sub="A work queue, not a dashboard. Each card is one decision, with what it's worth and how long it takes." />
      <div className="cv-col" style={{ gap: 8 }}>
        <div className="cv-row" style={{ justifyContent: "space-between" }}>
          <span className="cv-small cv-muted">{CV_QUEUE.length - left.length} of {CV_QUEUE.length} cleared</span>
          <span className="cv-small cv-num cv-muted">{minsLeft ? `about ${minsLeft} min left` : "all clear"}</span>
        </div>
        <div className="progress"><span style={{ width: `${((CV_QUEUE.length - left.length) / CV_QUEUE.length) * 100}%` }} /></div>
      </div>
      {left.length === 0 ? (
        <div className="cv-empty">
          <span className="ico"><Icon name="Check" size={22} /></span>
          <span className="cv-h3">Queue clear</span>
          <span className="cv-small cv-muted" style={{ maxWidth: 380 }}>Nothing else needs you today. The next check is Thursday at 9 am, when overtime for the weekend is still preventable.</span>
          <Button variant="secondary" size="sm" onClick={() => { setDone({}); setRefused({}); }}>Reset the demo</Button>
        </div>
      ) : (
        <div className="cv-col" style={{ gap: 10 }}>
          {CV_QUEUE.map((q) => {
            if (done[q.id] || refused[q.id]) return null;
            return (
              <article key={q.id} className="cv-q-card">
                <span className={`cv-q-ico ${q.tone}`}><Icon name={q.icon} size={18} /></span>
                <div className="cv-col" style={{ gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>{q.title}</span>
                  <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{q.body}</span>
                  <div className="cv-row" style={{ gap: 8 }}>
                    <Claim k={q.claim} /><span className="cv-xs cv-num cv-muted">{q.value}</span>
                    <span className="cv-xs cv-faint">· {q.mins} min</span>
                  </div>
                </div>
                <div className="cv-q-acts">
                  {q.refuse && <Button variant="ghost" size="sm" onClick={() => { setRefused((r) => ({ ...r, [q.id]: true })); cv.toast("Noted. We won't suggest a salmon price move for 90 days."); }}>Not for us</Button>}
                  {!q.refuse && <Button variant="ghost" size="sm" onClick={() => finish(q, "Snoozed until tomorrow")}>Snooze</Button>}
                  <Button size="sm" onClick={() => {
                    if (q.approval) cv.approve(q.approval, () => setDone((d) => ({ ...d, [q.id]: true })));
                    else if (q.go) { cv.go(q.go); }
                    else finish(q);
                  }}>{q.primary}</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================================================================ Service (live, phone-first) */
const CV_SERVICE = (() => {
  const times = Array.from({ length: 20 }, (_, i) => { const m = 17 * 60 + i * 15; const h = Math.floor(m / 60), mm = m % 60; return `${h - 12}:${mm ? mm : "00"}`; });
  const comp = [3, 4, 5, 6, 7, 8, 8, 9, 9, 8, 7, 6, 5, 4, 4, 3, 2, 2, 1, 1];
  const actual = [3, 3, 4, 5, 5, 6, 6, 7, 7];
  return { times, comp, actual, now: 9 };
})();

function ServiceChart() {
  const { comp, actual, now, times } = CV_SERVICE;
  const W = 340, H = 150, P = { l: 22, r: 8, t: 10, b: 22 };
  const x = cvScale(0, comp.length - 1, P.l, W - P.r);
  const y = cvScale(0, 10, H - P.b, P.t);
  const fc = comp.map((c, i) => (i < now ? null : c * 0.78));
  const band = comp.map((c, i) => (i < now ? null : [c * 0.66, c * 0.9]));
  const bandPts = band.map((b, i) => b && [x(i), y(b[1])]).filter(Boolean).concat(band.map((b, i) => b && [x(i), y(b[0])]).filter(Boolean).reverse());
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Covers per 15 minutes tonight versus a comparable Tuesday">
      {[0, 5, 10].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 6} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
      <polyline points={comp.map((c, i) => `${x(i)},${y(c)}`).join(" ")} fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 3" />
      <polygon points={bandPts.map((p) => p.join(",")).join(" ")} fill="var(--accent)" opacity="0.14" />
      <polyline points={fc.map((c, i) => c != null && `${x(i)},${y(c)}`).filter(Boolean).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 3" />
      <polyline points={actual.map((c, i) => `${x(i)},${y(c)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(now - 1)} cy={y(actual[now - 1])} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      <line x1={x(12)} x2={x(12)} y1={P.t} y2={H - P.b} stroke="var(--warning-600)" strokeWidth="1" strokeDasharray="3 3" />
      <text x={x(12) + 4} y={P.t + 8} style={{ fill: "var(--warning-600)" }}>8:00 cut</text>
      {[0, 4, 8, 12, 16, 19].map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{times[i]}</text>)}
    </svg>
  );
}

function CvService() {
  const cv = useCv();
  const [state, setState] = React.useState("ask");
  const so = CV_SERVICE.actual.reduce((a, b) => a + b, 0);
  const cmp = CV_SERVICE.comp.slice(0, CV_SERVICE.now).reduce((a, b) => a + b, 0);
  return (
    <div className="cv-page">
      <PageHead over="The only screen a manager opens during service" q="Is tonight going the way it should?"
        sub="Live pacing against a comparable Tuesday, an intraday forecast with its band, and at most one labour decision. Built for a phone in one hand." />
      <div className="cv-phone-stage">
        <div className="cv-phone" aria-label="Phone view">
          <span className="notch" />
          <div className="cv-row" style={{ justifyContent: "space-between", padding: "0 4px" }}>
            <span style={{ fontWeight: 700 }}>Tuesday dinner</span>
            <span className="cv-num cv-small cv-muted">{CV_NOW.time}</span>
          </div>
          <section className="cv-card">
            <div className="cv-row" style={{ justifyContent: "space-between" }}>
              <span className="cv-xs cv-faint">Covers so far</span>
              <span className="cv-xs cv-down cv-num" style={{ fontWeight: 600 }}>▼ 22% vs comparable</span>
            </div>
            <div className="cv-row" style={{ alignItems: "baseline" }}>
              <span className="cv-fig lg">{so}</span>
              <span className="cv-small cv-faint">of {cmp} on a comparable Tuesday</span>
            </div>
            <ServiceChart />
            <div className="cv-legend">
              <span><i className="line" style={{ background: "var(--accent)" }} />Tonight</span>
              <span><i style={{ background: "var(--accent)", opacity: 0.25 }} />Forecast band</span>
              <span><i className="line" style={{ background: "var(--fg-3)" }} />Comparable</span>
            </div>
          </section>
          {state === "ask" && (
            <section className="cv-card" style={{ borderColor: "var(--claim-cau-line)" }}>
              <span className="cv-xs cv-faint">One suggestion</span>
              <span style={{ fontWeight: 700, fontSize: "var(--text-lg)" }}>Cut one server at 8:00</span>
              <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>Even at the top of the band, four servers cover 8–10 pm. Saves <Money id="service-cut">$37</Money> tonight.</span>
              <div className="cv-row" style={{ gap: 8 }}>
                <Button className="btn-lg" style={{ flex: 1 }} onClick={() => cv.approve("tue-cut", () => setState("yes"))}>Yes, cut Jess at 8</Button>
                <Button variant="secondary" className="btn-lg" onClick={() => { setState("no"); cv.toast("Kept five servers. Logged as declined."); }}>Not tonight</Button>
              </div>
            </section>
          )}
          {state === "yes" && <Callout tone="good" icon="CircleCheck">Schedule written back to 7shifts. Jess is notified and on call until 8:30. The monitoring window is open.</Callout>}
          {state === "no" && <Callout icon="CircleMinus">Kept five servers. We'll count tonight as declined, which teaches the ranker too.</Callout>}
          <div className="cv-grid g3" style={{ gap: 8 }}>
            {[["Ticket time", "14 min", "line 16"], ["Turn time", "47 min", "guard 52"], ["Servers on", "5", "need 4"]].map(([k, v, s]) => (
              <div key={k} className="cv-card" style={{ padding: 10, gap: 2 }}><span className="cv-xs cv-faint">{k}</span><span className="cv-num" style={{ fontWeight: 600 }}>{v}</span><span className="cv-xs cv-faint">{s}</span></div>
            ))}
          </div>
        </div>
        <div className="cv-col" style={{ gap: 16 }}>
          <section className="cv-card">
            <span className="cv-h4">Why it speaks up only now</span>
            <ul className="cv-ul">
              <li><Icon name="Activity" size={15} />The forecast band has to narrow enough that the cut is safe even at its upper edge. Before 7 pm it was too wide.</li>
              <li><Icon name="BellOff" size={15} />One message per service at most. On a normal Tuesday the phone stays silent, because alert fatigue is what kills engagement.</li>
              <li><Icon name="Fence" size={15} />The fence you set holds: never below 4 servers on dinner, never cut after 8:30.</li>
            </ul>
          </section>
          <section className="cv-card">
            <span className="cv-h4">What happens when you tap yes</span>
            <ul className="cv-ul">
              <li><Icon name="RefreshCw" size={15} />The shift change is written back to 7shifts, and Jess gets the notification.</li>
              <li><Icon name="Timer" size={15} />Tonight is logged as an execution record in the Tuesday dinner test.</li>
              <li><Icon name="ShieldAlert" size={15} />Turn time, ticket time and covers per server-hour are watched. If one crosses its line, you hear about it right away.</li>
            </ul>
          </section>
          <Callout icon="Smartphone">This screen is laid out for a phone first. Open this page on your phone to see it at full size.</Callout>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ The plan */
function CvPlan() {
  const cv = useCv();
  const [hours, setHours] = React.useState(2);
  const [open, setOpen] = React.useState("ribeye");
  const cands = React.useMemo(cvPlanCandidates, []);
  const { sorted, chosen, used } = cvChoosePlan(cands, hours);
  const edv = sorted.filter((c) => chosen.has(c.id) && !c.prevent).reduce((s, c) => s + c.edv, 0);
  const point = sorted.filter((c) => chosen.has(c.id) && !c.prevent).reduce((s, c) => s + c.value, 0);
  const maxPH = Math.max(...sorted.map((c) => c.perHour));
  return (
    <div className="cv-page wide">
      <PageHead over="Rosewood Oakland · this week" q="What do I do this week?"
        sub="Not a ranked list of everything. A chosen set that fits the hours you have, ordered by expected value that lasts, per hour of effort." />

      <section className="cv-card">
        <div className="cv-grid g3" style={{ alignItems: "end" }}>
          <div className="cv-col" style={{ gap: 8 }}>
            <label htmlFor="cv-hours" className="cv-small" style={{ fontWeight: 600 }}>Manager hours available this week: <span className="cv-num">{hours.toFixed(2).replace(/\.?0+$/, "")} h</span></label>
            <input id="cv-hours" className="cv-range" type="range" min="0.5" max="4" step="0.25" value={hours} onChange={(e) => setHours(+e.target.value)} />
            <span className="cv-xs cv-faint">Drag it. The chosen set re-forms to fit.</span>
          </div>
          <div className="cv-col" style={{ gap: 2 }}>
            <span className="cv-xs cv-faint">Expected durable value of the chosen set</span>
            <span className="cv-fig md">{cvMoney(Math.round(edv))}<span className="cv-small cv-faint" style={{ fontFamily: "var(--font-sans)", fontWeight: 400 }}>/wk</span></span>
            <span className="cv-xs cv-faint">Point estimate {cvMoney(Math.round(point))}/wk before risk and durability</span>
          </div>
          <div className="cv-col" style={{ gap: 2 }}>
            <span className="cv-xs cv-faint">Hours used</span>
            <span className="cv-fig md">{used.toFixed(2).replace(/\.?0+$/, "")} h</span>
            <span className="cv-xs cv-faint">{chosen.size} chosen · {sorted.length - chosen.size} left for later</span>
          </div>
        </div>
      </section>

      <section className="cv-card flush">
        <div className="cv-plan-row head">
          <span />
          <span>Action</span>
          <span className="r" style={{ textAlign: "right" }}>Expected /wk</span>
          <span className="hide-sm" style={{ textAlign: "right" }}>Chance</span>
          <span className="hide-sm hide-md" style={{ textAlign: "right" }}>Effort</span>
          <span className="hide-sm">Value per hour</span>
        </div>
        {sorted.map((c, i) => {
          const isIn = chosen.has(c.id);
          const isOpen = open === c.id;
          return (
            <React.Fragment key={c.id}>
              <div className={`cv-plan-row cv-tr ${isIn ? "" : "out"}`} role="button" tabIndex={0} aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : c.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : c.id); } }}>
                <span className="cv-rank">{isIn ? <Icon name="Check" size={14} /> : i + 1}</span>
                <div className="cv-col" style={{ gap: 3 }}>
                  <span className="t" style={{ fontWeight: 600 }}>{c.title}</span>
                  <div className="cv-row" style={{ gap: 6 }}><span className="cv-xs cv-faint">{c.lever} · {CV_PERSIST[c.persist].label}</span>{c.prevent && <Pill icon="ShieldCheck">Prevented, not saved</Pill>}</div>
                </div>
                <div className="cv-col" style={{ alignItems: "flex-end", gap: 3 }}>
                  <span className="cv-num" style={{ fontWeight: 600 }}>{cvMoney(Math.round(c.value))}</span>
                  {c.hi > c.lo && <span className="cv-xs cv-num cv-faint">{cvMoney(Math.round(c.lo))}–{cvMoney(Math.round(c.hi))}</span>}
                </div>
                <span className="cv-num hide-sm" style={{ textAlign: "right" }}>{Math.round(c.p * 100)}%</span>
                <span className="cv-num hide-sm hide-md" style={{ textAlign: "right" }}>{c.hours * 60} min</span>
                <div className="cv-col hide-sm" style={{ gap: 4 }}>
                  <div className="cv-decomp"><span style={{ width: `${(c.perHour / maxPH) * 100}%`, background: isIn ? "var(--accent)" : "var(--border-strong)" }} /></div>
                  <span className="cv-xs cv-num cv-faint">{cvMoney(Math.round(c.perHour))}/hr</span>
                </div>
              </div>
              {isOpen && (
                <div style={{ padding: "4px 18px 18px 60px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }} className="cv-col">
                  <p className="cv-small" style={{ lineHeight: 1.55, maxWidth: "70ch" }}>{c.why}</p>
                  <div className="cv-formula" style={{ fontSize: "var(--text-xs)" }}>
                    {`${cvMoney(Math.round(c.value))} expected × ${Math.round(c.p * 100)}% chance it verifies × ${CV_PERSIST[c.persist].w.toFixed(1)} durability ÷ ${c.hours} h = ${cvMoney(Math.round(c.perHour))} per manager-hour`}
                  </div>
                  <div className="cv-row">
                    <Claim k={c.claim} />
                    <Button size="sm" variant="ghost" onClick={() => cv.go("finding", { id: c.id })}>See the finding</Button>
                    {c.id === "ribeye" && <Button size="sm" onClick={() => cv.approve("ribeye")}>Review the price change</Button>}
                    {(c.id === "salmon" || c.id === "carb") && <Button size="sm" variant="secondary" onClick={() => cv.go("menu")}>Open in the simulator</Button>}
                    {c.id === "vendor" && <Button size="sm" variant="secondary" onClick={() => cv.go("purchasing")}>See the invoices</Button>}
                    {(c.id === "satpeak" || c.id === "shoulder") && <Button size="sm" variant="secondary" onClick={() => cv.go("labour")}>See the hours</Button>}
                    {c.id === "paystage" && <Button size="sm" variant="secondary" onClick={() => cv.go("throughput")}>Why it's $0</Button>}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </section>
      <Callout icon="Lightbulb">The biggest number is not first. The vendor renegotiation has the highest expected value, but it takes an hour. Two price changes take half an hour each and are more likely to last, so they come first.</Callout>
    </div>
  );
}

export { CvThisWeek, CvToday, CvService, CvPlan };
