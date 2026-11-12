'use client';

import * as React from 'react';
import { Button, Icon, Tabs } from '../../kit';
import { CV_D, CV_ROOM, Callout, Claim, Pill, PageHead, cvMoney, useCv } from '../core';
import { EXCEPTION_TYPES, controlLimits } from '../../../lib/data/model';
import { weeklySeries } from '../../../lib/data/readers';
import { engine, useEngine } from '../../engine';
import { DenseControls } from '../dense-sections';
import { LoopStrip, Diagnose, ControlChart } from '../areas';

/* ================================================================ Controls */
const EXC_LABELS = ['Jul 27', 'Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21', 'Sep 28', 'Oct 5', 'Oct 12', 'Oct 19'];
/** Room exceptions as a share of sales, last 13 weeks of the room's history (this week from the register). */
const exceptionSeries = () => CV_D.hist.rows.slice(-13).map((r) => r.excPct);
/** On a room's own Toast data: voids, comps and discounts as a share of sales, from the export's 12 weeks. */
function ownExceptionSeries() {
  const v = CV_D.room.levers?.voidWeeks;
  if (!CV_D.room.fromToast || !v?.length) return null;
  const dollars = weeklySeries(CV_D.room, 'exceptionDollars');
  const weeks = [...new Set(v.map((x) => x.week))].sort((a, b) => a - b);
  const series = weeks.map((w) => { const rows = v.filter((x) => x.week === w); const sales = rows.reduce((t, x) => t + x.sales, 0); return sales ? (rows.reduce((t, x) => t + x.exceptions, 0) / sales) * 100 : 0; });
  const labels = dollars.map((p) => new Date(`${p.weekEnd}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
  return { series, labels };
}

function talkingPoints(k, meta, T) {
  return {
    subject: `${CV_ROOM.short}: ${meta.short} with ${k.name}`,
    body: `Talking points for a conversation with ${k.name} (a reason to talk, not an accusation):\n\n• The policy: ${meta.label.toLowerCase()} need a reason and a manager OK.\n• The numbers: over the last 28 days, ${k.name}'s ${meta.note} ran at ${(k[`${meta.k}Rate`] * 100).toFixed(2)}% of their sales, against the room's ${(T.base * 100).toFixed(2)}%.\n• The limit for their volume: ${(k[`${meta.k}Ucl`] * 100).toFixed(2)}%.\n• Ask what's driving it (a regular, a menu issue, training) before anything else.\n\nFrom Coversight.`,
  };
}

function CvControls() {
  const cv = useCv();
  const S = CV_D.staff;
  const firstSignal = EXCEPTION_TYPES.find(({ k }) => S.types[k].signals.length)?.k || 'postVoid';
  const [type, setType] = React.useState(firstSignal);
  const T = S.types[type];
  const meta = EXCEPTION_TYPES.find((t) => t.k === type);
  const k = T.signals[0];
  const times = k ? k[`${type}Rate`] / T.base : 0;
  const own = ownExceptionSeries();
  const eng = useEngine();
  const series = own ? own.series : exceptionSeries();
  const labels = own ? own.labels : EXC_LABELS;
  const lim = controlLimits(series);
  const last = series[series.length - 1];
  const people = [...S.people].sort((a, b) => b[`${type}Rate`] / b[`${type}Ucl`] - a[`${type}Rate`] / a[`${type}Ucl`]);
  const wcComps = CV_D.allProof.find((p) => p.id === 'wc-comps');
  return (
    <div className="cv-page wide">
      <PageHead over={`Controls · voids, comps and discounts · ${CV_ROOM.name} · ${S.people.length} people on the register`} q="Is money leaking at the register?"
        sub="Every void, comp and discount from Toast, per person, against limits set by their own volume. A signal is a reason for a conversation, never an accusation." />
      <LoopStrip stage={S.signalCount ? 'act' : 'understand'} notes={{ detect: 'Per-person limits on every exception', understand: S.signalCount ? `${S.signalCount} signal${S.signalCount === 1 ? '' : 's'} above a limit` : 'Everyone inside their limits', act: k ? (type === 'comps' ? 'Coach the comp policy' : 'Reason code on post-send voids') : 'Nothing to act on', verify: 'Control chart, 1 false alarm a quarter' }} />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Room exceptions as a share of sales, {series.length} weeks{own ? ' (your Toast data)' : ''}</span><Claim k="obs" /></div>
          <ControlChart series={series} mean={lim.mean} ucl={lim.ucl} lcl={lim.lcl} labels={labels} />
          <span className="cv-small cv-muted">{last > lim.ucl ? <>The room is <b>above</b> its upper limit at <b className="cv-num">{last.toFixed(1)}%</b> last week.</> : <>The room is inside its limits: <b className="cv-num">{last.toFixed(1)}%</b> last week, {cvMoney(Math.round(S.weekTotal))} of {cvMoney(Math.round(CV_D.week.net))}.</>} {S.signalCount ? 'The signal is in individual people, below.' : 'Nothing to chase at the room level.'}</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">{meta.label} above the room&apos;s rate, 28 days</span><Claim k={k ? 'obs' : 'none'} /></div>
          <span className={`cv-fig lg ${k ? 'cv-exp' : ''}`}>{cvMoney(Math.round(T.excess))}</span>
          {k ? (
            <p className="cv-small" style={{ lineHeight: 1.55 }}>{k.name}&apos;s {meta.note} run at <b className="cv-num">{(k[`${type}Rate`] * 100).toFixed(2)}%</b> of their sales, {times.toFixed(1)}× the rest of the room&apos;s {(T.base * 100).toFixed(2)}%. Their limit for their volume is {(k[`${type}Ucl`] * 100).toFixed(2)}%.</p>
          ) : (
            <p className="cv-small" style={{ lineHeight: 1.55 }}>Nobody is above their limit on {meta.short} at {CV_ROOM.short}. The room rate is {(T.pbar * 100).toFixed(2)}% of sales.</p>
          )}
          <Callout icon="Info">We don&apos;t count this as a saving. It&apos;s observed leakage; only a change that holds, measured against the baseline, becomes bookable.</Callout>
          {k && type === 'postVoid' && <div className="cv-row"><Button icon="ShieldCheck" onClick={() => cv.approve('void-reason')}>Review the void rule</Button></div>}
          {k && type !== 'postVoid' && (() => { const tp = talkingPoints(k, meta, T); return <div className="cv-row"><a className="btn btn-primary btn-sm" href={`mailto:?subject=${encodeURIComponent(tp.subject)}&body=${encodeURIComponent(tp.body)}`} onClick={() => { if (eng.mode === 'server') engine.draftEmail({ kind: 'gm-note', subject: tp.subject, body: tp.body }).catch(() => null); }}><Icon name="MessageSquare" size={14} /> Email talking points to the GM</a></div>; })()}
        </section>
      </div>
      <section className="cv-card flush">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }} className="cv-row">
          <Tabs value={type} onChange={setType} tabs={EXCEPTION_TYPES.map((t) => ({ value: t.k, label: `${t.label}${S.types[t.k].signals.length ? ` · ${S.types[t.k].signals.length}` : ''}` }))} />
        </div>
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table" style={{ maxHeight: 520, overflowY: 'auto' }}>
          <table className="cv-table">
            <thead><tr><th>Person</th><th className="r">Sales, 28 days</th><th className="r">{meta.label}</th><th className="r">Rate</th><th className="r">Limit for volume</th><th>Signal</th></tr></thead>
            <tbody>
              {people.map((r) => (
                <tr key={r.name}>
                  <td style={{ fontWeight: 600 }}>{r.name} <span className="cv-xs cv-faint">{r.role}{r.added ? ' · added by hand' : ''}</span></td>
                  <td className="r">{cvMoney(r.sales)}</td>
                  <td className="r">{cvMoney(r[type])}</td>
                  <td className={`r ${r[`${type}Signal`] ? 'cv-down' : ''}`}>{(r[`${type}Rate`] * 100).toFixed(2)}%</td>
                  <td className="r">{(r[`${type}Ucl`] * 100).toFixed(2)}%</td>
                  <td>{r[`${type}Signal`] ? <Pill tone="bad" icon="TriangleAlert">Above limit</Pill> : <Pill tone="good" icon="CircleCheck">Inside</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="cv-grid g2">
        <Diagnose data={['Toast']}
          manager={k ? `${k.name}'s ${meta.short} are ${times.toFixed(1)} times the rest of the room's. That's ${cvMoney(Math.round(T.excess))} this month. It could be training or it could be a pattern. Worth a conversation this week.` : `Everyone's ${meta.short} are inside their limits. Nothing to raise this week; the chart keeps watching.`}
          fix={type === 'comps' ? 'Walk the bar through the comp policy with the numbers in hand, and require a manager PIN on comps over $25.' : 'Post-send voids need a manager PIN and a reason code. Takes about 20 seconds; most rooms see the rate settle inside a month.'}
          verify="The same control chart keeps running. If the rate stays under the old baseline for 6 weeks, the difference books at its lower bound. If it creeps back, accrual pauses on its own." />
        <section className="cv-card">
          <span className="cv-h4">The same detector, across the group</span>
          <p className="cv-small cv-muted" style={{ lineHeight: 1.55 }}>Walnut Creek&apos;s bar comps crossed their limit in September. The policy reset verified at <b className="cv-num">{cvMoney(wcComps.bookable)}/wk</b>, then paused itself on Oct 19 when comps crossed the line again. That pause is the loop working.</p>
          <div className="cv-row"><Button variant="secondary" icon="FileCheck" onClick={() => cv.go('packet', { id: 'wc-comps' })}>Open the comp-policy packet</Button></div>
        </section>
      </div>
      <DenseControls />
    </div>
  );
}

export { CvControls };
