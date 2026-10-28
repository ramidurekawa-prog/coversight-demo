'use client';

import * as React from 'react';

import { Button, Icon } from '../kit';
import { CV_APPROVALS, CV_CLAIM, CV_INVOICES, CV_PRICE_LEG, Callout, Claim, Money, Pill, PageHead, cvMoney, cvPlanCandidates, cvScale, useCv } from './core';
import { CV_FEEDS } from './proof';

/* Operating areas, added in V3 from the "map of restaurant inefficiencies"
 * reference sheets. Every area runs the same closed loop (detect → understand
 * → act → verify), and every diagnostic screen answers the same four things:
 * what data it needs, the chart that shows it, what to tell the GM in plain
 * English, and the fix, plus how we'll know the fix worked.
 *
 * The sheets size each area in annual ranges. Those are Estimated by
 * definition, so they never appear as a figure here; each area shows only
 * what this room's data supports, with its claim strength. */

const CV_WEEK_SALES = 41620; // Oakland net sales, week of Oct 19 (matches "Earned this week")
const CV_ANNUAL_SALES = CV_WEEK_SALES * 52;

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
  const f = CV_FEEDS.find((x) => x.name === name);
  const [tone, icon] = f ? CV_FEED_TONE[f.state] : ['neutral', 'CircleMinus'];
  return <Pill tone={tone} icon={icon}>{name}</Pill>;
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

/* ================================================================ Controls
 * Voids, comps and discounts per employee, last 28 days. Post-send voids (the
 * kitchen already fired the order) are the expensive kind: food made, not paid.
 * Each employee gets a p-chart limit for their volume: p̄ ± 3·√(p̄(1−p̄)/n),
 * with n = checks. Above the upper limit is a signal; inside is noise. */
const CV_AVG_CHECK = 64;
const CV_STAFF = [
  { name: 'Tomás R.', role: 'Server', sales: 24100, postVoid: 140, comps: 210, disc: 310 },
  { name: 'Jess M.', role: 'Server', sales: 22400, postVoid: 120, comps: 180, disc: 290 },
  { name: 'Kayla P.', role: 'Server', sales: 21300, postVoid: 610, comps: 240, disc: 280 },
  { name: 'Sam O.', role: 'Server', sales: 19800, postVoid: 95, comps: 160, disc: 260 },
  { name: 'Rina D.', role: 'Bartender', sales: 26900, postVoid: 70, comps: 520, disc: 190 },
  { name: 'Owen L.', role: 'Bartender', sales: 18200, postVoid: 60, comps: 330, disc: 150 },
  { name: 'Everyone else (11)', role: 'Mixed', sales: 33780, postVoid: 180, comps: 400, disc: 620, rest: true },
];
const CV_STAFF_SALES = CV_STAFF.reduce((s, r) => s + r.sales, 0); // = 4 weeks of $41,620
const CV_ROOM_PV = CV_STAFF.reduce((s, r) => s + r.postVoid, 0) / CV_STAFF_SALES;
CV_STAFF.forEach((r) => {
  r.rate = r.postVoid / r.sales;
  r.checks = Math.round(r.sales / CV_AVG_CHECK);
  r.ucl = CV_ROOM_PV + 3 * Math.sqrt((CV_ROOM_PV * (1 - CV_ROOM_PV)) / r.checks);
  r.signal = !r.rest && r.rate > r.ucl;
});
const CV_SIGNALS = CV_STAFF.filter((r) => r.signal);
/** Room rate without the flagged people: the honest baseline to measure the excess against. */
const CV_PV_BASE = (() => {
  const rest = CV_STAFF.filter((r) => !r.signal);
  return rest.reduce((s, r) => s + r.postVoid, 0) / rest.reduce((s, r) => s + r.sales, 0);
})();
const CV_PV_EXCESS_28 = CV_SIGNALS.reduce((s, r) => s + (r.rate - CV_PV_BASE) * r.sales, 0);
const CV_EXC_WEEK = CV_STAFF.reduce((s, r) => s + r.postVoid + r.comps + r.disc, 0) / 4;
/* Room exceptions as a share of sales, 13 weeks (Toast). Control limits from the series itself. */
const CV_EXC_SERIES = [3.0, 3.2, 2.9, 3.1, 3.3, 2.8, 3.0, 3.1, 2.9, 3.2, 3.0, 3.1, +((CV_EXC_WEEK / CV_WEEK_SALES) * 100).toFixed(2)];
const CV_EXC_MEAN = CV_EXC_SERIES.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
const CV_EXC_SD = Math.sqrt(CV_EXC_SERIES.slice(0, 12).reduce((s, v) => s + (v - CV_EXC_MEAN) ** 2, 0) / 11);
const CV_EXC_UCL = CV_EXC_MEAN + 3 * CV_EXC_SD;
const CV_EXC_LCL = CV_EXC_MEAN - 3 * CV_EXC_SD;

