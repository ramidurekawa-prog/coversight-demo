'use client';

/* Service · Track record: shadow mode. Each morning Coversight logs the
   staffing call it would make for the day's services, and grades it once the
   service is over. Read-only: GET /api/page/shadow (server/shadow.ts). */

import * as React from 'react';
import { Icon } from '../../kit';
import { Claim, cvMoney } from '../core';
import { MEALS } from '../../../lib/data/page/service.js';

const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const hrs = (x) => `${Math.round(x * 10) / 10} h`;

function Tile({ big, label, sub, good }) {
  return (
    <div className="cv-col" style={{ gap: 4, padding: '12px 14px', borderRadius: 12, border: `1px solid ${good ? 'var(--money-up)' : 'var(--border)'}`, background: good ? 'color-mix(in srgb, var(--money-up) 8%, transparent)' : 'var(--surface)' }}>
      <span className="cv-num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: good ? 'var(--money-up)' : undefined }}>{big}</span>
      <span className="cv-small" style={{ fontWeight: 600 }}>{label}</span>
      {sub && <span className="cv-xs cv-muted">{sub}</span>}
    </div>
  );
}

/** One room's shadow record. */
export function ShadowRecord({ roomId, server }) {
  const [rec, setRec] = React.useState(null);
  React.useEffect(() => {
    if (!server) return undefined;
    let stop = false;
    fetch(`/api/page/shadow?roomId=${encodeURIComponent(roomId)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => { if (!stop) setRec(b); })
      .catch(() => { if (!stop) setRec({ error: true }); });
    return () => { stop = true; };
  }, [roomId, server]);

  if (!server) return <p className="cv-small cv-muted">Coversight’s track record runs on the server: each morning it logs the call it would make for every service and grades it after. This preview runs in your browser only.</p>;
  if (!rec) return <p className="cv-small cv-muted">Loading the track record…</p>;
  if (rec.error) return <p className="cv-small cv-muted">Couldn’t load the track record. Try again in a minute.</p>;
  const { report: r, latest, since } = rec;
  if (!r.logged) return <p className="cv-small cv-muted">Nothing logged yet. Each morning Coversight writes down the staffing call it would make for today’s and tomorrow’s services. After the service, it checks that call against the guests who came.</p>;
  const S = r.staffing;
  return (
    <div className="cv-col" style={{ gap: 14 }}>
      <p className="cv-small" style={{ margin: 0 }}>
        <b>Coversight is calling every service alongside you</b>{since ? ` since ${day(since)}` : ''}. Nobody has to act on it. {r.graded} of {r.logged} calls graded{r.waiting ? `, ${r.waiting} waiting on guests by hour` : ''}{r.blocked ? `, ${r.blocked} couldn’t be called (missing data)` : ''}.
      </p>
      {r.graded > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          {r.forecast.ranged > 0
            ? <Tile big={`${r.forecast.inRange} of ${r.forecast.ranged}`} label="Guest count inside the range" sub={r.forecast.meanMiss != null ? `Off by ${r.forecast.meanMiss} guests on average (${r.forecast.meanMissPct}%)` : null} good={r.forecast.inRange / r.forecast.ranged >= 0.7} />
            : <Tile big={`±${r.forecast.meanMiss ?? '—'}`} label="Guests off, on average" sub={r.forecast.meanMissPct != null ? `${r.forecast.meanMissPct}% of the guests who came. A range shows once Covercast reads this room’s data.` : null} good={r.forecast.meanMissPct != null && r.forecast.meanMissPct <= 15} />}
          <Tile big={`${S.closer} of ${r.graded}`} label="Services where the call beat the schedule" sub={`${S.same} the same, ${S.plan} where the schedule was closer`} good={S.closer > S.plan} />
          {S.shortFewer > S.idleFewer
            ? <Tile big={hrs(S.shortFewer)} label="Fewer short-staffed server-hours" sub={S.idleFewer < 0 ? `for ${hrs(-S.idleFewer)} more on the floor` : 'with no more idle hours'} good />
            : <Tile big={hrs(Math.max(0, S.idleFewer))} label="Fewer idle server-hours" sub={S.shortMore > 0 ? `and ${hrs(S.shortMore)} more short` : 'and no more short hours'} good={S.idleFewer > 0 && S.shortMore <= 0} />}
        </div>
      )}
      {S.simulatedCents != null && r.status === 'ready' && (
        <span className="cv-small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          Following the call would have cost about <b>{cvMoney(Math.round(S.simulatedCents / 100))}</b> less in idle hours <Claim k="mod" label="Simulated" /> <span className="cv-xs cv-faint">Not savings: a Proof test verifies that.</span>
        </span>
      )}
      {latest.length > 0 && (
        <div className="cv-tablewrap">
          <table className="cv-table">
            <thead><tr><th>Service</th><th>Guests: guess → came</th><th>Schedule, over / short</th><th>Coversight’s call, over / short</th><th>Closer</th></tr></thead>
            <tbody>
              {latest.map((e) => {
                const g = e.graded;
                return (
                  <tr key={`${e.date}-${e.meal}`}>
                    <td>{day(e.date)} · {MEALS[e.meal]?.label ?? e.meal}</td>
                    <td>{g.covers.forecast} → <b>{g.covers.actual}</b>{g.covers.inRange === true ? <Icon name="CircleCheck" size={14} style={{ color: 'var(--money-up)', marginLeft: 6, verticalAlign: '-2px' }} /> : null}</td>
                    <td>{hrs(g.gap.plan.over)} / {hrs(g.gap.plan.short)}</td>
                    <td>{hrs(g.gap.call.over)} / {hrs(g.gap.call.short)}</td>
                    <td style={{ color: g.closer === 'call' ? 'var(--money-up)' : undefined, fontWeight: g.closer === 'call' ? 600 : 400 }}>{g.closer === 'call' ? 'Coversight' : g.closer === 'plan' ? 'Schedule' : 'Same'}{g.followed ? ' · followed' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="cv-xs cv-faint" style={{ margin: 0 }}>{r.note} “Over / short” is server-hours above or below what the guests who came needed, at your own pace and never below your minimum.</p>
    </div>
  );
}
