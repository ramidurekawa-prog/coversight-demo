'use client';

import * as React from 'react';
import { Icon, Tabs } from '../../kit';
import { useEngine } from '../../engine';
import { bookedBetween, utcDay } from '../../../lib/data/billing';
import { useCv, cvMoney, CV_D, CV_DS, CV_GROUP, CV_ROOM, CV_LOCS, CV_PROOF, Claim, Pill, Callout, PageHead, cvScale } from '../core';

/* ================================================================ Savings ledger */
const LEDGER_COLORS = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--accent)"];
/** Weekly banked series, one per packet that ever accrued or reversed. */
function ledgerSeries() {
  const weeks = CV_DS.ledgerWeeks;
  let c = 0;
  return CV_PROOF.filter((p) => p.ledger).map((p) => {
    const [a, z, v] = p.ledger;
    const loc = CV_LOCS.find((l) => l.id === p.loc);
    return { key: p.id, loc: p.loc, label: `${loc.short} · ${p.title.charAt(0).toLowerCase()}${p.title.slice(1)}${v < 0 ? " (reversed)" : ""}`, color: v < 0 ? "var(--money-down)" : LEDGER_COLORS[c++ % LEDGER_COLORS.length], vals: weeks.map((_, i) => (i >= a && (z == null || i <= z) ? v : 0)), reversed: v < 0 };
  });
}
function LedgerChart({ series }) {
  const CV_WEEKS = CV_DS.ledgerWeeks;
  const W = 1000, H = 250, P = { l: 48, r: 10, t: 14, b: 30 };
  const n = CV_WEEKS.length, bw = (W - P.l - P.r) / n;
  const tops = CV_WEEKS.map((_, i) => series.reduce((s, ser) => s + Math.max(0, ser.vals[i]), 0));
  const bots = CV_WEEKS.map((_, i) => series.reduce((s, ser) => s + Math.min(0, ser.vals[i]), 0));
  const max = Math.max(100, ...tops) * 1.1, min = Math.min(0, ...bots) * 1.15;
  const y = cvScale(min, max, H - P.b, P.t);
  const step = max > 400 ? 200 : max > 150 ? 100 : 25;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly banked savings by change">
      {ticks.map((v) => <g key={v}><line className={v === 0 ? "axis" : "grid"} x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">{cvMoney(v)}</text></g>)}
      {CV_WEEKS.map((w, i) => {
        let acc = 0;
        const x0 = P.l + i * bw + bw * 0.16, bwid = bw * 0.68;
        return (
          <g key={w}>
            {series.map((s) => {
              const v = s.vals[i];
              if (!v) return null;
              if (v < 0) return <rect key={s.key} x={x0} y={y(0)} width={bwid} height={y(v) - y(0)} fill="none" stroke={s.color} strokeDasharray="3 2" strokeWidth="1.5" rx="2" />;
              const r = <rect key={s.key} x={x0} y={y(acc + v)} width={bwid} height={y(acc) - y(acc + v)} fill={s.color} rx="2" />;
              acc += v;
              return r;
            })}
            {i % 3 === 0 && <text x={x0 + bwid / 2} y={H - 10} textAnchor="middle">{w}</text>}
          </g>
        );
      })}
    </svg>
  );
}
/* A real group's ledger: every figure is the same daily accrual of verified
   lower bounds (lib/data/billing.js bookedBetween), over a different span. */
function LedgerReal() {
  const cv = useCv();
  const eng = useEngine();
  const [cad, setCad] = React.useState('week');
  const scope = cv.loc;
  const ws = (eng.windows || []).filter((w) => (w.status === 'verified' || w.status === 'reversed') && (scope === 'all' || w.roomId === scope))
    .map((w) => ({ ...w, bookedCentsBeforeReversal: Math.max(0, w.lowCents ?? 0) }));
  const now = new Date();
  const today = utcDay(now) + 1; // through today
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const dayN = (yy, mm, dd) => Date.UTC(yy, mm, dd) / 864e5;
  const span = (from) => ws.reduce((t, w) => t + bookedBetween(w, from, today).cents, 0) / 100;
  const live = ws.filter((w) => w.status === 'verified');
  const perDay = live.reduce((t, w) => t + w.bookedCents / 7, 0) / 100;
  const qStart = dayN(y, Math.floor(m / 3) * 3, 1);
  const name = scope === 'all' ? eng.org?.name : CV_ROOM.name;
  const monthName = now.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const CAD = {
    day: { fig: cvMoney(perDay, { cents: true }), say: live.length ? `Today ${live.length === 1 ? 'one verified change is' : `${live.length} verified changes are`} holding: ${cvMoney(perDay, { cents: true })}.` : 'Nothing is verified and holding yet.', math: 'Σ (weekly lower bound ÷ 7) for every verified change', note: 'An accrual of a rate already proven, not a new measurement.' },
    week: { fig: cvMoney(span(today - 7), { cents: true }), say: `The last 7 days: ${cvMoney(span(today - 7), { cents: true })}.`, math: 'Σ of the last seven daily accruals', note: 'A new rate is only born when a 28-day test closes.' },
    month: { fig: cvMoney(span(dayN(y, m, 1)), { cents: true }), say: `${monthName} so far: ${cvMoney(span(dayN(y, m, 1)), { cents: true })}.`, math: 'Σ of the month’s daily accruals, never weekly × 4.33', note: 'This is the reconciled savings the month’s invoice is built on.' },
    quarter: { fig: cvMoney(span(qStart), { cents: true }), say: `This quarter: ${cvMoney(span(qStart), { cents: true })}, counted day by day from each change's verification.`, math: 'Σ of each day this quarter a change was accruing', note: 'Reversed changes stop accruing the day they were reversed.' },
    year: { fig: cvMoney(span(dayN(y, 0, 1)), { cents: true }), say: `${y} to date: ${cvMoney(span(dayN(y, 0, 1)), { cents: true })}.`, math: 'Σ of every day this year a verified change held', note: 'Checked monthly against your books by your accountant.' },
  };
  const c = CAD[cad];
  return (
    <div className="cv-page wide">
      <PageHead over={`Savings ledger · ${name}`} q="What has this been worth, at every zoom level?"
        sub="Measured once, over 28 days. Everything after that is bookkeeping on that one measurement: the day is the week spread out, the month is its days added up." />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head">
            <Tabs value={cad} onChange={setCad} tabs={['day', 'week', 'month', 'quarter', 'year'].map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))} />
            <Claim k="book" />
          </div>
          <span className="cv-fig xl cv-up">{c.fig}</span>
          <p className="cv-h4" style={{ fontWeight: 600 }}>{c.say}</p>
          <div className="cv-formula" style={{ fontSize: 'var(--text-xs)' }}>{c.math}</div>
          <span className="cv-small cv-muted">{c.note}</span>
        </section>
        <section className="cv-card">
          <span className="cv-h4">What&apos;s accruing</span>
          {ws.length === 0 ? <span className="cv-small cv-muted">Nothing yet. The ledger starts when a test verifies.</span> : ws.map((w) => (
            <div key={w.id} className="cv-row nowrap" style={{ gap: 8 }}>
              <Pill tone={w.status === 'verified' ? 'good' : 'bad'} icon={w.status === 'verified' ? 'BadgeCheck' : 'Undo2'}>{w.status === 'verified' ? 'Holding' : 'Reversed'}</Pill>
              <span className="cv-small" style={{ flex: 1 }}>{w.title}</span>
              <span className="cv-small cv-num">{w.status === 'verified' ? `${cvMoney(w.bookedCents / 100, { cents: true })}/wk` : 'stopped accruing'}</span>
            </div>
          ))}
          <button className="cv-link" onClick={() => cv.go('billing')}>See the invoices <Icon name="ArrowRight" size={14} /></button>
        </section>
      </div>
    </div>
  );
}

