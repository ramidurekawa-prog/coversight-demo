'use client';

import React from 'react';

import { Button, Icon } from '../../kit';
import { CV_D, CV_ROOM, useCv } from '../core';
import { engine, useEngine, useSaved } from '../../engine';
import { kitchenPage, BUSY_HOURS, DAY_NAME, DOWS, OPEN_HOURS, TRIAL_NIGHTS, hourLabel } from '../../../lib/data/page/kitchen.js';
import s from './kitchen.module.css';

/* ================================================================ Kitchen speed
 * An analysis page: is food reaching guests on time at the rush, where does it
 * get stuck, and what one change is worth trying. The kitchen is read as a
 * line (order in, station, pass, table). Every figure comes from
 * lib/data/page/kitchen.js; the headline is the Lever Check card's.
 * Green means good or getting better; red is a real problem; persimmon is the
 * one action. "If it ain't broke, don't fix it": no trial is offered when the
 * rush is on time. */

const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtMin = (v) => (v == null ? '—' : `${v.toFixed(1)} min`);
const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Chip({ tone = 'mute', icon, children }) {
  return <span className={`${s.chip} ${s[`chip_${tone}`] || ''}`}>{icon && <Icon name={icon} size={14} />}{children}</span>;
}

/* ---------------------------------------------------------------- picture 1: when (the rush curve) */

