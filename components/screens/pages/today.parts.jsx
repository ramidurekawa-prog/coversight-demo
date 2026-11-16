'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { assigneeLabel, cardState, isActive, queueView, todayCards, worthOf, unlocksOf } from '../../../lib/data/page/today';
import { comingUp } from '../../../lib/data/page/today-brief';
import { CV_D, CV_DS, CV_GROUP, Claim, cvMoney } from '../core';
import { deriveRoom } from '../../../lib/data/model';
import { Panel } from './today.review';
import { dayLabel, shortMoney } from './today.last';
import { MAX_METRICS, METRICS, SCENARIOS, WIDGETS } from './today.layout';
import { AgeBar, HoursBar, MarkBar, PaceBars, People, Spark } from './today.viz';
import s from './today.module.css';

const money = (v) => cvMoney(Math.round(v));
const signPct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function PanelTop({ over, title, onClose }) {
  return (
    <div className={s.panelHead}>
      <div className={s.panelHeadText}>{over && <span className={s.panelOver}>{over}</span>}<h2 className={s.panelTitle} tabIndex={-1} data-autofocus>{title}</h2></div>
      <button type="button" className={s.iconBtn} aria-label="Close" onClick={onClose}><Icon name="X" size={18} /></button>
    </div>
  );
}

/* ================================================================ status */

/** One headline with a status mark, and one quiet line of context underneath. */
export function Status({ brief, period, now, sum, onFeeds, onCustomize }) {
  const calm = brief.tone === 'calm';
  return (
    <header className={s.status}>
      <div className={s.statusRow}>
        <span className={`${s.statusMark} ${calm ? s.markCalm : s.markAttn}`}>
          <Icon name={calm ? 'CircleCheck' : 'CircleDot'} size={16} />
          {calm ? 'On track' : sum.ready ? `${sum.ready} to decide` : 'Waiting on data'}
        </span>
        <button type="button" className={s.iconBtn} aria-label="Customize Today" title="Customize" onClick={onCustomize} aria-haspopup="dialog"><Icon name="SlidersHorizontal" size={17} /></button>
      </div>
      <h2 className={s.headline}>{brief.headline}</h2>
      <div className={s.meta}>
        {period.label && <span className={s.metaItem}><Icon name="Clock" size={13} />{period.label} · {now.time}</span>}
        {brief.warn.length > 0 && (
          <button type="button" className={s.metaWarn} onClick={onFeeds} title={brief.warn.map((f) => `${f.name}: ${f.what}`).join('. ')}>
            <Icon name="TriangleAlert" size={13} />{brief.warn.length === 1 ? `${brief.warn[0].name} is behind` : `${brief.warn.length} data feeds behind`}
          </button>
        )}
      </div>
    </header>
  );
}

/** Which feeds are behind, and what each holds back. */
export function FeedsPanel({ warn, onClose, onGo }) {
  return (
    <Panel label="Data that’s behind" onClose={onClose}>
      <PanelTop over="Data" title="Data that’s behind" onClose={onClose} />
      <div className={s.panelBody}>
        {warn.map((f) => (
          <section key={f.name} className={s.block}>
            <h3 className={s.blockTitle}>{f.name}</h3>
            <p className={s.blockText}>{f.last === 'not updating' ? 'Not updating.' : `Last updated ${f.last}.`} {f.what}.</p>
          </section>
        ))}
        <button type="button" className={s.textLink} onClick={() => onGo('sources')}>Fix it in Sources<Icon name="ArrowRight" size={13} /></button>
      </div>
    </Panel>
  );
}

/* ================================================================ three tiles */

/**
 * The three tiles' content: a big number, a small visual comparison, a few
 * words saying against what, and the facts behind it for the detail panel.
 * No basis means no comparison, said out loud, never a zero.
 */
