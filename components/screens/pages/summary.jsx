'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { CV_CLAIM, CV_D, CV_DS, CV_ROOM, Claim, cvMoney, useCv } from '../core';
import { deriveRoom } from '../../../lib/data/model';
import { useEngine } from '../../engine';
import { LEVERS, STATUS, STATUS_ORDER, leverSummary } from '../../../lib/data/page/summary';
import s from './summary.module.css';

/* ================================================================ Lever Check
 * The hub for every money lever, read in two minutes on one screen.
 *   1. Hero: a health ring of all eight levers, the answer in one line, and
 *      what Coversight has already banked (the proof that it pays).
 *   2. Start here: the lever that needs you, or the best ready win, with the
 *      page's one persimmon button.
 *   3. Eight lever tiles, worst first: status, one big number, a 12-week line,
 *      the one thing that matters, and tags for tests and ready wins. A tap
 *      opens the detail under the grid.
 * Figures come from lib/data/page/summary.js (deriveRoom, the This week
 * comparators, the room's own test windows). Nothing is typed in. */

const TONE = { bad: 'var(--error-600)', watch: 'var(--warning-500)', good: 'var(--success-600)', nodata: 'var(--border-strong)' };

/** A claim as its icon only, for a dollar inside a sentence; the name is in the tooltip and for screen readers. */
function ClaimDot({ k, light }) {
  if (!k || k === 'none') return null;
  const c = CV_CLAIM[k];
  return <span className={`${s.claimDot} ${light ? s.claimLight : ''}`} title={`${c.label}: ${c.tip}`} aria-label={c.label} role="img"><Icon name={c.icon} size={13} /></span>;
}

function StatusPill({ status }) {
  const st = STATUS[status];
  return <span className={`${s.pill} ${s[`pill_${status}`]}`}><Icon name={st.icon} size={13} />{st.label}</span>;
}

/** A small 12-week line: where this number has been. The last point is this week. */
function Spark({ trend, label, w = 84, h = 26 }) {
  if (!trend) return null;
  const v = trend.values;
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const x = (i) => 2 + (i / (v.length - 1)) * (w - 4);
  const y = (n) => 3 + (1 - (n - lo) / span) * (h - 6);
  const pts = v.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`);
  return (
    <svg className={s.spark} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`${label}, last ${v.length} weeks, ${trend.weeks[0]} to ${trend.weeks[v.length - 1]}`}>
      <path d={`M${pts[0]} L${pts.join(' L')} L${x(v.length - 1)},${h} L${x(0)},${h} Z`} fill="currentColor" opacity="0.08" />
      <path d={`M${pts.join(' L')}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(v.length - 1)} cy={y(v[v.length - 1])} r="2.6" fill="currentColor" />
    </svg>
  );
}