function DayChart({ hours, target, rush }) {
  const W = 640, H = 230, P = { l: 52, r: 8, t: 16, b: 44 };
  const vals = hours.map((h) => h.min).filter((v) => v != null);
  const top = Math.max(target + 4, ...vals) * 1.08;
  const bw = (W - P.l - P.r) / hours.length;
  const y = (v) => H - P.b - (v / top) * (H - P.b - P.t);
  const ticks = [0, 5, 10, 15, 20, 25, 30].filter((v) => v <= top);
  return (
    <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Minutes for food by hour against a ${target}-minute goal. ${hours.filter((h) => h.late).map((h) => h.label).join(', ') || 'No hour'} ran late.`}>
      {ticks.map((v) => <g key={v}><line className={s.grid} x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text className={s.axis} x={P.l - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
      <text className={s.axis} x={P.l - 8} y={P.t - 4} textAnchor="end">min</text>
      {hours.map((h, i) => {
        const x = P.l + i * bw + bw * 0.16, w = bw * 0.68;
        return (
          <g key={h.hour}>
            {h.min != null && <rect className={h.late ? s.barLate : s.barOk} x={x} y={y(h.min)} width={w} height={Math.max(1, y(0) - y(h.min))} rx="4"><title>{`${h.label}: ${fmtMin(h.min)}${h.orders != null ? `, about ${Math.round(h.orders)} orders` : ''}`}</title></rect>}
            {h.late && <text className={s.barVal} x={x + w / 2} y={y(h.min) - 6} textAnchor="middle">{h.min.toFixed(0)}</text>}
            <text className={s.axisX} x={x + w / 2} y={H - P.b + 18} textAnchor="middle">{h.label.replace(' ', '')}</text>
            {h.orders != null && <text className={s.orders} x={x + w / 2} y={H - P.b + 36} textAnchor="middle">{Math.round(h.orders)}</text>}
          </g>
        );
      })}
      <line className={s.goal} x1={P.l} x2={W - P.r} y1={y(target)} y2={y(target)} />
      {rush && <text className={s.axis} x={P.l - 8} y={H - P.b + 36} textAnchor="end">orders</text>}
    </svg>
  );
}

/** One sentence for the picked day: on time, or which hours ran late. */
function DayLead({ hours, name, target }) {
  const late = hours.filter((h) => h.late);
  if (!hours.some((h) => h.min != null)) return <>No kitchen times for {name} yet.</>;
  if (!late.length) return <><b className={s.okWord}>{name} is on time</b> every hour, under {target} minutes.</>;
  const worst = late.reduce((a, b) => (b.min > a.min ? b : a));
  return <>{name}: food runs late in <b>{plural(late.length, 'hour')}</b>, worst at {worst.label} ({fmtMin(worst.min)}).</>;
}

/* ---------------------------------------------------------------- picture 2: where (the Line Map) */

function LineMap({ stations, jam, meaning }) {
  const max = Math.max(1, ...stations.map((x) => x.share));
  return (
    <div className={s.map} role="group" aria-label="The line, from order to guest, with where late tickets wait">
      <div className={s.node}><Icon name="ReceiptText" size={22} /><span>Orders in</span></div>
      <Icon name="ChevronRight" size={20} className={s.arrow} />
      <div className={s.lanes}>
        {stations.slice(0, 6).map((st) => {
          const isJam = jam && st.name === jam.name;
          return (
            <div key={st.name} className={`${s.lane} ${isJam ? s.laneJam : s.laneOk}`}>
              <span className={s.laneName}>{isJam && <Icon name="TriangleAlert" size={15} />}{st.name}</span>
              <span className={s.laneBar}><span style={{ width: `${Math.max(4, (st.share / max) * 100)}%` }} /></span>
              <span className={s.laneVal}>{st.share}%</span>
            </div>
          );
        })}
      </div>
      <Icon name="ChevronRight" size={20} className={s.arrow} />
      <div className={s.node}><Icon name="ConciergeBell" size={22} /><span>Pass</span></div>
      <Icon name="ChevronRight" size={20} className={s.arrow} />
      <div className={s.node}><Icon name="Users" size={22} /><span>Guests</span></div>
      <p className={s.mapNote}>{meaning === 'late' ? 'Share of late tickets that wait at each station.' : 'Share of all tickets each station makes. Late-ticket shares arrive with the next kitchen export.'}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- the trial card */

/** The twelve busy hours as squares: green on time, red late. */
function HourMeter({ p }) {
  const cells = ['Fri', 'Sat'].map((d) => ({ d, hours: p.days[d].filter((h) => BUSY_HOURS.includes(h.hour)) }));
  return (
    <div className={s.meter} role="img" aria-label={`On time ${p.onTime} of ${p.busyHours} busy hours`}>
      {cells.map(({ d, hours }) => (
        <div key={d} className={s.meterRow}>
          <span className={s.meterDay}>{d}</span>
          {hours.map((h) => <span key={h.hour} className={h.min == null ? s.mNone : h.late ? s.mLate : s.mOk} title={`${DAY_NAME[d]} ${h.label}: ${fmtMin(h.min)}`}>{h.label.replace(' pm', '')}</span>)}
        </div>
      ))}
      <span className={s.small}>Friday and Saturday, 5 to 10 pm. Green is on time.</span>
    </div>
  );
}

function TrialCard({ p, trials, setTrials }) {
  const cv = useCv();
  const eng = useEngine();
  const [busy, setBusy] = React.useState(false);
  const task = p.move ? eng.tasks.find((t) => t.roomId === CV_D.id && t.approvalId === p.move.id && t.status !== 'cancelled') : null;

  if (p.active) {
    const r = p.active.result;
    return (
      <section className={`${s.card} ${s.trial}`}>
        <span className={s.over}><Icon name="FlaskConical" size={15} />Line Trial running</span>
        <h3 className={s.trialTitle}>{p.active.title}</h3>
        <div className={s.progress} aria-label={`${r.nightsIn} of ${TRIAL_NIGHTS} nights measured`}>
          {Array.from({ length: TRIAL_NIGHTS }, (_, i) => <span key={i} className={i < r.nightsIn ? s.stepOn : s.step} />)}
        </div>
        <p className={s.body}>{r.nightsIn ? `${plural(r.nightsIn, 'night')} measured.` : 'Measuring starts on the next matching night.'} We compare it with the same nights and hours before{r.before != null ? ` (${fmtMin(r.before)})` : ''}.</p>
        <div className={s.row}>
          <Button variant="secondary" size="sm" onClick={() => setTrials((list) => list.map((x) => (x.id === p.active.id ? { ...x, status: 'stopped', end: todayIso() } : x)), `Line Trial stopped: ${p.active.title}`)}>Stop the trial</Button>
          {task && <Chip tone="info" icon="ListChecks">Steps for the chef are on Today</Chip>}
        </div>
      </section>
    );
  }

  if (!p.move) {
    return (
      <section className={`${s.card} ${s.allGood}`}>
        <span className={`${s.over} ${s.good}`}><Icon name="CircleCheck" size={15} />Nothing to change</span>
        <h3 className={s.trialTitle}>{p.late.length ? 'The rush is close enough to goal' : 'Every busy hour is on time'}</h3>
        <p className={s.body}>{p.late.length ? `${plural(p.late.length, 'hour')} ran a little over ${p.target} minutes, none by more than 3. If it isn’t broken, we don’t fix it.` : 'Keep doing what you are doing. We’ll tell you here if a station starts to slow.'}</p>
        <HourMeter p={p} />
        {p.wins.length > 0 && <Chip tone="good" icon="TrendingDown">{plural(p.wins.length, 'trial')} made the line faster</Chip>}
      </section>
    );
  }

  const start = async () => {
    setBusy(true);
    const m = p.move;
    await engine.createTask(m.id, { title: m.title, system: m.task.system, diff: m.task.diff });
    setTrials((list) => [...list.filter((x) => x.id !== m.id), { id: m.id, title: m.title, station: m.station, days: m.days, from: m.from, to: m.to, start: todayIso(), status: 'running', at: new Date().toISOString() }], `Line Trial started: ${m.title}`);
    setBusy(false);
    cv.toast('Trial started. The chef’s steps are on Today, and we measure the next weekend against the ones before.');
  };
  return (
    <section className={`${s.card} ${s.trial}`}>
      <span className={s.over}><Icon name="FlaskConical" size={15} />This weekend’s Line Trial</span>
      <h3 className={s.trialTitle}>{p.move.title}</h3>
      <p className={s.body}>{p.move.how}</p>
      <div className={s.aims}><Icon name="Target" size={16} /><span>{p.move.aims}</span></div>
      {p.feed?.state === 'stale' && <p className={s.small}>The kitchen screen stopped sending times on {p.feed.last}. The trial is measured once it’s sending again.</p>}
      <div className={s.row}>
        <Button icon="Play" onClick={start} disabled={busy}>Try it this weekend</Button>
        <span className={s.small}>Measured on {plural(TRIAL_NIGHTS, 'matching night')}. No dollar claimed.</span>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Line Trials record */

const STATE = {
  better: ['good', 'TrendingDown', 'Faster'],
  same: ['mute', 'Minus', 'No change'],
  worse: ['bad', 'TrendingUp', 'Slower'],
  measuring: ['info', 'Timer', 'Measuring'],
  stopped: ['mute', 'CircleStop', 'Stopped'],
  paused: ['warn', 'CirclePause', 'Paused'],
};

function Trials({ p }) {
  const rows = [...p.trials.map((t) => ({ id: t.id, title: t.title, when: `Since ${fmtDay(t.start)}`, state: t.result.state, note: t.result.change != null ? `${fmtMin(t.result.before)} → ${fmtMin(t.result.after)}` : t.result.state === 'measuring' ? `${t.result.nightsIn} of ${TRIAL_NIGHTS} nights in` : null })),
    ...p.past.map((t) => ({ id: t.id, title: t.title, when: `Since ${t.since}`, state: t.state, note: t.reason }))];
  if (!rows.length) return null;
  return (
    <section className={s.card}>
      <div className={s.sectionHead}><h3 className={s.h3}>Line Trials</h3><span className={s.sub}>Each change tried, and what it did to the rush</span></div>
      <ul className={s.trials}>
        {rows.map((r) => {
          const [tone, icon, word] = STATE[r.state] || STATE.measuring;
          return (
            <li key={r.id} className={s.trialRow}>
              <Chip tone={tone} icon={icon}>{word}</Chip>
              <span className={s.trialName}>{r.title}</span>
              <span className={s.small}>{r.when}{r.note ? ` · ${r.note}` : ''}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- see why */

function Grid({ days, target }) {
  return (
    <div className={s.gridWrap} tabIndex={0} role="group" aria-label="Minutes for food, by day and hour">
      <table className={s.heat}>
        <thead><tr><th />{OPEN_HOURS.map((h) => <th key={h}>{hourLabel(h).replace(' ', '')}</th>)}</tr></thead>
        <tbody>{DOWS.map((d) => (
          <tr key={d}><th>{d}</th>{days[d].map((c) => <td key={c.hour} className={c.min == null ? '' : c.late ? s.hotCell : s.okCell} title={c.min == null ? 'No tickets' : `${DAY_NAME[d]} ${c.label}: ${fmtMin(c.min)}`}>{c.min == null ? '' : c.min.toFixed(1)}</td>)}</tr>
        ))}</tbody>
      </table>
      <span className={s.small}>Red: over the {target}-minute goal. Green: on time.</span>
    </div>
  );
}

function Trend({ weekly }) {
  if (weekly.length < 2) return null;
  const W = 300, H = 70, vals = weekly.map((w) => w.min);
  const lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5;
  const x = (i) => 6 + (i / (weekly.length - 1)) * (W - 12);
  const y = (v) => H - 8 - ((v - lo) / (hi - lo)) * (H - 16);
  return (
    <svg className={s.spark} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Friday and Saturday dinner, minutes for food by week: ${vals.join(', ')}`}>
      <path d={weekly.map((w, i) => `${i ? 'L' : 'M'}${x(i)},${y(w.min)}`).join(' ')} fill="none" stroke="var(--fg-2)" strokeWidth="2" />
      {weekly.map((w, i) => <circle key={i} cx={x(i)} cy={y(w.min)} r={i === weekly.length - 1 ? 4 : 2.5} fill={i === weekly.length - 1 ? 'var(--fg-1)' : 'var(--fg-3)'} />)}
    </svg>
  );
}

