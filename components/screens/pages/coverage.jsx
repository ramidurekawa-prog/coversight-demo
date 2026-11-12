'use client';

import * as React from 'react';
import { Button, Icon, Tabs } from '../../kit';
import { CV_CLAIM, CV_D, CV_ROOM, Callout, Claim, Money, Pill, PageHead, cvMoney, useCv } from '../core';
import { TEST_LEVER, coverageOf } from '../../../lib/data/coverage';
import { useEngine } from '../../engine';
import { CV_LOOP, FeedChip } from '../areas';

/* ================================================================ Coverage map */
const CV_STAGE_PILL = {
  verify: ['good', 'BadgeCheck', 'Verified'],
  act: ['info', 'MousePointerClick', 'Ready to act'],
  understand: ['neutral', 'ChartColumn', 'Explained'],
  detect: ['warn', 'ScanSearch', 'Detected'],
  none: ['neutral', 'CircleMinus', 'Not covered'],
};

/** Four dots, one per loop step: filled when this room supports it. */
function StepDots({ steps }) {
  return (
    <span className="cv-row nowrap" style={{ gap: 3 }} role="img" aria-label={CV_LOOP.map((s) => `${s.label} ${steps[s.k]?.ok ? 'yes' : 'no'}`).join(', ')}>
      {CV_LOOP.map((s) => <span key={s.k} title={`${s.label}: ${steps[s.k]?.why ?? '—'}`} style={{ width: 18, height: 6, borderRadius: 3, background: steps[s.k]?.ok ? 'var(--accent)' : 'var(--border-strong)', opacity: steps[s.k]?.ok ? 1 : 0.5 }} />)}
    </span>
  );
}

