'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { useCv, cvMoney, CV_GROUP, CV_NOW, Claim, Pill, PageHead } from '../core';
import { engine, useEngine } from '../../engine';
import { COMPARISONS, dayLabel, HANDLED_KEY, nextHandled, PERIODS, portfolioView, SNOOZE_DAYS } from '../../../lib/data/page/portfolio';
import { DensePortfolio } from '../dense-sections';
import s from './portfolio.module.css';

const PREFS = 'cv-portfolio-view';
const DEFAULTS = { period: 'week', comparison: 'own', show: 'all', detail: false };
const TIER = { urgent: { tone: 'bad', icon: 'Siren', label: 'Urgent' }, watch: { tone: 'warn', icon: 'TriangleAlert', label: 'Watch' }, steady: { tone: 'good', icon: 'ShieldCheck', label: 'Steady' } };
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const signed = (x, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`;

/* The view the owner picked (period, comparison, filter, columns) survives going into a room and back. */
function usePrefs() {
  const [p, setP] = React.useState(DEFAULTS);
  React.useEffect(() => {
    try { const v = JSON.parse(window.sessionStorage.getItem(PREFS) || 'null'); if (v) setP({ ...DEFAULTS, ...v }); } catch { /* storage blocked */ }
  }, []);
  const set = (k, v) => setP((cur) => {
    const next = { ...cur, [k]: v };
    try { window.sessionStorage.setItem(PREFS, JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });
  return [p, set];
}

/** A figure's status, with its icon. Calculated and unavailable use the claim chip's styles. */
function Status({ m }) {
  const tip = [m.source, m.dataThrough && `Data through ${dayLabel(m.dataThrough)}`, ...(m.limitations || [])].filter(Boolean).join('. ');
  if (m.status === 'verified') return <Claim k="book" />;
  if (m.status === 'observed') return <Claim k="obs" />;
  if (m.status === 'estimated') return <Claim k="est" />;
  if (m.status === 'calculated') return <span className="cv-claim obs" title={tip}><Icon name="Calculator" size={12} />Calculated</span>;
  return <span className="cv-claim none" title={tip}><Icon name="Ban" size={12} />Unavailable</span>;
}

function Seg({ label, value, options, onChange }) {
  return (
    <div className={s.seg} role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? s.on : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

function NeedsMost({ r, onNext, onRoom }) {
  if (!r || r.priority.tier === 'steady') {
    return (
      <div className={`cv-card ${s.hero} ${s.steady}`}>
        <span className={`cv-q-ico good ${s.heroIco}`}><Icon name="ShieldCheck" size={20} /></span>
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-over">Needs you most</span>
          <span className="cv-h3">Every room is steady</span>
          <span className="cv-small cv-muted">No urgent issues, no drop against any room’s own normal, nothing open that needs you. Anything new shows up here first.</span>
        </div>
      </div>
    );
  }
  const t = TIER[r.priority.tier];
  return (
    <section className={`cv-card ${s.hero} ${s[r.priority.tier]}`} aria-labelledby="pf-most">
      <span className={`cv-q-ico ${t.tone} ${s.heroIco}`}><Icon name={t.icon} size={20} /></span>
      <div className="cv-col" style={{ gap: 6, minWidth: 0 }}>
        <span className="cv-over">Needs you most</span>
        <h3 id="pf-most" className="cv-h3"><button type="button" className={s.linkish} onClick={onRoom}>{r.name}</button></h3>
        <span className="cv-small" style={{ lineHeight: 1.5 }}>{r.mainIssue || r.priority.parts[0]?.why}</span>
        <details className={s.why}>
          <summary>Why this room first</summary>
          <ul>
            {r.priority.parts.map((p) => <li key={p.k}><span>{p.why}</span><span className="cv-num cv-faint">+{p.points}</span></li>)}
            <li className={s.whyTotal}><span>Priority score{r.priority.tier === 'urgent' ? ', urgent issues rank first' : ''}</span><span className="cv-num">{r.priority.score}</span></li>
          </ul>
          <span className="cv-xs cv-faint">Every part is against the room’s own sales and history, never its size, so a smaller room isn’t ranked weak for being small.</span>
        </details>
      </div>
      {r.next && <div className={s.heroAct}><Button iconRight="ArrowRight" onClick={onNext}>{r.next.label}</Button></div>}
    </section>
  );
}

function AttentionCard({ x, onOpen, onAck, onSnooze }) {
  return (
    <article className="cv-q-card">
      <span className={`cv-q-ico ${x.tone === 'info' ? 'accent' : x.tone}`}><Icon name={x.icon} size={18} /></span>
      <div className="cv-col" style={{ gap: 6 }}>
        <span className={s.roomTag}><Icon name="MapPin" size={12} />{x.room}</span>
        <span style={{ fontWeight: 600 }}>{x.title}</span>
        <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{x.body}</span>
      </div>
      <div className="cv-q-acts">
        <Button variant="ghost" size="sm" icon="Check" onClick={onAck} aria-label={`Acknowledge: ${x.title}`}>Acknowledge</Button>
        <Button variant="ghost" size="sm" icon="BellOff" onClick={onSnooze} aria-label={`Snooze for ${SNOOZE_DAYS} days: ${x.title}`}>Snooze</Button>
        <Button size="sm" variant={x.tone === 'bad' ? 'primary' : 'secondary'} iconRight="ArrowRight" onClick={onOpen}>{x.cta}</Button>
      </div>
    </article>
  );
}

function Change({ c, comparison }) {
  if (!c) return null;
  if (c.unavailable) return <span className="cv-xs cv-faint" title={c.unavailable}>{comparison === 'own' ? 'No baseline yet' : 'Not available'}</span>;
  const tone = Math.abs(c.marginPts) < 1 ? 'cv-faint' : c.marginPts > 0 ? 'cv-up' : 'cv-down';
  return <span className={`cv-xs cv-num ${tone}`}>{signed(c.marginPts)} pts margin</span>;
}

/* ================================================================ Portfolio */
function CvPortfolio() {
  const cv = useCv();
  const eng = useEngine();
  const [prefs, setPref] = usePrefs();
  const [showAll, setShowAll] = React.useState(false);
  const real = eng.mode === 'server' && !!eng.org && !eng.org.sample;
  const sample = !real;
  /* One clock for the render: the sample group lives on its own date. */
  const now = real ? Date.now() : Date.parse(`${CV_NOW.iso}T19:15:00Z`);
  const handled = Object.fromEntries(CV_GROUP.rows.map((r) => [r.id, eng.actions[r.id]?.[HANDLED_KEY] || {}]));
  const v = portfolioView(CV_GROUP, { real, windows: eng.windows || [], now, handled, period: prefs.period, comparison: prefs.comparison });
  const { rooms, ranked, totals: t, open } = v;
  const n = rooms.length;
  const live = [...v.open, ...v.handled].map((x) => x.id);
  const shown = showAll ? open : open.slice(0, 3);
  const matrix = prefs.show === 'attention' ? ranked.filter((r) => r.priority.tier !== 'steady') : ranked;
  const periodWord = prefs.period === 'week' ? 'this week' : 'these 4 weeks';

  const save = (x, action) => {
    const next = nextHandled(eng.actions[x.roomId]?.[HANDLED_KEY], x.roomId, x.id, action, live.filter((id) => id.startsWith(`${x.roomId}:`)), new Date(now).toISOString());
    const what = action === 'ack' ? 'acknowledged' : action === 'snooze' ? `snoozed for ${SNOOZE_DAYS} days` : 'put back on the list';
    engine.act(HANDLED_KEY, next, { room: x.roomId, summary: `${x.room}: ${x.title} ${what}` });
    cv.toast(action === 'ack' ? 'Acknowledged. It comes back if anything about it changes.' : action === 'snooze' ? `Snoozed. It comes back in ${SNOOZE_DAYS} days if it’s still open.` : 'Back on the list.');
  };
  const go = (roomId, page, params) => { cv.pickRoom(roomId); cv.go(page, params); };
  const openRoom = (id) => go(id, 'week');

  const over = [eng.org?.name ?? 'Rosewood Restaurant Group', sample ? 'Sample group' : null, real ? (t.dataThrough ? `data through ${dayLabel(t.dataThrough)}` : 'waiting for your data') : CV_NOW.week].filter(Boolean).join(' · ');
  const one = n === 1;
  const sv = t.savings;
  const con = t.contribution;

  return (
    <div className="cv-page wide">
      <PageHead over={over} q={one ? 'How is your restaurant performing?' : 'How are your restaurants performing?'} sub={one ? 'Here is what needs your attention, and the numbers behind it.' : 'Here is where your attention will make the biggest difference.'} />

      <div className={s.controls}>
        <Seg label="Reporting period" value={prefs.period} options={Object.entries(PERIODS).map(([k, p]) => [k, p.label])} onChange={(x) => setPref('period', x)} />
        <label className={s.compare}>
          <span className="cv-xs cv-faint">Compare</span>
          <select className="input" value={prefs.comparison} onChange={(e) => setPref('comparison', e.target.value)} aria-label="Comparison">
            {Object.entries(COMPARISONS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </select>
        </label>
        {!one && <Seg label="Show rooms" value={prefs.show} options={[['all', `All ${n}`], ['attention', `Needs attention (${t.attention})`]]} onChange={(x) => setPref('show', x)} />}
        <span className={s.fresh}>
          {t.coverage.offline || t.coverage.stale ? <Pill tone="warn" icon="Clock">{[t.coverage.offline && `${t.coverage.offline} offline`, t.coverage.stale && `${t.coverage.stale} stale`].filter(Boolean).join(' · ')}</Pill>
            : real ? <Pill tone="good" icon="CircleCheck">{t.dataThrough ? `Data through ${dayLabel(t.dataThrough)}` : 'No data yet'}</Pill>
              : <Pill icon="FlaskConical">Sample data · {CV_NOW.week}</Pill>}
        </span>
      </div>

      <NeedsMost r={ranked[0]} onRoom={() => openRoom(ranked[0].id)} onNext={() => ranked[0]?.next && go(ranked[0].id, ranked[0].next.go, ranked[0].next.params)} />

      <div className={s.kpis}>
        <div className={`cv-card ${s.kpi}`}>
          <div className={s.kpiHead}><span className="cv-xs cv-faint">Contribution after food and labour, {periodWord}</span><Status m={con} /></div>
          <span className="cv-fig lg">{con.value == null ? '—' : cvMoney(Math.round(con.value))}</span>
          <span className="cv-xs cv-faint">
            {con.value == null ? (real ? 'Needs a complete period of a room’s own sales and payroll' : 'Not available') : <>From {t.counted === n ? (one ? 'your room' : `all ${n} rooms`) : `${t.counted} of ${n} rooms`} · food {pct(t.foodPct)}, labour {pct(t.labourPct)} of sales</>}
          </span>
          {t.counted < n && t.counted > 0 && <span className="cv-xs" style={{ color: 'var(--signal-warn)' }}>Partial: {n - t.counted} room{n - t.counted === 1 ? '' : 's'} left out, not counted as zero</span>}
        </div>
        <button type="button" className={`cv-card ${s.kpi} ${s.kpiBtn}`} onClick={() => cv.go(real ? 'windows' : 'ledger')} aria-label="Verified savings: open the proof">
          <div className={s.kpiHead}><span className="cv-xs cv-faint">Verified savings, run-rate</span><Claim k="book" /></div>
          <span className={`cv-fig lg ${sv.runRate ? 'cv-up' : ''}`}>{cvMoney(Math.round(sv.runRate))}<span className={s.unit}>/wk</span></span>
          <span className="cv-xs cv-faint">{cvMoney(Math.round(sv.accrued))} accrued {periodWord} · {cvMoney(Math.round(sv.toDate))} to date</span>
          {(sv.suspended > 0 || sv.reversed.length > 0) && <span className="cv-xs" style={{ color: 'var(--signal-warn)' }}>{[sv.suspended > 0 && `${cvMoney(Math.round(sv.suspended))}/wk suspended`, sv.reversed.length && `${sv.reversed.length} reversed`].filter(Boolean).join(' · ')}</span>}
        </button>
        <div className={`cv-card ${s.kpi}`}>
          <div className={s.kpiHead}><span className="cv-xs cv-faint">{one ? 'Needs your attention' : 'Rooms needing attention'}</span></div>
          <span className="cv-fig lg">{one ? open.length : t.attention}<span className={s.unit}>{one ? ` item${open.length === 1 ? '' : 's'}` : ` of ${n}`}</span></span>
          <span className="cv-xs cv-faint">{t.urgent ? `${t.urgent} urgent` : 'Nothing urgent'} · {open.length} open item{open.length === 1 ? '' : 's'} · {t.tests} test{t.tests === 1 ? '' : 's'} running</span>
        </div>
        <div className={`cv-card ${s.kpi}`}>
          <div className={s.kpiHead}><span className="cv-xs cv-faint">Data coverage, {periodWord}</span></div>
          <span className="cv-fig lg">{t.coverage.complete}<span className={s.unit}> of {n} complete</span></span>
          <span className="cv-xs cv-faint">
            {[t.coverage.sample && `${t.coverage.sample} on sample numbers`, t.coverage.offline && `${t.coverage.offline} offline`, t.coverage.stale && `${t.coverage.stale} stale`].filter(Boolean).join(' · ') || (real ? `Oldest data through ${dayLabel(t.oldestThrough)}` : 'Sample registers, recipes and payroll')}
          </span>
        </div>
      </div>

      <section className="cv-col" style={{ gap: 12 }} aria-labelledby="pf-attention">
        <div className={s.sectionHead}>
          <h3 id="pf-attention" className="cv-h4">What to do, most urgent first</h3>
          <span className="cv-xs cv-faint">Acknowledge an item and it stays off the list until something about it changes.</span>
        </div>
        {open.length ? (
          <div className={s.list}>
            {shown.map((x) => <AttentionCard key={x.id} x={x} onOpen={() => go(x.roomId, x.go, x.params)} onAck={() => save(x, 'ack')} onSnooze={() => save(x, 'snooze')} />)}
            {open.length > 3 && <Button variant="ghost" size="sm" icon={showAll ? 'ChevronUp' : 'ChevronDown'} onClick={() => setShowAll((x) => !x)} style={{ alignSelf: 'flex-start' }}>{showAll ? 'Show fewer' : `Show all ${open.length}`}</Button>}
          </div>
        ) : (
          <div className="cv-empty">
            <span className="ico"><Icon name="ShieldCheck" size={22} /></span>
            <span style={{ fontWeight: 600 }}>Nothing open across {one ? 'your room' : `your ${n} rooms`}</span>
            <span className="cv-small cv-muted">No alarms, no stale data, no reversed tests.</span>
          </div>
        )}
        {v.handled.length > 0 && (
          <details className={s.handled}>
            <summary><Icon name="CircleCheck" size={16} />Acknowledged and snoozed ({v.handled.length})</summary>
            {v.handled.map((x) => (
              <div key={x.id} className={s.handledRow}>
                <span><b>{x.room}</b> · {x.title} <span className="cv-faint">· {x.handled.state === 'snoozed' ? `snoozed until ${new Date(x.handled.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `acknowledged ${new Date(x.handled.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</span></span>
                <Button variant="ghost" size="sm" icon="Undo2" onClick={() => save(x, 'clear')}>Put back</Button>
              </div>
            ))}
          </details>
        )}
      </section>

      <section className="cv-col" style={{ gap: 12 }} aria-labelledby="pf-rooms">
        <div className={s.sectionHead}>
          <h3 id="pf-rooms" className="cv-h4">{one ? 'Your restaurant' : 'Every restaurant, by priority'}</h3>
          <Button variant="ghost" size="sm" icon={prefs.detail ? 'EyeOff' : 'Columns3'} onClick={() => setPref('detail', !prefs.detail)} aria-pressed={prefs.detail}>{prefs.detail ? 'Fewer columns' : 'Cost and proof columns'}</Button>
        </div>
        <div className="cv-card flush">
          <table className={`cv-table ${s.matrix}`}>
            <caption className={s.sr}>Restaurants ranked by priority, {PERIODS[prefs.period].label.toLowerCase()}, {COMPARISONS[prefs.comparison].label}</caption>
            <thead>
              <tr>
                <th scope="col">Restaurant</th>
                <th scope="col" className="r">Revenue</th>
                <th scope="col" className="r">Contribution</th>
                {prefs.detail && <><th scope="col" className="r">Food</th><th scope="col" className="r">Labour</th><th scope="col" className="r">Urgent</th><th scope="col" className="r">Tests</th><th scope="col" className="r">Verified /wk</th><th scope="col">Data</th></>}
                <th scope="col">Main issue</th>
                <th scope="col"><span className={s.sr}>Next action</span></th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => {
                const T = TIER[r.priority.tier];
                const m = r.money;
                return (
                  <tr key={r.id}>
                    <td data-label="Restaurant">
                      <div className={s.loc}>
                        <span className={s.rank} aria-label={`Priority ${r.rank}`}>{r.rank}</span>
                        <div className="cv-col" style={{ gap: 4, minWidth: 0 }}>
                          <button type="button" className={s.linkish} onClick={() => openRoom(r.id)} aria-label={`Open ${r.name}'s week`}>{r.name}</button>
                          <span className={s.locMeta}><Pill tone={T.tone} icon={T.icon}>{T.label}</Pill>{r.state === 'sample' && <Pill icon="FlaskConical">Sample data</Pill>}{r.state === 'offline' && <Pill tone="bad" icon="Unplug">Offline</Pill>}</span>
                          <span className="cv-xs cv-muted">{r.summary}</span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Revenue" className="r">
                      <span className="cv-num">{m.revenue.value == null ? '—' : cvMoney(Math.round(m.revenue.value))}</span>
                      <span className={s.cellSub}><Status m={m.revenue} /></span>
                    </td>
                    <td data-label="Contribution" className="r">
                      <span className="cv-num" style={{ fontWeight: 600 }}>{m.contribution.value == null ? '—' : cvMoney(Math.round(m.contribution.value))}</span>
                      <span className={s.cellSub}><Status m={m.contribution} /><Change c={m.change} comparison={prefs.comparison} /></span>
                    </td>
                    {prefs.detail && <>
                      <td data-label="Food" className="r cv-num">{pct(m.foodPct)}{m.food.status === 'estimated' && <span className={s.cellSub}><Claim k="est" /></span>}</td>
                      <td data-label="Labour" className="r cv-num">{pct(m.labourPct)}</td>
                      <td data-label="Urgent" className="r cv-num">{r.critical}</td>
                      <td data-label="Tests" className="r cv-num">{r.tests}</td>
                      <td data-label="Verified /wk" className="r">
                        <button type="button" className={`${s.linkish} cv-num`} onClick={() => go(r.id, r.savings.drill)} aria-label={`${r.short}: verified savings, open the proof`}>{cvMoney(Math.round(r.savings.runRate))}</button>
                        <span className={s.cellSub}><Claim k="book" /></span>
                      </td>
                      <td data-label="Data" className="cv-xs">{r.state === 'sample-group' ? 'Sample' : r.dataThrough ? `Through ${dayLabel(r.dataThrough)}` : 'No own data'}</td>
                    </>}
                    <td data-label="Main issue" className="cv-small">{r.mainIssue || <span className="cv-faint">Nothing open</span>}</td>
                    <td data-label="Next action" className={s.act}>{r.next ? <Button size="sm" variant={r.priority.tier === 'urgent' ? 'primary' : 'secondary'} iconRight="ArrowRight" onClick={() => go(r.id, r.next.go, r.next.params)}>{r.next.label}</Button> : <Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => openRoom(r.id)}>Open its week</Button>}</td>
                  </tr>
                );
              })}
              {!matrix.length && <tr><td colSpan={9} className="cv-small cv-muted">No restaurant needs attention right now.</td></tr>}
            </tbody>
            {!one && (
              <tfoot>
                <tr className={s.total}>
                  <th scope="row" data-label="Group">Group · {t.counted === n ? `all ${n}` : `${t.counted} of ${n} eligible`}</th>
                  <td data-label="Revenue" className="r cv-num">{t.revenue == null ? '—' : cvMoney(Math.round(t.revenue))}{t.revenueRooms < n && <span className={s.cellSub}><span className="cv-xs cv-faint">{t.revenueRooms} of {n}</span></span>}</td>
                  <td data-label="Contribution" className="r"><span className="cv-num" style={{ fontWeight: 600 }}>{con.value == null ? '—' : cvMoney(Math.round(con.value))}</span><span className={s.cellSub}><Status m={con} /></span></td>
                  {prefs.detail && <><td data-label="Food" className="r cv-num">{pct(t.foodPct)}</td><td data-label="Labour" className="r cv-num">{pct(t.labourPct)}</td><td data-label="Urgent" className="r cv-num">{rooms.reduce((x, r) => x + r.critical, 0)}</td><td data-label="Tests" className="r cv-num">{t.tests}</td><td data-label="Verified /wk" className="r cv-num">{cvMoney(Math.round(sv.runRate))}</td><td /></>}
                  <td colSpan={2} className="cv-xs cv-faint">Rates are group totals over group sales, not an average of rooms.</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <details className={s.handled}>
          <summary><Icon name="Info" size={16} />Where these numbers come from</summary>
          <dl className={s.prov}>
            <dt>Contribution</dt><dd>{con.source}. Calculated, not net profit: rent, utilities and other costs aren’t deducted.{con.limitations.length ? ` ${con.limitations.join(' ')}` : ''}</dd>
            <dt>Revenue</dt><dd>{real ? 'Net sales from each room’s own Toast data, by week of data.' : 'Net sales from the sample group’s registers.'} Only weeks fully covered by a room’s own data count.</dd>
            <dt>Verified savings</dt><dd>{real ? 'Verified test windows only, at the lower bound of each measured interval. Accrued is booked day by day while verified; a reversal stops it.' : 'Verified results only, at the lower bound of each interval.'} Estimated opportunities are never added to it.</dd>
            <dt>Change</dt><dd>{COMPARISONS[prefs.comparison].label}: contribution margin against the room’s own baseline weeks, so rooms of different size, seats and formats aren’t compared with each other.{prefs.comparison !== 'own' ? ' Not available for this group yet.' : ''}</dd>
            <dt>Priority</dt><dd>Urgent issues first, then a score from drops against the room’s own normal, open problems, missing data and the size of its best move relative to its own sales. Open “Why this room first” to see the parts.</dd>
          </dl>
        </details>
      </section>

      {sample && <DensePortfolio />}
    </div>
  );
}

export { CvPortfolio };
