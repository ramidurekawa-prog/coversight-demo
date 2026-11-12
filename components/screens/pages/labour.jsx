'use client';

import * as React from 'react';
import { Button, Tabs } from '../../kit';
import { engine, useEngine } from '../../engine';
import { tonightPlan } from '../week';
import { weeklySeries } from '../../../lib/data/readers';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_LOCS, CV_PROOF, Claim, Money, Pill, Outcome, Callout, PageHead, cvApproval, cvScale, SampleNote } from '../core';
import { DenseLabour } from '../dense-sections';

/* ================================================================ Labour */
function LabourChart({ d }) {
  const W = 560, H = 210, P = { l: 30, r: 10, t: 12, b: 28 };
  const n = d.hours.length, bw = (W - P.l - P.r) / n;
  const y = cvScale(0, 10, H - P.b, P.t);
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Servers scheduled versus needed, ${d.label}`}>
      {[0, 2, 4, 6, 8, 10].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 8} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
      {d.hours.map((h, i) => {
        const x0 = P.l + i * bw + bw * 0.18, w = bw * 0.64;
        const s = d.sched[i], nd = d.need[i];
        return (
          <g key={h}>
            <rect x={x0} y={y(s)} width={w} height={y(0) - y(s)} rx="3" fill="var(--surface-sunken)" stroke="var(--border-strong)" />
            <rect x={x0 + w * 0.22} y={y(nd)} width={w * 0.56} height={y(0) - y(nd)} rx="2" fill="var(--accent)" />
            {s > nd && <text x={x0 + w / 2} y={y(s) - 5} textAnchor="middle" style={{ fill: "var(--exposure)", fontWeight: 600 }}>+{s - nd} idle</text>}
            {nd > s && <text x={x0 + w / 2} y={y(nd) - 5} textAnchor="middle" style={{ fill: "var(--money-down)", fontWeight: 600 }}>−{nd - s} short</text>}
            <text x={x0 + w / 2} y={H - 10} textAnchor="middle">{h}</text>
          </g>
        );
      })}
    </svg>
  );
}
function CvLabour() {
  if (CV_D.room.fromToast) return <LabourOwn />;
  return <CvLabourSample />;
}
function CvLabourSample() {
  const cv = useCv();
  const [day, setDay] = React.useState("sat");
  const L = CV_D.room.labour;
  const d = L[day];
  const lastLab = CV_D.proofs.filter((p) => p.lever === "Labour" && (p.outcome === "verified" || p.outcome === "limited"))[0];
  const idle = d.sched.reduce((s, v, i) => s + Math.max(0, v - d.need[i]), 0);
  const short = d.sched.reduce((s, v, i) => s + Math.max(0, d.need[i] - v), 0);
  return (
    <div className="cv-page wide">
      <PageHead over={`Labour · ${CV_ROOM.name} · ${CV_D.room.staff.length} people, ${cvMoney(Math.round(CV_D.week.labour))} this week`} q="How many people does each hour need, and did the last change work?"
        sub="Staffing from your measured service rate, with short hours shown beside idle ones. A schedule that only ever cuts is not one anyone should trust." />
      <SampleNote what="The hour-by-hour staffing needs" />
      <div className="cv-grid g4">
        {[["Idle server-hours this week", `${L.kpis.idle} h`, "cv-exp", "obs"], ["Short server-hours this week", `${L.kpis.short} h`, "cv-down", "obs"], ["Your measured service rate", L.kpis.rate.toFixed(2), "", "obs"], ["Last change", lastLab ? `${cvMoney(lastLab.bookable)}/wk` : "$0", lastLab ? "cv-up" : "", lastLab ? "book" : "none"]].map(([k, v, c, cl]) => (
          <div key={k} className="cv-card" style={{ gap: 6 }}>
            <span className="cv-xs cv-faint">{k}</span>
            <span className={`cv-fig md ${c}`}>{k === "Last change" && lastLab ? <Money id={lastLab.id}>{v}</Money> : v}</span>
            <div className="cv-row" style={{ gap: 6 }}><Claim k={cl} />{k === "Your measured service rate" && <span className="cv-xs cv-faint">covers per server-hour</span>}</div>
          </div>
        ))}
      </div>
      <Callout icon="Info">{L.note}</Callout>
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head">
            <span className="cv-h4">{d.label}: scheduled vs needed</span>
            <Tabs value={day} onChange={setDay} tabs={[{ value: "tue", label: "Tuesday" }, { value: "sat", label: "Saturday" }]} />
          </div>
          <LabourChart d={d} />
          <div className="cv-legend">
            <span><i style={{ background: "var(--surface-sunken)", border: "1px solid var(--border-strong)" }} />Scheduled</span>
            <span><i style={{ background: "var(--accent)" }} />Needed, at your service rate with a safety margin</span>
          </div>
          <span className="cv-small cv-muted">This service: <b className="cv-num">{idle}</b> idle and <b className="cv-num">{short}</b> short server-hours.</span>
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Drafted for next week</span><Pill icon="Gauge">{cvApproval(L.draft.approval).level}</Pill></div>
          <div className="cv-diff">
            <div className="r h"><span>When</span><span>Now</span><span>Draft</span></div>
            {cvApproval(L.draft.approval).diff.map(([w, a, b]) => <div className="r" key={w}><span>{w}</span><span className="was">{a}</span><span className="now">{b}</span></div>)}
          </div>
          <p className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{L.draft.note}</p>
          <Button icon="Send" onClick={() => cv.approve(L.draft.approval)}>Review and publish</Button>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Recent labour changes</th><th>Room</th><th>Outcome</th><th className="r">Bookable /wk</th></tr></thead>
            <tbody>
              {CV_PROOF.filter((p) => p.lever === "Labour").map((p) => (
                <tr key={p.id} className="cv-tr" onClick={() => cv.go("packet", { id: p.id })}>
                  <td style={{ fontWeight: 600 }}>{p.title}</td>
                  <td>{CV_LOCS.find((l) => l.id === p.loc).short}</td>
                  <td><Outcome k={p.outcome} /></td>
                  <td className="r">{p.bookable ? cvMoney(p.bookable) : "$0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <DenseLabour />
    </div>
  );
}

/* A room on its own Toast data: staffing per hour from its own clock-ins and covers. */
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourLbl = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
function LabourOwn() {
  const cv = useCv();
  const eng = useEngine();
  const room = CV_D.room;
  const plans = Object.fromEntries(DAY_ORDER.map((d) => [d, tonightPlan(room, d)]));
  const days = DAY_ORDER.filter((d) => plans[d]);
  const [day, setDay] = React.useState(days.find((d) => plans[d].cutFrom != null) || days[0]);
  const plan = plans[day];
  const idleWk = weeklySeries(room, 'idleServerHours').slice(-1)[0]?.value ?? 0;
  const shortWk = Object.values(plans).filter(Boolean).reduce((t, p) => t + p.hours.reduce((x, h) => x + Math.max(0, h.need - Math.round(h.servers)), 0), 0);
  const otWk = weeklySeries(room, 'otMinutes').slice(-1)[0]?.value ?? 0;
  const tests = (eng.windows || []).filter((w) => w.roomId === CV_D.id && (w.lever === 'labour' || w.lever === 'overtime'));
  const approvalId = plan?.cutFrom != null ? `cut:${day}:${plan.cutFrom}` : null;
  const task = approvalId && (eng.tasks || []).find((t) => t.roomId === CV_D.id && t.approvalId === approvalId && t.status !== 'cancelled');
  return (
    <div className="cv-page wide">
      <PageHead over={`Labour · ${CV_ROOM.name} · ${room.staff.length} people, ${cvMoney(Math.round(CV_D.week.labour))} this week`} q="How many people does each hour need, and did the last change work?"
        sub={`From your Toast clock-ins and covers through ${room.fromToast.end}, at this room's own pace. Short hours are shown beside idle ones: a schedule that only ever cuts isn't one anyone should trust.`} />
      <div className="cv-grid g4">
        {[['Idle server-hours, last week', `${idleWk} h`, 'cv-exp'], ['Short server-hours, typical week', `${shortWk} h`, 'cv-down'], ['Your measured service rate', plan ? plan.rate.toFixed(2) : '—', ''], ['Overtime, last week', `${Math.round(otWk / 60 * 10) / 10} h`, otWk ? 'cv-exp' : '']].map(([k, v, c]) => (
          <div key={k} className="cv-card" style={{ gap: 6 }}><span className="cv-xs cv-faint">{k}</span><span className={`cv-fig md ${c}`}>{v}</span><Claim k="obs" /></div>
        ))}
      </div>
      {!days.length ? <Callout icon="Clock">Add TimeEntries.csv to your Toast upload to see servers on the floor per hour.</Callout> : (
        <div className="cv-grid g-hero">
          <section className="cv-card flush">
            <div className="cv-card-head" style={{ padding: '12px 16px' }}><span className="cv-h4">{day}: on the floor vs needed</span><Tabs value={day} onChange={setDay} tabs={days.map((d) => ({ value: d, label: d }))} /></div>
            <div className="cv-tablewrap"><table className="cv-table">
              <thead><tr><th>Hour</th><th className="r">Covers</th><th className="r">On the floor</th><th className="r">Needed</th><th className="r">Spare / short</th></tr></thead>
              <tbody>{plan.hours.map((h) => { const diff = Math.round(h.servers) - h.need; return (
                <tr key={h.hour}><td>{hourLbl(h.hour)}</td><td className="r">{h.covers}</td><td className="r">{h.servers}</td><td className="r">{h.need}</td><td className={`r ${diff > 0 ? 'cv-exp' : diff < 0 ? 'cv-down' : ''}`}>{diff > 0 ? `+${diff} spare` : diff < 0 ? `${diff} short` : '—'}</td></tr>
              ); })}</tbody>
            </table></div>
          </section>
          <section className="cv-card">
            <span className="cv-h4">Next {day}</span>
            {plan.cutFrom == null ? <span className="cv-small cv-muted">Every hour to close used its servers on recent {day}s. No cut.</span> : (
              <>
                <span className="cv-small">One fewer server from {hourLbl(plan.cutFrom)} to close: about {plan.idleHours} server-hour{plan.idleHours === 1 ? '' : 's'}, {cvMoney(plan.idleHours * plan.wage)} a week. <Claim k="mod" /></span>
                {task ? <Pill tone="info" icon="ListChecks">Approved · steps on Today</Pill> : <Button icon="Send" onClick={async () => { const top = Math.round(plan.hours.find((h) => h.hour === plan.cutFrom).servers); await engine.createTask(approvalId, { title: `${day}: one fewer server from ${hourLbl(plan.cutFrom)} to close`, system: '7shifts', diff: [[`${day} ${hourLbl(plan.cutFrom)} to close`, `${top} servers`, `${top - 1} servers`]] }); cv.toast('Approved. The steps for 7shifts are on Today.'); }}>Approve for next {day}</Button>}
              </>
            )}
            <span className="cv-xs cv-faint">To book it, run a 28-day test on Labour overstaff (Levers or Today).</span>
          </section>
        </div>
      )}
      <section className="cv-card flush">
        <div className="cv-tablewrap"><table className="cv-table">
          <thead><tr><th>Labour and overtime tests</th><th>Status</th><th className="r">Booked /wk</th></tr></thead>
          <tbody>
            {tests.length === 0 && <tr><td colSpan={3} className="cv-small cv-muted">No labour tests yet.</td></tr>}
            {tests.map((w) => <tr key={w.id} className="cv-tr" onClick={() => cv.go('packet', { id: w.id })}><td style={{ fontWeight: 600 }}>{w.title}</td><td>{w.status === 'running' ? `day ${w.day} of 28` : w.status}</td><td className="r">{w.status === 'verified' ? cvMoney(w.bookedCents / 100, { cents: true }) : '$0'}</td></tr>)}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}

export { CvLabour };
