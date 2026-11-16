'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { assigneeLabel, cardState, isActive, queueView, todayCards, worthOf, unlocksOf } from '../../../lib/data/page/today';
import { AREAS, areaOf, comingUp, results as resultsOf } from '../../../lib/data/page/today-brief';
import { CV_D, CV_DS, CV_GROUP, Claim, cvMoney } from '../core';
import { deriveRoom } from '../../../lib/data/model';
import { Panel } from './today.review';
import { dayLabel, shortMoney } from './today.last';
import { MAX_METRICS, METRICS, SCENARIOS, WIDGETS } from './today.layout';
import s from './today.module.css';

const money = (v) => cvMoney(Math.round(v));
const pts = (v) => `${Math.abs(v * 100).toFixed(1)} pts`;
const signPct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/* ================================================================ briefing */

/** How the room is doing, in one headline and one line; missing data said out loud. */
export function Briefing({ brief, added, onFeeds }) {
  return (
    <section className={s.brief} aria-labelledby="brief-head" data-tone={brief.tone}>
      <h2 id="brief-head" className={s.briefHead}>{brief.headline}</h2>
      <p className={s.briefLine}>{brief.line}{added > 0 ? ` ${added === 1 ? 'One is' : `${added} are`} new since this morning.` : ''}</p>
      {brief.warn.length > 0 && (
        <div className={s.warnRow} role="status">
          <Icon name="TriangleAlert" size={15} className={s.warnIcon} />
          <span>
            {brief.warn.map((f, i) => (
              <span key={f.name}>{i ? ' ' : ''}<b>{f.name}</b>{f.last === 'not updating' ? ' isn’t updating' : ` last updated ${f.last}`}. {f.what}.</span>
            ))}
          </span>
          <button type="button" className={s.textLink} onClick={onFeeds}>Check data sources<Icon name="ArrowRight" size={13} /></button>
        </div>
      )}
    </section>
  );
}

/* ================================================================ snapshot */

/**
 * The snapshot's tiles, every one with what it's compared against. A tile
 * with no basis says so instead of showing a zero.
 */
