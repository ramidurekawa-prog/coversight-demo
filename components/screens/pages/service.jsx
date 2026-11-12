'use client';

import { Icon, Button } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { useCv, cvMoney, CV_D, CV_ROOM, CV_NOW, Claim, Money, Pill, Callout, PageHead, cvScale, SampleNote } from '../core';
import { DenseService } from '../dense-sections';
import { tonightPlan } from '../week';

/* ================================================================ Service (live, phone-first) */
function serviceTimes(n) {
  return Array.from({ length: n }, (_, i) => { const m = 17 * 60 + i * 15; const h = Math.floor(m / 60), mm = m % 60; return `${h - 12}:${mm ? mm : '00'}`; });
}

function ServiceChart({ s }) {
  const { comp, actual, now, factor, mode } = s;
  const times = serviceTimes(comp.length);
  const W = 340, H = 150, P = { l: 22, r: 8, t: 10, b: 22 };
  const x = cvScale(0, comp.length - 1, P.l, W - P.r);
  const y = cvScale(0, 10, H - P.b, P.t);
  const fc = comp.map((c, i) => (i < now ? null : c * factor));
  const spread = mode === 'wait' ? 0.2 : 0.12;
  const band = comp.map((c, i) => (i < now ? null : [c * factor * (1 - spread), c * factor * (1 + spread)]));
  const bandPts = band.map((b, i) => b && [x(i), y(b[1])]).filter(Boolean).concat(band.map((b, i) => b && [x(i), y(b[0])]).filter(Boolean).reverse());
  return (
    <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Covers per 15 minutes tonight versus a comparable night">
      {[0, 5, 10].map((v) => <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text x={P.l - 6} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
      <polyline points={comp.map((c, i) => `${x(i)},${y(c)}`).join(' ')} fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 3" />
      <polygon points={bandPts.map((p) => p.join(',')).join(' ')} fill="var(--accent)" opacity="0.14" />
      <polyline points={fc.map((c, i) => c != null && `${x(i)},${y(c)}`).filter(Boolean).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 3" />
      <polyline points={actual.map((c, i) => `${x(i)},${y(c)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(now - 1)} cy={y(actual[now - 1])} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      {mode === 'cut' && <><line x1={x(12)} x2={x(12)} y1={P.t} y2={H - P.b} stroke="var(--warning-600)" strokeWidth="1" strokeDasharray="3 3" /><text x={x(12) + 4} y={P.t + 8} style={{ fill: 'var(--warning-600)' }}>8:00 cut</text></>}
      {[0, 4, 8, 12, 16, 19].map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{times[i]}</text>)}
    </svg>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;

function ServiceOwn() {
  const cv = useCv();
  const eng = useEngine();
  const day = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' }).slice(0, 3);
  const plan = tonightPlan(CV_D.room, day);
  const [answer, setAnswer] = useSaved('service', 'ask');
  const approvalId = plan?.cutFrom != null ? `cut:${day}:${plan.cutFrom}` : null;
  const task = approvalId && (eng.tasks || []).find((t) => t.roomId === CV_D.id && t.approvalId === approvalId && t.status !== 'cancelled');
  const approve = async () => {
    const top = Math.round(plan.hours.find((h) => h.hour === plan.cutFrom).servers);
    await engine.createTask(approvalId, { title: `${day}: one fewer server from ${hourLabel(plan.cutFrom)} to close`, system: '7shifts', diff: [[`${day} ${hourLabel(plan.cutFrom)} to close`, `${top} servers`, `${top - 1} servers`]] });
    setAnswer('yes', `${day}: one fewer server from ${hourLabel(plan.cutFrom)}`);
    cv.toast('Approved. The steps for 7shifts are on Today.');
  };
  return (
    <div className="cv-page">
      <PageHead over={`Service · ${CV_ROOM.name} · ${DAYS.includes(day) ? day : ''}`} q="How many servers does tonight need?"
        sub={`From your Toast data through ${CV_D.room.fromToast.end}: each hour on the last ${plan?.hours[0]?.weeks ?? 4} ${day}s, the covers you served and the servers on the floor, against this room's own pace of ${plan ? plan.rate.toFixed(1) : '—'} covers per server-hour.`} />
      <Callout icon="Info">Live pacing during service needs the Toast API sync. Until it&apos;s on, this plans tonight from the same weekday in your data.</Callout>
      {!plan ? <Callout icon="Clock">Not enough {day} dinners with servers on the floor in your data yet (needs TimeEntries.csv and 20+ busy hours).</Callout> : (
        <>
          <section className="cv-card flush">
            <div className="cv-tablewrap"><table className="cv-table">
              <thead><tr><th>Hour</th><th className="r">Typical covers</th><th className="r">Servers on the floor</th><th className="r">Servers needed</th><th className="r">Spare</th></tr></thead>
              <tbody>{plan.hours.map((h) => (
                <tr key={h.hour} style={h.hour >= (plan.cutFrom ?? 99) ? { background: 'var(--accent-subtle)' } : undefined}>
                  <td>{hourLabel(h.hour)}</td><td className="r">{h.covers}</td><td className="r">{h.servers}</td><td className="r">{h.need}</td><td className="r">{h.idle || '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
          <section className="cv-card">
            {plan.cutFrom == null ? (
              <><span className="cv-h4">Keep everyone on tonight</span><span className="cv-small cv-muted">Every hour to close has used its servers on recent {day}s.</span></>
            ) : (
              <>
                <span className="cv-h4">One fewer server from {hourLabel(plan.cutFrom)} to close</span>
                <span className="cv-small cv-muted">On recent {day}s every hour from {hourLabel(plan.cutFrom)} had a spare server: about {plan.idleHours} server-hour{plan.idleHours === 1 ? '' : 's'}, {cvMoney(plan.idleHours * plan.wage)} at your blended wage. <Claim k="mod" /></span>
                {task ? <Pill tone="info" icon="ListChecks">Approved · steps on Today</Pill> : answer === 'no' ? (
                  <div className="cv-row" style={{ gap: 8 }}><Pill icon="CircleMinus">Kept everyone on</Pill><Button size="sm" variant="ghost" onClick={() => setAnswer('ask', 'Service answer reopened')}>Change my answer</Button></div>
                ) : (
                  <div className="cv-row" style={{ gap: 8 }}>
                    <Button icon="Check" onClick={approve}>Approve the cut</Button>
                    <Button variant="secondary" onClick={() => { setAnswer('no', `${day}: kept everyone on`); cv.toast('Kept everyone on. Logged as declined.'); }}>Not tonight</Button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function CvService() {
  if (CV_D.room.fromToast) return <ServiceOwn />;
  return <CvServiceSample />;
}

function CvServiceSample() {
  const cv = useCv();
  const s = CV_D.room.service;
  const [state, setState] = useSaved('service', 'ask');
  const so = s.actual.reduce((a, b) => a + b, 0);
  const cmp = s.comp.slice(0, s.now).reduce((a, b) => a + b, 0);
  return (
    <div className="cv-page">
      <PageHead over={`The only screen a manager opens during service · ${CV_ROOM.name}`} q="Is tonight going the way it should?"
        sub="Live pacing against a comparable night, an intraday forecast with its band, and at most one labour decision. Built for a phone in one hand." />
      <SampleNote what="Tonight’s pacing" />
      <div className="cv-phone-stage">
        <div className="cv-phone" aria-label="Phone view">
          <span className="notch" />
          <div className="cv-row" style={{ justifyContent: 'space-between', padding: '0 4px' }}>
            <span style={{ fontWeight: 700 }}>{s.day}</span>
            <span className="cv-num cv-small cv-muted">{CV_NOW.time}</span>
          </div>
          <section className="cv-card">
            <div className="cv-row" style={{ justifyContent: 'space-between' }}>
              <span className="cv-xs cv-faint">Covers so far</span>
              <span className={`cv-xs cv-num ${s.pace < 0 ? 'cv-down' : 'cv-up'}`} style={{ fontWeight: 600 }}>{s.pace < 0 ? '▼' : '▲'} {Math.abs(s.pace)}% vs comparable</span>
            </div>
            <div className="cv-row" style={{ alignItems: 'baseline' }}>
              <span className="cv-fig lg">{so}</span>
              <span className="cv-small cv-faint">of {cmp} on a comparable night</span>
            </div>
            <ServiceChart s={s} />
            <div className="cv-legend">
              <span><i className="line" style={{ background: 'var(--accent)' }} />Tonight</span>
              <span><i style={{ background: 'var(--accent)', opacity: 0.25 }} />Forecast band</span>
              <span><i className="line" style={{ background: 'var(--fg-3)' }} />Comparable</span>
            </div>
          </section>
          {s.mode === 'cut' && state === 'ask' && (
            <section className="cv-card" style={{ borderColor: 'var(--claim-cau-line)' }}>
              <span className="cv-xs cv-faint">One suggestion</span>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{s.title}</span>
              <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{s.body} Saves <Money id="service-cut">{cvMoney(s.value)}</Money> tonight.</span>
              <div className="cv-row" style={{ gap: 8 }}>
                <Button className="btn-lg" style={{ flex: 1 }} onClick={() => cv.approve(s.approval, () => setState('yes', s.title))}>{CV_D.ownData ? 'Yes, cut one server at 8' : s.yes}</Button>
                <Button variant="secondary" className="btn-lg" onClick={() => { setState('no', `${s.title}: declined`); cv.toast('Kept everyone on. Logged as declined.'); }}>Not tonight</Button>
              </div>
            </section>
          )}
          {s.mode !== 'cut' && (
            <section className="cv-card">
              <span className="cv-xs cv-faint">{s.mode === 'quiet' ? 'No suggestion' : 'Not yet'}</span>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{s.title}</span>
              <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{s.body}</span>
            </section>
          )}
          {state === 'yes' && <Callout tone="good" icon="CircleCheck">Schedule written back to 7shifts. The server is notified and on call until 8:30. The monitoring window is open.</Callout>}
          {state === 'no' && <Callout icon="CircleMinus">Kept everyone on. We'll count tonight as declined, which teaches the ranker too.</Callout>}
          {s.mode === 'cut' && state !== 'ask' && <Button size="sm" variant="ghost" icon="Undo2" onClick={() => setState('ask', `${s.title}: answer reopened`)}>Change my answer</Button>}
          <div className="cv-grid g3" style={{ gap: 8 }}>
            {s.tiles.map(([k, v, t]) => (
              <div key={k} className="cv-card" style={{ padding: 10, gap: 2 }}><span className="cv-xs cv-faint">{k}</span><span className="cv-num" style={{ fontWeight: 600 }}>{v}</span><span className="cv-xs cv-faint">{t}</span></div>
            ))}
          </div>
        </div>
        <div className="cv-col" style={{ gap: 16 }}>
          <section className="cv-card">
            <span className="cv-h4">Why it speaks up only when it does</span>
            <ul className="cv-ul">
              <li><Icon name="Activity" size={15} />The forecast band has to narrow enough that a change is safe even at its upper edge. Early in service it's too wide.</li>
              <li><Icon name="BellOff" size={15} />One message per service at most. On a normal night the phone stays silent, because alert fatigue is what kills engagement.</li>
              <li><Icon name="Fence" size={15} />The fence you set holds: never below 4 servers on dinner, never cut after 8:30.</li>
            </ul>
          </section>
          <section className="cv-card">
            <span className="cv-h4">Tonight in the other rooms</span>
            <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>Each room's service screen runs the same rules. Switch rooms in the top bar: one room has a cut ready, one is quiet, and one is waiting for the band to narrow.</span>
          </section>
          <Callout icon="Smartphone">This screen is laid out for a phone first. Open this page on your phone to see it at full size.</Callout>
        </div>
      </div>
      <DenseService />
    </div>
  );
}

export { CvService };
