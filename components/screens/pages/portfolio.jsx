'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { useCv, cvMoney, CV_GROUP, CV_NOW, Claim, Pill, PageHead } from '../core';
import { engine, useEngine } from '../../engine';
import { COMPARISONS, dayLabel, HANDLED_KEY, nextHandled, PERIODS, portfolioView, SNOOZE_DAYS } from '../../../lib/data/page/portfolio';
import { MarginLines, RoomBars, roomColor, Spark } from './portfolio-charts';
import s from './portfolio.module.css';

const PREFS = 'cv-portfolio-view';
const DEFAULTS = { period: 'week', comparison: 'own', show: 'all', table: false };
const TIER = { urgent: { tone: 'bad', icon: 'Siren', label: 'Urgent' }, watch: { tone: 'warn', icon: 'TriangleAlert', label: 'Watch' }, steady: { tone: 'good', icon: 'ShieldCheck', label: 'Steady' } };
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);

/* The view the owner picked survives going into a room and back. */
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

/** A change against the room's own normal, as an arrow chip. */
function Delta({ c }) {
  if (!c || c.unavailable || c.marginPts == null) return null;
  const flat = Math.abs(c.marginPts) < 1;
  return (
    <span className={`${s.delta} ${flat ? '' : c.marginPts > 0 ? s.up : s.down}`} title={`Contribution margin against its own last ${c.weeks} weeks`}>
      <Icon name={flat ? 'ArrowRight' : c.marginPts > 0 ? 'TrendingUp' : 'TrendingDown'} size={13} />{flat ? 'Normal' : `${Math.abs(c.marginPts).toFixed(1)} pts`}
    </span>
  );
}

/** The group's own change: the latest period's margin against the 8 weeks before it. */
function groupChange(series, weeks) {
  const cur = series.slice(-weeks).filter(Boolean), base = series.slice(0, -weeks).slice(-8).filter(Boolean);
  if (!cur.length || base.length < 4) return null;
  const m = (a) => a.reduce((x, p) => x + p.contribution, 0) / a.reduce((x, p) => x + p.revenue, 0);
  return { marginPts: (m(cur) - m(base)) * 100, weeks: base.length };
}

