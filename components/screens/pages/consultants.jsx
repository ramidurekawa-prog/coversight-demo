'use client';

import * as React from 'react';
import { Button, Icon } from '../../kit';
import { useEngine, useSaved } from '../../engine';
import { CV_D, CV_GROUP, CV_NOW, CV_ROOM, Claim, Outcome, PageHead, cvMoney, useCv } from '../core';
import { LEVELS, MIN_RATE_N, casebook, consultantSay, endingOf, recordCalls } from '../../../lib/ai/casebook';
import { roomMoves } from '../../../lib/ai/room-moves';
import s from './consultants.module.css';

/* ================================================================ Consultants
   Every lever has a consultant agent. This is where an owner sees how good
   each one is getting: how often its calls held up when they were tested, how
   close its estimates were, what each ending taught it, and how much it may do
   on its own here. The level is earned from evidence (lib/ai/casebook.js) and
   granted by a person: the same `autonomy` key the System page sets, refused
   by the server above what was earned. No agent raises its own level. */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Held / tested as dots: green held up, red broke a guardrail, grey everything else that closed. */
function Dots({ cases }) {
  const closed = cases.filter((c) => endingOf(c.outcome).result);
  if (!closed.length) return null;
  return (
    <span className={s.dots} aria-hidden="true">
      {closed.map((c) => <i key={c.id} className={endingOf(c.outcome).held ? s.held : c.outcome === 'reversed' ? s.broke : s.other} />)}
    </span>
  );
}

function LevelChip({ n, earned }) {
  return <span className={`${s.level} ${n >= 2 ? s.up : ''}`}><b>A{n}</b>{LEVELS[n].name}{earned != null && earned > n ? <span className={s.room}> · can do more</span> : null}</span>;
}

/** The record in one line a person can scan: counts, never a bare percentage until there are enough results. */
function RecordCell({ k }) {
  const r = k.record;
  if (!r.results) return <span className={s.faint}>{r.open ? `${plural(r.open, 'test')} running` : 'No tests yet'}</span>;
  if (!r.reads) return <span className={s.rec}><Dots cases={k.cases} /><span className={s.faint}>{plural(r.results, 'test')} too small to tell</span></span>;
  return (
    <span className={s.rec}>
      <Dots cases={k.cases} />
      <span><b className={r.held ? 'cv-up' : ''}>{r.held}</b> of {plural(r.reads, 'clear result')} held up{r.heldRate != null ? ` (${Math.round(r.heldRate * 100)}%)` : ''}</span>
    </span>
  );
}

function AimCell({ k }) {
  const a = k.record.aim;
  if (!a.n || !Number.isFinite(a.ratio)) return <span className={s.faint}>Nothing measured yet</span>;
  const p = Math.round(a.ratio * 100);
  return <span title={k.aim}><b>{p}%</b> <span className={s.faint}>of estimate, {plural(a.n, 'change')}</span></span>;
}

