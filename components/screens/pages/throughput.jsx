'use client';

import { Icon, Button } from '../../kit';
import { measuredFillPct } from '../../../lib/data/levers';
import { useCv, cvMoney, CV_D, CV_ROOM, Claim, Callout, PageHead, SampleNote } from '../core';
import { DenseThroughput } from '../dense-sections';

/* ================================================================ Throughput */
/* What a room's own Toast export can say about throughput: turn times, how fast tables are reseated, and when covers peak. */
function ThroughputOwn() {
  const L = CV_D.room.levers || {};
  const turns = L.turns || [];
  const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);
  const fri = mean(turns.filter((t) => t.fri).map((t) => t.min));
  const all = mean(turns.map((t) => t.min));
  const fill = measuredFillPct(L.reseatGaps || []);
  const byHour = {};
  (L.serviceHours || []).forEach((h) => { byHour[`${h.day} ${h.hour}`] = (byHour[`${h.day} ${h.hour}`] || 0) + h.covers / 4; });
  const peak = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0];
  const hr = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
  return (
    <section className="cv-card">
      <div className="cv-card-head"><span className="cv-h4">From your Toast data through {CV_D.room.fromToast.end}</span><Claim k="obs" /></div>
      <div className="cv-grid g4">
        {[['Average dine-in turn', all != null ? `${all.toFixed(0)} min` : '—'], ['Friday dinner turn', fri != null ? `${fri.toFixed(0)} min` : '—'], ['Tables reseated within minutes', fill != null ? `${Math.round(fill * 100)}%` : 'needs 20+'], ['Busiest hour', peak ? `${peak[0].split(' ')[0]} ${hr(+peak[0].split(' ')[1])}, ~${Math.round(peak[1])} covers` : '—']].map(([k, v]) => (
          <div key={k} className="cv-col" style={{ gap: 4 }}><span className="cv-xs cv-faint">{k}</span><span className="cv-fig md">{v}</span></div>
        ))}
      </div>
      <span className="cv-small cv-muted">A quickly reseated table means someone was waiting for it. Without a waitlist, that's the only sign the room was full, so faster turns stay at $0 until it shows up often.</span>
    </section>
  );
}

function CvThroughput() {
  const cv = useCv();
  const T = CV_D.room.throughput;
  const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return (
    <div className="cv-page">
      <PageHead over={`Throughput · ${CV_ROOM.name}`} q="Is the room constrained, and is a faster turn worth anything?"
        sub="A faster turn only earns money when the room is full and people are waiting. So the first number is how often the room is actually full." />
      {CV_D.room.fromToast ? <ThroughputOwn /> : <SampleNote what="The seat-use and ceiling figures" />}
      {CV_D.room.fromToast && <span className="cv-small cv-muted">Below: the 15-minute seat-use view, still on the sample room until table-level data arrives with the API sync.</span>}
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <span className="cv-over">Claimable from faster turns this week</span>
          <span className="cv-fig xl">$0</span>
          <p className="cv-sub">{T.fullNote} If every one of those turned faster, the ceiling is <b className="cv-num">{cvMoney(T.ceiling)}</b> a month. We can't claim any of it: without waitlist data there's no way to know anyone was turned away.</p>
          <div className="cv-row"><Button icon="Plug" onClick={() => cv.go("sources")}>Connect your waitlist</Button><span className="cv-xs cv-faint">Turns the ceiling into something we can measure.</span></div>
        </section>
        <section className="cv-card">
          <span className="cv-h4">Room use</span>
          <dl className="cv-kv">
            <dt>Seat-hours used</dt><dd>{T.seatUse}%</dd>
            <dt>Best vs worst service</dt><dd>{T.bestWorst}×</dd>
            <dt>Intervals at capacity</dt><dd>{T.intervals} of {T.total}</dd>
            <dt>Seats</dt><dd>{CV_ROOM.seats}</dd>
          </dl>
          <Callout icon="Info">The old Watch screen applied a turn-time gain to every interval all week and showed {cvMoney(T.oldClaim)}. That number was never claimable.</Callout>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table">
            <thead><tr><th>Day</th><th><span className="cv-row" style={{ gap: 6 }}><Icon name="Sun" size={13} />Lunch, share of time full</span></th><th><span className="cv-row" style={{ gap: 6 }}><Icon name="Moon" size={13} />Dinner, share of time full</span></th></tr></thead>
            <tbody>
              {T.constrained.map(([d, l, n]) => (
                <tr key={d}>
                  <td style={{ fontWeight: 600 }}>{d}</td>
                  {[l, n].map((v, i) => (
                    <td key={i}>
                      <div className="cv-row nowrap" style={{ gap: 10 }}>
                        <div className="cv-decomp" style={{ width: 160, flexShrink: 0 }}><span style={{ width: `${v * 3}%`, background: i ? "var(--cat-1)" : "var(--cat-2)" }} /></div>
                        <span className="cv-num cv-small">{v}%</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <DenseThroughput />
    </div>
  );
}

export { CvThroughput };