/* ================================================================ Portfolio */
function CvPortfolio() {
  const cv = useCv();
  const eng = useEngine();
  const [prefs, setPref] = usePrefs();
  const [open1, setOpen1] = React.useState(null);
  const [showAll, setShowAll] = React.useState(false);
  const real = eng.mode === 'server' && !!eng.org && !eng.org.sample;
  /* One clock for the render: the sample group lives on its own date. */
  const now = real ? Date.now() : Date.parse(`${CV_NOW.iso}T19:15:00Z`);
  const handled = Object.fromEntries(CV_GROUP.rows.map((r) => [r.id, eng.actions[r.id]?.[HANDLED_KEY] || {}]));
  const v = portfolioView(CV_GROUP, { real, windows: eng.windows || [], now, handled, period: prefs.period, comparison: prefs.comparison });
  const { rooms, ranked, totals: t, open } = v;
  const order = rooms.map((r) => r.id);
  const n = rooms.length, one = n === 1;
  const live = [...v.open, ...v.handled].map((x) => x.id);
  const tiles = prefs.show === 'attention' ? ranked.filter((r) => r.priority.tier !== 'steady') : ranked;
  const todo = showAll ? open : open.slice(0, 4);
  const con = t.contribution, sv = t.savings;
  const gc = groupChange(t.series, v.weeks);
  const top = ranked[0];

  const save = (x, action) => {
    const next = nextHandled(eng.actions[x.roomId]?.[HANDLED_KEY], x.roomId, x.id, action, live.filter((id) => id.startsWith(`${x.roomId}:`)), new Date(now).toISOString());
    const what = action === 'ack' ? 'acknowledged' : action === 'snooze' ? `snoozed for ${SNOOZE_DAYS} days` : 'put back on the list';
    engine.act(HANDLED_KEY, next, { room: x.roomId, summary: `${x.room}: ${x.title} ${what}` });
    cv.toast(action === 'ack' ? 'Acknowledged. It comes back if anything changes.' : action === 'snooze' ? `Snoozed for ${SNOOZE_DAYS} days.` : 'Back on the list.');
  };
  const go = (roomId, page, params) => { cv.pickRoom(roomId); cv.go(page, params); };
  const openRoom = (id) => go(id, 'week');
  const over = [eng.org?.name ?? 'Rosewood Restaurant Group', real ? (t.dataThrough ? `data through ${dayLabel(t.dataThrough)}` : 'waiting for your data') : `Sample · ${CV_NOW.week}`].join(' · ');

  return (
    <div className={`cv-page wide ${s.viz}`}>
      <PageHead over={over} q={one ? 'How is your restaurant doing?' : 'How are your restaurants doing?'} />

      <div className={s.controls}>
        <Seg label="Reporting period" value={prefs.period} options={Object.entries(PERIODS).map(([k, p]) => [k, p.label])} onChange={(x) => setPref('period', x)} />
        {!one && <Seg label="Show restaurants" value={prefs.show} options={[['all', `All ${n}`], ['attention', `Needs attention · ${t.attention}`]]} onChange={(x) => setPref('show', x)} />}
        <span className={s.fresh}>
          {t.coverage.offline || t.coverage.stale ? <Pill tone="warn" icon="Clock">{[t.coverage.offline && `${t.coverage.offline} offline`, t.coverage.stale && `${t.coverage.stale} stale`].filter(Boolean).join(' · ')}</Pill>
            : real ? <Pill tone="good" icon="CircleCheck">{t.dataThrough ? `Through ${dayLabel(t.dataThrough)}` : 'No data yet'}</Pill>
              : <Pill icon="FlaskConical">Sample data</Pill>}
        </span>
      </div>

      {/* ---- The answer: who needs you, and the one thing to do */}
      {top && top.priority.tier !== 'steady' ? (
        <section className={`${s.hero} ${s[top.priority.tier]}`} aria-labelledby="pf-most">
          <span className={`cv-q-ico ${TIER[top.priority.tier].tone} ${s.heroIco}`}><Icon name={TIER[top.priority.tier].icon} size={22} /></span>
          <div className={s.heroText}>
            <span className={s.heroOver}>Needs you most</span>
            <h3 id="pf-most" className={s.heroName}>{top.name}</h3>
            <span className={s.heroWhy}>{top.mainIssue || top.priority.parts[0]?.why}</span>
          </div>
          {top.next && <Button iconRight="ArrowRight" onClick={() => go(top.id, top.next.go, top.next.params)}>{top.next.label}</Button>}
          <details className={s.why}>
            <summary>Why first?</summary>
            <ul>
              {top.priority.parts.map((p) => <li key={p.k}><span>{p.why}</span><b className="cv-num">+{p.points}</b></li>)}
            </ul>
          </details>
        </section>
      ) : (
        <section className={`${s.hero} ${s.steady}`}>
          <span className={`cv-q-ico good ${s.heroIco}`}><Icon name="ShieldCheck" size={22} /></span>
          <div className={s.heroText}><span className={s.heroOver}>Needs you most</span><h3 className={s.heroName}>Nobody. Every room is steady.</h3></div>
        </section>
      )}

      {/* ---- Big numbers */}
      <div className={s.kpis}>
        <div className={s.kpi}>
          <div className={s.kpiHead}><span>Contribution</span><Status m={con} /></div>
          <span className={s.big}>{con.value == null ? '—' : cvMoney(Math.round(con.value))}</span>
          <div className={s.kpiFoot}>
            {gc && <Delta c={gc} />}
            <span className={s.kpiNote}>{con.value == null ? 'Needs a full week of sales and payroll' : `after food & labour · ${t.counted === n ? (one ? 'your room' : `all ${n}`) : `${t.counted} of ${n} rooms`}`}</span>
          </div>
          {t.series.some(Boolean) && <Spark values={t.series.map((p) => p?.contribution ?? null)} label="Group contribution, last 12 weeks" />}
        </div>
        <button type="button" className={`${s.kpi} ${s.kpiBtn}`} onClick={() => cv.go(real ? 'windows' : 'ledger')} aria-label={`Verified savings ${cvMoney(Math.round(sv.runRate))} a week. Open the proof.`}>
          <div className={s.kpiHead}><span>Verified savings</span><Claim k="book" /></div>
          <span className={`${s.big} ${sv.runRate ? 'cv-up' : ''}`}>{cvMoney(Math.round(sv.runRate))}<small>/wk</small></span>
          <div className={s.kpiFoot}>
            <span className={s.kpiNote}>{cvMoney(Math.round(sv.toDate))} to date</span>
            {sv.reversed.length > 0 && <span className={`${s.delta} ${s.down}`}><Icon name="Undo2" size={13} />{sv.reversed.length} reversed</span>}
            {sv.suspended > 0 && <span className={`${s.delta} ${s.warnChip}`}><Icon name="CirclePause" size={13} />{cvMoney(Math.round(sv.suspended))} paused</span>}
          </div>
        </button>
        <div className={s.kpi}>
          <div className={s.kpiHead}><span>{one ? 'Open items' : 'Need attention'}</span></div>
          <span className={s.big}>{one ? open.length : t.attention}{!one && <small> of {n}</small>}</span>
          <div className={s.dots} aria-label={rooms.map((r) => `${r.short}: ${TIER[r.priority.tier].label}`).join(', ')}>
            {ranked.map((r) => <span key={r.id} className={`${s.dot} ${s[r.priority.tier]}`} title={`${r.short}: ${TIER[r.priority.tier].label}`}><Icon name={TIER[r.priority.tier].icon} size={12} />{r.short}</span>)}
          </div>
        </div>
        <div className={s.kpi}>
          <div className={s.kpiHead}><span>Data coverage</span></div>
          <span className={s.big}>{t.coverage.complete}<small> of {n}</small></span>
          <div className={s.cover} role="img" aria-label={`${t.coverage.complete} of ${n} rooms with complete data`}>
            {rooms.map((r) => <span key={r.id} className={r.counted ? s.covOk : r.state === 'sample' ? s.covSample : s.covBad} title={`${r.short}: ${r.counted ? 'complete' : r.state === 'sample' ? 'sample numbers' : r.state === 'offline' ? 'offline' : 'incomplete'}`} />)}
          </div>
          <span className={s.kpiNote}>{[t.coverage.sample && `${t.coverage.sample} sample`, t.coverage.offline && `${t.coverage.offline} offline`, t.coverage.stale && `${t.coverage.stale} stale`].filter(Boolean).join(' · ') || 'Every room complete'}</span>
        </div>
      </div>

      {/* ---- Charts */}
      {!one && (
        <div className={s.charts}>
          <figure className={s.chart}>
            <figcaption><span>Contribution by restaurant</span><span className={s.cap}>{PERIODS[prefs.period].label}</span></figcaption>
            <RoomBars rooms={rooms} order={order} onOpen={openRoom} />
          </figure>
          <figure className={s.chart}>
            <figcaption><span>Margin, last 12 weeks</span><span className={s.cap}>after food & labour</span></figcaption>
            <MarginLines rooms={rooms} order={order} group={t.series} />
          </figure>
        </div>
      )}

      {/* ---- What to do */}
      <section className="cv-col" style={{ gap: 10 }} aria-labelledby="pf-todo">
        <div className={s.sectionHead}><span className={s.titleRow}><h3 id="pf-todo" className="cv-h4">What to do</h3>{open.length > 0 && <span className={s.count}>{open.length}</span>}</span></div>
        {open.length ? (
          <div className={s.todo}>
            {todo.map((x) => (
              <div key={x.id} className={`${s.todoRow} ${s['t' + x.tone]}`}>
                <span className={`cv-q-ico ${x.tone === 'info' ? 'accent' : x.tone}`}><Icon name={x.icon} size={16} /></span>
                <button type="button" className={s.todoText} onClick={() => setOpen1(open1 === x.id ? null : x.id)} aria-expanded={open1 === x.id}>
                  <span className={s.todoRoom}>{x.room}</span>
                  <span className={s.todoTitle}>{x.title}</span>
                  {open1 === x.id && <span className={s.todoBody}>{x.body}</span>}
                </button>
                <div className={s.todoActs}>
                  <Button variant="ghost" size="sm" icon="Check" onClick={() => save(x, 'ack')} aria-label={`Acknowledge: ${x.title}`} title="Acknowledge" />
                  <Button variant="ghost" size="sm" icon="BellOff" onClick={() => save(x, 'snooze')} aria-label={`Snooze ${SNOOZE_DAYS} days: ${x.title}`} title={`Snooze ${SNOOZE_DAYS} days`} />
                  <Button size="sm" variant={x.tone === 'bad' ? 'primary' : 'secondary'} iconRight="ArrowRight" onClick={() => go(x.roomId, x.go, x.params)}>{x.cta}</Button>
                </div>
              </div>
            ))}
            {open.length > 4 && <Button variant="ghost" size="sm" icon={showAll ? 'ChevronUp' : 'ChevronDown'} onClick={() => setShowAll((a) => !a)} style={{ alignSelf: 'flex-start' }}>{showAll ? 'Fewer' : `All ${open.length}`}</Button>}
          </div>
        ) : (
          <div className="cv-empty"><span className="ico"><Icon name="ShieldCheck" size={22} /></span><span style={{ fontWeight: 600 }}>Nothing to do</span></div>
        )}
        {v.handled.length > 0 && (
          <details className={s.fold}>
            <summary><Icon name="CircleCheck" size={15} />Done or snoozed · {v.handled.length}</summary>
            {v.handled.map((x) => (
              <div key={x.id} className={s.foldRow}>
                <span><b>{x.room}</b> · {x.title} <span className="cv-faint">· {x.handled.state === 'snoozed' ? `until ${new Date(x.handled.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'acknowledged'}</span></span>
                <Button variant="ghost" size="sm" icon="Undo2" onClick={() => save(x, 'clear')}>Put back</Button>
              </div>
            ))}
          </details>
        )}
      </section>

      {/* ---- Every restaurant */}
      <section className="cv-col" style={{ gap: 10 }} aria-labelledby="pf-rooms">
        <div className={s.sectionHead}>
          <h3 id="pf-rooms" className="cv-h4">{one ? 'Your restaurant' : 'Every restaurant'}</h3>
          <Seg label="View" value={prefs.table ? 'table' : 'tiles'} options={[['tiles', 'Tiles'], ['table', 'Table']]} onChange={(x) => setPref('table', x === 'table')} />
        </div>
        {!prefs.table ? (
          <div className={s.tiles}>
            {tiles.map((r) => {
              const T = TIER[r.priority.tier], m = r.money;
              return (
                <article key={r.id} className={`${s.tile} ${s[r.priority.tier]}`}>
                  <button type="button" className={s.tileMain} onClick={() => openRoom(r.id)} aria-label={`Open ${r.name}'s week`}>
                    <span className={s.tileHead}>
                      <span className={s.tileName}><i style={{ background: roomColor(order.indexOf(r.id)) }} />{r.name}</span>
                      <Pill tone={T.tone} icon={T.icon}>{T.label}</Pill>
                    </span>
                    <span className={s.tileFig}>
                      <span className={s.big2}>{m.contribution.value == null ? '—' : cvMoney(Math.round(m.contribution.value))}</span>
                      <Delta c={m.change} />
                    </span>
                    <span className={s.tileSub}>{m.contribution.value == null ? (r.state === 'sample' ? 'Sample numbers' : r.state === 'offline' ? `No data for ${r.dataAge} days` : 'Incomplete data') : <>contribution · {pct(m.revenue.value ? m.contribution.value / m.revenue.value : null)} margin</>}</span>
                    <Spark values={m.series.map((p) => p?.contribution ?? null)} color={roomColor(order.indexOf(r.id))} label={`${r.short} contribution, last 12 weeks`} />
                    <span className={s.tileStats}>
                      <span><Icon name="BadgeCheck" size={13} />{cvMoney(Math.round(r.savings.runRate))}/wk</span>
                      <span><Icon name="Timer" size={13} />{r.tests} test{r.tests === 1 ? '' : 's'}</span>
                      {r.critical > 0 && <span className={s.bad}><Icon name="Siren" size={13} />{r.critical}</span>}
                    </span>
                  </button>
                  {r.next && (
                    <Button size="sm" variant={r.priority.tier === 'urgent' ? 'primary' : 'secondary'} iconRight="ArrowRight" onClick={() => go(r.id, r.next.go, r.next.params)} className={s.tileAct}>{r.next.label}</Button>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="cv-card flush">
            <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Restaurants table">
              <table className="cv-table">
                <caption className={s.sr}>Restaurants ranked by priority, {PERIODS[prefs.period].label.toLowerCase()}</caption>
                <thead><tr><th scope="col">#</th><th scope="col">Restaurant</th><th scope="col" className="r">Revenue</th><th scope="col" className="r">Contribution</th><th scope="col" className="r">Food</th><th scope="col" className="r">Labour</th><th scope="col" className="r">Verified /wk</th><th scope="col">Data</th><th scope="col">Main issue</th></tr></thead>
                <tbody>
                  {tiles.map((r) => (
                    <tr key={r.id}>
                      <td className="cv-num">{r.rank}</td>
                      <td><button type="button" className={s.linkish} onClick={() => openRoom(r.id)}>{r.name}</button></td>
                      <td className="r cv-num">{r.money.revenue.value == null ? '—' : cvMoney(Math.round(r.money.revenue.value))}</td>
                      <td className="r"><span className="cv-num">{r.money.contribution.value == null ? '—' : cvMoney(Math.round(r.money.contribution.value))}</span> <Status m={r.money.contribution} /></td>
                      <td className="r cv-num">{pct(r.money.foodPct)}</td>
                      <td className="r cv-num">{pct(r.money.labourPct)}</td>
                      <td className="r cv-num">{cvMoney(Math.round(r.savings.runRate))}</td>
                      <td className="cv-xs">{r.state === 'sample-group' ? 'Sample' : r.dataThrough ? dayLabel(r.dataThrough) : 'None'}</td>
                      <td className="cv-small">{r.mainIssue || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {!one && (
                  <tfoot><tr className={s.total}><td /><th scope="row">Group · {t.counted} of {n}</th><td className="r cv-num">{t.revenue == null ? '—' : cvMoney(Math.round(t.revenue))}</td><td className="r cv-num">{con.value == null ? '—' : cvMoney(Math.round(con.value))}</td><td className="r cv-num">{pct(t.foodPct)}</td><td className="r cv-num">{pct(t.labourPct)}</td><td className="r cv-num">{cvMoney(Math.round(sv.runRate))}</td><td colSpan={2} /></tr></tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </section>

      <details className={s.fold}>
        <summary><Icon name="Info" size={15} />How these numbers work</summary>
        <dl className={s.prov}>
          <dt>Contribution</dt><dd>Revenue − food − labour. Not net profit: rent and other costs aren’t taken off.{con.limitations.length ? ` ${con.limitations.join(' ')}` : ''}</dd>
          <dt>Group totals</dt><dd>Only rooms with a complete period of their own data. Others are left out and flagged, never counted as zero. Rates are group totals over group sales.</dd>
          <dt>Verified savings</dt><dd>Verified tests only, at the low end of each measured range. {cvMoney(Math.round(sv.accrued))} accrued {prefs.period === 'week' ? 'this week' : 'in these 4 weeks'}. Estimates are never added.</dd>
          <dt>Arrows</dt><dd>Margin against the room’s own last 8 weeks, so rooms of different sizes aren’t compared with each other.</dd>
          <dt>Compare</dt>
          <dd>
            <select className="input" style={{ width: 'auto', height: 32 }} value={prefs.comparison} onChange={(e) => setPref('comparison', e.target.value)} aria-label="Comparison">
              {Object.entries(COMPARISONS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
            {prefs.comparison !== 'own' && <span className="cv-xs cv-faint"> {rooms[0]?.money.change?.unavailable}</span>}
          </dd>
          <dt>Priority</dt><dd>Urgent issues first, then drops against a room’s own normal, open problems, missing data and the size of its best move against its own sales.</dd>
        </dl>
      </details>
    </div>
  );
}

export { CvPortfolio };
