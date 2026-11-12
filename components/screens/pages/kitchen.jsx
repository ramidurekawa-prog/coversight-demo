'use client';

import { Button, Icon } from '../../kit';
import { CV_D, CV_ROOM, Callout, Claim, Pill, PageHead, cvScale, useCv, SampleNote } from '../core';
import { useSaved } from '../../engine';
import { DenseKitchen } from '../dense-sections';
import { LoopStrip, Diagnose } from '../areas';

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
  const own = !!t.own;
  const [ideas, setIdeas] = useSaved('ideas', []);
  const idea = { id: 'kitchen-bottleneck', title: `Rebalance the ${t.bottleneck} station at the Saturday peak`, why: 'Waits on a waitlist to show whether a faster kitchen seats anyone new.' };
  const hasIdea = ideas.some((x) => x.id === idea.id);
  const peakHour = t.sat.indexOf(Math.max(...t.sat.filter((v) => v != null)));
  const kds = CV_D.feeds.find((f) => f.name === 'Kitchen display');
  const late = t.fri.filter((v) => v > t.target).length + t.sat.filter((v) => v > t.target).length;
  const peak = Math.max(...t.sat);
  const stale = kds.state === 'stale';
  return (
    <div className="cv-page wide">
      <PageHead over={`Kitchen · ticket times · ${CV_ROOM.name}`} q="Where does the line slow down, and does it cost anything?"
        sub="Ticket time at the pass by hour and station. A slow kitchen only costs money when it costs a table: when the room is full and someone is waiting." />
      {own ? <Callout icon="ChefHat">From your Toast kitchen timings through {CV_D.room.fromToast?.end}: every ticket, measured at the station that fulfilled it.</Callout> : <SampleNote what="Ticket times by station" />}
      <LoopStrip stage={stale ? 'detect' : 'understand'} notes={{ detect: `${late} dinner hours over target`, understand: `${t.bottleneck}, Fri and Sat peak`, act: 'Waits on measured ticket times', verify: 'Needs ticket-level export' }} />
      {stale && !own && <Callout tone="warn" icon="Clock">The kitchen display hasn&apos;t exported since Oct 21, so these are the last good weeks. {kds.note}</Callout>}
      <div className="cv-grid g-hero">
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Ticket time at the pass, Friday and Saturday dinner</span><Claim k="est" /></div>
          <TicketChart t={t} />
          <div className="cv-legend">
            <span><i style={{ background: 'var(--cat-2)' }} />Friday</span>
            <span><i className="ring" style={{ borderColor: 'var(--cat-1)' }} />Saturday</span>
            <span><i className="line" style={{ background: 'var(--money-down)' }} />{t.target}-minute target</span>
          </div>
          <span className="cv-small cv-muted">Saturday peaks at <b className="cv-num">{peak.toFixed(1)} min</b> at {peakHour + 5} pm. {own ? 'Measured from every ticket in your Toast kitchen timings.' : 'These are hourly averages from the kitchen display, so they can be estimated, not measured.'}</span>
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
          <span className="cv-xs cv-faint">{own ? 'Share of all tickets, by the station that fulfilled them.' : `Share of tickets over ${t.target} minutes, by the station that finished last.`}</span>
          <div className="cv-row" style={{ alignItems: 'baseline' }}>
            <span className="cv-fig md">$0</span><Claim k="none" />
            <span className="cv-small cv-muted">claimable this week</span>
          </div>
          <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>The slow hours line up with the hours the room is full. A faster kitchen there is the same money as faster turns on <button className="cv-link" onClick={() => cv.go('throughput')}>Throughput</button>, counted once, and it can&apos;t be claimed until a waitlist shows who was turned away.</span>
        </section>
      </div>
      <div className="cv-grid g2">
        <Diagnose data={['Kitchen display', 'Toast', 'Waitlist']} manager={own ? `${t.bottleneck} carries ${t.stations[0]?.[1] ?? 0}% of tickets, and Saturday peaks at ${peak.toFixed(1)} minutes around ${peakHour + 5} pm against a ${t.target}-minute target.` : t.manager} fix={own ? `Move one prep task off ${t.bottleneck} before the Saturday peak, or split its busiest dish across two stations.` : t.fix}
          verify="With ticket-level export on, the test compares ticket times on changed nights against matched nights. With a waitlist, faster turns at full room become claimable." />
        <section className="cv-card">
          <span className="cv-h4">Two connections unlock this lever</span>
          <div className="cv-col" style={{ gap: 10 }}>
            <div className="cv-row nowrap"><span className={`cv-q-ico ${stale ? 'bad' : 'warn'}`}><Icon name="MonitorCog" size={18} /></span><span className="cv-small" style={{ flex: 1 }}>Kitchen display: {stale ? 'restart the export, then ' : ''}switch export to each ticket. Measured, not estimated.</span></div>
            <div className="cv-row nowrap"><span className="cv-q-ico"><Icon name="Users" size={18} /></span><span className="cv-small" style={{ flex: 1 }}>Waitlist: shows whether a faster kitchen seated anyone new.</span></div>
          </div>
          <div className="cv-row">
            <Button icon="Plug" onClick={() => cv.go('sources')}>Fix the connections</Button>
            {hasIdea ? <Pill tone="good" icon="Check">Saved as a test idea</Pill> : <Button variant="secondary" onClick={() => { setIdeas((list) => [...list, { ...idea, at: new Date().toISOString() }], `Test idea saved: ${idea.title}`); cv.toast('Saved as a test idea. It ranks at $0 until a waitlist is connected.'); }}>Add as a test idea</Button>}
          </div>
          {ideas.length > 0 && (
            <div className="cv-col" style={{ gap: 6 }}>
              <span className="cv-over">Saved test ideas</span>
              {ideas.map((x) => <div key={x.id} className="cv-row nowrap" style={{ gap: 8 }}><Icon name="Lightbulb" size={14} /><span className="cv-small" style={{ flex: 1 }}>{x.title}</span><Button size="sm" variant="ghost" onClick={() => setIdeas((list) => list.filter((y) => y.id !== x.id), `Test idea removed: ${x.title}`)}>Remove</Button></div>)}
            </div>
          )}
        </section>
      </div>
      <DenseKitchen />
    </div>
  );
}

export { CvKitchen };