export function snapshotTiles({ d, dense, sum, sv, flags, res }) {
  const rows = d.hist?.rows || [];
  const last = rows.at(-1);
  const before = rows.slice(-5, -1);
  const day = dense?.days?.at(-1);
  const same = day ? dense.days.filter((x) => x.dow === day.dow).slice(-8, -1) : [];
  const labor7 = d.feeds.find((f) => f.name === '7shifts');
  const t = {};
  t.tonight = sv
    ? { fig: `${Math.abs(sv.pace)}% ${sv.pace >= 0 ? 'over' : 'under'}`, sub: `a usual ${String(sv.day).split(' ')[0]}, so far tonight`, claim: 'obs', go: 'service' }
    : { fig: null, sub: 'No service running now', go: 'service' };
  if (day && same.length >= 3 && !flags.noHistory) {
    const avg = mean(same.map((x) => x.net));
    t.sales = { label: `Sales, ${day.dow} ${dayLabel(day.iso)}`, fig: money(day.net), sub: `${signPct((day.net - avg) / avg)} vs the ${same.length} ${day.dow}s before`, claim: 'obs', go: 'daily' };
    const cavg = mean(same.map((x) => x.covers));
    t.covers = { label: `Covers, ${day.dow} ${dayLabel(day.iso)}`, fig: String(day.covers), sub: `${signPct((day.covers - cavg) / cavg)} vs the ${same.length} ${day.dow}s before`, claim: 'obs', go: 'daily' };
  } else if (last && before.length >= 4 && !flags.noHistory) {
    const avg = mean(before.map((r) => r.net));
    t.sales = { label: 'Sales, last week', fig: money(last.net), sub: `${signPct((last.net - avg) / avg)} vs the 4 weeks before`, claim: 'obs', go: 'trends' };
    t.covers = { label: 'Covers, last week', fig: String(last.covers), sub: `${signPct((last.covers - mean(before.map((r) => r.covers))) / mean(before.map((r) => r.covers)))} vs the 4 weeks before`, claim: 'obs', go: 'trends' };
  } else {
    t.sales = { label: 'Sales, last week', fig: last ? money(last.net) : null, sub: 'Comparisons start after 4 weeks of data', go: 'trends' };
    t.covers = { label: 'Covers, last week', fig: last ? String(last.covers) : null, sub: 'Comparisons start after 4 weeks of data', go: 'trends' };
  }
  if (flags.laborDown) {
    t.labor = { fig: null, sub: '7shifts isn’t updating. Labor shows again when it does.', warn: true, go: 'sources' };
  } else if (last && before.length >= 4 && !flags.noHistory) {
    const diff = last.labourRate - mean(before.map((r) => r.labourRate));
    t.labor = {
      label: 'Labor, last week', fig: `${(last.labourRate * 100).toFixed(1)}%`,
      sub: Math.abs(diff) < 0.0005 ? 'Same as the 4 weeks before' : `${pts(diff)} ${diff > 0 ? 'above' : 'below'} the 4 weeks before`,
      claim: 'obs', go: 'labour', warn: labor7?.state === 'stale' ? `7shifts ${labor7.last} behind`.replace(' ago behind', ' behind') : null,
    };
  } else {
    t.labor = { label: 'Labor, last week', fig: last ? `${(last.labourRate * 100).toFixed(1)}%` : null, sub: 'Comparisons start after 4 weeks of data', go: 'labour' };
  }
  t.confirmed = res.confirmed.week > 0
    ? { fig: money(res.confirmed.week), unit: '/wk', sub: `${money(res.confirmed.toDate)} since Jun 22`, claim: 'book', go: 'ledger' }
    : { fig: 'None yet', sub: res.checking.length ? `${res.checking.length} test${res.checking.length === 1 ? '' : 's'} still measuring` : 'Shows once a change passes its test', go: 'proof' };
  t.decisions = { fig: String(sum.ready), sub: sum.ready ? `about ${sum.minsLeft} min of your time` : sum.blocked ? `${sum.blocked} waiting on data` : 'All clear', go: null };
  return t;
}

export function Snapshot({ ids, tiles, onGo }) {
  return (
    <section className={s.snap} aria-label="Quick numbers" style={{ '--n': ids.filter((id) => tiles[id]).length }}>
      {ids.map((id) => {
        const t = tiles[id];
        if (!t) return null;
        const body = (
          <>
            <span className={s.snapLabel}>{t.label || METRICS[id]}</span>
            <span className={s.snapFig}>{t.fig ?? <span className={s.snapNone}>Not available</span>}{t.unit && <span className={s.snapUnit}>{t.unit}</span>}</span>
            <span className={s.snapSub}>{t.sub}</span>
            {(t.warn || t.claim) && (
              <span className={s.snapFoot}>
                {typeof t.warn === 'string' && <span className={s.snapWarn}><Icon name="TriangleAlert" size={12} />{t.warn}</span>}
                {t.claim && !t.warn && <Claim k={t.claim} />}
              </span>
            )}
          </>
        );
        return t.go
          ? <button key={id} type="button" className={s.snapTile} onClick={() => onGo(t.go)}>{body}</button>
          : <div key={id} className={s.snapTile}>{body}</div>;
      })}
    </section>
  );
}

/* ================================================================ needs your attention */

/** What the card is worth, in a fixed slot: one figure, its unit and how sure. */
export function Worth({ q, cards, big = false }) {
  const w = worthOf(q);
  const un = w.figure ? null : unlocksOf(q, cards);
  if (!w.figure && !un) return <span className={s.worthNone}>{q.value || 'No $ figure'}</span>;
  const unit = w.unit || un?.unit;
  return (
    <span className={`${s.worthSlot} ${big ? s.worthBigSlot : ''}`} title={w.means || 'What finishing this unlocks'}>
      {big && <span className={s.worthLabel}>{un ? 'Unlocks' : w.means}</span>}
      <span className={s.worthFig}>
        {!big && un && <span className={s.worthPre}>Unlocks </span>}
        {w.about && <span className={s.worthPre}>about </span>}
        {w.figure || un.figure}
        {unit && <span className={s.worthUnit}>{unit.startsWith('/') ? '' : ' '}{unit}</span>}
      </span>
      <Claim k={un ? un.claim : q.claim} />
    </span>
  );
}

