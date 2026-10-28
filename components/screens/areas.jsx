'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../kit';
import { CV_CLAIM, CV_D, CV_ROOM, Callout, Claim, Money, Pill, PageHead, cvMoney, cvScale, useCv } from './core';
import { EXCEPTION_TYPES, controlLimits } from '../../lib/data/model';

/* Operating areas (V3, from the "map of restaurant inefficiencies" sheets).
 * Every area runs the same closed loop (detect → understand → act → verify),
 * and every diagnostic screen answers the same four things: what data it
 * needs, the chart that shows it, what to tell the GM in plain English, and
 * the fix, plus how we'll know the fix worked. All figures come from the
 * current room's data (CV_D). */

/* ================================================================ the loop */
const CV_LOOP = [
  { k: 'detect', label: 'Detect', icon: 'ScanSearch', sub: 'A detector finds it in your data' },
  { k: 'understand', label: 'Understand', icon: 'ChartColumn', sub: 'The chart, the cause and the dollars' },
  { k: 'act', label: 'Act', icon: 'MousePointerClick', sub: 'One fix, approved in the app' },
  { k: 'verify', label: 'Verify', icon: 'BadgeCheck', sub: 'Measured against matched controls' },
];
const CV_STAGE_IDX = { none: -1, detect: 0, understand: 1, act: 2, verify: 3 };

