'use client';

import * as React from 'react';
import { Icon } from '../../kit';
import { useBrain } from '../brain';
import { CV_D, CV_GROUP, CV_ROOM, Claim, Outcome, PageHead, useCv } from '../core';
import { MISE, mise } from '../../../lib/ai/mise';
import s from './mise.module.css';

/* ================================================================ Mise
   The restaurant's brain (lib/ai/mise.js). One page for what Coversight
   understands about this restaurant at every level, every decision before,
   during and after, and the data that would teach it most. Signed in with the
   AI engine on, Mise's read on each level comes from the brain model and has
   passed the figure check; otherwise the built-in words stand. */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TONE = { good: 'cv-up', bad: 'cv-down', warn: s.warn, info: '' };

function Level({ l, read }) {
  const [all, setAll] = React.useState(false);
  const known = all ? l.known : l.known.slice(0, 3);
  return (
    <section className={`cv-card ${s.level}`} aria-label={l.name}>
      <header className={s.levelHead}>
        <span className={s.levelIcon} aria-hidden="true"><Icon name={l.icon} size={16} /></span>
        <span className={s.levelName}>{l.name}</span>
        <span className={s.count}>{l.known.length} known{l.gaps.length ? ` · ${l.gaps.length} to learn` : ''}</span>
      </header>
      {read && <p className={s.read}><Icon name="Brain" size={14} />{read}</p>}
      {l.known.length ? (
        <ul className={s.known}>
          {known.map((k) => (
            <li key={k.text}>
              <span>{k.text}</span>
              <span className={s.src}>{k.source}{k.claim ? <> · <Claim k={k.claim} /></> : null}</span>
            </li>
          ))}
        </ul>
      ) : <p className={s.faint}>Nothing here yet.</p>}
      {l.known.length > 3 && <button type="button" className={s.more} onClick={() => setAll(!all)} aria-expanded={all}>{all ? 'Show less' : `Show all ${l.known.length}`}</button>}
      {l.gaps.length > 0 && (
        <div className={s.gaps}>
          <span className={s.gapsHead}><Icon name="Lock" size={13} />Not known yet</span>
          <ul>{l.gaps.slice(0, 2).map((g) => <li key={g.need}>{g.need}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function Before({ b, open }) {
  return (
    <details className={s.ticket} open={open}>
      <summary>
        <span className={s.who}>{b.who}</span>
        <span className={s.what}>{b.what}</span>
        {b.worth && <span className={s.worth}><b>{b.worth.value}</b> <span className={s.faint}>{b.worth.unit}</span> <Claim k={b.worth.claim} /></span>}
      </summary>
      <dl className={s.brief}>
        {b.why && <><dt>Why</dt><dd>{b.why}</dd></>}
        <dt>How</dt>
        <dd><ol className={s.steps}>{b.how.map((h) => <li key={h}>{h}</li>)}</ol></dd>
        {b.aim && <><dt>Its record</dt><dd>{b.aim.text}{b.aim.claim && <> <Claim k={b.aim.claim} /></>}</dd></>}
        {b.risks.length > 0 && <><dt>Watch for</dt><dd>{b.risks.map((r) => <p key={r} className={s.risk}>{r}</p>)}</dd></>}
        <dt>Who does it</dt><dd><span className={s.lvl}>A{b.level.n} {b.level.name}</span> {b.level.does}</dd>
        {b.measure && <><dt>How we’ll know</dt><dd>{b.measure}</dd></>}
      </dl>
    </details>
  );
}

function During({ c }) {
  return (
    <article className={s.ticket}>
      <span className={s.who}>{c.who}</span>
      <span className={s.what}>{c.title}</span>
      {Number.isFinite(c.progress) && (
        <span className={s.bar} role="progressbar" aria-valuenow={c.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.title}: ${c.progress}% through the test`}><i style={{ width: `${Math.max(4, c.progress)}%` }} /></span>
      )}
      <p className={`${s.line} ${TONE[c.read.tone] || ''}`}>{c.read.text}</p>
      {(c.checkpoint || c.closes) && <p className={s.faint}>{[c.checkpoint, c.closes && `closes ${c.closes}`].filter(Boolean).join(' · ')}</p>}
    </article>
  );
}

function After({ c }) {
  return (
    <article className={s.ticket}>
      <span className={s.who}>{c.who}</span>
      <span className={s.whatRow}><span className={s.what}>{c.title}</span><Outcome k={c.outcome} /></span>
      <p className={s.line}>{c.read.text}</p>
      <p className={s.lesson}><Icon name="GraduationCap" size={14} />{c.read.lesson}</p>
    </article>
  );
}

function CvMise() {
  const cv = useCv();
  const { eng, saved, moves, book } = useBrain();
  const [reads, setReads] = React.useState(/** @type {{ engine: string, model: string, reads: { levels: Record<string, string>, consultants: Record<string, string> } } | null} */ (null));
  React.useEffect(() => {
    setReads(null);
    if (eng.mode !== 'server') return;
    let live = true;
    fetch(`/api/mise?room=${encodeURIComponent(CV_D.id)}`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((b) => { if (live && b) setReads(b); }).catch(() => {});
    return () => { live = false; };
  }, [eng.mode, eng.room]);

  const m = React.useMemo(() => mise(CV_D, { book, moves, group: CV_GROUP, tasks: (eng.tasks || []).filter((t) => t.roomId === CV_D.id), notes: saved['sous.notes'] || [], mem: saved.sous || {} }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, moves, eng.tasks, saved]);
  const u = m.understanding;
  const room = CV_ROOM.short || CV_ROOM.name;
  const ai = reads?.engine === 'ai';

  return (
    <div className="cv-page wide">
      <PageHead over={`${MISE.name} · ${MISE.what}`}
        q={`Mise knows ${plural(u.known, 'thing')} about ${room}, and learns from every decision.`}
        sub="Everything Coversight understands about your restaurant, at every level, and every decision before, during and after. Every consultant and every answer reads from it. It never acts on its own." />

      <div className={s.levels}>
        {u.levels.map((l) => <Level key={l.id} l={l} read={reads?.reads?.levels?.[l.id]} />)}
      </div>

      <section aria-labelledby="mise-loop">
        <h3 id="mise-loop" className={s.h3}>Every decision, before, during and after</h3>
        <div className={s.loop}>
          <div className={s.lane}>
            <h4 className={s.laneHead}><Icon name="Lightbulb" size={15} />Before <span className={s.faint}>what to do now, how and why</span></h4>
            {m.loop.before.length ? m.loop.before.map((b, i) => <Before key={b.id} b={b} open={i === 0} />) : <p className={s.faint}>Nothing to decide right now.</p>}
          </div>
          <div className={s.lane}>
            <h4 className={s.laneHead}><Icon name="Timer" size={15} />During <span className={s.faint}>tests running here</span></h4>
            {m.loop.during.length ? m.loop.during.map((c) => <During key={c.id} c={c} />) : <p className={s.faint}>No test running here.</p>}
          </div>
          <div className={s.lane}>
            <h4 className={s.laneHead}><Icon name="GraduationCap" size={15} />After <span className={s.faint}>what the results taught</span></h4>
            {m.loop.after.length ? m.loop.after.map((c) => <After key={c.id} c={c} />) : <p className={s.faint}>No results here yet.</p>}
          </div>
        </div>
      </section>

      <section className="cv-card" aria-labelledby="mise-smarter">
        <h3 id="mise-smarter" className={s.h3}>What would make Mise smarter</h3>
        <p className={s.faint}>The data that would teach it most about {room}, in order. Each one unlocks checks it can’t run yet.</p>
        <ol className={s.smarter}>
          {u.smarter.slice(0, 5).map((g) => (
            <li key={g.need}>
              <span className={s.need}>{g.need}</span>
              <span className={s.faint}>Unlocks: {g.unlocks.join('; ')}{g.fix ? ` · ${g.fix}` : ''}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className={s.fine}>
        {ai ? `Mise’s reads above were written by ${reads.model} from your records, and every figure in them was checked against those records.` : 'Mise reads every record above itself. When the AI engine is switched on it also writes its own read of each level, and every figure it writes is checked against your records.'}
        {' '}It learns across your rooms, never from other restaurants’ data, and never claims to beat a person until real results show it.{' '}
        <button type="button" className={s.link} onClick={() => cv.go('consultants')}>See each consultant’s record</button>
      </p>
    </div>
  );
}

export { CvMise };
