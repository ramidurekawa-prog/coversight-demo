'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { CV_CLAIM, CV_D, CV_DS, CV_ROOM, Claim, cvMoney, useCv } from '../core';
import { deriveRoom } from '../../../lib/data/model';
import { useEngine } from '../../engine';
import { LEVERS, STATUS, STATUS_ORDER, leverSummary } from '../../../lib/data/page/summary';
import s from './summary.module.css';

/* ================================================================ Lever Check
 * The hub for every money lever, built to be read in two minutes on one
 * screen (Ramidu, 2026-11-19: "too much scrolling, need real emphasis where
 * it's needed"). Emphasis follows urgency:
 *   1. one "Start here" card: the lever that needs you, or the best ready win;
 *   2. one row per lever, worst first: red rows are loud, amber rows clear,
 *      green rows quiet; everything else opens in place on a tap;
 *   3. a slim proof strip and the week's four numbers as context.
 * Figures come from lib/data/page/summary.js (deriveRoom, the This week
 * comparators, the room's own test windows). Nothing is typed in. */

/** A claim as its icon only, for a dollar inside a sentence; the name is in the tooltip and for screen readers. */
function ClaimDot({ k }) {
  if (!k || k === 'none') return null;
  const c = CV_CLAIM[k];
  return <span className={s.claimDot} title={`${c.label}: ${c.tip}`} aria-label={c.label} role="img"><Icon name={c.icon} size={13} /></span>;
}

function StatusPill({ status }) {
  const st = STATUS[status];
  return <span className={`${s.pill} ${s[`pill_${status}`]}`}><Icon name={st.icon} size={14} />{st.label}</span>;
}

