'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useEngine, useSaved } from '../../engine';
import { dataEnd as roomDataEnd } from '../../../lib/data/readers';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_PERSIST, cvPlanCandidates, cvChoosePlan, Claim, Pill, Callout, PageHead } from '../core';

/* ================================================================ The plan */
const TASK_LABEL = { open: 'Approved · to make', done: 'Made · waiting for data', verified: 'Confirmed in Toast', mismatch: 'Not in Toast yet' };

/** Where a finding stands: an approval task, a running test, or an estimated cost underneath it. */
function planStatus(c, eng) {
  const out = [];
  const approval = c.kind === 'price' ? `price:${c.item}:${c.to}` : c.kind === 'markup' ? 'delivery-markup' : null;
  const t = approval && (eng.tasks || []).find((x) => x.roomId === CV_D.id && x.approvalId === approval && x.status !== 'cancelled');
  if (t) out.push({ tone: t.status === 'verified' ? 'good' : t.status === 'mismatch' ? 'warn' : 'info', icon: 'ListChecks', label: TASK_LABEL[t.status] || t.status });
  const w = c.kind === 'price' && (eng.windows || []).find((x) => x.roomId === CV_D.id && x.lever === 'menu_margin' && x.dish === c.item && x.status !== 'stopped');
  if (w) out.push({ tone: w.status === 'verified' ? 'good' : 'info', icon: 'Timer', label: w.status === 'running' ? `Testing · day ${w.day} of 28` : w.status === 'verified' ? 'Verified' : w.status });
  const dish = c.kind === 'price' && CV_D.room.menu.find((m) => m.key === c.item);
  if (dish?.costEstimated) out.push({ tone: 'warn', icon: 'Calculator', label: 'Plate cost estimated' });
  return out;
}

function CvPlan() {
  const cv = useCv();
  const eng = useEngine();
  const [plan, setPlan] = useSaved('plan', { hours: CV_D.room.managerHours });
  const hours = plan.hours;
  const setHours = (h) => setPlan({ hours: h }, `Manager hours set to ${h} h`);
  const [dismissed] = useSaved('findings', {});
  const cands = cvPlanCandidates().filter((c) => !(dismissed[c.id] && dismissed[c.id] > new Date().toISOString()));
  const [open, setOpen] = React.useState(cands[0]?.id);
  const { sorted, chosen, used } = cvChoosePlan(cands, hours);
  const edv = sorted.filter((c) => chosen.has(c.id) && !c.prevent).reduce((s, c) => s + c.edv, 0);
  const point = sorted.filter((c) => chosen.has(c.id) && !c.prevent).reduce((s, c) => s + c.value, 0);
  const maxPH = Math.max(...sorted.map((c) => c.perHour)) || 1;
  const go = { Menu: 'menu', Purchasing: 'purchasing', Labour: 'labour', Throughput: 'throughput', Controls: 'controls', Inventory: 'inventory', Channels: 'channels', Kitchen: 'kitchen' };
  return (
    <div className="cv-page wide">
      <PageHead over={`${CV_ROOM.name} · this week`} q="What do I do this week?"
        sub={`Not a ranked list of everything. A chosen set that fits the hours you have, ordered by expected value that lasts, per hour of effort.${CV_D.room.fromToast ? ` Valued from your Toast data through ${roomDataEnd(CV_D.room)}.` : ''}`} />

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
                  <div className="cv-row" style={{ gap: 6 }}><span className="cv-xs cv-faint">{c.lever} · {CV_PERSIST[c.persist].label}</span>{c.prevent && <Pill icon="ShieldCheck">Prevented, not saved</Pill>}{planStatus(c, eng).map((p) => <Pill key={p.label} tone={p.tone} icon={p.icon}>{p.label}</Pill>)}</div>
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

export { CvPlan };
