'use client';

import * as React from 'react';
import { Icon, Button } from '../../kit';
import { useCv, cvMoney, CV_D, CV_DS, CV_ROOM, Pill, Callout, PageHead } from '../core';
import { leverReport } from '../../../lib/data/levers.js';
import { engine, useEngine } from '../../engine';
import { locOf } from '../live';

/* ================================================================ Levers */

const BAR_LABELS = [
  ['data', 'Data', 'Reads the room’s own observations'],
  ['measured', 'Measured', 'No made-up number in its dollars'],
  ['measurable', 'Provable', 'A 28-day test could prove the expected effect'],
  ['controls', 'Controls', 'An untouched comparison to subtract'],
  ['books', 'Books $', 'A verified test converts to dollars a week'],
];
const gradeTone = (g) => (g === 'A' ? 'good' : g === 'A−' || g === 'Clear' ? 'info' : g === 'B' ? 'warn' : 'bad');
const gradeIcon = (g) => ({ A: 'BadgeCheck', 'A−': 'CircleCheck', Clear: 'CircleMinus', B: 'CircleDot' })[g] ?? 'CircleX';

function CvLevers() {
  const cv = useCv();
  const eng = useEngine();
  const roomId = cv.loc === 'all' ? CV_D.id : cv.loc;
  const room = CV_DS.rooms[roomId];
  const levers = React.useMemo(() => leverReport(room, roomId === CV_D.id ? CV_D : undefined), [room, roomId]);
  const [open, setOpen] = React.useState(null);
  const own = !!room.fromToast;
  const testOf = (key) => (eng.windows || []).find((w) => w.roomId === roomId && w.lever === key && (w.status === 'running' || w.status === 'waiting' || w.status === 'verified'));
  const start = async (key) => { const r = await engine.startWindow(key, { roomId }); cv.toast(r.ok ? 'Test started. Baseline frozen; each new week of data is a checkpoint.' : r.error); };
  return (
    <div className="cv-page wide">
      <PageHead over={`Levers · ${locOf(roomId)?.name ?? CV_ROOM.name}`} q="Is every lever running on measurement?"
        sub={`Each of the six Toast-fed levers, graded on five bars: it reads the room's own data, no number in its dollars is made up, a 28-day test could prove it, there's an untouched comparison to subtract, and a verified test books dollars. ${own ? `Every figure reads this room's own Toast data through ${room.fromToast.end}.` : 'Every figure here is computed from this room’s sample observations until its Toast data is loaded.'}`}
        right={cv.loc === 'all' && <Pill icon="Building2">Showing Oakland; pick a room in the top bar</Pill>} />
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Lever</th><th>Where</th><th className="r">$ a week</th><th className="r">Confidence</th>{BAR_LABELS.map(([k, l, t]) => <th key={k} className="c" title={t}>{l}</th>)}<th>Grade</th></tr></thead>
            <tbody>
              {levers.map((l) => (
                <React.Fragment key={l.key}>
                  <tr onClick={() => setOpen(open === l.key ? null : l.key)} style={{ cursor: 'pointer' }} aria-expanded={open === l.key}>
                    <td style={{ fontWeight: 600 }}>{l.name}</td>
                    <td className="cv-small">{l.scope}</td>
                    <td className="r">{l.weekly > 0 ? cvMoney(Math.round(l.weekly)) : '—'}</td>
                    <td className="r">{l.conf ? l.conf.confidence : '—'}</td>
                    {BAR_LABELS.map(([k]) => (
                      <td key={k} className="c">
                        {l.bars[k] === null ? <span className="cv-faint">—</span> : <Icon name={l.bars[k] ? 'CircleCheck' : 'CircleX'} size={16} className={l.bars[k] ? 'ok' : 'no'} aria-label={l.bars[k] ? 'yes' : 'no'} />}
                      </td>
                    ))}
                    <td><Pill tone={gradeTone(l.grade)} icon={gradeIcon(l.grade)}>{l.grade}</Pill></td>
                  </tr>
                  {open === l.key && (
                    <tr>
                      <td colSpan={10} className="cv-small cv-muted" style={{ lineHeight: 1.6, whiteSpace: 'normal' }}>
                        <b>How:</b> {l.method}.{' '}
                        <b>Test power:</b> {l.mde === null ? 'not enough spread to say' : `a 28-day test proves effects of ${l.mde.toFixed(2)} ${l.unit} or more; this one expects ${Math.abs(l.expectedUnits ?? 0).toFixed(2)}`}.{' '}
                        <b>Controls:</b> {l.controlNote}.
                        {l.conf && <> <b>Confidence:</b> {Math.round(l.conf.stability * 100)}% of weeks held × sample {Math.round(l.conf.sample * 100)}%{l.conf.estimatedShare ? `, ${Math.round(l.conf.estimatedShare * 100)}% inferred` : ''}.</>}
                        {eng.mode === 'server' && (() => {
                          const w = testOf(l.key);
                          if (w) return <span className="cv-row" style={{ gap: 6, marginTop: 6 }}><Pill tone={w.status === 'verified' ? 'good' : 'info'} icon="Timer">{w.status === 'verified' ? 'Verified' : `Testing · day ${w.day} of 28`}</Pill><button className="cv-link" onClick={() => cv.go('windows')}>See the test</button></span>;
                          if (l.key === 'menu_margin') return <span className="cv-row" style={{ marginTop: 6 }}><button className="cv-link" onClick={() => cv.go('windows')}>Pick a dish to test on Test windows</button></span>;
                          return l.weekly > 0 ? <span className="cv-row" style={{ marginTop: 6 }}><Button size="sm" icon="Play" onClick={(e) => { e.stopPropagation(); start(l.key); }}>Start a 28-day test</Button></span> : null;
                        })()}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="cv-grid g2">
        <section className="cv-card">
          <span className="cv-h4">What changed from the typed numbers</span>
          <ul className="cv-ul">
            <li><Icon name="Users" size={15} />Labour: each room's own pace in its busiest hours replaces “14 covers a server”.</li>
            <li><Icon name="Receipt" size={15} />Voids & comps: the norm is the room's 8 weeks before, on a control chart; a whole-room rise is its own finding.</li>
            <li><Icon name="UtensilsCrossed" size={15} />Menu: each dish's price sensitivity is fitted from its own price changes, so a rise is valued after the plates it loses.</li>
            <li><Icon name="Armchair" size={15} />Turns: “guests were waiting” is measured from how fast tables are reseated, not assumed at 50% × 0.52, and valued after food cost.</li>
            <li><Icon name="BadgeCheck" size={15} />Every finding's confidence comes from one rule: weeks it held, data behind it, how much was inferred.</li>
          </ul>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Still not 100%</span>
          <ul className="cv-ul">
            <li><Icon name="ChefHat" size={15} />Ticket times: {own && room.fromToast.files?.includes('kitchen') ? 'measured from your Toast kitchen timings, but not a lever until a waitlist shows who was turned away.' : 'need the KitchenTimings export (Toast’s Standard API has no kitchen timings).'}</li>
            <li><Icon name="Shuffle" size={15} />Mix: the whole menu moves together, so there's no untouched comparison; a test is a before/after.</li>
            <li><Icon name="GitCompareArrows" size={15} />Matched controls aren&apos;t subtracted in real tests yet, so every real test is a before/after against its frozen baseline.</li>
            {!own && <li><Icon name="FlaskConical" size={15} />This room runs on sample observations. Load its Toast data exports to put every lever on its own numbers.</li>}
          </ul>
        </section>
      </div>
      <Callout icon="Timer"><span>See one lever run through a 28-day test, with and without matched controls: <button className="cv-link" onClick={() => cv.go('windows')}>Test windows</button></span></Callout>
    </div>
  );
}

export { CvLevers };