const dueText = (q) => (q.deadline === 'today' ? 'Today' : q.deadline ? q.deadline[0].toUpperCase() + q.deadline.slice(1) : null);

/**
 * One issue: what's happening, why it matters, what we suggest, what it's
 * worth, when, and who. The lead card gets the page's one filled button.
 */
export function IssueCard({ q, cards, lead, n, label, busy, isNew, onPrimary, onReview }) {
  const due = dueText(q);
  return (
    <li id={`card-${q.id}`} className={`${s.issue} ${lead ? s.issueLead : ''} ${q.blocked ? s.issueBlocked : ''}`} aria-busy={busy || undefined}>
      <div className={s.issueMeta}>
        {lead && <span className={s.issueRank}>First{n > 1 ? ` of ${n}` : ''}</span>}
        <span className={s.issueArea}>{AREAS[areaOf(q)]}</span>
        {due && <span className={q.deadline === 'today' ? s.dueToday : s.due}>{due === 'Today' ? 'Due today' : due}</span>}
        {q.approval && <span className={s.tag}>Needs approval</span>}
        {isNew && <span className={s.tag}>New</span>}
      </div>
      <div className={s.issueGrid}>
        <div className={s.issueText}>
          <h4 className={s.issueTitle}>{q.blocked && <Icon name="Lock" size={14} className={s.lock} />}{q.title}</h4>
          <p className={s.issueBody}>{q.blocked ? `Waiting on data. ${q.blocked}` : q.body}</p>
          <span className={s.issueWho}><Icon name="Users" size={13} />{q.approval ? 'You or the GM can approve' : 'Yours to decide'} · {q.effort?.manager ?? q.mins} min</span>
        </div>
        <div className={s.issueSide}>
          <Worth q={q} cards={cards} big={lead} />
          <div className={s.issueActs}>
            <Button size={lead ? 'md' : 'sm'} variant={lead ? 'primary' : 'secondary'} className={s.issueBtn} disabled={busy} onClick={onPrimary}>{label}</Button>
            <button type="button" className={s.textBtn} onClick={onReview} aria-haspopup="dialog">See why</button>
          </div>
        </div>
      </div>
    </li>
  );
}

/** The rest of the list, filtered by area. */
export function MoreIssues({ rest, waiting, renderCard }) {
  const [open, setOpen] = React.useState(false);
  const [area, setArea] = React.useState('all');
  const all = [...rest, ...waiting];
  if (!all.length) return null;
  const areas = [...new Set(all.map(areaOf))];
  const shown = area === 'all' ? all : all.filter((q) => areaOf(q) === area);
  return (
    <div className={s.more}>
      <button type="button" className={s.moreBtn} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Show fewer' : `${all.length} more${waiting.length ? `, ${waiting.length} waiting on data` : ''}`}
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
      </button>
      {open && (
        <>
          {areas.length > 1 && (
            <div className={s.filters} role="group" aria-label="Filter by area">
              {['all', ...areas].map((a) => (
                <button key={a} type="button" className={s.filter} aria-pressed={area === a} onClick={() => setArea(a)}>
                  {a === 'all' ? `All ${all.length}` : `${AREAS[a]} ${all.filter((q) => areaOf(q) === a).length}`}
                </button>
              ))}
            </div>
          )}
          <ul className={s.issues}>{shown.map((q) => renderCard(q))}</ul>
        </>
      )}
    </div>
  );
}

/* ================================================================ side sections */

