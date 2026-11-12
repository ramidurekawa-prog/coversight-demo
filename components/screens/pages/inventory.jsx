'use client';

import { Button } from '../../kit';
import { CV_D, CV_ROOM, Callout, Claim, Money, PageHead, cvMoney, useCv } from '../core';
import { LoopStrip, Diagnose } from '../areas';

/* ================================================================ Inventory & waste */
function CvInventory() {
  const cv = useCv();
  const U = CV_D.usage;
  const top = [...U.flagged].sort((a, b) => b.dollars - a.dollars)[0];
  const max = Math.max(0.12, ...U.rows.map((r) => r.pct)) * 1.15;
  const salmonTest = CV_D.room.fromToast ? null : CV_D.proofs.find((p) => p.id === 'salmon-plate');
  return (
    <div className="cv-page wide">
      <PageHead over={`Inventory & waste · theoretical vs actual · ${CV_ROOM.name}`} q="Are we using more than we sell?"
        sub="What the plates and pours you sold should have used, against what actually left the walk-in and the bar. Logged waste explains part of any gap; the rest is over-portioning, spoilage or something rung in wrong." />
      {CV_D.room.fromToast && !CV_D.inputs.counts && <Callout tone="warn" icon="Package"><span>Toast doesn&apos;t count stock, so these counts are still the sample&apos;s. Your plates sold are real (from Toast), but a gap needs your own count. <button className="cv-link" onClick={() => cv.go('inputs', { kind: 'counts' })}>Enter a count</button> · <button className="cv-link" onClick={() => cv.go('inputs', { kind: 'waste' })}>Log waste</button></span></Callout>}
      {CV_D.inputs.counts && <Callout icon="ClipboardList">Counts entered by hand {CV_D.inputs.counts.date}: {CV_D.inputs.counts.n} item{CV_D.inputs.counts.n === 1 ? '' : 's'}{CV_D.inputs.waste ? `, plus ${CV_D.inputs.waste.n} waste entries` : ''}. Expected use comes from {CV_D.room.fromToast ? 'your Toast plates sold' : 'the plates sold'} and your recipes.</Callout>}
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
          {salmonTest && CV_D.usage.flagged.some((r) => r.item === "Salmon fillet") && <Callout icon="Layers">The salmon gap and the salmon plate-cost test share one lever key. Whichever verifies first claims the dollars; the other can&apos;t.</Callout>}
          <div className="cv-row">
            <Button icon="ClipboardList" onClick={() => cv.go('inputs', { kind: 'counts' })}>Enter a spot count</Button>
            <Button variant="secondary" icon="Trash2" onClick={() => cv.go('inputs', { kind: 'waste' })}>Log waste</Button>
          </div>
        </section>
      </div>
      <section className="cv-card flush">
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
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

export { CvInventory };
