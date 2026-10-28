'use client';

import * as React from 'react';

import { Icon, Button } from '../kit';
import { useCv, cvMoney, cvFill, CV_D, CV_ROOM, CV_NOW, CV_PERSIST, cvPlanCandidates, cvChoosePlan, Claim, Money, Pill, Callout, Interval, PageHead, cvScale } from './core';

/* Coversight — weekly and daily surfaces: This week, Today, Service, The plan.
   Everything reads the current room (CV_D). */

/* ================================================================ This week */
function CvThisWeek() {
  const cv = useCv();
  const d = CV_D;
  const plan = cvChoosePlan(cvPlanCandidates(), d.room.managerHours);
  const chosen = plan.sorted.filter((c) => plan.chosen.has(c.id));
  const b = d.banked;
  const lead = b.lead;
  const move = d.hist.marginMove;
  const testing = d.proofs.filter((p) => p.outcome === 'testing');
  const blocked = d.proofs.filter((p) => p.outcome === 'data');
  const elsewhere = CV_D.allProof.filter((p) => p.paused && p.loc !== d.id);
  const openCount = d.candidates.filter((c) => !c.prevent && c.value > 0).length;
  return (
    <div className="cv-page">
      <PageHead over={`${CV_ROOM.name} · ${CV_NOW.week}`} q="What happened this week, and what you're doing about it" />

      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head">
            <span className="cv-over">Banked this week</span>
            <Claim k="book" />
          </div>
          <div className="cv-row" style={{ alignItems: 'baseline', gap: 14 }}>
            <span className={`cv-fig xl ${b.week ? 'cv-up' : ''}`}><Money id="banked-week">{cvMoney(b.week)}</Money></span>
            <span className="cv-muted">{d.room.banked.from}</span>
          </div>
          <p className="cv-sub">{d.room.banked.note}</p>
          {lead && <Interval lo={lead.lo} pt={lead.point} hi={lead.hi} min={Math.round(lead.lo * 0.6)} max={Math.round(lead.hi * 1.25)} billedLabel="what we bill on" />}
          <div className="cv-sep" />
          <div className="cv-row" style={{ gap: 24 }}>
            <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">Banked to date</span><span className="cv-num" style={{ fontWeight: 600 }}><Money id="to-date">{cvMoney(Math.round(b.toDate))}</Money></span></div>
            <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">September vs subscription</span><span className="cv-num" style={{ fontWeight: 600 }}><Money id="coverage">{b.coverage.toFixed(1)}×</Money> <span className="cv-faint" style={{ fontWeight: 400 }}>of $349</span></span></div>
            <button className="cv-link" style={{ marginLeft: 'auto' }} onClick={() => cv.go(lead ? 'packet' : 'proof', lead ? { id: lead.id } : undefined)}>See the proof <Icon name="ArrowRight" size={14} /></button>
          </div>
        </section>

        <section className="cv-card">
          <div className="cv-card-head">
            <span className="cv-over">Earned this week</span>
            <Claim k="obs" />
          </div>
          <span className="cv-fig lg"><Money id="earned-week">{cvMoney(Math.round(d.week.earned))}</Money></span>
          <p className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>Contribution margin from your own register. Earned and saved are kept apart, so a good month never inflates what we claim.</p>
          <div className="cv-col" style={{ gap: 8 }}>
            <div className="cv-row between" style={{ justifyContent: 'space-between' }}>
              <span className="cv-small">Margin vs 6 matched weeks</span>
              <span className={`cv-num ${move >= 0 ? 'cv-up' : 'cv-down'}`} style={{ fontWeight: 600 }}><Money id="margin-move">{cvMoney(Math.round(move), { sign: true })}</Money></span>
            </div>
            {move > 0 ? (
              <>
                <div className="cv-decomp" style={{ height: 12 }}>
                  <span style={{ width: `${(d.claimable / move) * 100}%`, background: 'var(--claim-book)' }} />
                  <span style={{ width: `${(d.unexplained / move) * 100}%`, background: 'var(--border-strong)' }} />
                </div>
                <div className="cv-legend">
                  <span><i style={{ background: 'var(--claim-book)' }} />We can account for {cvMoney(Math.round(d.claimable))}</span>
                  <span><i style={{ background: 'var(--border-strong)' }} />We can't explain {cvMoney(Math.round(d.unexplained))}, so we don't claim it</span>
                </div>
              </>
            ) : (
              <span className="cv-small cv-muted">Below matched weeks, and nothing we changed explains it. We don't claim a cause we didn't measure, either way.</span>
            )}
          </div>
        </section>
      </div>

      <section className="cv-card">
        <div className="cv-card-head">
          <div className="cv-col" style={{ gap: 4 }}>
            <span className="cv-h4">Chosen for this week</span>
            <span className="cv-small cv-faint">Picked to fit {d.room.managerHours} manager-hours, by expected value that lasts</span>
          </div>
          <Button variant="secondary" size="sm" iconRight="ArrowRight" onClick={() => cv.go('plan')}>Open the plan</Button>
        </div>
        <div className="cv-col" style={{ gap: 0 }}>
          {chosen.map((c, i) => (
            <div key={c.id} className="cv-row nowrap" style={{ padding: '12px 0', borderTop: i ? '1px solid var(--border)' : 0, gap: 14 }}>
              <span className="cv-rank">{i + 1}</span>
              <div className="cv-col" style={{ flex: 1, gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{c.title}</span>
                <span className="cv-xs cv-faint">{c.lever} · {c.hours * 60} min · {Math.round(c.p * 100)}% chance it verifies{c.needs ? ' · needs current recipe costs' : ''}{c.prevent ? ' · prevented, not saved' : ''}</span>
              </div>
              <div className="cv-col" style={{ alignItems: 'flex-end', gap: 4 }}>
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
          {d.room.alarms.length === 0 && <Callout tone="good" icon="ShieldCheck">Nothing alarmed at {CV_ROOM.short}. Every control chart moved a little and stayed inside its limits.</Callout>}
          {d.room.alarms.map((a) => (
            <div key={a.title} className="cv-row nowrap" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span className="cv-q-ico warn"><Icon name="Siren" size={18} /></span>
              <div className="cv-col" style={{ gap: 4 }}>
                <span style={{ fontWeight: 600 }}>{a.title}</span>
                <span className="cv-small cv-muted">{a.body}</span>
                <button className="cv-link" onClick={() => cv.go(a.go)}>See it <Icon name="ArrowRight" size={14} /></button>
              </div>
            </div>
          ))}
          {elsewhere.map((p) => (
            <div key={p.id} className="cv-row nowrap" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span className="cv-q-ico"><Icon name="CirclePause" size={18} /></span>
              <div className="cv-col" style={{ gap: 4 }}>
                <span style={{ fontWeight: 600 }}>Elsewhere in the group: {p.title.toLowerCase()} is paused</span>
                <span className="cv-small cv-muted">{p.reason}</span>
                <button className="cv-link" onClick={() => cv.go('packet', { id: p.id })}>Open the packet <Icon name="ArrowRight" size={14} /></button>
              </div>
            </div>
          ))}
        </section>
        <section className="cv-card">
          <span className="cv-h4">In flight</span>
          {testing.length === 0 && blocked.length === 0 && <span className="cv-small cv-muted">No tests running at {CV_ROOM.short} this week.</span>}
          {testing.map((p) => (
            <div key={p.id} className="cv-row nowrap" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span className="cv-q-ico accent"><Icon name="Timer" size={18} /></span>
              <div className="cv-col" style={{ gap: 4, flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{p.title}</span>
                <span className="cv-small cv-muted">{p.checkpoint}. The window closes {p.closes}, and nothing accrues until it does.</span>
                <div className="progress" style={{ marginTop: 4 }}><span style={{ width: `${p.progress || 10}%` }} /></div>
              </div>
            </div>
          ))}
          {blocked.map((p) => (
            <div key={p.id} className="cv-row nowrap" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span className="cv-q-ico warn"><Icon name="DatabaseZap" size={18} /></span>
              <div className="cv-col" style={{ gap: 4 }}>
                <span style={{ fontWeight: 600 }}>{p.title}: quarantined</span>
                <span className="cv-small cv-muted">{p.reason}</span>
                <button className="cv-link" onClick={() => cv.go(p.unblockedBy ? 'inputs' : 'sources')}>{p.unblockedBy ? 'Enter the data' : 'Fix the feed'} <Icon name="ArrowRight" size={14} /></button>
              </div>
            </div>
          ))}
        </section>
      </div>

      <div className="cv-card sunken" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <Claim k="est" />
        <span className="cv-small" style={{ flex: 1, minWidth: 220 }}>
          Estimated open exposure is <Money id="exposure"><b className="cv-num">{cvMoney(Math.round(d.exposure))}/wk</b></Money> across {openCount} candidates. These are estimates, so they're never added to what you've banked.
        </span>
        <button className="cv-link" onClick={() => cv.go('plan')}>See the candidates <Icon name="ArrowRight" size={14} /></button>
      </div>
    </div>
  );
}

/* ================================================================ Today (work queue) */
function CvToday() {
  const cv = useCv();
  const queue = CV_D.room.queue.map((q) => ({ ...q, value: cvFill(q.value), body: cvFill(q.body) }));
  const [done, setDone] = React.useState({});
  const [refused, setRefused] = React.useState({});
  const left = queue.filter((q) => !done[q.id] && !refused[q.id]);
  const minsLeft = left.reduce((s, q) => s + q.mins, 0);
  const finish = (q, label) => { setDone((d) => ({ ...d, [q.id]: true })); cv.toast(label || `${q.title} — done`); };
  return (
    <div className="cv-page" style={{ maxWidth: 860 }}>
      <PageHead over={`${CV_ROOM.name} · ${CV_NOW.label}`} q="Clear this in fifteen minutes"
        sub="A work queue, not a dashboard. Each card is one decision, with what it's worth and how long it takes." />
      <div className="cv-col" style={{ gap: 8 }}>
        <div className="cv-row" style={{ justifyContent: 'space-between' }}>
          <span className="cv-small cv-muted">{queue.length - left.length} of {queue.length} cleared</span>
          <span className="cv-small cv-num cv-muted">{minsLeft ? `about ${minsLeft} min left` : 'all clear'}</span>
        </div>
        <div className="progress"><span style={{ width: `${((queue.length - left.length) / queue.length) * 100}%` }} /></div>
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
          {queue.map((q) => {
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
                  {q.refuse && <Button variant="ghost" size="sm" onClick={() => { setRefused((r) => ({ ...r, [q.id]: true })); cv.toast('Noted. We won’t suggest this again for 90 days.'); }}>Not for us</Button>}
                  {!q.refuse && <Button variant="ghost" size="sm" onClick={() => finish(q, 'Snoozed until tomorrow')}>Snooze</Button>}
                  <Button size="sm" onClick={() => {
                    if (q.approval) cv.approve(q.approval, () => setDone((d) => ({ ...d, [q.id]: true })));
                    else if (q.go) cv.go(q.go, q.input ? { kind: q.input } : undefined);
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
function serviceTimes(n) {
  return Array.from({ length: n }, (_, i) => { const m = 17 * 60 + i * 15; const h = Math.floor(m / 60), mm = m % 60; return `${h - 12}:${mm ? mm : '00'}`; });
}

function ServiceChart({ s }) {
  const { comp, actual, now, factor, mode } = s;
  const times = serviceTimes(comp.length);
  const W = 340, H = 150, P = { l: 22, r: 8, t: 10, b: 22 };
  const x = cvScale(0, comp.length - 1, P.l, W - P.r);
  const y = cvScale(0, 10, H - P.b, P.t);
  const fc = comp.map((c, i) => (i < now ? null : c * factor));
  const spread = mode === 'wait' ? 0.2 : 0.12;
  const band = comp.map((c, i) => (i < now ? null : [c * factor * (1 - spread), c * factor * (1 + spread)]));
  const bandPts = band.map((b, i) => b && [x(i), y(b[1])]).filter(Boolean).concat(band.map((b, i) => b && [x(i), y(b[0])]).filter(Boolean).reverse());
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Covers per 15 minutes tonight versus a comparable night">
      {[0, 5, 10].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 6} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
      <polyline points={comp.map((c, i) => `${x(i)},${y(c)}`).join(' ')} fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 3" />
      <polygon points={bandPts.map((p) => p.join(',')).join(' ')} fill="var(--accent)" opacity="0.14" />
      <polyline points={fc.map((c, i) => c != null && `${x(i)},${y(c)}`).filter(Boolean).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 3" />
      <polyline points={actual.map((c, i) => `${x(i)},${y(c)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(now - 1)} cy={y(actual[now - 1])} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      {mode === 'cut' && <><line x1={x(12)} x2={x(12)} y1={P.t} y2={H - P.b} stroke="var(--warning-600)" strokeWidth="1" strokeDasharray="3 3" /><text x={x(12) + 4} y={P.t + 8} style={{ fill: 'var(--warning-600)' }}>8:00 cut</text></>}
      {[0, 4, 8, 12, 16, 19].map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{times[i]}</text>)}
    </svg>
  );
}

function CvService() {
  const cv = useCv();
  const s = CV_D.room.service;
  const [state, setState] = React.useState('ask');
  const so = s.actual.reduce((a, b) => a + b, 0);
  const cmp = s.comp.slice(0, s.now).reduce((a, b) => a + b, 0);
  return (
    <div className="cv-page">
      <PageHead over={`The only screen a manager opens during service · ${CV_ROOM.name}`} q="Is tonight going the way it should?"
        sub="Live pacing against a comparable night, an intraday forecast with its band, and at most one labour decision. Built for a phone in one hand." />
      <div className="cv-phone-stage">
        <div className="cv-phone" aria-label="Phone view">
          <span className="notch" />
          <div className="cv-row" style={{ justifyContent: 'space-between', padding: '0 4px' }}>
            <span style={{ fontWeight: 700 }}>{s.day}</span>
            <span className="cv-num cv-small cv-muted">{CV_NOW.time}</span>
          </div>
          <section className="cv-card">
            <div className="cv-row" style={{ justifyContent: 'space-between' }}>
              <span className="cv-xs cv-faint">Covers so far</span>
              <span className={`cv-xs cv-num ${s.pace < 0 ? 'cv-down' : 'cv-up'}`} style={{ fontWeight: 600 }}>{s.pace < 0 ? '▼' : '▲'} {Math.abs(s.pace)}% vs comparable</span>
            </div>
            <div className="cv-row" style={{ alignItems: 'baseline' }}>
              <span className="cv-fig lg">{so}</span>
              <span className="cv-small cv-faint">of {cmp} on a comparable night</span>
            </div>
            <ServiceChart s={s} />
            <div className="cv-legend">
              <span><i className="line" style={{ background: 'var(--accent)' }} />Tonight</span>
              <span><i style={{ background: 'var(--accent)', opacity: 0.25 }} />Forecast band</span>
              <span><i className="line" style={{ background: 'var(--fg-3)' }} />Comparable</span>
            </div>
          </section>
          {s.mode === 'cut' && state === 'ask' && (
            <section className="cv-card" style={{ borderColor: 'var(--claim-cau-line)' }}>
              <span className="cv-xs cv-faint">One suggestion</span>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{s.title}</span>
              <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{s.body} Saves <Money id="service-cut">{cvMoney(s.value)}</Money> tonight.</span>
              <div className="cv-row" style={{ gap: 8 }}>
                <Button className="btn-lg" style={{ flex: 1 }} onClick={() => cv.approve(s.approval, () => setState('yes'))}>{s.yes}</Button>
                <Button variant="secondary" className="btn-lg" onClick={() => { setState('no'); cv.toast('Kept everyone on. Logged as declined.'); }}>Not tonight</Button>
              </div>
            </section>
          )}
          {s.mode !== 'cut' && (
            <section className="cv-card">
              <span className="cv-xs cv-faint">{s.mode === 'quiet' ? 'No suggestion' : 'Not yet'}</span>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{s.title}</span>
              <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{s.body}</span>
            </section>
          )}
          {state === 'yes' && <Callout tone="good" icon="CircleCheck">Schedule written back to 7shifts. The server is notified and on call until 8:30. The monitoring window is open.</Callout>}
          {state === 'no' && <Callout icon="CircleMinus">Kept everyone on. We'll count tonight as declined, which teaches the ranker too.</Callout>}
          <div className="cv-grid g3" style={{ gap: 8 }}>
            {s.tiles.map(([k, v, t]) => (
              <div key={k} className="cv-card" style={{ padding: 10, gap: 2 }}><span className="cv-xs cv-faint">{k}</span><span className="cv-num" style={{ fontWeight: 600 }}>{v}</span><span className="cv-xs cv-faint">{t}</span></div>
            ))}
          </div>
        </div>
        <div className="cv-col" style={{ gap: 16 }}>
          <section className="cv-card">
            <span className="cv-h4">Why it speaks up only when it does</span>
            <ul className="cv-ul">
              <li><Icon name="Activity" size={15} />The forecast band has to narrow enough that a change is safe even at its upper edge. Early in service it's too wide.</li>
              <li><Icon name="BellOff" size={15} />One message per service at most. On a normal night the phone stays silent, because alert fatigue is what kills engagement.</li>
              <li><Icon name="Fence" size={15} />The fence you set holds: never below 4 servers on dinner, never cut after 8:30.</li>
            </ul>
          </section>
          <section className="cv-card">
            <span className="cv-h4">Tonight in the other rooms</span>
            <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>Each room's service screen runs the same rules. Switch rooms in the top bar: one room has a cut ready, one is quiet, and one is waiting for the band to narrow.</span>
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
  const [hours, setHours] = React.useState(CV_D.room.managerHours);
  const cands = cvPlanCandidates();
  const [open, setOpen] = React.useState(cands[0]?.id);
  const { sorted, chosen, used } = cvChoosePlan(cands, hours);
  const edv = sorted.filter((c) => chosen.has(c.id) && !c.prevent).reduce((s, c) => s + c.edv, 0);
  const point = sorted.filter((c) => chosen.has(c.id) && !c.prevent).reduce((s, c) => s + c.value, 0);
  const maxPH = Math.max(...sorted.map((c) => c.perHour)) || 1;
  const go = { Menu: 'menu', Purchasing: 'purchasing', Labour: 'labour', Throughput: 'throughput', Controls: 'controls', Inventory: 'inventory', Channels: 'channels', Kitchen: 'kitchen' };
  return (
    <div className="cv-page wide">
      <PageHead over={`${CV_ROOM.name} · this week`} q="What do I do this week?"
        sub="Not a ranked list of everything. A chosen set that fits the hours you have, ordered by expected value that lasts, per hour of effort." />

      <section className="cv-card">
        <div className="cv-grid g3" style={{ alignItems: 'end' }}>
          <div className="cv-col" style={{ gap: 8 }}>
            <label htmlFor="cv-hours" className="cv-small" style={{ fontWeight: 600 }}>Manager hours available this week: <span className="cv-num">{hours.toFixed(2).replace(/\.?0+$/, '')} h</span></label>
            <input id="cv-hours" className="cv-range" type="range" min="0.5" max="5" step="0.25" value={hours} onChange={(e) => setHours(+e.target.value)} />
            <span className="cv-xs cv-faint">Drag it. The chosen set re-forms to fit.</span>
          </div>
          <div className="cv-col" style={{ gap: 2 }}>
            <span className="cv-xs cv-faint">Expected durable value of the chosen set</span>
            <span className="cv-fig md">{cvMoney(Math.round(edv))}<span className="cv-small cv-faint" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400 }}>/wk</span></span>
            <span className="cv-xs cv-faint">Point estimate {cvMoney(Math.round(point))}/wk before risk and durability</span>
          </div>
          <div className="cv-col" style={{ gap: 2 }}>
            <span className="cv-xs cv-faint">Hours used</span>
            <span className="cv-fig md">{used.toFixed(2).replace(/\.?0+$/, '')} h</span>
            <span className="cv-xs cv-faint">{chosen.size} chosen · {sorted.length - chosen.size} left for later</span>
          </div>
        </div>
      </section>

      <section className="cv-card flush">
        <div className="cv-plan-row head">
          <span />
          <span>Action</span>
          <span className="r" style={{ textAlign: 'right' }}>Expected /wk</span>
          <span className="hide-sm" style={{ textAlign: 'right' }}>Chance</span>
          <span className="hide-sm hide-md" style={{ textAlign: 'right' }}>Effort</span>
          <span className="hide-sm">Value per hour</span>
        </div>
        {sorted.map((c, i) => {
          const isIn = chosen.has(c.id);
          const isOpen = open === c.id;
          return (
            <React.Fragment key={c.id}>
              <div className={`cv-plan-row cv-tr ${isIn ? '' : 'out'}`} role="button" tabIndex={0} aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : c.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(isOpen ? null : c.id); } }}>
                <span className="cv-rank">{isIn ? <Icon name="Check" size={14} /> : i + 1}</span>
                <div className="cv-col" style={{ gap: 3 }}>
                  <span className="t" style={{ fontWeight: 600 }}>{c.title}</span>
                  <div className="cv-row" style={{ gap: 6 }}><span className="cv-xs cv-faint">{c.lever} · {CV_PERSIST[c.persist].label}</span>{c.prevent && <Pill icon="ShieldCheck">Prevented, not saved</Pill>}</div>
                </div>
                <div className="cv-col" style={{ alignItems: 'flex-end', gap: 3 }}>
                  <span className="cv-num" style={{ fontWeight: 600 }}>{cvMoney(Math.round(c.value))}</span>
                  {c.hi > c.lo && <span className="cv-xs cv-num cv-faint">{cvMoney(Math.round(c.lo))}–{cvMoney(Math.round(c.hi))}</span>}
                </div>
                <span className="cv-num hide-sm" style={{ textAlign: 'right' }}>{Math.round(c.p * 100)}%</span>
                <span className="cv-num hide-sm hide-md" style={{ textAlign: 'right' }}>{c.hours * 60} min</span>
                <div className="cv-col hide-sm" style={{ gap: 4 }}>
                  <div className="cv-decomp"><span style={{ width: `${(Math.max(0, c.perHour) / maxPH) * 100}%`, background: isIn ? 'var(--accent)' : 'var(--border-strong)' }} /></div>
                  <span className="cv-xs cv-num cv-faint">{cvMoney(Math.round(c.perHour))}/hr</span>
                </div>
              </div>
              {isOpen && (
                <div style={{ padding: '4px 18px 18px 60px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }} className="cv-col">
                  <p className="cv-small" style={{ lineHeight: 1.55, maxWidth: '70ch' }}>{c.why}</p>
                  <div className="cv-formula" style={{ fontSize: 'var(--text-xs)' }}>
                    {`${cvMoney(Math.round(c.value))} expected × ${Math.round(c.p * 100)}% chance it verifies × ${CV_PERSIST[c.persist].w.toFixed(1)} durability ÷ ${c.hours} h = ${cvMoney(Math.round(c.perHour))} per manager-hour`}
                  </div>
                  <div className="cv-row">
                    <Claim k={c.claim} />
                    <Button size="sm" variant="ghost" onClick={() => cv.go('finding', { id: c.id })}>See the finding</Button>
                    {c.kind === 'price' && <Button size="sm" onClick={() => cv.approve(`price:${c.item}:${c.to}`)}>Review the price change</Button>}
                    {c.kind === 'markup' && <Button size="sm" onClick={() => cv.approve('delivery-markup')}>Review the markup</Button>}
                    {go[c.lever] && <Button size="sm" variant="secondary" onClick={() => cv.go(go[c.lever])}>Open {c.lever.toLowerCase()}</Button>}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </section>
      <Callout icon="Lightbulb">The biggest number is not always first. Ranking is by expected value that lasts, per hour of a manager's time, so a quick, likely, durable change beats a bigger one that takes an afternoon.</Callout>
    </div>
  );
}

export { CvThisWeek, CvToday, CvService, CvPlan };