function Side({ id, title, sub, children, action }) {
  return (
    <section className={s.side} aria-labelledby={`${id}-head`} data-w={id}>
      <div className={s.sideHead}>
        <h3 id={`${id}-head`} className={s.sideTitle}>{title}</h3>
        {sub && <span className={s.sideSub}>{sub}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

export function ComingUp({ d, cards, view, now, onGo }) {
  const items = comingUp(d, { cards, view, now });
  return (
    <Side id="coming" title="Coming up" sub={items.length ? null : 'Nothing to prepare for'}>
      {items.length > 0 && (
        <ul className={s.timeline}>
          {items.map((x) => (
            <li key={x.key} className={s[`tl_${x.tone}`]}>
              <span className={s.tlWhen}>{x.when}</span>
              <span className={s.tlText}>
                <span className={s.tlTitle}>{x.title}</span>
                <span className={s.tlSub}>{x.detail}</span>
              </span>
              {x.go && <button type="button" className={s.iconBtn} aria-label={`Open: ${x.title}`} onClick={() => onGo(x.go)}><Icon name="ArrowRight" size={15} /></button>}
            </li>
          ))}
        </ul>
      )}
    </Side>
  );
}

const TASK_STATE = {
  open: { icon: 'CircleDashed', label: 'To make' },
  mismatch: { icon: 'MessageSquareWarning', label: 'Marked made; data doesn’t show it yet' },
  done: { icon: 'Hourglass', label: 'Made · checking the data' },
};

/** In progress, assigned, and being measured: who has it and where it stands. */
export function BeingHandled({ cards, view, tasks, windows, d, busy, onUndo, onDone, onSteps, stepsOpen }) {
  const assigned = cards.filter((c) => cardState(c, view) === 'assigned');
  const live = tasks.filter((t) => TASK_STATE[t.status]);
  const tests = (d.proofs || []).filter((p) => p.outcome === 'testing');
  const extra = windows.filter((w) => !tests.some((p) => p.lever === w.lever));
  const n = assigned.length + live.length + tests.length + extra.length;
  const parts = [[live.length, 'to make'], [assigned.length, 'assigned'], [tests.length + extra.length, 'being measured']].filter(([k]) => k).map(([k, l]) => `${k} ${l}`);
  return (
    <Side id="handled" title="Being handled" sub={n ? parts.join(' · ') : 'Nothing in progress'}>
      {n > 0 && (
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
              <span className={s.hText}>
                <span className={s.hTitle}>{c.title}</span>
                <span className={s.hSub}>Assigned to {assigneeLabel(view.assigned[c.id].to, d.profile)} · not done yet</span>
              </span>
              <span className={s.hActs}>
                {!c.approval && !c.task && !c.start && !c.blocked && <button type="button" className={s.textBtn} disabled={busy === c.id} onClick={() => onDone(c)}>Done</button>}
                <button type="button" className={s.textBtn} disabled={busy === c.id} onClick={() => onUndo(c.id)}>Take back</button>
              </span>
            </li>
          ))}
          {tests.map((p) => (
            <li key={p.id}>
              <Icon name="FlaskConical" size={15} className={s.hIcon} />
              <span className={s.hText}><span className={s.hTitle}>{p.title}</span><span className={s.hSub}>Test · {p.checkpoint || 'measuring'} · result {p.closes}</span></span>
            </li>
          ))}
          {extra.map((w) => (
            <li key={w.id || w.lever}>
              <Icon name="FlaskConical" size={15} className={s.hIcon} />
              <span className={s.hText}><span className={s.hTitle}>{w.title || w.lever}</span><span className={s.hSub}>Test · {w.status === 'waiting' ? 'waiting to start' : 'measuring'}</span></span>
            </li>
          ))}
        </ul>
      )}
      {live.length > 0 && <button type="button" className={s.textLink} aria-expanded={stepsOpen} onClick={onSteps}>{stepsOpen ? 'Hide the steps' : 'Open the steps'}<Icon name={stepsOpen ? 'ChevronUp' : 'ChevronDown'} size={13} /></button>}
    </Side>
  );
}