/** The four-step loop with the current step highlighted. `notes` overrides each step's sub-line. */
function LoopStrip({ stage, notes = {} }) {
  const at = CV_STAGE_IDX[stage];
  return (
    <ol className="cv-loop" aria-label="Where this is in the loop">
      {CV_LOOP.map((s, i) => (
        <li key={s.k} className={i < at ? 'done' : i === at ? 'on' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="n">{i < at ? <Icon name="Check" size={14} /> : <Icon name={s.icon} size={14} />}</span>
          <span className="cv-col" style={{ gap: 1 }}>
            <b>{s.label}</b>
            <span className="cv-xs cv-muted">{notes[s.k] || s.sub}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const CV_FEED_TONE = { healthy: ['good', 'CircleCheck'], stale: ['warn', 'Clock'], partial: ['warn', 'CircleDot'], off: ['neutral', 'CircleMinus'] };
function FeedChip({ name }) {
  const f = CV_D.feeds.find((x) => x.name === name);
  const [tone, icon] = f ? CV_FEED_TONE[f.state] : ['neutral', 'CircleMinus'];
  return <Pill tone={tone} icon={f?.manual ? 'PencilLine' : icon}>{name}</Pill>;
}

/** The reference sheets' diagnostic method, as one card. */
function Diagnose({ data, manager, fix, verify }) {
  return (
    <section className="cv-card cv-diag">
      <div className="cv-diag-row">
        <span className="cv-over"><Icon name="Database" size={13} />Data it needs</span>
        <div className="cv-row" style={{ gap: 6 }}>{data.map((d) => <FeedChip key={d} name={d} />)}</div>
      </div>
      <div className="cv-diag-row">
        <span className="cv-over"><Icon name="MessageSquareQuote" size={13} />What to tell the GM</span>
        <p className="cv-quote">&ldquo;{manager}&rdquo;</p>
      </div>
      <div className="cv-diag-row">
        <span className="cv-over"><Icon name="Wrench" size={13} />The fix</span>
        <span className="cv-small" style={{ lineHeight: 1.5 }}>{fix}</span>
      </div>
      <div className="cv-diag-row">
        <span className="cv-over"><Icon name="RefreshCcw" size={13} />How we&apos;ll know it worked</span>
        <span className="cv-small" style={{ lineHeight: 1.5 }}>{verify}</span>
      </div>
    </section>
  );
}

/* ================================================================ Controls */
const EXC_LABELS = ['Jul 27', 'Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21', 'Sep 28', 'Oct 5', 'Oct 12', 'Oct 19'];
/** Room exceptions as a share of sales, last 13 weeks of the room's history (this week from the register). */
const exceptionSeries = () => CV_D.hist.rows.slice(-13).map((r) => r.excPct);

function ControlChart({ series, mean, ucl, lcl, unit = '%', labels }) {
  const W = 560, H = 190, P = { l: 34, r: 16, t: 14, b: 26 };
  const lo = Math.min(lcl, ...series) * 0.96, hi = Math.max(ucl, ...series) * 1.03;
  const x = cvScale(0, series.length - 1, P.l, W - P.r);
  const y = cvScale(lo, hi, H - P.b, P.t);
  const path = series.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Control chart">
      {[[ucl, 'UCL'], [mean, 'mean'], [lcl, 'LCL']].map(([v, k]) => (
        <g key={k}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke={k === 'mean' ? 'var(--border-strong)' : 'var(--money-down)'} strokeDasharray={k === 'mean' ? '' : '4 4'} />
          <text x={P.l - 4} y={y(v) + 3} textAnchor="end">{k === 'mean' ? `${v.toFixed(1)}${unit}` : k}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {series.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === series.length - 1 ? 4.5 : 3} fill={v > ucl || v < lcl ? 'var(--money-down)' : i === series.length - 1 ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" strokeWidth="1.5" />)}
      {labels && labels.map((l, i) => (i % 3 === 0 || i === labels.length - 1) && <text key={l} className="lbl" x={x(i)} y={H - 8} textAnchor="middle">{l}</text>)}
    </svg>
  );
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
  const series = exceptionSeries();
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
          <div className="cv-card-head"><span className="cv-h4">Room exceptions as a share of sales, 13 weeks</span><Claim k="obs" /></div>
          <ControlChart series={series} mean={lim.mean} ucl={lim.ucl} lcl={lim.lcl} labels={EXC_LABELS} />
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
          {k && type === 'comps' && <div className="cv-row"><Button icon="MessageSquare" onClick={() => cv.toast(`Talking points for ${k.name} sent to ${CV_ROOM.gm}: the policy, the numbers, and the limit.`)}>Send talking points to the GM</Button></div>}
        </section>
      </div>
      <section className="cv-card flush">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }} className="cv-row">
          <Tabs value={type} onChange={setType} tabs={EXCEPTION_TYPES.map((t) => ({ value: t.k, label: `${t.label}${S.types[t.k].signals.length ? ` · ${S.types[t.k].signals.length}` : ''}` }))} />
        </div>
        <div className="cv-tablewrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
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
    </div>
  );
}

/* ================================================================ Kitchen */
function TicketChart({ t }) {
  const W = 560, H = 200, P = { l: 30, r: 14, t: 14, b: 26 };
  const hours = ['5 pm', '6 pm', '7 pm', '8 pm', '9 pm', '10 pm'];
  const n = hours.length;
  const x = cvScale(0, n - 1, P.l + 20, W - P.r - 20);
  const y = cvScale(8, 22, H - P.b, P.t);
  const line = (s) => s.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Ticket time by hour, Friday and Saturday, against a ${t.target}-minute target`}>
      {[10, 14, 18].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 4} y={y(v) + 3} textAnchor="end">{v}m</text></g>)}
      <line x1={P.l} x2={W - P.r} y1={y(t.target)} y2={y(t.target)} stroke="var(--money-down)" strokeDasharray="4 4" />
      <path d={line(t.fri)} fill="none" stroke="var(--cat-2)" strokeWidth="2" />
      <path d={line(t.sat)} fill="none" stroke="var(--cat-1)" strokeWidth="2" strokeDasharray="6 3" />
      {t.sat.map((v, i) => <circle key={`s${i}`} cx={x(i)} cy={y(v)} r="3" fill="var(--cat-1)" />)}
      {t.fri.map((v, i) => <rect key={`f${i}`} x={x(i) - 3} y={y(v) - 3} width="6" height="6" fill="var(--cat-2)" />)}
      {hours.map((h, i) => <text key={h} className="lbl" x={x(i)} y={H - 8} textAnchor="middle">{h}</text>)}
    </svg>
  );
}

function CvKitchen() {
  const cv = useCv();
  const t = CV_D.room.tickets;
  const kds = CV_D.feeds.find((f) => f.name === 'Kitchen display');
  const late = t.fri.filter((v) => v > t.target).length + t.sat.filter((v) => v > t.target).length;
  const peak = Math.max(...t.sat);
  const stale = kds.state === 'stale';
  return (
    <div className="cv-page wide">
      <PageHead over={`Kitchen · ticket times · ${CV_ROOM.name}`} q="Where does the line slow down, and does it cost anything?"
        sub="Ticket time at the pass by hour and station. A slow kitchen only costs money when it costs a table: when the room is full and someone is waiting." />
      <LoopStrip stage={stale ? 'detect' : 'understand'} notes={{ detect: `${late} dinner hours over target`, understand: `${t.bottleneck}, Fri and Sat peak`, act: 'Waits on measured ticket times', verify: 'Needs ticket-level export' }} />
      {stale && <Callout tone="warn" icon="Clock">The kitchen display hasn&apos;t exported since Oct 21, so these are the last good weeks. {kds.note}</Callout>}
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Ticket time at the pass, Friday and Saturday dinner</span><Claim k="est" /></div>
          <TicketChart t={t} />
          <div className="cv-legend">
            <span><i style={{ background: 'var(--cat-2)' }} />Friday</span>
            <span><i className="ring" style={{ borderColor: 'var(--cat-1)' }} />Saturday</span>
            <span><i className="line" style={{ background: 'var(--money-down)' }} />{t.target}-minute target</span>
          </div>
          <span className="cv-small cv-muted">Saturday peaks at <b className="cv-num">{peak.toFixed(1)} min</b> at 8 pm. These are hourly averages from the kitchen display, so they can be estimated, not measured.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Where late tickets wait</span><Claim k="est" /></div>
          <div className="cv-col" style={{ gap: 10 }}>
            {t.stations.map(([s, v]) => (
              <div key={s} className="cv-hbar">
                <span>{s}</span>
                <span className="bar"><span style={{ width: `${v}%`, background: s === t.bottleneck ? 'var(--money-down)' : 'var(--border-strong)' }} /></span>
                <span className="cv-num" style={{ textAlign: 'right' }}>{v}%</span>
              </div>
            ))}
          </div>
          <span className="cv-xs cv-faint">Share of tickets over {t.target} minutes, by the station that finished last.</span>
          <div className="cv-row" style={{ alignItems: 'baseline' }}>
            <span className="cv-fig md">$0</span><Claim k="none" />
            <span className="cv-small cv-muted">claimable this week</span>
          </div>
          <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>The slow hours line up with the hours the room is full. A faster kitchen there is the same money as faster turns on <button className="cv-link" onClick={() => cv.go('throughput')}>Throughput</button>, counted once, and it can&apos;t be claimed until a waitlist shows who was turned away.</span>
        </section>
      </div>
      <div className="cv-grid g2">
        <Diagnose data={['Kitchen display', 'Toast', 'Waitlist']} manager={t.manager} fix={t.fix}
          verify="With ticket-level export on, the test compares ticket times on changed nights against matched nights. With a waitlist, faster turns at full room become claimable." />
        <section className="cv-card">
          <span className="cv-h4">Two connections unlock this lever</span>
          <div className="cv-col" style={{ gap: 10 }}>
            <div className="cv-row nowrap"><span className={`cv-q-ico ${stale ? 'bad' : 'warn'}`}><Icon name="MonitorCog" size={18} /></span><span className="cv-small" style={{ flex: 1 }}>Kitchen display: {stale ? 'restart the export, then ' : ''}switch export to each ticket. Measured, not estimated.</span></div>
            <div className="cv-row nowrap"><span className="cv-q-ico"><Icon name="Users" size={18} /></span><span className="cv-small" style={{ flex: 1 }}>Waitlist: shows whether a faster kitchen seated anyone new.</span></div>
          </div>
          <div className="cv-row">
            <Button icon="Plug" onClick={() => cv.go('sources')}>Fix the connections</Button>
            <Button variant="secondary" onClick={() => cv.toast('Added to next week as a test idea. It ranks at $0 until the waitlist is connected.')}>Add as a test idea</Button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ================================================================ Inventory & waste */
function CvInventory() {
  const cv = useCv();
  const U = CV_D.usage;
  const top = [...U.flagged].sort((a, b) => b.dollars - a.dollars)[0];
  const max = Math.max(0.12, ...U.rows.map((r) => r.pct)) * 1.15;
  const salmonTest = CV_D.proofs.find((p) => p.id === 'salmon-plate');
  return (
    <div className="cv-page wide">
      <PageHead over={`Inventory & waste · theoretical vs actual · ${CV_ROOM.name}`} q="Are we using more than we sell?"
        sub="What the plates and pours you sold should have used, against what actually left the walk-in and the bar. Logged waste explains part of any gap; the rest is over-portioning, spoilage or something rung in wrong." />
      <LoopStrip stage={U.flagged.length ? 'detect' : 'understand'} notes={{ detect: `${U.flagged.length} items past tolerance`, understand: U.wasteWeek > 0 ? 'Waste log explains part of it' : 'Needs a spot count to separate causes', act: 'Portion scale, prep pars, pour spouts', verify: 'Usage gap vs the count baseline' }} />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Unexplained usage over what you sold, 28 days</span><Claim k="est" /></div>
          <div className="cv-col" style={{ gap: 10 }}>
            {U.rows.map((r) => (
              <div key={r.item} className="cv-hbar" style={{ gridTemplateColumns: 'minmax(0, 150px) minmax(0, 1fr) 110px' }}>
                <span>{r.label} <span className="cv-xs cv-faint">{r.cat}</span></span>
                <span className="bar" style={{ position: 'relative' }}>
                  <span style={{ width: `${(Math.max(0, r.pct) / max) * 100}%`, background: r.flag ? 'var(--money-down)' : 'var(--border-strong)' }} />
                  <i className="cv-tol" style={{ left: `${(r.tol / max) * 100}%` }} title={`Tolerance ${(r.tol * 100).toFixed(0)}%`} />
                </span>
                <span className="cv-num" style={{ textAlign: 'right' }}>{(r.pct * 100).toFixed(1)}% · {cvMoney(Math.round(r.dollars))}</span>
              </div>
            ))}
          </div>
          <span className="cv-xs cv-faint">The tick on each bar is its tolerance: 3% for kitchen counts, 4% for the bar. Inside it, the count can&apos;t tell a real gap from counting error.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">Past tolerance, per week</span><Claim k="est" /></div>
          <span className={`cv-fig lg ${U.week > 0 ? 'cv-exp' : ''}`}><Money id="usage-week">{cvMoney(Math.round(U.week))}/wk</Money></span>
          {top ? (
            <p className="cv-small" style={{ lineHeight: 1.55 }}>{top.label} is the biggest: <b className="cv-num">{(+top.unexplained.toFixed(1)).toLocaleString('en-US')} {top.unit}</b> more than the plates sold needed ({top.why}), {cvMoney(Math.round(top.dollars))} this month at the current invoice price.{U.barWeek > 0 ? ` Bar pours add ${cvMoney(Math.round(U.barWeek))}/wk.` : ''}</p>
          ) : <p className="cv-small" style={{ lineHeight: 1.55 }}>Every counted item is inside its tolerance at {CV_ROOM.short}.</p>}
          {U.wasteWeek > 0 && <Callout tone="info" icon="Trash2">The waste log accounts for {cvMoney(Math.round(U.wasteWeek))}/wk of known loss. That part is explained, so it&apos;s shown separately and never counted as a usage gap.</Callout>}
          {salmonTest && <Callout icon="Layers">The salmon gap and the salmon plate-cost test share one lever key. Whichever verifies first claims the dollars; the other can&apos;t.</Callout>}
          <div className="cv-row">
            <Button icon="ClipboardList" onClick={() => cv.go('inputs', { kind: 'counts' })}>Enter a spot count</Button>
            <Button variant="secondary" icon="Trash2" onClick={() => cv.go('inputs', { kind: 'waste' })}>Log waste</Button>
          </div>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Item</th><th>Should use</th><th className="r">Theoretical</th><th className="r">Actual</th><th className="r">Logged waste</th><th className="r">Unexplained</th><th className="r">Gap</th><th className="r">Unit cost</th><th className="r">28-day cost</th></tr></thead>
            <tbody>
              {U.rows.map((r) => (
                <tr key={r.item}>
                  <td style={{ fontWeight: 600 }}>{r.label}{r.counted && <span className="cv-xs cv-faint"> · counted by hand</span>}</td>
                  <td className="cv-small cv-muted">{r.why}</td>
                  <td className="r">{(+r.theo.toFixed(1)).toLocaleString('en-US')} {r.unit}</td>
                  <td className="r">{(+r.actual.toFixed(1)).toLocaleString('en-US')} {r.unit}</td>
                  <td className="r">{r.waste ? `${(+r.waste.toFixed(1)).toLocaleString('en-US')} ${r.unit}` : '—'}</td>
                  <td className="r">{(+r.unexplained.toFixed(1)).toLocaleString('en-US')} {r.unit}</td>
                  <td className={`r ${r.flag ? 'cv-down' : ''}`}>{(r.pct * 100).toFixed(1)}%</td>
                  <td className="r">{cvMoney(r.cost, { cents: true })}</td>
                  <td className="r">{cvMoney(Math.round(r.dollars))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Diagnose data={['Toast', 'Recipe costs', 'Invoices', 'Inventory counts', 'Waste log']}
        manager={top ? `We're going through about ${Math.round(top.unexplained)} more ${top.unit === 'oz' ? 'ounces' : top.unit === 'lb' ? 'pounds' : top.unit + 's'} of ${top.label.toLowerCase()} a month than what we sold needs. That's heavy portions, trim waste, or comps nobody rang in. A spot count and a waste log this week will tell us which.` : 'Usage matches what we sold, inside the counting error. Keep logging waste so it stays that way.'}
        fix="A spot count on the flagged items, a waste log on the line, a portion scale where plates run heavy, and measured pour spouts at the bar."
        verify="Weekly spot counts give a usage baseline with a known error. If the gap stays inside tolerance for 6 weeks, the change books at its lower bound." />
    </div>
  );
}

/* ================================================================ Delivery & channels */
function CvChannels() {
  const cv = useCv();
  const C = CV_D.chan;
  const dine = C.channels.find((c) => c.k === 'dine');
  const dd = C.channels.find((c) => c.k === 'dd');
  const offBy = C.total - CV_D.week.net;
  return (
    <div className="cv-page wide">
      <PageHead over={`Delivery & channels · ${CV_ROOM.name}`} q="Does every channel make money?"
        sub="The same plate earns very different money depending on how it leaves the building. Contribution per channel after food, commission, packaging and refunds, before labour." />
      <LoopStrip stage="act" notes={{ detect: 'Channel margin from statements', understand: `DoorDash keeps ${Math.round(dd.per100)}¢ of each dollar`, act: '10% delivery markup, ready to review', verify: '6-week test, takeout as control' }} />
      {Math.abs(offBy) > CV_D.week.net * 0.03 && <Callout tone="warn" icon="TriangleAlert">Channel sales add up to {cvMoney(Math.round(C.total))}, {cvMoney(Math.round(Math.abs(offBy)))} {offBy > 0 ? 'more' : 'less'} than the register&apos;s net sales this week. Hand-entered channel figures are shown as entered; check them against your delivery statements.</Callout>}
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">What each $100 of sales keeps, by channel</span><Claim k="obs" /></div>
          <div className="cv-col" style={{ gap: 12 }}>
            {C.channels.map((c) => (
              <div key={c.k} className="cv-hbar" style={{ gridTemplateColumns: 'minmax(0, 110px) minmax(0, 1fr) 130px' }}>
                <span>{c.name}</span>
                <span className="bar"><span style={{ width: `${Math.max(0, c.per100)}%`, background: c.per100 < 50 ? 'var(--money-down)' : 'var(--accent)' }} /></span>
                <span className="cv-num" style={{ textAlign: 'right' }}>${c.per100.toFixed(0)} · {cvMoney(Math.round(c.sales))}/wk</span>
              </div>
            ))}
          </div>
          <span className="cv-small cv-muted">Delivery is {(C.deliveryShare * 100).toFixed(0)}% of sales. A DoorDash order keeps ${dd.per100.toFixed(0)} of every $100; the same food dine-in keeps ${dine.per100.toFixed(0)}. Refunds for missing or wrong items cost <b className="cv-num">{cvMoney(C.deliveryRefunds)}/wk</b>.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">A 10% delivery markup, per week</span><Claim k="est" /></div>
          <span className="cv-fig lg">{cvMoney(Math.round(C.markupLo))} to {cvMoney(Math.round(C.markupHi))}</span>
          <p className="cv-small" style={{ lineHeight: 1.55 }}>Your delivery menu charges dine-in prices. We can&apos;t model how many orders a markup would lose, because no delivery price here has ever moved. So this is a range: from every order staying to one in six leaving. At the low end it {C.markupLo < 0 ? 'loses a little money' : 'barely pays'}, which is exactly why it gets tested, not assumed.</p>
          <Callout icon="Info">A range with no fitted elasticity gets a low chance-it-verifies in the plan, so it competes fairly with modelled moves. The test is how it earns a better one.</Callout>
          <div className="cv-row"><Button icon="Tag" onClick={() => cv.approve('delivery-markup')}>Review the markup</Button><Button variant="secondary" onClick={() => cv.go('inputs', { kind: 'channels' })}>Enter this week&apos;s channel sales</Button></div>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Channel</th><th className="r">Sales / wk</th><th className="r">Orders</th><th className="r">Food</th><th className="r">Commission or card fees</th><th className="r">Packaging</th><th className="r">Refunds</th><th className="r">Contribution</th></tr></thead>
            <tbody>
              {C.channels.map((c) => (
                <tr key={c.k}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td className="r">{cvMoney(Math.round(c.sales))}</td>
                  <td className="r">{Math.round(c.orders)}</td>
                  <td className="r">{cvMoney(Math.round(c.food))}</td>
                  <td className="r">{cvMoney(Math.round(c.fees))} <span className="cv-xs cv-faint">{Math.round(c.fee * 1000) / 10}%</span></td>
                  <td className="r">{cvMoney(Math.round(c.packaging))}</td>
                  <td className="r">{cvMoney(c.refunds)}</td>
                  <td className="r" style={{ fontWeight: 600 }}>{cvMoney(Math.round(c.contrib))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Diagnose data={['Toast', 'Delivery statements', 'Recipe costs']}
        manager={`Delivery orders keep about $${dd.per100.toFixed(0)} of every $100 after the apps take their cut, against $${dine.per100.toFixed(0)} dine-in. We're charging the same price for a plate that earns about half as much, and refunds for missing items add another ${cvMoney(C.deliveryRefunds)} a week.`}
        fix="Raise delivery prices 10% on DoorDash and Uber Eats. Separately, add a bag check at expo for orders with modifiers, where most missing-item refunds start."
        verify="A 6-week test with takeout as the control channel. Delivery contribution per week is compared before and after; the lower bound books." />
    </div>
  );
}

/* ================================================================ Coverage map */
const CV_STAGE_PILL = {
  verify: ['good', 'BadgeCheck', 'Verified'],
  act: ['info', 'MousePointerClick', 'Ready to act'],
  understand: ['neutral', 'ChartColumn', 'Explained'],
  detect: ['warn', 'ScanSearch', 'Detected'],
  none: ['neutral', 'CircleMinus', 'Not covered'],
};

function CvCoverage() {
  const cv = useCv();
  const AREAS = CV_D.areas;
  const at = (k) => AREAS.filter((a) => CV_STAGE_IDX[a.stage] >= CV_STAGE_IDX[k]).length;
  const counts = { detect: at('detect'), understand: at('understand'), act: at('act'), verify: at('verify') };
  const annual = Math.round((CV_D.week.net * 52) / 1000) * 1000;
  return (
    <div className="cv-page wide">
      <PageHead over={`Coverage map · ${CV_ROOM.name}`} q="Where is this restaurant losing money, and how far along is each fix?"
        sub="Twelve operating areas, one closed loop. Every area shows the data it reads, the chart that finds the problem, and the one figure this room's data supports, with how strong that figure is." />
      <ol className="cv-loop big" aria-label="Areas at each step of the loop">
        {CV_LOOP.map((s) => (
          <li key={s.k} className="on">
            <span className="n"><Icon name={s.icon} size={16} /></span>
            <span className="cv-col" style={{ gap: 1 }}>
              <span className="cv-row" style={{ gap: 8, alignItems: 'baseline' }}><b>{s.label}</b><span className="cv-fig md">{counts[s.k]}</span><span className="cv-xs cv-faint">of 12</span></span>
              <span className="cv-xs cv-muted">{s.sub}</span>
            </span>
          </li>
        ))}
      </ol>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table cv-areas">
            <thead><tr><th>Area</th><th>What leaks</th><th>Data it reads</th><th>How it&apos;s shown</th><th>At {CV_ROOM.short}</th><th className="r">What the data supports</th></tr></thead>
            <tbody>
              {AREAS.map((a) => {
                const [tone, icon, label] = CV_STAGE_PILL[a.stage];
                const href = a.screen === 'build' ? null : a.screen;
                return (
                  <tr key={a.id} className={href ? 'cv-tr' : ''} onClick={href ? () => cv.go(href) : undefined} style={href ? { cursor: 'pointer' } : undefined}>
                    <td>
                      <div className="cv-row nowrap" style={{ gap: 10 }}>
                        <span className="cv-q-ico accent" style={{ width: 30, height: 30 }}><Icon name={a.icon} size={16} /></span>
                        {href ? <button className="cv-link" style={{ fontWeight: 600, textAlign: 'left' }} onClick={(e) => { e.stopPropagation(); cv.go(href); }}>{a.area}</button> : <span style={{ fontWeight: 600 }}>{a.area}</span>}
                      </div>
                    </td>
                    <td className="cv-small cv-muted" style={{ minWidth: 180 }}>{a.examples}</td>
                    <td><div className="cv-row" style={{ gap: 4 }}>{a.data.length ? a.data.map((d) => <FeedChip key={d} name={d} />) : <span className="cv-xs cv-faint">—</span>}</div></td>
                    <td className="cv-small" style={{ minWidth: 160 }}>{a.view}</td>
                    <td style={{ minWidth: 170 }}>
                      <div className="cv-col" style={{ gap: 4 }}>
                        <Pill tone={tone} icon={icon}>{label}</Pill>
                        <span className="cv-xs cv-faint">{a.note}</span>
                      </div>
                    </td>
                    <td className="r">
                      <div className="cv-col" style={{ gap: 4, alignItems: 'flex-end' }}>
                        <span className="cv-num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{a.fig}</span>
                        {a.claim !== 'none' && <Claim k={a.claim} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="cv-grid g2">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Why the right-hand column isn&apos;t added up</span><Claim k="est" /></div>
          <p className="cv-small" style={{ lineHeight: 1.6 }}>Opportunity-sizing sheets put a restaurant this size ({CV_ROOM.short} runs about <b className="cv-num">{cvMoney(annual)}</b> a year) at $20K to $45K a year of recoverable margin. That&apos;s a fair <i>{CV_CLAIM.est.label.toLowerCase()}</i>. It isn&apos;t money.</p>
          <p className="cv-small" style={{ lineHeight: 1.6 }}>The figures above mix five claim strengths and overlap each other: the kitchen&apos;s slow hours and the full-room hours are the same dollars, and a usage gap and a plate-cost test can share a key. Summing them would count dollars twice.</p>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">What&apos;s actually banked</span><Claim k="book" /></div>
          <span className="cv-fig lg"><Money id="to-date">{cvMoney(Math.round(CV_D.banked.toDate))}</Money></span>
          <p className="cv-small cv-muted" style={{ lineHeight: 1.55 }}>{CV_D.banked.toDate ? `Since each change verified, at ${CV_ROOM.short}.` : `Nothing at ${CV_ROOM.short} has passed every gate yet.`} Each area moves left to right on the loop above; only the last step earns a fee.</p>
          <div className="cv-row">
            <Button icon="BadgeCheck" onClick={() => cv.go('proof')}>See the proof</Button>
            <Button variant="secondary" icon="Wrench" onClick={() => cv.go('build')}>What&apos;s not built yet</Button>
          </div>
        </section>
      </div>
    </div>
  );
}

export { CV_LOOP, LoopStrip, Diagnose, FeedChip, ControlChart, CvCoverage, CvControls, CvKitchen, CvInventory, CvChannels };
