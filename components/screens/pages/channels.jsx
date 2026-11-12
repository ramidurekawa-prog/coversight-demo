'use client';

import { Button } from '../../kit';
import { CV_D, CV_ROOM, Callout, Claim, PageHead, cvMoney, useCv } from '../core';
import { DenseChannels } from '../dense-sections';
import { LoopStrip, Diagnose } from '../areas';

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
      {CV_D.room.fromToast && <Callout icon="Info"><span>Sales, orders and refunds by channel are from your Toast data through {CV_D.room.fromToast.end}. Commission rates and packaging are standard assumptions until you enter your delivery statements. <button className="cv-link" onClick={() => cv.go('inputs', { kind: 'channels' })}>Enter statements</button>{C.channels.some((c) => c.none) ? ` · No sales in your data on: ${C.channels.filter((c) => c.none).map((c) => c.name).join(', ')}.` : ''}</span></Callout>}
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
        <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
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
      <DenseChannels />
    </div>
  );
}

export { CvChannels };
