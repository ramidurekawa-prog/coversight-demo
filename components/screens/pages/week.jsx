'use client';

import { Icon, Button } from '../../kit';
import { useEngine } from '../../engine';
import { bookedBetween, utcDay } from '../../../lib/data/billing';
import { weekBrief } from '../../../lib/data/weekbrief';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_NOW, cvPlanCandidates, cvChoosePlan, Claim, Money, Callout, Interval, PageHead } from '../core';
import { DenseWeek } from '../dense-sections';

/* Coversight — weekly and daily surfaces: This week, Today, Service, The plan.
   Everything reads the current room (CV_D). */

/* ================================================================ This week */
/* A real group's room: banked = its own verified tests' lower bounds. */
function BankedReal() {
  const cv = useCv();
  const eng = useEngine();
  const ws = (eng.windows || []).filter((w) => w.roomId === CV_D.id && (w.status === 'verified' || w.status === 'reversed')).map((w) => ({ ...w, bookedCentsBeforeReversal: Math.max(0, w.lowCents ?? 0) }));
  const live = ws.filter((w) => w.status === 'verified');
  const week = live.reduce((t, w) => t + w.bookedCents, 0) / 100;
  const today = utcDay(new Date()) + 1;
  const toDate = ws.reduce((t, w) => t + bookedBetween(w, 0, today).cents, 0) / 100;
  const running = (eng.windows || []).filter((w) => w.roomId === CV_D.id && (w.status === 'running' || w.status === 'waiting'));
  return (
    <section className="cv-card">
      <div className="cv-card-head"><span className="cv-over">Banked this week</span><Claim k="book" /></div>
      <span className={`cv-fig xl ${week ? 'cv-up' : ''}`}>{cvMoney(week, { cents: true })}</span>
      <p className="cv-sub">{live.length ? `From ${live.length} verified change${live.length === 1 ? '' : 's'}, at the cautious end of what each proved.` : running.length ? `Nothing verified yet. ${running.length} test${running.length === 1 ? ' is' : 's are'} running; the first closes at day 28.` : 'Nothing verified yet. Start a 28-day test from Today or Levers.'}</p>
      <div className="cv-sep" />
      <div className="cv-row" style={{ gap: 24 }}>
        <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">Banked to date</span><span className="cv-num" style={{ fontWeight: 600 }}>{cvMoney(toDate, { cents: true })}</span></div>
        <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">Tests running</span><span className="cv-num" style={{ fontWeight: 600 }}>{running.length}</span></div>
        <button className="cv-link" style={{ marginLeft: 'auto' }} onClick={() => cv.go('proof')}>See the proof <Icon name="ArrowRight" size={14} /></button>
      </div>
    </section>
  );
}

/* What changed, why, what next — from the room's own weekly history. */
function Spark({ pts }) {
  const w = 120, h = 28, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const xy = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - 2 - ((v - lo) / span) * (h - 4)}`).join(' ');
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={xy} fill="none" stroke="var(--accent)" strokeWidth="1.5" /></svg>;
}

function WeekBrief({ next }) {
  const cv = useCv();
  const b = weekBrief(CV_D.room.history);
  if (!b) return null;
  const up = b.vsLast.earned >= 0;
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  return (
    <section className="cv-card" aria-label="What changed this week">
      <div className="cv-card-head"><span className="cv-over">What changed · why · what next</span><Claim k="obs" /></div>
      <div className="cv-grid g3" style={{ gap: 20 }}>
        <div className="cv-col" style={{ gap: 6 }}>
          <span className="cv-xs cv-faint">What changed</span>
          <span style={{ fontWeight: 600 }}>Margin {up ? 'up' : 'down'} <span className={`cv-num ${up ? 'cv-up' : 'cv-down'}`}>{cvMoney(Math.abs(Math.round(b.vsLast.earned)))}</span> on last week</span>
          <span className="cv-small cv-muted">{cvMoney(Math.round(b.vsAvg4.earned), { sign: true })} against the 4 weeks before · sales {cvMoney(Math.round(b.vsLast.net), { sign: true })} · covers {b.vsLast.covers >= 0 ? '+' : ''}{Math.round(b.vsLast.covers)}</span>
          <div className="cv-row" style={{ gap: 8 }}><Spark pts={b.trend.map((t) => t.earned)} /><span className="cv-xs cv-faint">margin, last {b.trend.length} weeks</span></div>
        </div>
        <div className="cv-col" style={{ gap: 6 }}>
          <span className="cv-xs cv-faint">Why</span>
          <span style={{ fontWeight: 600 }}>{b.driver.label} moved it most</span>
          {b.parts.map((p) => (
            <div key={p.key} className="cv-row" style={{ justifyContent: 'space-between' }}>
              <span className="cv-small">{p.label}{p.key === 'food' ? ` (${pct(b.week.foodRate)} of sales)` : p.key === 'labour' ? ` (${pct(b.week.labourRate)})` : ''}</span>
              <span className={`cv-num cv-small ${p.amount >= 0 ? 'cv-up' : 'cv-down'}`}>{cvMoney(Math.round(p.amount), { sign: true })}</span>
            </div>
          ))}
          <span className="cv-xs cv-faint">These parts add up exactly to the change. They describe the week; they aren't savings we claim.</span>
        </div>
        <div className="cv-col" style={{ gap: 6 }}>
          <span className="cv-xs cv-faint">What next</span>
          {next ? <>
            <span style={{ fontWeight: 600 }}>{next.title}</span>
            <span className="cv-small cv-muted">{next.lever} · {next.hours * 60} min · {Math.round(next.p * 100)}% chance it verifies · estimated {cvMoney(Math.round(next.value))}/wk</span>
            <div><Claim k={next.claim} /></div>
            <div><Button size="sm" iconRight="ArrowRight" onClick={() => cv.go('plan')}>Decide in the plan</Button></div>
          </> : <span className="cv-small cv-muted">Nothing worth a manager’s time this week. The next check runs when new data arrives.</span>}
        </div>
      </div>
    </section>
  );
}

function CvThisWeek() {
  const cv = useCv();
  const eng = useEngine();
  const real = eng.mode === 'server' && eng.org && !eng.org.sample;
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
      <PageHead over={`${CV_ROOM.name} · ${d.room.fromToast ? `week ending ${d.room.fromToast.end}` : CV_NOW.week}`} q="What happened this week, and what you're doing about it" />

      <WeekBrief next={chosen.find((c) => !c.prevent) || chosen[0]} />

      <div className="cv-grid g-hero">
        {real ? <BankedReal /> : <section className="cv-card">
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
        </section>}

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
          {d.alarms.length === 0 && <Callout tone="good" icon="ShieldCheck">Nothing alarmed at {CV_ROOM.short}. Every control chart moved a little and stayed inside its limits.</Callout>}
          {d.alarms.map((a) => (
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
      <DenseWeek />
    </div>
  );
}

export { CvThisWeek };