/** The money in its three states, side by side and never added up. */
export function Results({ res, onOpen }) {
  const { could, checking, confirmed } = res;
  return (
    <Side id="results" title="Your results" sub="Kept apart, never added up">
      <div className={s.res}>
        <button type="button" className={s.resRow} onClick={() => onOpen('confirmed')}>
          <span className={s.resLabel}>Confirmed savings</span>
          <span className={s.resFig}>{confirmed.week > 0 ? <>{money(confirmed.week)}<span className={s.worthUnit}>/wk</span></> : 'None yet'}</span>
          <span className={s.resSub}>{confirmed.week > 0 ? `${money(confirmed.toDate)} since Jun 22, passed their tests` : 'Shows once a change passes its test. That’s normal early on.'}</span>
          {confirmed.week > 0 && <Claim k="book" />}
        </button>
        <button type="button" className={s.resRow} onClick={() => onOpen('checking')}>
          <span className={s.resLabel}>Being checked</span>
          <span className={s.resFig}>{checking.length ? `${checking.length} test${checking.length === 1 ? '' : 's'}` : 'None'}</span>
          <span className={s.resSub}>{checking.length ? `Next result ${checking.map((p) => p.closes).filter(Boolean).sort((a, b) => Date.parse(`${a} 2026`) - Date.parse(`${b} 2026`))[0] || 'soon'}. Nothing counts until it passes.` : 'No change is being measured now.'}</span>
        </button>
        <button type="button" className={s.resRow} onClick={() => onOpen('could')}>
          <span className={s.resLabel}>Could save or avoid</span>
          <span className={s.resFig}>{could.length ? `${could.length} open` : 'None open'}</span>
          <span className={s.resSub}>{could.length ? `Largest: ${could[0].w.figure}${could[0].w.unit ? `${could[0].w.unit.startsWith('/') ? '' : ' '}${could[0].w.unit}` : ''}. Estimates until tested.` : 'No open decision has a dollar figure.'}</span>
        </button>
      </div>
    </Side>
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
  const move = (id, by) => {
    const i = w.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= w.length) return;
    const n = [...w]; [n[i], n[j]] = [n[j], n[i]]; setW(n);
  };
  return (
    <Panel label="Customize Today" onClose={onClose}>
      <div className={s.panelHead}>
        <div className={s.panelHeadText}><span className={s.panelOver}>{role === 'gm' ? 'General manager view' : 'Owner view'}</span><h2 className={s.panelTitle} tabIndex={-1} data-autofocus>Customize Today</h2></div>
        <button type="button" className={s.iconBtn} aria-label="Close" onClick={onClose}><Icon name="X" size={18} /></button>
      </div>
      <div className={s.panelBody}>
        <p className={s.blockText}>The briefing, data warnings and Needs your attention always show. Saved in this browser.</p>
        <section className={s.block}>
          <h3 className={s.blockTitle}>Quick numbers <span className={s.blockCount}>{m.length} of {MAX_METRICS}</span></h3>
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
          <h3 className={s.blockTitle}>Sections</h3>
          <ul className={s.order}>
            {[...w, ...Object.keys(WIDGETS).filter((id) => !w.includes(id))].map((id) => {
              const on = w.includes(id);
              return (
                <li key={id}>
                  <label className={s.check}><input type="checkbox" checked={on} onChange={() => toggleW(id)} /><span>{WIDGETS[id].label}</span></label>
                  {on && (
                    <span className={s.orderBtns}>
                      <button type="button" className={s.iconBtn} aria-label={`Move ${WIDGETS[id].label} up`} disabled={w.indexOf(id) === 0} onClick={() => move(id, -1)}><Icon name="ArrowUp" size={15} /></button>
                      <button type="button" className={s.iconBtn} aria-label={`Move ${WIDGETS[id].label} down`} disabled={w.indexOf(id) === w.length - 1} onClick={() => move(id, 1)}><Icon name="ArrowDown" size={15} /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <div className={s.panelFoot}>
        <Button size="lg" className={s.panelPrimary} onClick={() => { onSave({ metrics: m, widgets: w }); onClose(); }}>Save layout</Button>
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