function ControlChart({ series, mean, ucl, lcl, unit = '%', labels }) {
  const W = 560, H = 190, P = { l: 34, r: 16, t: 14, b: 26 };
  const lo = Math.min(lcl, ...series) * 0.96, hi = Math.max(ucl, ...series) * 1.03;
  const x = cvScale(0, series.length - 1, P.l, W - P.r);
  const y = cvScale(lo, hi, H - P.b, P.t);
  const path = series.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Control chart of exceptions as a share of sales">
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
  const k = CV_SIGNALS[0];
  const weeks = ['Jul 27', 'Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21', 'Sep 28', 'Oct 5', 'Oct 12', 'Oct 19'];
  const last = CV_EXC_SERIES[CV_EXC_SERIES.length - 1];
  const times = k ? k.rate / CV_PV_BASE : 0;
  return (
    <div className="cv-page wide">
      <PageHead over="Controls · voids, comps and discounts · Rosewood Oakland" q="Is money leaking at the register?"
        sub="Every void, comp and discount from Toast, per person, against limits set by their own volume. A signal is a reason for a conversation, never an accusation." />
      <LoopStrip stage="act" notes={{ detect: 'Per-person limits on every exception', understand: `${k ? k.name : 'Nobody'} above the limit on post-send voids`, act: 'Reason code on post-send voids', verify: 'Control chart, 1 false alarm a quarter' }} />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Room exceptions as a share of sales, 13 weeks</span><Claim k="obs" /></div>
          <ControlChart series={CV_EXC_SERIES} mean={CV_EXC_MEAN} ucl={CV_EXC_UCL} lcl={CV_EXC_LCL} labels={weeks} />
          <span className="cv-small cv-muted">The room is inside its limits: <b className="cv-num">{last.toFixed(1)}%</b> last week, {cvMoney(Math.round(CV_EXC_WEEK))} of {cvMoney(CV_WEEK_SALES)}. Nothing to chase at the room level. The signal is one person.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">Post-send voids above the room&apos;s rate, 28 days</span><Claim k="obs" /></div>
          <span className="cv-fig lg cv-exp">{cvMoney(Math.round(CV_PV_EXCESS_28))}</span>
          <p className="cv-small" style={{ lineHeight: 1.55 }}>{k.name}&apos;s voids after the kitchen fired the order run at <b className="cv-num">{(k.rate * 100).toFixed(2)}%</b> of her sales, {times.toFixed(1)}× the rest of the room&apos;s {(CV_PV_BASE * 100).toFixed(2)}%. Her limit for her volume is {(k.ucl * 100).toFixed(2)}%.</p>
          <Callout icon="Info">We don&apos;t count this as a saving. It&apos;s observed leakage; only a change that holds, measured against the baseline, becomes bookable.</Callout>
          <div className="cv-row">
            <Button icon="ShieldCheck" onClick={() => cv.approve('void-reason')}>Review the void rule</Button>
          </div>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Person</th><th className="r">Sales</th><th className="r">Post-send voids</th><th className="r">Rate</th><th className="r">Limit for volume</th><th className="r">Comps</th><th className="r">Discounts</th><th>Signal</th></tr></thead>
            <tbody>
              {CV_STAFF.map((r) => (
                <tr key={r.name}>
                  <td style={{ fontWeight: 600 }}>{r.name} <span className="cv-xs cv-faint">{r.role}</span></td>
                  <td className="r">{cvMoney(r.sales)}</td>
                  <td className="r">{cvMoney(r.postVoid)}</td>
                  <td className={`r ${r.signal ? 'cv-down' : ''}`}>{(r.rate * 100).toFixed(2)}%</td>
                  <td className="r">{r.rest ? '—' : `${(r.ucl * 100).toFixed(2)}%`}</td>
                  <td className="r">{cvMoney(r.comps)}</td>
                  <td className="r">{cvMoney(r.disc)}</td>
                  <td>{r.signal ? <Pill tone="bad" icon="TriangleAlert">Above limit</Pill> : <Pill tone="good" icon="CircleCheck">Inside</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="cv-grid g2">
        <Diagnose data={['Toast']}
          manager={`${k.name}'s voids after the kitchen fires are ${times.toFixed(1)} times the rest of the room's. That's ${cvMoney(Math.round(CV_PV_EXCESS_28))} of food made and not paid for this month. It could be training or it could be a pattern. Worth a conversation this week.`}
          fix="Post-send voids need a manager PIN and a reason code. Takes about 20 seconds; most rooms see the rate settle inside a month."
          verify="The same control chart keeps running. If post-send voids stay under the old baseline for 6 weeks, the difference books at its lower bound. If they creep back, accrual pauses on its own." />
        <section className="cv-card">
          <span className="cv-h4">The same detector, across the group</span>
          <p className="cv-small cv-muted" style={{ lineHeight: 1.55 }}>Walnut Creek&apos;s bar comps crossed their limit in September. The policy reset verified at <b className="cv-num">$88/wk</b>, then paused itself on Oct 19 when comps crossed the line again. That pause is the loop working.</p>
          <div className="cv-row"><Button variant="secondary" icon="FileCheck" onClick={() => cv.go('packet', { id: 'wc-comps' })}>Open the comp-policy packet</Button></div>
        </section>
      </div>
    </div>
  );
}

/* ================================================================ Kitchen
 * Ticket time at the pass by hour, Friday and Saturday dinner (KDS hourly
 * averages by station; ticket-level export not yet on, so Estimated). */
const CV_TICKET_TARGET = 14;
const CV_TICKETS = {
  hours: ['5 pm', '6 pm', '7 pm', '8 pm', '9 pm', '10 pm'],
  fri: [11.2, 13.1, 17.6, 18.4, 14.0, 10.8],
  sat: [11.8, 13.9, 18.9, 19.6, 15.2, 11.1],
};
const CV_LATE_BY_STATION = [
  ['Grill', 58], ['Sauté', 21], ['Fry', 9], ['Garde manger', 7], ['Pizza', 5],
];
const CV_LATE_HOURS = CV_TICKETS.fri.filter((v) => v > CV_TICKET_TARGET).length + CV_TICKETS.sat.filter((v) => v > CV_TICKET_TARGET).length;

function TicketChart() {
  const W = 560, H = 200, P = { l: 30, r: 14, t: 14, b: 26 };
  const n = CV_TICKETS.hours.length;
  const x = cvScale(0, n - 1, P.l + 20, W - P.r - 20);
  const y = cvScale(8, 21, H - P.b, P.t);
  const line = (s) => s.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ticket time by hour, Friday and Saturday, against a 14-minute target">
      {[10, 14, 18].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 4} y={y(v) + 3} textAnchor="end">{v}m</text></g>)}
      <line x1={P.l} x2={W - P.r} y1={y(CV_TICKET_TARGET)} y2={y(CV_TICKET_TARGET)} stroke="var(--money-down)" strokeDasharray="4 4" />
      <path d={line(CV_TICKETS.fri)} fill="none" stroke="var(--cat-2)" strokeWidth="2" />
      <path d={line(CV_TICKETS.sat)} fill="none" stroke="var(--cat-1)" strokeWidth="2" strokeDasharray="6 3" />
      {CV_TICKETS.sat.map((v, i) => <circle key={`s${i}`} cx={x(i)} cy={y(v)} r="3" fill="var(--cat-1)" />)}
      {CV_TICKETS.fri.map((v, i) => <rect key={`f${i}`} x={x(i) - 3} y={y(v) - 3} width="6" height="6" fill="var(--cat-2)" />)}
      {CV_TICKETS.hours.map((h, i) => <text key={h} className="lbl" x={x(i)} y={H - 8} textAnchor="middle">{h}</text>)}
    </svg>
  );
}

function CvKitchen() {
  const cv = useCv();
  const peak = Math.max(...CV_TICKETS.sat);
  return (
    <div className="cv-page wide">
      <PageHead over="Kitchen · ticket times · Rosewood Oakland" q="Where does the line slow down, and does it cost anything?"
        sub="Ticket time at the pass by hour and station. A slow kitchen only costs money when it costs a table: when the room is full and someone is waiting." />
      <LoopStrip stage="understand" notes={{ detect: `${CV_LATE_HOURS} dinner hours over target`, understand: 'Grill, Fri and Sat 7–9 pm', act: 'Waits on measured ticket times', verify: 'Needs ticket-level export' }} />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Ticket time at the pass, Friday and Saturday dinner</span><Claim k="est" /></div>
          <TicketChart />
          <div className="cv-legend">
            <span><i style={{ background: 'var(--cat-2)' }} />Friday</span>
            <span><i className="ring" style={{ borderColor: 'var(--cat-1)' }} />Saturday</span>
            <span><i className="line" style={{ background: 'var(--money-down)' }} />{CV_TICKET_TARGET}-minute target</span>
          </div>
          <span className="cv-small cv-muted">Saturday peaks at <b className="cv-num">{peak.toFixed(1)} min</b> at 8 pm. These are hourly averages from the kitchen display, so they can be estimated, not measured.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Where late tickets wait</span><Claim k="est" /></div>
          <div className="cv-col" style={{ gap: 10 }}>
            {CV_LATE_BY_STATION.map(([s, v]) => (
              <div key={s} className="cv-hbar">
                <span>{s}</span>
                <span className="bar"><span style={{ width: `${v}%`, background: s === 'Grill' ? 'var(--money-down)' : 'var(--border-strong)' }} /></span>
                <span className="cv-num" style={{ textAlign: 'right' }}>{v}%</span>
              </div>
            ))}
          </div>
          <span className="cv-xs cv-faint">Share of tickets over {CV_TICKET_TARGET} minutes, by the station that finished last.</span>
          <div className="cv-row" style={{ alignItems: 'baseline' }}>
            <span className="cv-fig md">$0</span><Claim k="none" />
            <span className="cv-small cv-muted">claimable this week</span>
          </div>
          <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>The slow hours line up with the five intervals the room was full. A faster grill there is the same money as faster turns on <button className="cv-link" onClick={() => cv.go('throughput')}>Throughput</button>, counted once, and it can&apos;t be claimed until a waitlist shows who was turned away.</span>
        </section>
      </div>
      <div className="cv-grid g2">
        <Diagnose data={['Kitchen display', 'Toast', 'Waitlist']}
          manager="Saturday at 8 the grill is the bottleneck. Tickets wait almost 20 minutes there while sauté has room. Nobody's slow on purpose; the salmon and the ribeye both land on one station."
          fix="Move the salmon to sauté on Friday and Saturday from 7 to 9 pm, and pre-fire ribeye sides when the ticket prints."
          verify="With ticket-level export on, the test compares grill ticket times on changed nights against matched nights. With a waitlist, faster turns at full room become claimable." />
        <section className="cv-card">
          <span className="cv-h4">Two connections unlock this lever</span>
          <div className="cv-col" style={{ gap: 10 }}>
            <div className="cv-row nowrap"><span className="cv-q-ico warn"><Icon name="MonitorCog" size={18} /></span><span className="cv-small" style={{ flex: 1 }}>Kitchen display: switch export to each ticket. Measured, not estimated.</span></div>
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

/* ================================================================ Inventory & waste
 * Theoretical usage (Toast depletion × recipe quantities) vs actual usage
 * (opening count + invoiced − closing count), last 28 days. Dollars at the
 * current invoice price. Manual counts carry about ±3% error, so variance
 * inside tolerance is noise. */
const CV_INV_PRICE = Object.fromEntries(CV_INVOICES.map((r) => [r.item, r.p1]));
const CV_USAGE = [
  { item: 'Salmon fillet', unit: 'lb', cost: CV_INV_PRICE['Salmon fillet'], theo: 284, actual: 307, tol: 0.03, cat: 'Kitchen', why: '142 plates a week at 8 oz' },
  { item: 'Romaine hearts', unit: 'case', cost: CV_INV_PRICE['Romaine hearts'], theo: 21.0, actual: 23.1, tol: 0.03, cat: 'Kitchen', why: 'Caesar and the burger garnish' },
  { item: 'Ribeye, choice', unit: 'lb', cost: CV_INV_PRICE['Ribeye, choice'], theo: 256, actual: 263, tol: 0.03, cat: 'Kitchen', why: '64 plates a week at 16 oz' },
  { item: 'Chicken, whole', unit: 'lb', cost: CV_INV_PRICE['Chicken, whole'], theo: 661, actual: 672, tol: 0.03, cat: 'Kitchen', why: '118 half chickens a week' },
  { item: 'House red', unit: 'oz', cost: 3.92 / 6, theo: 5040, actual: 5330, tol: 0.04, cat: 'Bar', why: '210 glasses a week at 6 oz' },
  { item: 'Bourbon', unit: 'oz', cost: 1.3, theo: 1056, actual: 1102, tol: 0.04, cat: 'Bar', why: '132 Old Fashioneds a week at 2 oz' },
];
CV_USAGE.forEach((r) => {
  r.over = r.actual - r.theo;
  r.pct = r.over / r.theo;
  r.dollars = r.over * r.cost;
  r.flag = r.pct > r.tol;
});
const CV_USAGE_FLAGGED = CV_USAGE.filter((r) => r.flag);
const CV_USAGE_WEEK = CV_USAGE_FLAGGED.reduce((s, r) => s + r.dollars, 0) / 4;
const CV_BAR_WEEK = CV_USAGE_FLAGGED.filter((r) => r.cat === 'Bar').reduce((s, r) => s + r.dollars, 0) / 4;

function CvInventory() {
  const cv = useCv();
  const sal = CV_USAGE[0];
  const max = Math.max(...CV_USAGE.map((r) => r.pct)) * 1.15;
  return (
    <div className="cv-page wide">
      <PageHead over="Inventory & waste · theoretical vs actual · Rosewood Oakland" q="Are we using more than we sell?"
        sub="What the plates and pours you sold should have used, against what actually left the walk-in and the bar. The gap is over-portioning, waste, spoilage or something rung in wrong." />
      <LoopStrip stage="detect" notes={{ detect: `${CV_USAGE_FLAGGED.length} items past tolerance`, understand: 'Needs a spot count to separate causes', act: 'Portion scale, prep pars, pour spouts', verify: 'Usage gap vs the count baseline' }} />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Usage over what you sold, last 28 days</span><Claim k="est" /></div>
          <div className="cv-col" style={{ gap: 10 }}>
            {CV_USAGE.map((r) => (
              <div key={r.item} className="cv-hbar" style={{ gridTemplateColumns: 'minmax(0, 150px) minmax(0, 1fr) 110px' }}>
                <span>{r.item} <span className="cv-xs cv-faint">{r.cat}</span></span>
                <span className="bar" style={{ position: 'relative' }}>
                  <span style={{ width: `${(r.pct / max) * 100}%`, background: r.flag ? 'var(--money-down)' : 'var(--border-strong)' }} />
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
          <span className="cv-fig lg cv-exp">{cvMoney(Math.round(CV_USAGE_WEEK))}/wk</span>
          <p className="cv-small" style={{ lineHeight: 1.55 }}>Salmon is the biggest: <b className="cv-num">{sal.over} lb</b> more than the plates sold needed ({sal.why.toLowerCase()}), {cvMoney(Math.round(sal.dollars))} this month at Bay Fish Co.&apos;s new price. Bar pours add {cvMoney(Math.round(CV_BAR_WEEK))}/wk.</p>
          <Callout icon="Layers">The salmon gap and the quarantined plate-cost test share one lever key. Whichever verifies first claims the dollars; the other can&apos;t.</Callout>
          <div className="cv-row">
            <Button icon="ClipboardList" onClick={() => cv.toast('Thursday spot count added to the GM’s list: salmon, romaine, house red. About 15 minutes.')}>Schedule a spot count</Button>
            <Button variant="secondary" onClick={() => cv.go('packet', { id: 'salmon-plate' })}>The salmon plate test</Button>
          </div>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Item</th><th>Should use</th><th className="r">Theoretical</th><th className="r">Actual</th><th className="r">Over</th><th className="r">Gap</th><th className="r">Unit cost</th><th className="r">28-day cost</th></tr></thead>
            <tbody>
              {CV_USAGE.map((r) => (
                <tr key={r.item}>
                  <td style={{ fontWeight: 600 }}>{r.item}</td>
                  <td className="cv-small cv-muted">{r.why}</td>
                  <td className="r">{r.theo.toLocaleString('en-US')} {r.unit}</td>
                  <td className="r">{r.actual.toLocaleString('en-US')} {r.unit}</td>
                  <td className="r">{(+r.over.toFixed(1)).toLocaleString('en-US')} {r.unit}</td>
                  <td className={`r ${r.flag ? 'cv-down' : ''}`}>{(r.pct * 100).toFixed(1)}%</td>
                  <td className="r">{cvMoney(r.cost, { cents: true })}</td>
                  <td className="r">{cvMoney(Math.round(r.dollars))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Diagnose data={['Toast', 'Recipe costs', 'Invoices', 'Inventory counts']}
        manager={`We're going through about ${sal.over} more pounds of salmon a month than the plates we sold need. That's heavy portions, trim waste, or comps nobody rang in. A Thursday count and a scale on the grill will tell us which.`}
        fix="Thursday spot count on the three flagged items, a portion scale at the grill for salmon, and measured pour spouts on house red."
        verify="Weekly spot counts give a usage baseline with a known error. If the gap stays inside tolerance for 6 weeks, the change books at its lower bound." />
    </div>
  );
}

/* ================================================================ Delivery & channels
 * Weekly net sales by channel (Toast + delivery statements). Contribution
 * before labour = sales − food − commission/processing − packaging − refunds.
 * Food cost is the room's theoretical rate ($12,130 / $41,620). */
const CV_FOOD_RATE = 12130 / CV_WEEK_SALES;
const CV_CHANNELS = [
  { k: 'dine', name: 'Dine-in', sales: 34180, avg: 64, fee: 0.029, pack: 0, refunds: 0 },
  { k: 'take', name: 'Takeout', sales: 3940, avg: 38, fee: 0.029, pack: 0.9, refunds: 12 },
  { k: 'dd', name: 'DoorDash', sales: 2610, avg: 41, fee: 0.25, pack: 1.1, refunds: 96 },
  { k: 'ue', name: 'Uber Eats', sales: 890, avg: 43, fee: 0.3, pack: 1.1, refunds: 38 },
];
CV_CHANNELS.forEach((c) => {
  c.orders = c.sales / c.avg;
  c.food = c.sales * CV_FOOD_RATE;
  c.fees = c.sales * c.fee;
  c.packaging = c.orders * c.pack;
  c.contrib = c.sales - c.food - c.fees - c.packaging - c.refunds;
  c.per100 = (c.contrib / c.sales) * 100;
});
const CV_DELIVERY = CV_CHANNELS.filter((c) => c.k === 'dd' || c.k === 'ue');
const CV_DELIVERY_REFUNDS = CV_DELIVERY.reduce((s, c) => s + c.refunds, 0);
/** Contribution from delivery if prices rise by `m` and a share `v` of orders leave. */
function cvDeliveryContrib(m, v) {
  return CV_DELIVERY.reduce((s, c) => {
    const keep = 1 - v;
    const sales = c.sales * (1 + m) * keep;
    return s + sales - c.food * keep - sales * c.fee - c.packaging * keep - c.refunds * keep;
  }, 0);
}
const CV_DELIVERY_BASE = cvDeliveryContrib(0, 0);
const CV_MARKUP = 0.1;
/* No delivery price has ever moved here, so there is no elasticity to fit:
   show the range from "every order stays" to "1 in 6 orders leaves". */
const CV_MARKUP_HI = cvDeliveryContrib(CV_MARKUP, 0) - CV_DELIVERY_BASE;
const CV_MARKUP_LO = cvDeliveryContrib(CV_MARKUP, 1 / 6) - CV_DELIVERY_BASE;

function CvChannels() {
  const cv = useCv();
  const dine = CV_CHANNELS[0];
  const dd = CV_CHANNELS[2];
  return (
    <div className="cv-page wide">
      <PageHead over="Delivery & channels · Rosewood Oakland" q="Does every channel make money?"
        sub="The same plate earns very different money depending on how it leaves the building. Contribution per channel after food, commission, packaging and refunds, before labour." />
      <LoopStrip stage="act" notes={{ detect: 'Channel margin from statements', understand: `DoorDash keeps ${Math.round(dd.per100)}¢ of each dollar`, act: '10% delivery markup, ready to review', verify: '6-week test, takeout as control' }} />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">What each $100 of sales keeps, by channel</span><Claim k="obs" /></div>
          <div className="cv-col" style={{ gap: 12 }}>
            {CV_CHANNELS.map((c) => (
              <div key={c.k} className="cv-hbar" style={{ gridTemplateColumns: 'minmax(0, 110px) minmax(0, 1fr) 130px' }}>
                <span>{c.name}</span>
                <span className="bar"><span style={{ width: `${c.per100}%`, background: c.per100 < 50 ? 'var(--money-down)' : 'var(--accent)' }} /></span>
                <span className="cv-num" style={{ textAlign: 'right' }}>${c.per100.toFixed(0)} · {cvMoney(c.sales)}/wk</span>
              </div>
            ))}
          </div>
          <span className="cv-small cv-muted">Delivery is {Math.round(((CV_DELIVERY.reduce((s, c) => s + c.sales, 0)) / CV_WEEK_SALES) * 100)}% of sales. A DoorDash order keeps ${dd.per100.toFixed(0)} of every $100; the same food dine-in keeps ${dine.per100.toFixed(0)}. Refunds for missing or wrong items cost <b className="cv-num">{cvMoney(CV_DELIVERY_REFUNDS)}/wk</b>.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-over">A 10% delivery markup, per week</span><Claim k="est" /></div>
          <span className="cv-fig lg">{cvMoney(Math.round(CV_MARKUP_LO))} to {cvMoney(Math.round(CV_MARKUP_HI))}</span>
          <p className="cv-small" style={{ lineHeight: 1.55 }}>Your delivery menu charges dine-in prices. We can&apos;t model how many orders a markup would lose, because no delivery price here has ever moved. So this is a range: from every order staying to one in six leaving. At the low end it {CV_MARKUP_LO < 0 ? 'loses a little money' : 'barely pays'}, which is exactly why it gets tested, not assumed.</p>
          <Callout icon="Info">Not ranked in this week&apos;s plan. A range with no fitted elasticity has no chance-it-verifies, so it can&apos;t be compared fairly with modelled moves. The test is how it gets one.</Callout>
          <div className="cv-row"><Button icon="Tag" onClick={() => cv.approve('delivery-markup')}>Review the markup</Button></div>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Channel</th><th className="r">Sales / wk</th><th className="r">Orders</th><th className="r">Food</th><th className="r">Commission or card fees</th><th className="r">Packaging</th><th className="r">Refunds</th><th className="r">Contribution</th></tr></thead>
            <tbody>
              {CV_CHANNELS.map((c) => (
                <tr key={c.k}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td className="r">{cvMoney(c.sales)}</td>
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
        manager={`Delivery orders keep about $${dd.per100.toFixed(0)} of every $100 after the apps take their cut, against $${dine.per100.toFixed(0)} dine-in. We're charging the same price for a plate that earns half as much, and refunds for missing items add another ${cvMoney(CV_DELIVERY_REFUNDS)} a week.`}
        fix="Raise delivery prices 10% on DoorDash and Uber Eats. Separately, add a bag check at expo for orders with modifiers, where most missing-item refunds start."
        verify="A 6-week test with takeout as the control channel. Delivery contribution per week is compared before and after; the lower bound books." />
    </div>
  );
}

/* Approvals these screens open. Registered here so the modal in the shell finds them. */
Object.assign(CV_APPROVALS, {
  'void-reason': {
    title: 'Require a reason code on post-send voids', where: 'Rosewood Oakland · Toast permissions', level: 'A1 · Recommends', system: 'Toast',
    diff: [['Void after the order is sent', 'Server can void', 'Manager PIN + reason code'], ['Void before send', 'Server can void', 'No change']],
    fence: 'Applies to post-send voids only. Never blocks a void; it only asks who and why.',
    kill: ['Ticket time at the pass goes past 16 minutes (managers pulled off the floor)', 'Average void approval takes over 2 minutes'],
    window: 'The control chart keeps running against the 13-week baseline, at 1 false alarm per quarter.',
    revert: 'Turn the permission back off in Toast. Nothing else changes.',
    value: 'No claim until it verifies', claim: 'none',
  },
  'delivery-markup': {
    title: 'Raise delivery prices 10%', where: 'Rosewood Oakland · DoorDash and Uber Eats menus', level: 'A1 · Recommends', system: 'Toast delivery menus',
    diff: [['DoorDash prices', 'Dine-in prices', '+10%, rounded to $0.50'], ['Uber Eats prices', 'Dine-in prices', '+10%, rounded to $0.50'], ['Dine-in and takeout', '—', 'No change']],
    fence: 'Delivery prices at most 12% above dine-in. One delivery price change per 6 weeks.',
    kill: ['Delivery orders fall more than 20% against takeout', 'App rating drops below 4.5', 'Refund rate rises'],
    window: 'Opens a 6-week test with takeout as the control channel.',
    revert: 'Restore dine-in prices on both apps from Toast. The test closes as no claim.',
    value: `${cvMoney(Math.round(CV_MARKUP_LO))} to ${cvMoney(Math.round(CV_MARKUP_HI))}/wk estimated`, claim: 'est',
  },
});

/* ================================================================ Coverage map
 * The twelve operating areas, MECE across the restaurant, each with its
 * detector, the data it reads, where it is in the loop at Oakland, and the
 * one figure the data supports. */
const cvMenuMoves = () => cvPlanCandidates().filter((c) => c.lever === 'Menu').reduce((s, c) => s + c.value, 0);

const CV_AREAS = [
  { id: 'labour', area: 'Labour & scheduling', icon: 'Users', examples: 'Overstaffed shoulders, overtime, shifts that miss demand', data: ['Toast', '7shifts'], view: 'Revenue per labour hour vs matched weeks', stage: 'verify', fig: '$97/wk banked', claim: 'book', screen: 'labour', note: 'Thursday prep verified; Tuesday dinner in testing' },
  { id: 'demand', area: 'Demand & tonight’s staffing', icon: 'CloudSun', examples: 'Slow nights not caught in time, rushes understaffed', data: ['Toast', '7shifts'], view: 'Covers nowcast vs comparable nights', stage: 'act', fig: '$37 tonight', claim: 'obs', screen: 'service', note: 'Cut one server at 8, ready on the phone' },
  { id: 'menu', area: 'Menu & pricing', icon: 'UtensilsCrossed', examples: 'Underpriced plates, stale recipe costs, weak mix', data: ['Toast', 'Recipe costs'], view: 'Contribution vs popularity, priced by elasticity', stage: 'act', fig: () => `${cvMoney(Math.round(cvMenuMoves()))}/wk in 3 moves`, claim: 'mod', screen: 'menu', note: 'Salmon, ribeye and carbonara ranked' },
  { id: 'purchasing', area: 'Purchasing & vendors', icon: 'Truck', examples: 'Price creep, missed credits, emergency buys', data: ['Invoices'], view: 'Invoice change split into vendor price and your mix', stage: 'act', fig: () => `${cvMoney(Math.round(CV_PRICE_LEG))} vendor rises, 28 days`, claim: 'obs', screen: 'purchasing', note: 'Two vendor calls drafted' },
  { id: 'inventory', area: 'Inventory, prep & waste', icon: 'Package', examples: 'Over-portioning, trim waste, spoilage, shrink', data: ['Toast', 'Invoices', 'Inventory counts'], view: 'Theoretical vs actual usage', stage: 'detect', fig: () => `${cvMoney(Math.round(CV_USAGE_WEEK - CV_BAR_WEEK))}/wk past tolerance`, claim: 'est', screen: 'inventory', note: 'Salmon and romaine flagged; needs a spot count' },
  { id: 'bar', area: 'Bar & beverage', icon: 'Wine', examples: 'Over-pouring, untracked comps, high pour cost', data: ['Toast', 'Inventory counts'], view: 'Pour variance and bar comps vs limits', stage: 'detect', fig: () => `${cvMoney(Math.round(CV_BAR_WEEK))}/wk past tolerance`, claim: 'est', screen: 'inventory', note: 'House red over-pouring' },
  { id: 'kitchen', area: 'Kitchen flow & ticket times', icon: 'ChefHat', examples: 'Station bottlenecks, poor batching, remakes', data: ['Kitchen display', 'Toast'], view: 'Ticket time by hour and station vs target', stage: 'understand', fig: '$0 claimable', claim: 'none', screen: 'kitchen', note: 'Grill bottleneck Fri and Sat 7–9 pm' },
  { id: 'foh', area: 'Tables & turns', icon: 'Armchair', examples: 'Empty tables while guests wait, slow resets and closeouts', data: ['Toast', 'Waitlist'], view: 'Share of time the room is full', stage: 'understand', fig: '$0 claimable', claim: 'none', screen: 'throughput', note: '$1,047/mo ceiling; needs the waitlist' },
  { id: 'controls', area: 'Register controls', icon: 'ShieldCheck', examples: 'Voids after send, comps, discounts, overrides', data: ['Toast'], view: 'Per-person control limits', stage: 'act', fig: () => `${cvMoney(Math.round(CV_PV_EXCESS_28))} over limit, 28 days`, claim: 'obs', screen: 'controls', note: 'One server above her limit' },
  { id: 'channels', area: 'Delivery & channels', icon: 'Bike', examples: 'Commission drag, refunds, delivery priced like dine-in', data: ['Toast', 'Delivery statements'], view: 'Contribution per $100 by channel', stage: 'act', fig: () => `${cvMoney(Math.round(CV_MARKUP_LO))} to ${cvMoney(Math.round(CV_MARKUP_HI))}/wk`, claim: 'est', screen: 'channels', note: '10% delivery markup ready to review' },
  { id: 'guests', area: 'Guest experience & retention', icon: 'Heart', examples: 'Order errors, repeat visits, reviews', data: ['Toast'], view: 'Comps and remakes on late tickets', stage: 'none', fig: 'Not built yet', claim: 'none', screen: 'build', note: 'Needs review and loyalty feeds (gap 20)' },
  { id: 'facilities', area: 'Facilities & compliance', icon: 'Wrench', examples: 'Equipment downtime, temperature logs, energy', data: [], view: '—', stage: 'none', fig: 'Out of scope', claim: 'none', screen: 'build', note: 'Risk more than recoverable margin; partner, don’t build' },
];
const cvAreaFig = (a) => (typeof a.fig === 'function' ? a.fig() : a.fig);

const CV_STAGE_PILL = {
  verify: ['good', 'BadgeCheck', 'Verified'],
  act: ['info', 'MousePointerClick', 'Ready to act'],
  understand: ['neutral', 'ChartColumn', 'Explained'],
  detect: ['warn', 'ScanSearch', 'Detected'],
  none: ['neutral', 'CircleMinus', 'Not covered'],
};

function CvCoverage() {
  const cv = useCv();
  const at = (k) => CV_AREAS.filter((a) => CV_STAGE_IDX[a.stage] >= CV_STAGE_IDX[k]).length;
  const counts = { detect: at('detect'), understand: at('understand'), act: at('act'), verify: at('verify') };
  const banked = Math.round((97 / 7) * 127);
  return (
    <div className="cv-page wide">
      <PageHead over="Coverage map · Rosewood Oakland" q="Where is this restaurant losing money, and how far along is each fix?"
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
            <thead><tr><th>Area</th><th>What leaks</th><th>Data it reads</th><th>How it&apos;s shown</th><th>At Oakland</th><th className="r">What the data supports</th></tr></thead>
            <tbody>
              {CV_AREAS.map((a) => {
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
                        <span className="cv-num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{cvAreaFig(a)}</span>
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
          <p className="cv-small" style={{ lineHeight: 1.6 }}>Opportunity-sizing sheets put a restaurant this size (Oakland runs about <b className="cv-num">{cvMoney(Math.round(CV_ANNUAL_SALES / 1000) * 1000)}</b> a year) at $20K to $45K a year of recoverable margin. That&apos;s a fair <i>{CV_CLAIM.est.label.toLowerCase()}</i>. It isn&apos;t money.</p>
          <p className="cv-small" style={{ lineHeight: 1.6 }}>The figures above mix five claim strengths and overlap each other: the kitchen&apos;s slow hours and the full-room hours are the same dollars, and the salmon usage gap and the salmon plate test share a key. Summing them would count dollars twice.</p>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">What&apos;s actually banked</span><Claim k="book" /></div>
          <span className="cv-fig lg"><Money id="to-date">{cvMoney(banked)}</Money></span>
          <p className="cv-small cv-muted" style={{ lineHeight: 1.55 }}>Since Jun 22, from one verified change. Each area moves left to right on the loop above; only the last step earns a fee.</p>
          <div className="cv-row">
            <Button icon="BadgeCheck" onClick={() => cv.go('proof')}>See the proof</Button>
            <Button variant="secondary" icon="Wrench" onClick={() => cv.go('build')}>What&apos;s not built yet</Button>
          </div>
        </section>
      </div>
    </div>
  );
}

export {
  CV_LOOP, LoopStrip, Diagnose, CV_AREAS, cvAreaFig,
  CV_STAFF, CV_SIGNALS, CV_PV_BASE, CV_PV_EXCESS_28, CV_EXC_SERIES, CV_EXC_UCL, CV_EXC_LCL, CV_EXC_WEEK,
  CV_TICKETS, CV_LATE_BY_STATION, CV_LATE_HOURS,
  CV_USAGE, CV_USAGE_WEEK, CV_BAR_WEEK,
  CV_CHANNELS, CV_DELIVERY_REFUNDS, CV_MARKUP_LO, CV_MARKUP_HI, CV_WEEK_SALES,
  CvCoverage, CvControls, CvKitchen, CvInventory, CvChannels,
};