export function tileData({ d, dense, sv, flags }) {
  const rows = d.hist?.rows || [];
  const last = rows.at(-1);
  const before = rows.slice(-5, -1);
  const day = dense?.days?.at(-1);
  const same = day ? dense.days.filter((x) => x.dow === day.dow).slice(-8) : [];
  const labor7 = d.feeds.find((f) => f.name === '7shifts');
  const src = (x) => (d.room.fromToast ? `Your Toast data${x ? `, ${x}` : ''}` : `Sample restaurant data${x ? `, ${x}` : ''}`);
  const t = {};
  const byDay = (k, label) => {
    if (!(day && same.length >= 4) || flags.noHistory) return null;
    const prior = same.slice(0, -1);
    const avg = mean(prior.map((x) => x[k]));
    const delta = (day[k] - avg) / avg;
    return {
      label, fig: k === 'net' ? money(day[k]) : String(day[k]), cmp: `${signPct(delta)} vs a usual ${day.dow}`,
      viz: <Spark values={same.map((x) => x[k])} />, claim: 'obs',
      facts: [[`${day.dow}, ${dayLabel(day.iso)}`, k === 'net' ? money(day[k]) : String(day[k])], [`Average of the ${prior.length} ${day.dow}s before`, k === 'net' ? money(avg) : String(Math.round(avg))], ['Their range', k === 'net' ? `${money(Math.min(...prior.map((x) => x[k])))} to ${money(Math.max(...prior.map((x) => x[k])))}` : `${Math.min(...prior.map((x) => x[k]))} to ${Math.max(...prior.map((x) => x[k]))}`], ['Source', src(`through ${dayLabel(day.iso)}`)]],
      go: 'daily',
    };
  };
  const byWeek = (k, label) => {
    if (!(last && before.length >= 4) || flags.noHistory) return { label, fig: last ? (k === 'net' ? money(last[k]) : String(last[k])) : null, cmp: 'Comparisons after 4 weeks of data', facts: [['Source', src()]], go: 'trends' };
    const avg = mean(before.map((r) => r[k]));
    return {
      label: `${label}, last week`, fig: k === 'net' ? money(last[k]) : String(last[k]), cmp: `${signPct((last[k] - avg) / avg)} vs the 4 weeks before`,
      viz: <Spark values={rows.slice(-8).map((r) => r[k])} />, claim: 'obs',
      facts: [[`Week of ${last.label}`, k === 'net' ? money(last[k]) : String(last[k])], ['Average of the 4 weeks before', k === 'net' ? money(avg) : String(Math.round(avg))], ['Source', src()]], go: 'trends',
    };
  };
  t.sales = byDay('net', 'Sales') || byWeek('net', 'Sales');
  t.covers = byDay('covers', 'Covers') || byWeek('covers', 'Covers');
  if (flags.laborDown) {
    t.labor = { label: 'Labor', fig: null, cmp: '7shifts isn’t updating', warn: true, facts: [['Status', 'Labor shows again once 7shifts updates. Nothing here is guessed in the meantime.']], go: 'sources' };
  } else if (last && before.length >= 4 && !flags.noHistory) {
    const avg = mean(before.map((r) => r.labourRate));
    // Compare the figures as shown, so the words and the two numbers always agree.
    const diff = Math.round(last.labourRate * 1000) / 10 - Math.round(avg * 1000) / 10;
    t.labor = {
      label: 'Labor, last week', fig: `${(last.labourRate * 100).toFixed(1)}%`,
      cmp: Math.abs(diff) < 0.05 ? 'Same as usual' : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} pts vs usual`,
      viz: <MarkBar value={last.labourRate} mark={avg} max={Math.max(last.labourRate, avg) * 1.4} />, claim: 'obs',
      warn: labor7?.state === 'stale' ? `7shifts ${labor7.last.replace(' ago', '')} behind` : null,
      facts: [['Labor, share of sales', `${(last.labourRate * 100).toFixed(1)}% (week of ${last.label})`], ['Usual (the 4 weeks before)', `${(avg * 100).toFixed(1)}%`], ['Labor cost', money(last.labour)], ['Source', `${src()}${labor7?.state === 'stale' ? `; 7shifts last updated ${labor7.last}` : ''}`]],
      go: 'labour',
    };
  } else {
    t.labor = { label: 'Labor', fig: last ? `${(last.labourRate * 100).toFixed(1)}%` : null, cmp: 'Comparisons after 4 weeks of data', facts: [['Source', src()]], go: 'labour' };
  }
  t.tonight = sv
    ? {
      label: 'Covers tonight', fig: `${sv.pace >= 0 ? '+' : '−'}${Math.abs(sv.pace)}%`, cmp: `vs a usual ${String(sv.day).split(' ')[0]}`,
      viz: <PaceBars factor={sv.factor} />, claim: 'obs',
      facts: [['Pace so far', `${Math.abs(sv.pace)}% ${sv.pace >= 0 ? 'over' : 'under'} a usual ${String(sv.day).split(' ')[0]}`], ...(sv.tiles || []).map(([k, v, g]) => [k, `${v} (${g})`]), ['Source', src('live')]],
      go: 'service',
    }
    : { ...t.covers };
  return t;
}

export function Tiles({ ids, tiles, onOpen }) {
  return (
    <section className={s.tiles} aria-label="Key numbers">
      {ids.map((id) => {
        const t = tiles[id];
        if (!t) return null;
        return (
          <button key={id} type="button" className={s.tile} onClick={() => onOpen(id)} aria-haspopup="dialog">
            <span className={s.tileLabel}>{t.label}{t.warn && <Icon name="TriangleAlert" size={13} className={s.tileWarnIcon} aria-label="Data behind" />}</span>
            <span className={s.tileFig}>{t.fig ?? <span className={s.tileNone}>—</span>}</span>
            {t.viz && <span className={s.tileViz}>{t.viz}</span>}
            <span className={s.tileCmp}>{t.cmp}{typeof t.warn === 'string' ? ` · ${t.warn}` : ''}</span>
          </button>
        );
      })}
    </section>
  );
}

export function TilePanel({ t, onClose, onGo }) {
  return (
    <Panel label={t.label} onClose={onClose}>
      <PanelTop over="Key number" title={t.label} onClose={onClose} />
      <div className={s.panelBody}>
        <div className={s.panelMoney}>
          <span className={s.panelFig}>{t.fig ?? 'Not available'}</span>
          <span className={s.panelClaim}>{t.claim && <Claim k={t.claim} />}<span>{t.cmp}</span></span>
          {t.viz && <span className={s.tileViz}>{t.viz}</span>}
        </div>
        <dl className={s.facts}>{t.facts.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
        {t.go && <button type="button" className={s.textLink} onClick={() => onGo(t.go)}>See it in full<Icon name="ArrowRight" size={13} /></button>}
      </div>
    </Panel>
  );
}

/* ================================================================ the action */

/** The money on a card: one figure, its unit and how sure. */
export function Worth({ q, cards, big = false }) {
  const w = worthOf(q);
  const un = w.figure ? null : unlocksOf(q, cards);
  if (!w.figure && !un) return null;
  const unit = w.unit || un?.unit;
  return (
    <span className={`${s.worth} ${big ? s.worthBig : ''}`} title={w.means || 'What finishing this unlocks'}>
      <span className={s.worthFig}>
        {un && <span className={s.worthPre}>unlocks </span>}
        {w.about && <span className={s.worthPre}>about </span>}
        {w.figure || un.figure}
        {unit && <span className={s.worthUnit}>{unit.startsWith('/') ? '' : ' '}{unit}</span>}
      </span>
      {big && <Claim k={un ? un.claim : q.claim} />}
    </span>
  );
}

/** The one picture that says why: staffing, hours, data age. Null when there's none worth drawing. */
export function evidenceFor(q, d, sv) {
  const plan = d.room?.labour?.tue;
  if (sv && plan && q.approval && q.approval === sv.approval) {
    const at = /at (\d{1,2}):00/.exec(q.title)?.[1];
    const i = at ? plan.hours.indexOf(`${at} pm`) : -1;
    if (i >= 0) return <People on={plan.sched[i]} need={plan.need[i]} label={`servers at ${at} pm`} />;
  }
  const hrs = /tracking to (\d+) hours/i.exec(q.body || '')?.[1];
  if (hrs) return <HoursBar hours={Number(hrs)} />;
  const stale = /^stale:(.+)$/.exec(q.when || '')?.[1];
  if (stale) {
    const f = d.feeds.find((x) => x.name === stale);
    const days = /(\d+) days ago/.exec(f?.last || '')?.[1];
    if (days) return <AgeBar days={Number(days)} />;
  }
  return null;
}

/** The single action card: icon, title, the picture that says why, the money, one button. */
export function ActionCard({ q, cards, evidence, label, busy, due, onPrimary, onDetails }) {
  return (
    <section id={`card-${q.id}`} className={s.action} aria-labelledby={`a-${q.id}`} aria-busy={busy || undefined}>
      <span className={s.actionIcon} aria-hidden="true"><Icon name={q.icon || 'CircleDot'} size={20} /></span>
      <div className={s.actionMain}>
        {due && <span className={s.actionDue}><Icon name="Clock" size={12} />{due}</span>}
        <h3 id={`a-${q.id}`} className={s.actionTitle}>{q.title}</h3>
        {evidence ? <div className={s.actionViz}>{evidence}</div> : q.body && <p className={s.actionWhy}>{q.body.split(/(?<=\.)\s/)[0]}</p>}
      </div>
      <div className={s.actionSide}>
        <Worth q={q} cards={cards} big />
        <Button size="lg" className={s.actionBtn} disabled={busy} onClick={onPrimary}>{label}</Button>
        <button type="button" className={s.textBtn} onClick={onDetails} aria-haspopup="dialog">Why, and other options</button>
      </div>
    </section>
  );
}

/** A compact row: icon, title, the money; the whole row opens its details. */
export function IssueRow({ q, cards, onOpen }) {
  return (
    <li>
      <button type="button" className={`${s.row} ${q.blocked ? s.rowBlocked : ''}`} onClick={onOpen} aria-haspopup="dialog">
        <span className={s.rowIcon} aria-hidden="true"><Icon name={q.blocked ? 'Lock' : q.icon || 'CircleDot'} size={16} /></span>
        <span className={s.rowTitle}>{q.title}{q.blocked && <span className={s.srOnly}> (waiting on data)</span>}</span>
        <span className={s.rowEnd}>
          <Worth q={q} cards={cards} />
          {q.deadline === 'today' && <span className={s.rowDue}>Today</span>}
          <Icon name="ChevronRight" size={16} className={s.rowChev} />
        </span>
      </button>
    </li>
  );
}

/* ================================================================ savings and progress */

/** Confirmed savings, alone: the only money that passed a test. */
export function Savings({ confirmed, onOpen }) {
  return (
    <button type="button" className={s.savings} onClick={onOpen} aria-haspopup="dialog">
      <Icon name="BadgeCheck" size={16} className={confirmed.week > 0 ? s.savedIcon : s.savedNone} />
      {confirmed.week > 0
        ? <span className={s.savedTxt}><b>{money(confirmed.week)}/wk</b> confirmed savings <span className={s.savedSub}>· {money(confirmed.toDate)} since Jun 22</span></span>
        : <span className={s.savedTxt}>No confirmed savings yet <span className={s.savedSub}>· they show once a change passes its test</span></span>}
      <Icon name="ChevronRight" size={16} className={s.rowChev} />
    </button>
  );
}

const TASK_STATE = {
  open: { icon: 'CircleDashed', label: 'To make' },
  mismatch: { icon: 'MessageSquareWarning', label: 'Marked made; data doesn’t show it yet' },
  done: { icon: 'Hourglass', label: 'Made · checking the data' },
};

/**
 * What's under way, as one line of states with counts. Opens to the list:
 * changes to make, assigned, being measured and decided today.
 */
export function Progress({ cards, view, tasks, windows, d, busy, onUndo, onDone, decided, steps }) {
  const [open, setOpen] = React.useState(false);
  const assigned = cards.filter((c) => cardState(c, view) === 'assigned');
  const live = tasks.filter((t) => TASK_STATE[t.status]);
  const tests = (d.proofs || []).filter((p) => p.outcome === 'testing');
  const extra = windows.filter((w) => !tests.some((p) => p.lever === w.lever));
  const doneToday = Object.keys(view.done).length + Object.keys(view.refused).length + Object.keys(view.snoozed).length;
  const states = [
    { k: 'make', icon: 'CircleDashed', n: live.length, label: 'to make' },
    { k: 'assigned', icon: 'UserCheck', n: assigned.length, label: 'assigned' },
    { k: 'test', icon: 'FlaskConical', n: tests.length + extra.length, label: 'being measured' },
    { k: 'done', icon: 'CircleCheck', n: doneToday, label: 'decided today' },
  ];
  if (!states.some((x) => x.n)) return null;
  return (
    <section className={s.progress} aria-label="In progress">
      <button type="button" className={s.progLine} aria-expanded={open} onClick={() => setOpen(!open)}>
        {states.filter((x) => x.n).map((x) => (
          <span key={x.k} className={s.progState}><Icon name={x.icon} size={14} /><b>{x.n}</b> {x.label}</span>
        ))}
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={15} className={s.rowChev} />
      </button>
      {open && (
        <div className={s.progBody}>
          <ul className={s.handled}>
            {live.map((t) => (
              <li key={t.id}>
                <Icon name={TASK_STATE[t.status].icon} size={15} className={s.hIcon} />
                <span className={s.hText}><span className={s.hTitle}>{t.title}</span><span className={s.hSub}>{t.system} · {TASK_STATE[t.status].label}</span></span>
              </li>
            ))}
            {assigned.map((c) => (
              <li key={c.id}>
                <Icon name="UserCheck" size={15} className={s.hIcon} />
                <span className={s.hText}><span className={s.hTitle}>{c.title}</span><span className={s.hSub}>{assigneeLabel(view.assigned[c.id].to, d.profile)} · not done yet</span></span>
                <span className={s.hActs}>
                  {!c.approval && !c.task && !c.start && !c.blocked && <button type="button" className={s.textBtn} disabled={busy === c.id} onClick={() => onDone(c)}>Done</button>}
                  <button type="button" className={s.textBtn} disabled={busy === c.id} onClick={() => onUndo(c.id)}>Take back</button>
                </span>
              </li>
            ))}
            {tests.map((p) => (
              <li key={p.id}>
                <Icon name="FlaskConical" size={15} className={s.hIcon} />
                <span className={s.hText}><span className={s.hTitle}>{p.title}</span><span className={s.hSub}>{p.checkpoint || 'Measuring'} · result {p.closes}</span></span>
                {typeof p.progress === 'number' && <span className={s.hMeter} aria-label={`${p.progress}% of the test window`}><span style={{ width: `${p.progress}%` }} /></span>}
              </li>
            ))}
            {extra.map((w) => (
              <li key={w.id || w.lever}>
                <Icon name="FlaskConical" size={15} className={s.hIcon} />
                <span className={s.hText}><span className={s.hTitle}>{w.title || w.lever}</span><span className={s.hSub}>{w.status === 'waiting' ? 'Waiting to start' : 'Measuring'}</span></span>
              </li>
            ))}
          </ul>
          {steps}
          {decided}
        </div>
      )}
    </section>
  );
}

/* ================================================================ coming up */

/** A few time markers, only when there's something to prepare for. */
export function Timeline({ d, cards, view, now, todayIso, skip = [], onGo }) {
  const year = todayIso.slice(0, 4);
  const soon = (when) => {
    const t = Date.parse(`${when} ${year} 12:00 UTC`);
    return Number.isNaN(t) || (t - Date.parse(`${todayIso}T12:00:00Z`)) / 864e5 <= 7;
  };
  // Only what needs preparing: tonight's hours that aren't staffed to need, and anything due this week.
  const items = comingUp(d, { cards, view, now, max: 8 }).filter((x) => x.tone !== 'ok' && soon(x.when) && !skip.includes(x.key)).slice(0, 4);
  if (!items.length) return null;
  return (
    <section className={s.timeline} aria-label="Coming up">
      <span className={s.tlHead}>Coming up</span>
      <ol className={s.tlList}>
        {items.map((x) => (
          <li key={x.key}>
            <button type="button" className={s.tlItem} onClick={() => x.go && onGo(x.go)} disabled={!x.go}>
              <span className={s.tlWhen}>{x.when}</span>
              <span className={s.tlWhat}>{/^hour-/.test(x.key) ? x.detail : x.detail === 'Test result due' ? 'Test result' : x.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** One state of the money, item by item, with how each is measured. */
export function ResultsPanel({ which, res, onClose, onGo }) {
  const title = { confirmed: 'Confirmed savings', checking: 'Being checked', could: 'Could save or avoid' }[which];
  return (
    <Panel label={title} onClose={onClose}>
      <div className={s.panelHead}>
        <div className={s.panelHeadText}><span className={s.panelOver}>Your results</span><h2 className={s.panelTitle} tabIndex={-1} data-autofocus>{title}</h2></div>
        <button type="button" className={s.iconBtn} aria-label="Close" onClick={onClose}><Icon name="X" size={18} /></button>
      </div>
      <div className={s.panelBody}>
        {which === 'confirmed' && (
          <>
            <p className={s.blockText}>Savings from changes that passed a test against matched days, counted at the low end of what was measured. Only these can ever be billed.</p>
            {res.confirmed.items.length ? res.confirmed.items.map((p) => (
              <section key={p.id} className={s.block}>
                <h3 className={s.blockTitle}>{p.title}</h3>
                <dl className={s.facts}>
                  <dt>Counted</dt><dd>{money(p.bookable)}/wk{p.paused ? ' · paused' : ''} <Claim k="book" /></dd>
                  <dt>Measured</dt><dd>{money(p.lo)} to {money(p.hi)}/wk</dd>
                  <dt>How</dt><dd>{p.method}</dd>
                  <dt>Since</dt><dd>{p.since}, held {p.held}</dd>
                  <dt>Status</dt><dd>{p.outcome === 'limited' ? 'Confirmed, with limits' : 'Confirmed'} · {p.persist}</dd>
                </dl>
              </section>
            )) : <p className={s.blockText}>None yet. Coversight is measuring outcomes; a result shows here once a change passes its test.</p>}
            {res.confirmed.reversed.length > 0 && <p className={s.blockNote}>Reversed and no longer counted: {res.confirmed.reversed.map((p) => p.title).join('; ')}.</p>}
            <button type="button" className={s.textLink} onClick={() => onGo('ledger')}>The full savings ledger<Icon name="ArrowRight" size={13} /></button>
          </>
        )}
        {which === 'checking' && (
          <>
            <p className={s.blockText}>Changes being measured now. Each has its own range; none is counted as saved until its test passes.</p>
            {res.checking.length ? res.checking.map((p) => (
              <section key={p.id} className={s.block}>
                <h3 className={s.blockTitle}>{p.title}</h3>
                <dl className={s.facts}>
                  <dt>So far</dt><dd>{money(p.lo)} to {money(p.hi)}/wk, most likely {money(p.point)}</dd>
                  <dt>How</dt><dd>{p.method}</dd>
                  <dt>Where</dt><dd>{p.checkpoint || 'Measuring'} · result {p.closes}</dd>
                </dl>
              </section>
            )) : <p className={s.blockText}>Nothing is being measured right now.</p>}
            <button type="button" className={s.textLink} onClick={() => onGo('proof')}>Every test and how it’s judged<Icon name="ArrowRight" size={13} /></button>
          </>
        )}
        {which === 'could' && (
          <>
            <p className={s.blockText}>Open decisions with a dollar figure. Each is a different kind of money, so they’re not added together.</p>
            <ul className={s.couldList}>
              {res.could.map(({ c, w }) => (
                <li key={c.id}>
                  <span className={s.hTitle}>{c.title}</span>
                  <span className={s.couldFig}>{w.about ? 'about ' : ''}{w.figure}{w.unit ? `${w.unit.startsWith('/') ? '' : ' '}${w.unit}` : ''} <Claim k={c.claim} /></span>
                  <span className={s.hSub}>{w.means}</span>
                </li>
              ))}
            </ul>
            {!res.could.length && <p className={s.blockText}>No open decision has a dollar figure.</p>}
          </>
        )}
      </div>
    </Panel>
  );
}

/* ================================================================ locations */

/** Every room the viewer can see, with what needs them; pick one to switch. */
export function Locations({ eng, onPick, today }) {
  const rows = CV_GROUP?.rows || [];
  if (rows.length < 2) return null;
  const tz = 'America/Los_Angeles';
  return (
    <section className={s.locs} aria-labelledby="locs-head">
      <div className={s.sectionHead}>
        <h3 id="locs-head" className={s.sectionTitle}>Your locations</h3>
        <span className={s.sectionSub}>Most to decide first</span>
      </div>
      <ul className={s.locList}>
        {rows.map((r) => {
          const d = deriveRoom(CV_DS, r.id);
          const cards = todayCards(d, { today, testing: [], dismissed: eng.actions?.[r.id]?.findings || {}, tasks: (eng.tasks || []).filter((t) => t.roomId === r.id) });
          const view = queueView(eng.actions?.[r.id]?.queue, { today, own: !!d.room.fromToast, tz: d.room.tz || tz, cards });
          const open = cards.filter((c) => isActive(c, view) && !c.blocked).length;
          return { r, d, open };
        }).sort((a, b) => b.open - a.open).map(({ r, d, open }) => (
          <li key={r.id}>
            <button type="button" className={`${s.loc} ${r.id === CV_D.id ? s.locOn : ''}`} aria-current={r.id === CV_D.id ? 'true' : undefined} onClick={() => onPick(r.id)}>
              <span className={s.locName}>{r.name}</span>
              <span className={s.locFig}>{open}<span className={s.locUnit}> to decide</span></span>
              <span className={s.locSub}>
                {r.stale ? <span className={s.snapWarn}><Icon name="TriangleAlert" size={12} />{r.stale} feed{r.stale === 1 ? '' : 's'} behind</span> : <span>Data current</span>}
                <span>{r.banked ? `${money(r.banked)}/wk confirmed` : 'No confirmed savings yet'}</span>
              </span>
              <span className={s.locNote}>{d.room.service?.title || r.note}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ================================================================ customize */

export function CustomizePanel({ layout, custom, role, onSave, onRestore, onClose }) {
  const [m, setM] = React.useState(layout.metrics);
  const [w, setW] = React.useState(layout.widgets);
  const toggleM = (id) => setM(m.includes(id) ? m.filter((x) => x !== id) : m.length >= MAX_METRICS ? m : [...m, id]);
  const toggleW = (id) => setW(w.includes(id) ? w.filter((x) => x !== id) : [...w, id]);
  return (
    <Panel label="Customize Today" onClose={onClose}>
      <PanelTop over={role === 'gm' ? 'General manager view' : 'Owner view'} title="Customize Today" onClose={onClose} />
      <div className={s.panelBody}>
        <section className={s.block}>
          <h3 className={s.blockTitle}>Key numbers <span className={s.blockCount}>{m.length} of {MAX_METRICS}</span></h3>
          <div className={s.checks}>
            {Object.entries(METRICS).map(([id, label]) => (
              <label key={id} className={s.check}>
                <input type="checkbox" checked={m.includes(id)} disabled={!m.includes(id) && m.length >= MAX_METRICS} onChange={() => toggleM(id)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>
        <section className={s.block}>
          <h3 className={s.blockTitle}>Extras, below everything else</h3>
          <div className={s.checks}>
            {Object.entries(WIDGETS).map(([id, x]) => (
              <label key={id} className={s.check}><input type="checkbox" checked={w.includes(id)} onChange={() => toggleW(id)} /><span>{x.label}</span></label>
            ))}
          </div>
        </section>
        <p className={s.blockNote}>The status, the action and what’s in progress always show. Saved in this browser.</p>
      </div>
      <div className={s.panelFoot}>
        <Button size="lg" className={s.panelPrimary} disabled={!m.length} onClick={() => { onSave({ metrics: m, widgets: w }); onClose(); }}>Save</Button>
        <div className={s.panelMore}>
          <Button size="sm" variant="secondary" disabled={!custom} onClick={() => { onRestore(); onClose(); }}>Restore defaults</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Panel>
  );
}

/* ================================================================ demo scenarios (tools only) */

export function ScenarioBar({ value, onPick, rooms, onRoom }) {
  const sc = SCENARIOS.find((x) => x.id === value);
  return (
    <div className={s.scen} role="group" aria-label="Demo scenario">
      <span className={s.scenLabel}>Demo scenario</span>
      {rooms.map((r) => <button key={r.id} type="button" className={s.filter} aria-pressed={value === 'live' && r.id === CV_D.id} onClick={() => { onPick('live'); onRoom(r.id); }}>{r.name}</button>)}
      {SCENARIOS.filter((x) => x.id !== 'live').map((x) => <button key={x.id} type="button" className={s.filter} aria-pressed={value === x.id} onClick={() => onPick(value === x.id ? 'live' : x.id)}>{x.label}</button>)}
      {sc?.note && <span className={s.scenNote} role="status">{sc.note}</span>}
    </div>
  );
}

export { shortMoney };