function Ladder({ k, onSet, canSet }) {
  return (
    <ol className={s.ladder} aria-label={`What ${k.name} may do at ${CV_ROOM.short || CV_ROOM.name}`}>
      {LEVELS.map((L) => {
        const working = L.n === k.working;
        const earned = L.n <= k.earned.level;
        const state = working ? 'Working at' : L.n < k.working ? 'Allowed' : earned ? 'Earned, not switched on' : 'Not earned yet';
        return (
          <li key={L.n} className={`${s.rung} ${working ? s.on : ''} ${earned ? s.earned : s.locked}`}>
            <span className={s.rungMark} aria-hidden="true"><Icon name={earned ? (working ? 'CircleCheck' : 'Check') : 'Lock'} size={14} /></span>
            <span className={s.rungBody}>
              <span className={s.rungHead}><b>A{L.n} {L.name}</b><span className={s.rungState}>{state}</span></span>
              <span className={s.rungMay}>{L.may}</span>
            </span>
            {canSet && earned && !working && L.n > k.working && (
              <Button variant="secondary" size="sm" onClick={() => onSet(L.n)}>Allow</Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Detail({ k, onSet, canSet }) {
  const room = CV_ROOM.short || CV_ROOM.name;
  const learned = [...k.cases].sort((a, b) => Number(endingOf(b.outcome).result) - Number(endingOf(a.outcome).result));
  return (
    <div className={s.detail}>
      <section className={s.learned} aria-label={`What ${k.name} learned`}>
        <h4 className={s.h}>What it learned</h4>
        {k.aim && <p className={s.aim}><Icon name="Target" size={15} />{k.aim}</p>}
        {learned.length ? (
          <ul className={s.cases}>
            {learned.map((c) => (
              <li key={c.id} className={s.case}>
                <div className={s.caseTop}>
                  <span className={s.caseTitle}>{c.title}</span>
                  <Outcome k={c.outcome} />
                </div>
                <p className={s.lesson}>{c.lesson}</p>
                <p className={s.caseMeta}>
                  {c.roomName}
                  {c.est != null && <> · estimated {cvMoney(c.est)}/wk <Claim k="est" /></>}
                  {c.point != null && endingOf(c.outcome).result && !endingOf(c.outcome).noRead && <> · measured {cvMoney(c.point)}/wk</>}
                  {endingOf(c.outcome).held && c.bookable > 0 && <> · <span className="cv-up">{cvMoney(c.bookable)}/wk</span> <Claim k="book" /></>}
                </p>
              </li>
            ))}
          </ul>
        ) : <p className={s.faint}>No calls have gone to a test yet. It learns from the first result.</p>}
      </section>
      <section className={s.authority} aria-label={`What ${k.name} may do`}>
        <h4 className={s.h}>What it may do at {room}</h4>
        {k.earned.capped && (
          <p className={s.capped} role="note"><Icon name="TriangleAlert" size={15} />Dropped back to Recommends: {k.earned.capped.why}.</p>
        )}
        <Ladder k={k} onSet={onSet} canSet={canSet} />
        {k.earned.next && k.earned.next.needs.length > 0 && (
          <div className={s.next}>
            <span className={s.nextHead}>To earn A{k.earned.next.level} {LEVELS[k.earned.next.level].name}</span>
            <ul>{k.earned.next.needs.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}
        {k.working > 0 && canSet && (
          <Button variant="ghost" size="sm" icon="ArrowDown" onClick={() => onSet(k.working - 1)}>Use less: {LEVELS[k.working - 1].name}</Button>
        )}
        <p className={s.fine}>Today every level ends at a person: Coversight can’t write to Toast or 7shifts yet, so an allowed change still arrives as a task to approve. Money, staff and suppliers always wait for you.</p>
      </section>
    </div>
  );
}

function CvConsultants() {
  const cv = useCv();
  const eng = useEngine();
  const saved = eng.actions?.[CV_D.id] || {};
  const seeded = Object.fromEntries(Object.entries(CV_D.room.autonomy || {}).map(([k, [now]]) => [k, now]));
  const [levels, saveLevels] = useSaved('autonomy', seeded);
  const [calls, saveCalls] = useSaved('sous.calls', []);
  const own = eng.mode === 'server' && eng.org && !eng.org.sample;
  const role = eng.mode === 'server' ? eng.viewer?.role : 'owner';
  const canSet = !role || ['owner', 'admin', 'gm'].includes(role);
  const rooms = React.useMemo(() => Object.fromEntries((CV_GROUP.rows || []).map((r) => [r.id, r.name])), [eng.version]);

  // What is on offer now is what the consultants are saying now: log each call once, with what it estimated then.
  const moves = React.useMemo(() => roomMoves(CV_D, saved, { windows: eng.windows || [], tasks: eng.tasks || [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eng.version, eng.room, eng.actions, eng.windows, eng.tasks]);
  React.useEffect(() => {
    const next = recordCalls(calls, moves);
    if (next !== calls) saveCalls(next, `Logged ${plural(next.length - (calls?.length || 0), 'consultant call')}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves]);

  const book = React.useMemo(() => casebook(CV_D, {
    windows: own ? eng.windows || [] : undefined, rooms, today: own ? undefined : CV_NOW.iso,
    calls, acts: saved['sous.learn'] || [], mem: saved.sous || {}, offered: moves, levels: { ...seeded, ...(levels || {}) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [own, eng.windows, rooms, calls, saved, moves, levels]);

  const withRecord = book.consultants.filter((k) => k.record.calls);
  const [open, setOpen] = React.useState(/** @type {string | null} */ (withRecord[0]?.page || null));
  const r = book.record;
  const room = CV_ROOM.short || CV_ROOM.name;
  const setLevel = (k, n) => saveLevels((cur) => ({ ...seeded, ...(cur || {}), [k.lever]: n }), `${k.name} at ${room}: ${LEVELS[n].name}`);
  const best = [...book.consultants].sort((a, b) => b.record.held - a.record.held || b.record.week - a.record.week)[0];

  const q = r.results
    ? `${r.held} of ${plural(r.reads, 'clear result')} held up. Every one taught your consultants something.`
    : 'Your consultants learn from every result. None has come in yet.';

  return (
    <div className="cv-page wide">
      <PageHead over="Proof" q={q}
        sub="Every lever has a consultant. Each keeps a casebook of every call it made and how it ended, and learns from it: how often it is right, how close its estimates are, and how much it may do on its own. Nothing here counts as saved until a test verifies it." />

      <div className={s.strip} role="list" aria-label="Every call on record">
        <div role="listitem"><span className={s.n}>{r.calls}</span><span className={s.k}>Calls tested</span></div>
        <div role="listitem"><span className={`${s.n} cv-up`}>{r.held}</span><span className={s.k}>Held up</span></div>
        <div role="listitem"><span className={s.n}>{r.reads - r.held - r.reversed}</span><span className={s.k}>Right way, not proven</span></div>
        <div role="listitem"><span className={`${s.n} ${r.reversed ? 'cv-down' : ''}`}>{r.reversed}</span><span className={s.k}>Broke a guardrail</span></div>
        <div role="listitem"><span className={s.n}>{r.noRead}</span><span className={s.k}>Too small to tell</span></div>
        <div role="listitem"><span className={s.n}>{r.open}</span><span className={s.k}>Still open</span></div>
      </div>
      {best?.record.held > 0 && (
        <p className={s.lead}><Icon name="GraduationCap" size={16} /><span><b>{best.name}</b> is your strongest consultant: {consultantSay(best).charAt(0).toLowerCase()}{consultantSay(best).slice(1)}</span>{best.record.week > 0 && <Claim k="book" />}</p>
      )}

      <section className={`cv-card flush ${s.table}`} aria-label={`Consultants at ${room}`}>
        <div className={s.thead} aria-hidden="true">
          <span>Consultant</span><span>Record, your rooms</span><span>Estimates</span><span>At {room}</span><span />
        </div>
        {book.consultants.map((k) => {
          const isOpen = open === k.page;
          return (
            <div key={k.page} className={`${s.row} ${isOpen ? s.open : ''}`}>
              <button type="button" className={s.summary} aria-expanded={isOpen} aria-controls={`cb-${k.page}`} onClick={() => setOpen(isOpen ? null : k.page)}>
                <span className={s.who}><b>{k.name}</b><span className={s.faint}>{k.area}</span></span>
                <span className={s.cell}><span className={s.cellK}>Record</span><RecordCell k={k} /></span>
                <span className={s.cell}><span className={s.cellK}>Estimates</span><AimCell k={k} /></span>
                <span className={s.cell}><span className={s.cellK}>At {room}</span><LevelChip n={k.working} earned={k.earned.level} /></span>
                <Icon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size={16} />
              </button>
              {isOpen && <div id={`cb-${k.page}`}><Detail k={k} canSet={canSet} onSet={(n) => setLevel(k, n)} /></div>}
            </div>
          );
        })}
      </section>

      <div className={s.honest}>
        <section className="cv-card">
          <h4 className={s.h}><Icon name="Network" size={16} />Where they learn from</h4>
          <p className={s.p}><b className="cv-up">Your {plural(Object.keys(rooms).length || 1, 'room')}: on.</b> A change that holds up at one of your rooms makes the consultant more confident at the others, and one that breaks a guardrail makes it more careful everywhere.</p>
          <p className={s.p}><b>Restaurants like yours: not yet.</b> That needs {book.network.need.locations} comparable restaurants from at least {book.network.need.groups} groups ({book.network.locations} so far). Until then no consultant borrows anyone else’s numbers.</p>
        </section>
        <section className="cv-card">
          <h4 className={s.h}><Icon name="Scale" size={16} />Is the learning paying off?</h4>
          <p className={s.p}>We compare calls ranked with what the consultants learned against plain rules, on results that come in after learning was switched on. That needs {book.lift.need} results; there {book.lift.results === 1 ? 'is' : 'are'} {book.lift.results} so far.</p>
          <p className={s.p}>Until then nobody can say these consultants beat plain rules or a person, and we don’t. Rates show as counts until a consultant has {MIN_RATE_N} results.</p>
        </section>
      </div>
      <p className={s.fine}>Consultants never raise their own level, start a test, change a price or a schedule, or count a saving. A guardrail breach drops a consultant back to Recommends in that room for 90 days. <button type="button" className={s.link} onClick={() => cv.go('system')}>See every agent’s permissions</button></p>
    </div>
  );
}

export { CvConsultants };