function SeeWhy({ p }) {
  const [open, setOpen] = React.useState(false);
  const src = p.source === 'toast' ? `Your Toast kitchen timings${p.through ? ` to ${fmtDay(p.through)}` : ''}: the hours average the last 4 weeks, the trend and spread the last ${plural(p.weeks || 4, 'week')}.`
    : p.source === 'sample' ? `Sample kitchen times, last ${p.weeks} weeks${p.through ? ` to ${fmtDay(p.through)}` : ''}.` : 'No kitchen times yet.';
  return (
    <section className={s.card}>
      <button type="button" className={s.seeWhy} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={18} />{open ? 'Hide the detail' : 'See why'}
        <span className={s.small}>Busy hours by day, the trend, how it’s worked out</span>
      </button>
      {open && (
        <div className={s.why}>
          <div className={s.whyGrid}>
            <div className={s.whyBox}>
              <span className={s.whyLabel}>Rush Point</span>
              {p.rush ? (
                <>
                  <b className={s.whyFig}>{p.rush.held ? `${p.rush.limit}+` : p.rush.limit} <small>orders an hour</small></b>
                  <span className={s.small}>{p.rush.held ? 'The busiest hour so far, and every hour stayed on time.' : `Past this, food usually runs late. True for ${p.rush.right} of ${p.rush.of} hours of the week.`}</span>
                </>
              ) : <span className={s.small}>Needs order counts by hour.</span>}
            </div>
            <div className={s.whyBox}>
              <span className={s.whyLabel}>Weekend dinners, week by week</span>
              <Trend weekly={p.weekly} />
              {p.trend && <Chip tone={p.trend.dir === 'better' ? 'good' : p.trend.dir === 'worse' ? 'bad' : 'mute'} icon={p.trend.dir === 'better' ? 'TrendingDown' : p.trend.dir === 'worse' ? 'TrendingUp' : 'Minus'}>{p.trend.dir === 'steady' ? 'Steady' : `${Math.abs(p.trend.change).toFixed(1)} min ${p.trend.dir === 'better' ? 'faster' : 'slower'}`} over the last 4 weeks</Chip>}
            </div>
            <div className={s.whyBox}>
              <span className={s.whyLabel}>1 in 10 tables waits longer than</span>
              {p.spread ? (<><b className={s.whyFig}>{p.spread.p90} <small>min</small></b><span className={s.small}>{p.spread.over}% of busy-hour tickets were over goal ({p.spread.tickets.toLocaleString()} tickets).</span></>)
                : <span className={s.small}>Needs every ticket from the kitchen screen (Toast’s kitchen timings export).</span>}
            </div>
          </div>
          <Grid days={p.days} target={p.target} />
          <ul className={s.notes}>
            <li>{src} Unmarked numbers come from the restaurant’s own data.</li>
            <li>Goal: {p.target} minutes from fire to the pass. Busy hours are Friday and Saturday, 5 to 10 pm.</li>
            <li>A slow kitchen only costs money when guests can’t get a table, so we don’t put a dollar on it. Faster turns are counted once, on Tables.</li>
            {p.feed?.state === 'stale' && <li>The kitchen screen last sent times on {p.feed.last}. These are the last good weeks.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- locked: no kitchen screen */

const UNLOCKS = [
  ['Clock', 'Which hours food runs late', 'Every hour, green or red, against your goal.'],
  ['Route', 'Which station holds tickets up', 'The Line Map shows where late tickets wait.'],
  ['Gauge', 'How busy the line can get', 'The Rush Point: orders an hour before food runs late.'],
  ['FlaskConical', 'Whether a change worked', 'Line Trials measure each change on matching nights.'],
];

/** The page stays locked until a kitchen screen sends ticket times: nobody is asked to time tickets by hand. */
function Locked({ feed }) {
  const cv = useCv();
  return (
    <div className={`cv-page wide ${s.page}`}>
      <header className={s.head}>
        <span className={s.overHead}>Kitchen speed · {CV_ROOM.name}</span>
        <h2 className={s.title}>Connect your kitchen screen to see how fast food gets out</h2>
        <p className={s.body}>Ticket times come from a kitchen display (KDS). Your POS alone doesn’t record when food is fired and finished, so this page stays empty until one is connected. Nobody has to time tickets by hand.</p>
      </header>
      <section className={`${s.card} ${s.lockCard}`}>
        <span className={s.over}><Icon name="Lock" size={15} />What it unlocks</span>
        <ul className={s.unlocks}>
          {UNLOCKS.map(([icon, title, sub]) => (
            <li key={title}><span className={s.unlockIco}><Icon name={icon} size={20} /></span><span><b>{title}</b><span className={s.small}>{sub}</span></span></li>
          ))}
        </ul>
        <div className={s.row}>
          <Button icon="Plug" onClick={() => cv.go('connect')}>Connect your kitchen screen</Button>
          <span className={s.small}>Toast KDS: add the Kitchen Timings export. Other kitchen screens switch on when connected.</span>
        </div>
        {feed?.note && <p className={s.small}>{feed.note}</p>}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

function CvKitchen() {
  const [trials, setTrials] = useSaved('kitchen.trials', []);
  const feed = CV_D.feeds.find((f) => f.name === 'Kitchen display') || null;
  const p = React.useMemo(() => kitchenPage(CV_D.room, { trials, proofs: CV_D.proofs, feed, roomId: CV_D.id }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [CV_D.id, trials, feed?.state]);
  const [view, setView] = React.useState('when');
  const [dow, setDow] = React.useState(p.worstDay || 'Sat');
  React.useEffect(() => { if (p.worstDay) setDow(p.worstDay); }, [p.worstDay]);
  if (p.locked) return <Locked feed={p.feed} />;

  return (
    <div className={`cv-page wide ${s.page}`}>
      <header className={s.head}>
        <span className={s.overHead}>Kitchen speed · {CV_ROOM.name}</span>
        <h2 className={s.title}>{p.headline}</h2>
        <div className={s.headline}>
          {p.peak != null && (
            <div className={s.big}>
              <b className={`${s.fig} ${p.broken ? s.figBad : ''}`}>{p.peak.toFixed(1)}<small> min</small></b>
              <span className={s.figLabel}>longest wait for food, Saturday dinner (goal: {p.target} min)</span>
            </div>
          )}
          <div className={s.chips}>
            {p.busyHours > 0 && <Chip tone="good" icon="CircleCheck">On time {p.onTime} of {p.busyHours} busy hours</Chip>}
            {p.broken && p.jam && <Chip tone="bad" icon="TriangleAlert">Slowest spot: {p.jam.name}</Chip>}
            {p.trend?.dir === 'better' && <Chip tone="good" icon="TrendingDown">{Math.abs(p.trend.change).toFixed(1)} min faster than last month</Chip>}
            {p.wins.length > 0 && <Chip tone="good" icon="Trophy">{plural(p.wins.length, 'trial')} that worked</Chip>}
          </div>
        </div>
      </header>

      <div className={s.hero}>
        <TrialCard p={p} trials={trials} setTrials={setTrials} />
        <section className={`${s.card} ${s.picture}`}>
          <div className={s.picHead}>
            <div className={s.seg} role="group" aria-label="Show">
              {[['when', 'When it’s slow', 'Clock'], ['where', 'Where it’s stuck', 'Route']].map(([k, label, icon]) => (
                <button key={k} type="button" className={`${s.segBtn} ${view === k ? s.segOn : ''}`} aria-pressed={view === k} onClick={() => setView(k)}><Icon name={icon} size={15} />{label}</button>
              ))}
            </div>
            {view === 'when' && (
              <div className={s.days} role="group" aria-label="Day">
                {DOWS.map((d) => <button key={d} type="button" className={`${s.dayBtn} ${dow === d ? s.dayOn : ''}`} aria-pressed={dow === d} onClick={() => setDow(d)}>{d}</button>)}
              </div>
            )}
          </div>
          {view === 'when' ? (
            <>
              <p className={s.picLead}><DayLead hours={p.days[dow]} name={DAY_NAME[dow]} target={p.target} /></p>
              <DayChart hours={p.days[dow]} target={p.target} rush={p.rush} />
              <div className={s.legend}><span><i className={s.lgOk} />On time</span><span><i className={s.lgLate} />Late</span><span><i className={s.lgGoal} />Goal ({p.target} min)</span>{p.rush && <span>Bottom row: orders that hour</span>}</div>
            </>
          ) : p.stations.length ? (
            <>
              <p className={s.picLead}>{p.jam ? <><b>{p.jam.name}</b> is where late tickets pile up. Free it up first, before adding a cook.</> : 'No station is holding the line up.'}</p>
              <LineMap stations={p.stations} jam={p.jam} meaning={p.stationMeaning} />
            </>
          ) : <p className={s.picLead}>Station times arrive with the kitchen screen’s export.</p>}
        </section>
      </div>

      <Trials p={p} />
      <SeeWhy p={p} />
      {p.source === 'sample' && <p className={s.foot}><Icon name="FlaskConical" size={15} />Kitchen times on this screen are sample data until your own kitchen screen is connected.</p>}
    </div>
  );
}

export { CvKitchen };
