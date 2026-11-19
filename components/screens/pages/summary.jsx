'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { CV_CLAIM, CV_D, CV_DS, CV_ROOM, Claim, cvMoney, useCv } from '../core';
import { deriveRoom } from '../../../lib/data/model';
import { useEngine } from '../../engine';
import { LEVERS, STATUS, STATUS_ORDER, leverSummary } from '../../../lib/data/page/summary';
import s from './summary.module.css';

/* ================================================================ Lever Check
 * Every money lever in the room on one page, at a glance: is it on track, what
 * is working, what is leaking, and the one thing to do first. Replaces the
 * Coverage map (Ramidu, 2026-11-18). Figures come from lib/data/page/summary.js,
 * which reads deriveRoom() and the This week comparators; detail sits behind
 * a tap on each lever, and each lever's own page is one more tap away. */

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
function Spark({ trend, label, w = 120, h = 34 }) {
  if (!trend) return null;
  const v = trend.values;
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const x = (i) => 2 + (i / (v.length - 1)) * (w - 4);
  const y = (n) => 3 + (1 - (n - lo) / span) * (h - 6);
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  const last = v[v.length - 1];
  return (
    <svg className={s.spark} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`${label}, last ${v.length} weeks, from ${trend.weeks[0]} to ${trend.weeks[v.length - 1]}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(v.length - 1)} cy={y(last)} r="3" fill="currentColor" />
    </svg>
  );
}

/** What Coversight has done here: banked so far, banking now, payback on the fee, and how much it is working on. */
function ProofBand({ o, handled, total, room }) {
  const items = [
    { k: 'toDate', big: cvMoney(Math.round(o.toDate)), label: 'banked for you so far', claim: 'book' },
    { k: 'week', big: `${cvMoney(Math.round(o.week))}/wk`, label: 'banking now from verified changes', claim: 'book' },
    o.payback ? { k: 'pay', big: `${o.payback.times.toFixed(1)}×`, label: `its $${o.payback.fee}/mo fee, paid back in ${o.payback.month}`, claim: 'book' } : null,
    { k: 'on', big: `${handled} of ${total}`, label: `levers Coversight is working on${o.tests ? `, ${o.tests} test${o.tests === 1 ? '' : 's'} running` : ''}`, claim: null },
  ].filter(Boolean);
  return (
    <section className={s.proof} aria-label={`What Coversight has done at ${room}`}>
      <span className={s.proofLabel}><Icon name="BadgeCheck" size={16} />What Coversight has done for {room}</span>
      <div className={s.proofRow}>
        {items.map((i) => (
          <div key={i.k} className={s.proofItem}>
            <span className={s.proofBig}>{i.big}</span>
            <span className={s.proofText}>{i.label}{i.claim && <> <span className={s.proofClaim}><Icon name={CV_CLAIM[i.claim].icon} size={12} />{CV_CLAIM[i.claim].label}</span></>}</span>
          </div>
        ))}
      </div>
      {o.toDate <= 0 && <span className={s.proofNote}>Nothing has verified here yet. A change only counts once a test proves it, so every banked dollar is real money.</span>}
    </section>
  );
}

/** Eight blocks, one per lever, coloured and labelled by status: the whole room in one glance. */
function StatusStrip({ levers, count, onPick }) {
  const sorted = [...levers].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return (
    <div className={s.strip}>
      <div className={s.blocks} role="list" aria-label="Every lever by status">
        {sorted.map((l) => (
          <button key={l.id} type="button" role="listitem" className={`${s.block} ${s[`block_${l.status}`]}`} onClick={() => onPick(l.id)} title={`${l.name}: ${STATUS[l.status].label}`}>
            <span className={s.blockIcons}><Icon name={l.icon} size={16} /><Icon name={STATUS[l.status].icon} size={15} /></span><span>{l.name}</span>
          </button>
        ))}
      </div>
      <div className={s.legend}>
        {STATUS_ORDER.filter((k) => count[k]).map((k) => (
          <span key={k} className={s.legendItem}><i className={s[`dot_${k}`]} /><b>{count[k]}</b> {STATUS[k].label.toLowerCase()}</span>
        ))}
      </div>
    </div>
  );
}

/** Sales, food cost, labor and what the room kept, against a normal week. */
function Vitals({ v, trends }) {
  const signed = (n) => `${n >= 0 ? '+' : '−'}${cvMoney(Math.abs(Math.round(n)))}`;
  const ptsOf = (n) => (Math.abs(n) < 0.0005 ? 'Same' : `${n > 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} pts`);
  /* The arrow follows the number; the colour follows whether that is good for the room. */
  const tiles = [
    { k: 'sales', label: 'Sales', big: cvMoney(Math.round(v.sales.now)), delta: signed(v.sales.change), dir: Math.sign(v.sales.change), status: v.sales.status },
    { k: 'food', label: 'Food cost', big: `${(v.food.now * 100).toFixed(1)}%`, delta: ptsOf(v.food.change), dir: Math.abs(v.food.change) < 0.0005 ? 0 : Math.sign(v.food.change), status: v.food.status, of: 'of sales' },
    { k: 'labour', label: 'Labor', big: `${(v.labour.now * 100).toFixed(1)}%`, delta: ptsOf(v.labour.change), dir: Math.abs(v.labour.change) < 0.0005 ? 0 : Math.sign(v.labour.change), status: v.labour.status, of: 'of sales' },
    { k: 'kept', label: 'You kept', big: cvMoney(Math.round(v.kept.now)), delta: signed(v.kept.change), dir: Math.sign(v.kept.change), status: v.kept.status, of: 'after food and labor' },
  ];
  return (
    <section className={s.vitals} aria-label={`The week of ${v.period}`}>
      {tiles.map((t) => (
        <div key={t.k} className={s.vital}>
          <span className={s.vitalLabel}>{t.label}{t.of && <span className={s.faint}> {t.of}</span>}</span>
          <span className={s.bigRow}><span className={s.big}>{t.big}</span>{trends?.[t.k] && <Spark trend={trends[t.k]} label={t.label} w={90} h={30} />}</span>
          <span className={`${s.delta} ${t.status === 'good' ? s.up : t.status === 'bad' ? s.down : s.flat}`}>
            <Icon name={t.dir > 0 ? 'TrendingUp' : t.dir < 0 ? 'TrendingDown' : 'Minus'} size={15} />{t.delta}<span className={s.faint}>vs {v.comparator.toLowerCase()}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

function LeverCard({ l, open, onToggle, go }) {
  const ref = React.useRef(null);
  React.useEffect(() => { if (open) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [open]);
  if (l.status === 'nodata') {
    return (
      <article ref={ref} id={`lever-${l.id}`} className={`${s.card} ${s.card_nodata}`}>
        <header className={s.cardHead}><span className={s.cardName}><Icon name={l.icon} size={18} />{l.name}</span><StatusPill status="nodata" /></header>
        <p className={s.lineMuted}>Needs {l.missing.join(' and ')}. Nothing here is counted as zero.</p>
        <div className={s.cardFoot}><button type="button" className={s.link} onClick={() => go(l.next.go)}>{l.next.label} <Icon name="ArrowRight" size={14} /></button></div>
      </article>
    );
  }
  const facts = (l.facts || []).filter(Boolean);
  return (
    <article ref={ref} id={`lever-${l.id}`} className={`${s.card} ${s[`card_${l.status}`]}`}>
      <header className={s.cardHead}>
        <span className={s.cardName}><Icon name={l.icon} size={18} />{l.name}</span>
        <StatusPill status={l.status} />
      </header>
      {l.rank && <span className={`${s.rank} ${s[`rank_${l.rank.tone}`]}`}><Icon name={l.rank.rank === 1 ? 'Trophy' : 'Building2'} size={13} />{l.rank.text}</span>}
      <div className={s.cardBig}>
        <span className={s.bigRow}><span className={s.bigMd}>{l.big.value}</span><Spark trend={l.trend} label={l.name} /></span>
        <span className={s.bigLabel}>{l.big.label} <ClaimDot k={l.big.claim} /></span>
        {l.delta && <span className={`${s.delta} ${l.delta.good ? s.up : s.flat}`}><Icon name={l.delta.text.startsWith('−') ? 'TrendingDown' : 'TrendingUp'} size={14} />{l.delta.text}</span>}
      </div>
      <ul className={s.lines}>
        <li className={s.good}><Icon name="CircleCheck" size={16} /><span>{l.good ? <>{l.good.text} <ClaimDot k={l.good.claim} /></> : 'Nothing to celebrate yet'}</span></li>
        <li className={l.bad ? s.bad : s.lineMuted}><Icon name={l.bad ? 'CircleAlert' : 'Minus'} size={16} /><span>{l.bad ? <>{l.bad.text} <ClaimDot k={l.bad.claim} /></> : 'Nothing wrong found'}</span></li>
      </ul>
      {l.handled && (
        <div className={`${s.onIt} ${s[`onIt_${l.handled.kind}`]}`}>
          <Icon name={{ testing: 'Timer', verified: 'BadgeCheck', held: 'CirclePause' }[l.handled.kind]} size={16} />
          <span className={s.onItText}>
            <b>{{ testing: 'Coversight is testing', verified: 'Verified and banking', held: 'On hold' }[l.handled.kind]}:</b> {l.handled.text}
            <span className={s.faint}> · {l.handled.sub}</span>
          </span>
          {l.handled.progress != null && <span className={s.bar} role="img" aria-label={`${l.handled.progress}% through the test`}><i style={{ width: `${l.handled.progress}%` }} /></span>}
        </div>
      )}
      {l.fix && (
        <div className={s.fix}>
          <span className={s.fixLabel}>Ready win</span>
          <span className={s.fixTitle}>{l.fix.title}</span>
          <span className={s.fixValue}>{l.fix.range ? `${cvMoney(Math.max(0, Math.round(l.fix.lo)))} to ${cvMoney(Math.round(l.fix.hi))}/wk` : `about ${cvMoney(Math.round(l.fix.value))}/wk`} <Claim k={l.fix.claim} /></span>
        </div>
      )}
      {open && (
        <dl className={s.facts}>
          {facts.map(([k, v, c]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v} <ClaimDot k={c} /></dd></React.Fragment>)}
          {l.note && <p className={s.note}>{l.note}</p>}
        </dl>
      )}
      <div className={s.cardFoot}>
        <button type="button" className={s.more} aria-expanded={open} onClick={onToggle}>{open ? 'Less' : 'The numbers'} <Icon name="ChevronDown" size={14} className={open ? s.flip : ''} /></button>
        <button type="button" className={s.link} onClick={() => go(l.go)}>Open {l.name} <Icon name="ArrowRight" size={14} /></button>
      </div>
    </article>
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
  const sorted = [...view.levers].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || LEVERS.findIndex((x) => x.id === a.id) - LEVERS.findIndex((x) => x.id === b.id));
  const pick = (id) => { setOpen(id); document.getElementById(`lever-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); };
  const t = view.top;
  return (
    <div className={`cv-page ${s.page}`}>
      <header className={s.head}>
        <span className={s.over}>Lever Check · {CV_ROOM.name}{view.period ? ` · week of ${view.period}` : ''}</span>
        <h2 className={s.h1}>{view.headline}</h2>
        <p className={s.sub}>Your hub for every money lever. See what&apos;s working, what&apos;s leaking, and what Coversight is already fixing for you.</p>
      </header>

      {!view.waiting && <ProofBand o={view.outcome} handled={view.handled} total={view.levers.length} room={CV_ROOM.short} />}

      <StatusStrip levers={view.levers} count={view.count} onPick={pick} />

      {view.vitals && <Vitals v={view.vitals} trends={view.trends} />}

      {t && (
        <section className={s.action}>
          <div className={s.actionText}>
            <span className={s.actionLabel}>{t.kind === 'move' ? 'Do this first' : 'Look at this first'} · {t.lever}</span>
            <span className={s.actionTitle}>{t.title}</span>
            {t.kind === 'move' && <span className={s.actionValue}>About {cvMoney(Math.round(t.value))} a week, if it works <Claim k={t.claim} />{t.hours ? <span className={s.faint}> · {t.hours < 1 ? `${Math.round(t.hours * 60)} minutes` : `${t.hours} hours`} of your time</span> : null}</span>}
          </div>
          <div className={s.actionSide}>
            <Button icon="ArrowRight" onClick={() => cv.go(t.go)}>Open {t.lever}</Button>
            {view.outcome.plan && (
              <button type="button" className={s.planLink} onClick={() => cv.go('plan')}>
                This week&apos;s plan: {view.outcome.plan.count} moves, up to <b>{cvMoney(Math.round(view.outcome.plan.value))}/wk</b> in {view.outcome.plan.hours} hours <ClaimDot k={view.outcome.plan.claim} /> <Icon name="ArrowRight" size={14} />
              </button>
            )}
          </div>
        </section>
      )}

      <section className={s.grid} aria-label="Every lever">
        {sorted.map((l) => <LeverCard key={l.id} l={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} go={cv.go} />)}
      </section>

      <details className={s.why}>
        <summary><Icon name="Info" size={15} /> Why these aren&apos;t added up</summary>
        <p>The levers overlap (a slow grill and a full room can be the same dollars) and mix claim strengths, so one total would count money twice. Only what&apos;s banked is money; the rest is what to go after.</p>
      </details>
    </div>
  );
}

export { CvSummary };