function CvLedger() {
  const eng = useEngine();
  if (eng.mode === 'server' && eng.org && !eng.org.sample) return <LedgerReal />;
  return <CvLedgerSample />;
}

function CvLedgerSample() {
  const cv = useCv();
  const [cad, setCad] = React.useState("week");
  const scope = cv.loc;
  const all = ledgerSeries();
  const series = all.filter((x) => scope === "all" || x.loc === scope);
  const ds = scope === "all" ? CV_GROUP.rooms : [CV_D];
  const accr = ds.flatMap((r) => r.banked.accruing);
  const wk = ds.reduce((s2, r) => s2 + r.banked.week, 0);
  const d = wk / 7;
  const sumDays = (k) => accr.reduce((s2, p) => s2 + (p.bookable / 7) * (p[k] || 0), 0);
  const toDate = sumDays("accrualDays"), oct = sumDays("octDays"), q3 = sumDays("q3Days");
  const name = scope === "all" ? "All three rooms" : CV_ROOM.name;
  const n = ds.reduce((s2, r) => s2 + r.banked.live.length, 0);
  const CAD = {
    day: { fig: cvMoney(Math.round(d)), say: wk ? `Today you banked ${cvMoney(Math.round(d))} from ${n === 1 ? "one change" : `${n} changes`} holding.` : "Nothing accrued today. Nothing here has passed every gate and is holding.", math: "Σ (weekly lower bound ÷ 7) × persistence", note: "An accrual of a rate already proven, not a new measurement." },
    week: { fig: cvMoney(wk), say: `${cvMoney(wk)} this week. Nothing new verified, nothing reversed.`, math: "seven daily accruals + any window that closed this week", note: "The only cadence where a new number can be born." },
    month: { fig: cvMoney(Math.round(oct)), say: `October so far: ${cvMoney(Math.round(oct))} over 26 days, against $349 a room of subscription.`, math: "Σ of the month's daily accruals, never weekly × 4.33", note: "Months differ in length, and the ledger simply reflects that." },
    quarter: { fig: cvMoney(Math.round(q3)), say: `Q3: ${cvMoney(Math.round(q3))} banked, counted day by day from each change's verification date.`, math: "Σ of each day in Jul–Sep a change was accruing", note: "One re-test per standard per quarter." },
    year: { fig: cvMoney(Math.round(toDate)), say: `${cvMoney(Math.round(toDate))} since June 22. The first annual reconciliation against your books is in June 2027.`, math: "Σ of days, then checked against the margin your P&L actually shows", note: "If the claim ever exceeds the improvement, it's capped and the gap is shown." },
  };
  const c = CAD[cad];
  return (
    <div className="cv-page wide">
      <PageHead over={`Savings ledger · ${name}`} q="What has this been worth, at every zoom level?"
        sub="Measured once, over weeks. Everything after that is bookkeeping on that one measurement: the day is the week spread out, the month is its days added up." />
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head">
            <Tabs value={cad} onChange={setCad} tabs={["day", "week", "month", "quarter", "year"].map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))} />
            <Claim k="book" />
          </div>
          <span className="cv-xs cv-faint">{name}</span>
          <span className="cv-fig xl cv-up">{c.fig}</span>
          <p className="cv-h4" style={{ fontWeight: 600 }}>"{c.say}"</p>
          <div className="cv-formula" style={{ fontSize: "var(--text-xs)" }}>{c.math}</div>
          <span className="cv-small cv-muted">{c.note}</span>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Two numbers that never merge</span>
          <div className="cv-col" style={{ gap: 4 }}>
            <div className="cv-row"><Claim k="obs" /><span style={{ fontWeight: 600 }}>Earned</span></div>
            <span className="cv-small cv-muted">What the business made, from its own register. It exists whether or not we do.</span>
          </div>
          <div className="cv-col" style={{ gap: 4 }}>
            <div className="cv-row"><Claim k="book" /><span style={{ fontWeight: 600 }}>Saved</span></div>
            <span className="cv-small cv-muted">What changed because of a change we recommended, measured against matched controls. Never a share of earned, never a target percentage.</span>
          </div>
        </section>
      </div>
      <section className="cv-card">
        <div className="cv-card-head">
          <span className="cv-h4">Banked each week</span>
          <span className="cv-small cv-faint">Switch rooms in the top bar</span>
        </div>
        <LedgerChart series={series.length ? series : all} />
        <div className="cv-legend">
          {(series.length ? series : all).map((s) => <span key={s.key}><i style={s.reversed ? { border: `1.5px dashed ${s.color}`, background: "transparent" } : { background: s.color }} />{s.label}</span>)}
        </div>
        {(scope === "all" || scope === "walnut") && <Callout tone="warn" icon="PauseCircle">Walnut Creek's comp reset stopped accruing the week of Oct 19. Its control chart is outside the limit, and nothing accrues while a guardrail is amber.</Callout>}
        {(scope === "all" || scope === "berkeley") && <Callout tone="bad" icon="Undo2">Berkeley's Friday server cut was removed back to Aug 3, the day turn time started to slip, not the day anyone noticed. The $555 left every figure and was credited.</Callout>}
      </section>
      <section className="cv-card">
        <span className="cv-h4">The life of one saved dollar</span>
        <div className="cv-life">
          {[["Nothing yet", "Tuesday dinner", "In testing. Accrues nothing."], ["Accrues", "Thursday prep", "Window closed clean. Bills on the lower bound."], ["Decays", "None yet", "A short half-life accrues less, automatically."], ["Reverses", "Berkeley Friday", "Dollars leave from the day the metric turned."], ["Retires", "Jun 2027", "After 52 weeks it's held, not saved."], ["Is defended", "Later", "A held standard is worth what its drift would cost."]].map(([k, who, t]) => (
            <div key={k}><span style={{ fontWeight: 700 }}>{k}</span><span className="cv-xs" style={{ color: "var(--accent)", fontWeight: 600 }}>{who}</span><span className="k" style={{ lineHeight: 1.4 }}>{t}</span></div>
          ))}
        </div>
      </section>
      <Callout icon="ShieldCheck">Six rules, each one costs us money in the short run. Nothing accrues before its window closes. Nothing accrues while a guardrail is amber. One lever key per dollar. The invoice uses the lower bound. A reversal removes dollars retroactively. The annual total is capped at what your books show.</Callout>
    </div>
  );
}

export { CvLedger };