/** A small 12-week line: where this number has been. The last point is this week. */
function Spark({ trend, label, w = 84, h = 26 }) {
  if (!trend) return null;
  const v = trend.values;
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const x = (i) => 2 + (i / (v.length - 1)) * (w - 4);
  const y = (n) => 3 + (1 - (n - lo) / span) * (h - 6);
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  return (
    <svg className={s.spark} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`${label}, last ${v.length} weeks, ${trend.weeks[0]} to ${trend.weeks[v.length - 1]}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(v.length - 1)} cy={y(v[v.length - 1])} r="2.6" fill="currentColor" />
    </svg>
  );
}

const winText = (f) => (f.range ? `${cvMoney(Math.max(0, Math.round(f.lo)))} to ${cvMoney(Math.round(f.hi))}/wk` : `+${cvMoney(Math.round(f.value))}/wk`);
const ON_IT = { testing: ['Timer', 'Testing'], verified: ['BadgeCheck', 'Banking'], held: ['CirclePause', 'On hold'] };

/* ---------------------------------------------------------------- start here */
/** The one place to start: the lever that needs you, else the best ready win. One persimmon button. */
function StartHere({ view, go }) {
  const red = view.levers.filter((l) => l.status === 'bad');
  const t = view.top;
  if (red.length) {
    const l = red[0];
    return (
      <section className={`${s.start} ${s.start_bad}`} aria-label="Start here">
        <div className={s.startMain}>
          <span className={s.startLabel}><Icon name="CircleAlert" size={15} />Needs you now · {l.name}</span>
          <span className={s.startTitle}>{l.bad?.text ?? l.name}</span>
          <span className={s.startSub}><b>{l.big.value}</b> {l.big.label} <ClaimDot k={l.big.claim} />{red.length > 1 && <> · and {red.length - 1} more below</>}</span>
        </div>
        <div className={s.startSide}>
          {l.fix && <span className={s.startFix}>Fix: {l.fix.title} <b>{winText(l.fix)}</b> <Claim k={l.fix.claim} /></span>}
          <Button icon="ArrowRight" onClick={() => go(l.go)}>Fix {l.name.toLowerCase()}</Button>
          {t?.kind === 'move' && t.go !== l.go && (
            <button type="button" className={s.nextWin} onClick={() => go(t.go)}>Next best win: {t.title} <b>+{cvMoney(Math.round(t.value))}/wk</b> <Icon name="ArrowRight" size={13} /></button>
          )}
        </div>
      </section>
    );
  }
  if (!t) return null;
  return (
    <section className={`${s.start} ${s.start_move}`} aria-label="Start here">
      <div className={s.startMain}>
        <span className={s.startLabel}><Icon name="Sparkles" size={15} />Best win this week · {t.lever}</span>
        <span className={s.startTitle}>{t.title}</span>
        {t.kind === 'move' && <span className={s.startSub}>About <b>{cvMoney(Math.round(t.value))} a week</b>, if it works <Claim k={t.claim} />{t.hours ? ` · ${t.hours < 1 ? `${Math.round(t.hours * 60)} minutes` : `${t.hours} hours`} of your time` : ''}</span>}
      </div>
      <div className={s.startSide}>
        <Button icon="ArrowRight" onClick={() => go(t.go)}>Open {t.lever.toLowerCase()}</Button>
        {view.outcome.plan && <button type="button" className={s.nextWin} onClick={() => go('plan')}>This week&apos;s plan: {view.outcome.plan.count} moves, up to <b>{cvMoney(Math.round(view.outcome.plan.value))}/wk</b> <Icon name="ArrowRight" size={13} /></button>}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- one row per lever */
function LeverRow({ l, open, onToggle, go }) {
  const id = `lever-${l.id}`;
  if (l.status === 'nodata') {
    return (
      <li className={`${s.row} ${s.row_nodata}`} id={id}>
        <div className={s.rowHead}>
          <span className={s.rowName}><Icon name={l.icon} size={18} />{l.name}</span>
          <span className={s.rowLine}>Needs {l.missing.join(' and ')}. Not counted as zero.</span>
          <button type="button" className={s.link} onClick={() => go(l.next.go)}>{l.next.label} <Icon name="ArrowRight" size={13} /></button>
          <StatusPill status="nodata" />
        </div>
      </li>
    );
  }
  const quiet = l.status === 'good';
  const line = quiet ? l.good : l.bad || l.good;
  const ok = quiet || !l.bad;
  const facts = (l.facts || []).filter(Boolean);
  const on = l.handled && ON_IT[l.handled.kind];
  return (
    <li className={`${s.row} ${s[`row_${l.status}`]} ${open ? s.rowOpen : ''}`} id={id}>
      <button type="button" className={s.rowHead} aria-expanded={open} aria-controls={`${id}-more`} onClick={onToggle}>
        <span className={s.rowName}><Icon name={l.icon} size={18} />{l.name}</span>
        <span className={s.rowFig}>
          <span className={s.rowBig}>{l.big.value}</span>
          <span className={s.rowBigLabel}>{l.big.label} <ClaimDot k={l.big.claim} /></span>
        </span>
        <span className={s.rowLine}>
          {line && <><Icon name={ok ? 'CircleCheck' : 'CircleAlert'} size={15} className={ok ? s.icoGood : s.icoBad} /><span>{line.text}</span></>}
        </span>
        <span className={s.rowTags}>
          {on && <span className={`${s.tag} ${s[`tag_${l.handled.kind}`]}`} title={`${on[1]}: ${l.handled.text}`}><Icon name={on[0]} size={13} />{on[1]}</span>}
          {l.fix && <span className={`${s.tag} ${s.tag_win}`} title={`Ready win: ${l.fix.title}`}><Icon name="Sparkles" size={13} />{winText(l.fix)}</span>}
        </span>
        <StatusPill status={l.status} />
        <Icon name="ChevronDown" size={16} className={`${s.chev} ${open ? s.flip : ''}`} />
      </button>
      {open && (
        <div className={s.more} id={`${id}-more`}>
          <ul className={s.lines}>
            <li><Icon name="CircleCheck" size={15} className={s.icoGood} /><span>{l.good ? <>{l.good.text} <ClaimDot k={l.good.claim} /></> : 'Nothing to celebrate yet'}</span></li>
            <li><Icon name={l.bad ? 'CircleAlert' : 'Minus'} size={15} className={l.bad ? s.icoBad : s.icoMuted} /><span>{l.bad ? <>{l.bad.text} <ClaimDot k={l.bad.claim} /></> : 'Nothing wrong found'}</span></li>
            {l.handled && <li><Icon name={on[0]} size={15} className={s.icoInk} /><span><b>{{ testing: 'Coversight is testing', verified: 'Verified and banking', held: 'On hold' }[l.handled.kind]}:</b> {l.handled.text} <span className={s.faint}>· {l.handled.sub}</span></span></li>}
            {l.fix && <li><Icon name="Sparkles" size={15} className={s.icoInk} /><span><b>Ready win:</b> {l.fix.title}, {l.fix.range ? winText(l.fix) : `about ${cvMoney(Math.round(l.fix.value))}/wk`} <Claim k={l.fix.claim} /></span></li>}
          </ul>
          <div className={s.moreSide}>
            {(l.trend || l.rank) && (
              <div className={s.ctx}>
                {l.trend && <span className={s.ctxTrend}><Spark trend={l.trend} label={l.name} w={120} h={30} /><span className={s.faint}>12 weeks</span></span>}
                {l.rank && <span className={`${s.rank} ${s[`rank_${l.rank.tone}`]}`}><Icon name={l.rank.rank === 1 ? 'Trophy' : 'Building2'} size={13} />{l.rank.text}</span>}
              </div>
            )}
            {facts.length > 0 && (
              <dl className={s.facts}>
                {facts.map(([k, v, c]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v} <ClaimDot k={c} /></dd></React.Fragment>)}
              </dl>
            )}
            {l.note && <p className={s.note}>{l.note}</p>}
            <button type="button" className={s.link} onClick={() => go(l.go)}>Open {l.name} <Icon name="ArrowRight" size={13} /></button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- context: proof and the week */
function Context({ view }) {
  const o = view.outcome;
  const v = view.vitals;
  const signed = (n) => `${n >= 0 ? '+' : '−'}${cvMoney(Math.abs(Math.round(n)))}`;
  const ptsOf = (n) => (Math.abs(n) < 0.0005 ? 'same' : `${n > 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} pts`);
  const tone = (st) => (st === 'good' ? s.up : st === 'bad' ? s.down : s.flat);
  const week = v ? [
    { k: 'sales', label: 'Sales', big: cvMoney(Math.round(v.sales.now)), d: signed(v.sales.change), st: v.sales.status },
    { k: 'food', label: 'Food cost', big: `${(v.food.now * 100).toFixed(1)}%`, d: ptsOf(v.food.change), st: v.food.status },
    { k: 'labour', label: 'Labor', big: `${(v.labour.now * 100).toFixed(1)}%`, d: ptsOf(v.labour.change), st: v.labour.status },
    { k: 'kept', label: 'You kept', big: cvMoney(Math.round(v.kept.now)), d: signed(v.kept.change), st: v.kept.status },
  ] : [];
  return (
    <div className={s.context}>
      <section className={s.proof} aria-label={`What Coversight has done for ${CV_ROOM.short}`}>
        <span className={s.proofLabel}><Icon name="BadgeCheck" size={14} />What Coversight has done for {CV_ROOM.short}</span>
        <div className={s.proofRow}>
          <span className={s.proofItem}><b>{cvMoney(Math.round(o.toDate))}</b>banked so far</span>
          <span className={s.proofItem}><b>{cvMoney(Math.round(o.week))}/wk</b>banking now</span>
          {o.payback && <span className={s.proofItem}><b>{o.payback.times.toFixed(1)}×</b>its fee, {o.payback.month}</span>}
          <span className={s.proofItem}><b>{view.handled} of {view.levers.length}</b>levers being worked</span>
        </div>
        <span className={s.proofClaim}><Icon name={CV_CLAIM.book.icon} size={12} />Bookable: only changes a test verified</span>
      </section>
      {v && (
        <section className={s.week} aria-label={`The week of ${v.period}`}>
          <span className={s.weekLabel}>Week of {v.period} <span className={s.faint}>vs {v.comparator.toLowerCase()}</span></span>
          <div className={s.weekRow}>
            {week.map((t) => (
              <div key={t.k} className={s.weekItem}>
                <span className={s.weekName}>{t.label}</span>
                <span className={s.weekBig}>{t.big}</span>
                <span className={`${s.weekDelta} ${tone(t.st)}`}>{t.d}</span>
                {view.trends?.[t.k] && <Spark trend={view.trends[t.k]} label={t.label} w={64} h={20} />}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CvSummary() {
  const cv = useCv();
  const eng = useEngine();
  const real = eng.mode === 'server' && eng.org && !eng.org.sample;
  const view = React.useMemo(
    () => leverSummary(CV_D, { windows: real ? eng.windows || [] : null, matchedWeeks: CV_DS.matchedWeeks || [], group: Object.keys(CV_DS.rooms).map((id) => deriveRoom(CV_DS, id)) }),
    // CV_D changes with the room and the dataset; the engine's windows with the group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [CV_D, real, eng.windows],
  );
  const [open, setOpen] = React.useState(null);
  const order = (l) => STATUS_ORDER.indexOf(l.status) * 100 + LEVERS.findIndex((x) => x.id === l.id);
  const sorted = [...view.levers].sort((a, b) => order(a) - order(b));
  const c = view.count;
  return (
    <div className={`cv-page ${s.page}`}>
      <header className={s.head}>
        <div className={s.headText}>
          <span className={s.over}>Lever Check · {CV_ROOM.name}{view.period ? ` · week of ${view.period}` : ''}</span>
          <h2 className={s.h1}>{view.headline}</h2>
        </div>
        <div className={s.counts} aria-label="Levers by status">
          {STATUS_ORDER.filter((k) => k !== 'nodata' || c[k]).map((k) => (
            <span key={k} className={`${s.count} ${s[`count_${k}`]} ${c[k] ? '' : s.countZero}`}>
              <Icon name={STATUS[k].icon} size={16} /><b>{c[k]}</b>{STATUS[k].label}
            </span>
          ))}
        </div>
      </header>

      <StartHere view={view} go={cv.go} />

      <section aria-label="Every lever, worst first">
        <ul className={s.rows}>
          {sorted.map((l) => <LeverRow key={l.id} l={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} go={cv.go} />)}
        </ul>
        <p className={s.hint}>Tap a lever for the details. Dollars across levers aren&apos;t added up: they overlap and mix claim strengths.</p>
      </section>

      {!view.waiting && <Context view={view} />}
    </div>
  );
}

export { CvSummary };