/** Eight arcs, one per lever, coloured by status, worst first; the count on track in the middle. */
function HealthRing({ levers, good }) {
  const R = 52, C = 2 * Math.PI * R, gap = 5;
  const seg = C / levers.length;
  const sorted = [...levers].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return (
    <svg className={s.ring} viewBox="0 0 132 132" width="132" height="132" role="img" aria-label={`${good} of ${levers.length} levers look good. ${sorted.map((l) => `${l.name}: ${STATUS[l.status].label}`).join('; ')}`}>
      <g transform="rotate(-90 66 66)">
        {sorted.map((l, i) => (
          <circle key={l.id} cx="66" cy="66" r={R} fill="none" stroke={TONE[l.status]} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${seg - gap} ${C - seg + gap}`} strokeDashoffset={-i * seg} />
        ))}
      </g>
      <text x="66" y="64" textAnchor="middle" className={s.ringBig}>{good}/{levers.length}</text>
      <text x="66" y="84" textAnchor="middle" className={s.ringSmall}>look good</text>
    </svg>
  );
}

const winText = (f) => (f.range ? `${cvMoney(Math.max(0, Math.round(f.lo)))}–${cvMoney(Math.round(f.hi))}/wk` : `+${cvMoney(Math.round(f.value))}/wk`);
const ON_IT = { testing: ['Timer', 'Testing'], verified: ['BadgeCheck', 'Banking'], held: ['CirclePause', 'On hold'] };
const ON_IT_LONG = { testing: 'We’re testing a fix', verified: 'A fix is working', held: 'A fix is paused' };

/* ---------------------------------------------------------------- hero */
function Hero({ view }) {
  const o = view.outcome;
  const c = view.count;
  const stats = [
    { k: 'toDate', big: cvMoney(Math.round(o.toDate)), label: 'saved for you so far' },
    { k: 'week', big: `${cvMoney(Math.round(o.week))}`, unit: '/wk', label: 'saved every week now' },
    o.payback ? { k: 'pay', big: `${o.payback.times.toFixed(1)}×`, label: `Coversight paid for itself in ${o.payback.month}` } : { k: 'tests', big: String(o.tests), label: `fix${o.tests === 1 ? '' : 'es'} being tested for you` },
  ];
  return (
    <section className={s.hero} aria-label="How your levers are doing">
      <div className={s.heroLeft}>
        <HealthRing levers={view.levers} good={c.good} />
        <div className={s.heroText}>
          <span className={s.heroOver}><Icon name="Gauge" size={14} />Lever Check · {CV_ROOM.name}{view.period ? ` · week of ${view.period}` : ''}</span>
          <h2 className={s.heroH1}>{view.headline}</h2>
          <div className={s.heroCounts}>
            {['bad', 'watch', 'good', 'nodata'].filter((k) => c[k]).map((k) => (
              <span key={k} className={`${s.hc} ${s[`hc_${k}`]}`}><Icon name={STATUS[k].icon} size={14} /><b>{c[k]}</b> {STATUS[k].label.toLowerCase()}</span>
            ))}
          </div>
        </div>
      </div>
      {!view.waiting && (
        <div className={s.heroRight}>
          <span className={s.heroProofLabel}><Icon name="BadgeCheck" size={14} />What Coversight has saved {CV_ROOM.short}</span>
          <div className={s.heroStats}>
            {stats.map((t) => (
              <div key={t.k} className={s.heroStat}>
                <span className={s.heroBig}>{t.big}{t.unit && <small>{t.unit}</small>}</span>
                <span className={s.heroLabel}>{t.label}</span>
              </div>
            ))}
          </div>
          <span className={s.heroFoot}><Icon name={CV_CLAIM.book.icon} size={12} />Real money only: we count a saving once a test proves it</span>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- start here */
function StartHere({ view, go }) {
  const red = view.levers.filter((l) => l.status === 'bad');
  const t = view.top;
  const l = red[0];
  if (!l && !t) return null;
  const bad = !!l;
  return (
    <section className={`${s.start} ${bad ? s.start_bad : s.start_move}`} aria-label="Start here">
      <span className={s.startIcon}><Icon name={bad ? l.icon : 'Sparkles'} size={22} /></span>
      <div className={s.startMain}>
        <span className={s.startLabel}>{bad ? <>Fix this first · {l.name}</> : <>Your best move this week · {t.lever}</>}</span>
        <span className={s.startTitle}>{bad ? (l.bad?.text ?? l.name) : t.title}</span>
        <span className={s.startSub}>
          {bad
            ? <>{l.big.value} {l.big.label} <ClaimDot k={l.big.claim} />{l.fix && <> · Fixing it could add <b>{winText(l.fix)}</b> <Claim k={l.fix.claim} /></>}</>
            : <>About <b>{cvMoney(Math.round(t.value))} a week</b> if it works <Claim k={t.claim} /></>}
        </span>
      </div>
      <div className={s.startSide}>
        <Button icon="ArrowRight" onClick={() => go(bad ? l.go : t.go)}>{bad ? `Fix ${l.name.toLowerCase()}` : `Open ${t.lever.toLowerCase()}`}</Button>
        {bad && t?.kind === 'move' && t.go !== l.go && (
          <button type="button" className={s.nextWin} onClick={() => go(t.go)}>After that: {t.title} <b>+{cvMoney(Math.round(t.value))}/wk</b> <Icon name="ArrowRight" size={13} /></button>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- lever tiles */
function Tile({ l, selected, onPick }) {
  const on = l.handled && ON_IT[l.handled.kind];
  if (l.status === 'nodata') {
    return (
      <button type="button" className={`${s.tile} ${s.tile_nodata} ${selected ? s.tileOn : ''}`} aria-pressed={selected} onClick={onPick}>
        <span className={s.tileHead}><span className={s.tileIcon}><Icon name={l.icon} size={17} /></span><span className={s.tileNameWrap}><span className={s.tileName}>{l.name}</span><span className={s.tileAbout}>{l.about}</span></span><StatusPill status="nodata" /></span>
        <span className={s.tileLine}>We need your {l.missing.join(' and ')} to check this.</span>
      </button>
    );
  }
  const line = l.status === 'good' ? l.good : l.bad || l.good;
  const ok = l.status === 'good' || !l.bad;
  return (
    <button type="button" className={`${s.tile} ${s[`tile_${l.status}`]} ${selected ? s.tileOn : ''}`} aria-pressed={selected} onClick={onPick}>
      <span className={s.tileHead}>
        <span className={s.tileIcon}><Icon name={l.icon} size={17} /></span>
        <span className={s.tileNameWrap}><span className={s.tileName}>{l.name}</span><span className={s.tileAbout}>{l.about}</span></span>
        <StatusPill status={l.status} />
      </span>
      <span className={s.tileNum}>
        <span className={s.tileBig}>{l.big.value}</span>
        <span className={s.tileLabel}>{l.big.label} <ClaimDot k={l.big.claim} /></span>
      </span>
      {line && <span className={s.tileLine}><Icon name={ok ? 'CircleCheck' : 'CircleAlert'} size={14} className={ok ? s.icoGood : s.icoBad} /><span>{line.text}</span></span>}
      <span className={s.tileTags}>
        {l.fix ? <span className={`${s.tag} ${s.tag_win}`}><Icon name="Sparkles" size={12} />Could add {winText(l.fix)}</span>
          : on ? <span className={`${s.tag} ${s[`tag_${l.handled.kind}`]}`}><Icon name={on[0]} size={12} />{ON_IT_LONG[l.handled.kind]}</span> : null}
      </span>
    </button>
  );
}

function Detail({ l, go, onClose }) {
  const ref = React.useRef(null);
  React.useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [l.id]);
  const facts = (l.facts || []).filter(Boolean);
  const on = l.handled && ON_IT[l.handled.kind];
  return (
    <section ref={ref} className={`${s.detail} ${s[`detail_${l.status}`]}`} aria-label={`${l.name} in detail`}>
      <header className={s.detailHead}>
        <span className={s.tileIcon}><Icon name={l.icon} size={17} /></span>
        <span className={s.detailName}>{l.name}</span><span className={s.faint}>{l.about}</span>
        <StatusPill status={l.status} />
        {l.rank && <span className={`${s.rank} ${s[`rank_${l.rank.tone}`]}`}><Icon name={l.rank.rank === 1 ? 'Trophy' : 'Building2'} size={13} />{l.rank.text}</span>}
        <button type="button" className={s.close} onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
      </header>
      {l.status === 'nodata' ? (
        <div className={s.detailBody}><p className={s.note}>Add your {l.missing.join(' and ')} and we can check this lever. Until then we don’t guess.</p>
          <button type="button" className={s.link} onClick={() => go(l.next.go)}>{l.next.label} <Icon name="ArrowRight" size={13} /></button></div>
      ) : (
        <div className={s.detailBody}>
          <ul className={s.lines}>
            <li><Icon name="CircleCheck" size={15} className={s.icoGood} /><span><b>Going well:</b> {l.good ? <>{l.good.text} <ClaimDot k={l.good.claim} /></> : 'Nothing to celebrate yet'}</span></li>
            <li><Icon name={l.bad ? 'CircleAlert' : 'Minus'} size={15} className={l.bad ? s.icoBad : s.icoMuted} /><span><b>Not going well:</b> {l.bad ? <>{l.bad.text} <ClaimDot k={l.bad.claim} /></> : 'Nothing wrong found'}</span></li>
            {l.handled && <li><Icon name={on[0]} size={15} className={s.icoInk} /><span><b>{ON_IT_LONG[l.handled.kind]}:</b> {l.handled.text} <span className={s.faint}>· {l.handled.sub}</span></span></li>}
            {l.fix && <li><Icon name="Sparkles" size={15} className={s.icoInk} /><span><b>Easy win:</b> {l.fix.title}, {l.fix.range ? winText(l.fix) : `about ${cvMoney(Math.round(l.fix.value))}/wk`} <Claim k={l.fix.claim} /></span></li>}
          </ul>
          <div className={s.detailSide}>
            {l.trend && <span className={s.ctxTrend}><Spark trend={l.trend} label={l.name} w={160} h={40} /><span className={s.faint}>the last 12 weeks</span></span>}
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
    </section>
  );
}

/* ---------------------------------------------------------------- the week */
function Week({ view }) {
  const v = view.vitals;
  if (!v) return null;
  const signed = (n) => `${n >= 0 ? '+' : '−'}${cvMoney(Math.abs(Math.round(n)))}`;
  const ptsOf = (n) => (Math.abs(n) < 0.0005 ? 'same' : `${n > 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} pts`);
  const tone = (st) => (st === 'good' ? s.up : st === 'bad' ? s.down : s.flat);
  const items = [
    { k: 'sales', label: 'Sales', big: cvMoney(Math.round(v.sales.now)), d: signed(v.sales.change), st: v.sales.status },
    { k: 'food', label: 'Food cost', big: `${(v.food.now * 100).toFixed(1)}%`, d: ptsOf(v.food.change), st: v.food.status },
    { k: 'labour', label: 'Staff pay', big: `${(v.labour.now * 100).toFixed(1)}%`, d: ptsOf(v.labour.change), st: v.labour.status },
    { k: 'kept', label: 'Left after food & staff', big: cvMoney(Math.round(v.kept.now)), d: signed(v.kept.change), st: v.kept.status },
  ];
  return (
    <section className={s.week} aria-label={`The week of ${v.period}`}>
      <span className={s.weekLabel}>This week <span className={s.faint}>compared with a normal week</span></span>
      {items.map((t) => (
        <div key={t.k} className={s.weekItem}>
          <span className={s.weekName}>{t.label}</span>
          <span className={s.weekBig}>{t.big}</span>
          <span className={`${s.weekDelta} ${tone(t.st)}`}>{t.d}</span>
        </div>
      ))}
    </section>
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
  const picked = sorted.find((l) => l.id === open);
  return (
    <div className={`cv-page ${s.page}`}>
      <Hero view={view} />
      <StartHere view={view} go={cv.go} />
      <section aria-label="Every lever, worst first">
        <div className={s.gridHead}>
          <span className={s.gridTitle}>Your {view.levers.length} money levers</span>
          <span className={s.faint}>Most urgent first. Tap one to see more.</span>
        </div>
        <div className={s.grid}>
          {sorted.map((l) => <Tile key={l.id} l={l} selected={open === l.id} onPick={() => setOpen(open === l.id ? null : l.id)} />)}
        </div>
        {picked && <Detail l={picked} go={cv.go} onClose={() => setOpen(null)} />}
      </section>
      <Week view={view} />
      <p className={s.hint}>We don&apos;t add these dollars together, because some of them overlap.</p>
    </div>
  );
}

export { CvSummary };