function CvCoverage() {
  const cv = useCv();
  const eng = useEngine();
  const real = (eng.mode === 'server' && eng.org && !eng.org.sample) || !!CV_D.room.fromToast;
  /* Verified and running tests: the room's own windows once it runs on its own data; the sample's written proofs otherwise. */
  const mine = (eng.windows || []).filter((w) => w.roomId === CV_D.id);
  const evidence = real
    ? { verified: mine.filter((w) => w.status === 'verified').map((w) => TEST_LEVER[w.lever]), testing: mine.filter((w) => w.status === 'running' || w.status === 'waiting').map((w) => TEST_LEVER[w.lever]) }
    : { verified: CV_D.proofs.filter((p) => p.outcome === 'verified').map((p) => p.lever), testing: CV_D.proofs.filter((p) => p.outcome === 'testing').map((p) => p.lever) };
  const banked = mine.filter((w) => w.status === 'verified');
  /* A written note only shows when it agrees with what the data supports; otherwise the computed reason does. */
  const AREAS = coverageOf(CV_D, evidence).map((a) => {
    if (!a.steps.detect) return a;
    const note = real || a.reached !== a.stage ? (a.steps[a.reached]?.why ?? a.gap) : a.note;
    if (real && a.id === 'labour') {
      const wk = banked.filter((w) => TEST_LEVER[w.lever] === 'Labour').reduce((t, w) => t + w.bookedCents, 0) / 100;
      return { ...a, note, fig: wk ? `${cvMoney(wk)}/wk banked` : '$0 banked', claim: wk ? 'book' : 'none' };
    }
    return { ...a, note };
  });
  const [detail, setDetail] = React.useState(false);
  const at = (k) => AREAS.filter((a) => a.steps[k]?.ok).length;
  const counts = { detect: at('detect'), understand: at('understand'), act: at('act'), verify: at('verify') };
  const unavailable = AREAS.filter((a) => a.kind === 'unavailable');
  const annual = Math.round((CV_D.week.net * 52) / 1000) * 1000;
  return (
    <div className="cv-page wide">
      <PageHead over={`Coverage map · ${CV_ROOM.name}`} q="Where is this restaurant losing money, and how far along is each fix?"
        sub="Each area reaches a step only when this room's feeds, findings and tests support it, not because it's on a roadmap. A missing feed shows as unavailable, never as zero." />
      <ol className="cv-loop big" aria-label="Areas at each step of the loop">
        {CV_LOOP.map((s) => (
          <li key={s.k} className="on">
            <span className="n"><Icon name={s.icon} size={16} /></span>
            <span className="cv-col" style={{ gap: 1 }}>
              <span className="cv-row" style={{ gap: 8, alignItems: 'baseline' }}><b>{s.label}</b><span className="cv-fig md">{counts[s.k]}</span><span className="cv-xs cv-faint">of {AREAS.length}</span></span>
              <span className="cv-xs cv-muted">{s.sub}</span>
            </span>
          </li>
        ))}
      </ol>
      {unavailable.length > 0 && <Callout tone="warn" icon="Unplug">{unavailable.length} area{unavailable.length === 1 ? ' is' : 's are'} unavailable, not clear: {unavailable.map((a) => `${a.area.toLowerCase()} (needs ${a.missing.join(' and ')})`).join('; ')}. Nothing there is counted as zero.</Callout>}
      <div className="cv-row" style={{ justifyContent: 'space-between' }}>
        <span className="cv-small cv-muted">{detail ? 'Every step, with the reason it is or isn’t reached.' : 'One line per area: how far it gets and what unblocks the next step.'}</span>
        <Tabs value={detail ? 'detail' : 'overview'} onChange={(v) => setDetail(v === "detail")} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'detail', label: 'Detail' }]} />
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="cv-table cv-areas">
            <thead><tr><th>Area</th>{detail && <th>What leaks</th>}<th>Data it reads</th><th>At {CV_ROOM.short}</th><th>{detail ? 'Each step' : 'Next'}</th><th className="r">What the data supports</th></tr></thead>
            <tbody>
              {AREAS.map((a) => {
                const [tone, icon, label] = a.kind === 'unavailable' ? ['warn', 'Unplug', 'Unavailable'] : a.kind === 'clear' ? ['good', 'Check', 'Looked: nothing found'] : CV_STAGE_PILL[a.reached];
                const href = a.screen === 'build' ? null : a.screen;
                return (
                  <tr key={a.id} className={href ? 'cv-tr' : ''} onClick={href ? () => cv.go(href) : undefined} style={href ? { cursor: 'pointer' } : undefined}>
                    <td>
                      <div className="cv-row nowrap" style={{ gap: 10 }}>
                        <span className="cv-q-ico accent" style={{ width: 30, height: 30 }}><Icon name={a.icon} size={16} /></span>
                        {href ? <button className="cv-link" style={{ fontWeight: 600, textAlign: 'left' }} onClick={(e) => { e.stopPropagation(); cv.go(href); }}>{a.area}</button> : <span style={{ fontWeight: 600 }}>{a.area}</span>}
                      </div>
                    </td>
                    {detail && <td className="cv-small cv-muted" style={{ minWidth: 180 }}>{a.examples}</td>}
                    <td><div className="cv-row" style={{ gap: 4 }}>{a.data.length ? a.data.map((d) => <FeedChip key={d} name={d} />) : <span className="cv-xs cv-faint">—</span>}</div>{a.helps?.length > 0 && <span className="cv-xs cv-faint">Sharper with {a.helps.join(', ')}</span>}</td>
                    <td style={{ minWidth: 170 }}>
                      <div className="cv-col" style={{ gap: 4 }}>
                        <Pill tone={tone} icon={icon}>{label}</Pill>
                        {a.steps.detect && <StepDots steps={a.steps} />}
                        <span className="cv-xs cv-faint">{a.kind === 'unbuilt' || a.kind === 'out' ? a.why : a.note}</span>
                      </div>
                    </td>
                    <td style={{ minWidth: 200 }}>
                      {detail && a.steps.detect ? (
                        <ul className="cv-col" style={{ gap: 2, margin: 0, padding: 0, listStyle: 'none' }}>
                          {CV_LOOP.map((s) => <li key={s.k} className="cv-xs"><b>{s.label}:</b> <span className={a.steps[s.k].ok ? '' : 'cv-faint'}>{a.steps[s.k].why}</span></li>)}
                        </ul>
                      ) : (
                        <div className="cv-col" style={{ gap: 4 }}>
                          {a.gap && <span className="cv-xs cv-muted">{a.gap}</span>}
                          {a.next && <button className="cv-link cv-small" onClick={(e) => { e.stopPropagation(); cv.go(a.next.go); }}>{a.next.label} <Icon name="ArrowRight" size={12} /></button>}
                        </div>
                      )}
                    </td>
                    <td className="r">
                      <div className="cv-col" style={{ gap: 4, alignItems: 'flex-end' }}>
                        {a.kind === 'unavailable' ? <span className="cv-small cv-faint">No figure without {a.missing[0]}</span> : <>
                          <span className="cv-num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{a.fig}</span>
                          {a.claim !== 'none' && <Claim k={a.claim} />}
                        </>}
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

export { CvCoverage };
