'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { CV_CLAIM, CV_D, CV_DS, CV_ROOM, Claim, cvMoney, useCv } from '../core';
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
function Vitals({ v }) {
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
          <span className={s.big}>{t.big}</span>
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
      <div className={s.cardBig}>
        <span className={s.bigMd}>{l.big.value}</span>
        <span className={s.bigLabel}>{l.big.label} <ClaimDot k={l.big.claim} /></span>
        {l.delta && <span className={`${s.delta} ${l.delta.good ? s.up : s.flat}`}><Icon name={l.delta.text.startsWith('−') ? 'TrendingDown' : 'TrendingUp'} size={14} />{l.delta.text}</span>}
      </div>
      <ul className={s.lines}>
        <li className={s.good}><Icon name="CircleCheck" size={16} /><span>{l.good ? <>{l.good.text} <ClaimDot k={l.good.claim} /></> : 'Nothing to celebrate yet'}</span></li>
        <li className={l.bad ? s.bad : s.lineMuted}><Icon name={l.bad ? 'CircleAlert' : 'Minus'} size={16} /><span>{l.bad ? <>{l.bad.text} <ClaimDot k={l.bad.claim} /></> : 'Nothing wrong found'}</span></li>
      </ul>
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
    () => leverSummary(CV_D, { windows: real ? eng.windows || [] : null, matchedWeeks: CV_DS.matchedWeeks || [] }),
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
        <p className={s.sub}>Every money lever on one page: what&apos;s working, what&apos;s leaking, and the one thing to do first.</p>
      </header>

      <StatusStrip levers={view.levers} count={view.count} onPick={pick} />

      {view.vitals && <Vitals v={view.vitals} />}

      {t && (
        <section className={s.action}>
          <div className={s.actionText}>
            <span className={s.actionLabel}>{t.kind === 'move' ? 'Do this first' : 'Look at this first'} · {t.lever}</span>
            <span className={s.actionTitle}>{t.title}</span>
            {t.kind === 'move' && <span className={s.actionValue}>About {cvMoney(Math.round(t.value))} a week, if it works <Claim k={t.claim} />{t.hours ? <span className={s.faint}> · {t.hours < 1 ? `${Math.round(t.hours * 60)} minutes` : `${t.hours} hours`} of your time</span> : null}</span>}
          </div>
          <div className={s.actionSide}>
            <Button icon="ArrowRight" onClick={() => cv.go(t.go)}>Open {t.lever}</Button>
            <span className={s.banked}>
              {view.banked > 0 ? <><b>{cvMoney(Math.round(view.banked))}/wk</b> already banked <Claim k="book" /></> : <>Nothing banked yet. Wins count once a test verifies.</>}
            </span>
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
