'use client';

import * as React from 'react';
import { Icon } from '../../kit';
import { useEngine } from '../../engine';
import { CV_CLAIM, CV_D, CV_GROUP, CV_NOW, CV_ROOM, Claim, PageHead } from '../core';
import { CONSULTANTS } from '../../../lib/ai/casebook';
import { backtestDays, seriesFromSample } from '../../../lib/data/forecast';
import { CV_PAGES } from '../../../lib/pages';
import { roomBook } from '../../mise';
import s from './how.module.css';

/* ================================================================ How We Work
   A plain, careful summary of what Coversight does with a restaurant's data
   and what it never does: Mise, Covercast, Sous, the consultants and Proof.
   It explains outcomes and safeguards, not internals (no models, thresholds
   or formulas), and it never promises a result. The few figures it shows are
   computed from the room in view: each consultant's record (the casebook) and
   Covercast's accuracy on this restaurant's own past days (its backtest). */

/** The marks for Coversight's own systems. Drawn here, in the app's own colours. */
function Mark({ id }) {
  const common = { width: 40, height: 40, viewBox: '0 0 40 40', 'aria-hidden': true, className: s.mark };
  if (id === 'Mise') return (
    <svg {...common}><rect width="40" height="40" rx="10" className={s.markBg} />
      <path d="M20 13 L12 25 M20 13 L28 25 M12 25 L28 25" className={s.markLine} />
      <circle cx="20" cy="13" r="5" className={s.markAccent} /><circle cx="12" cy="26" r="4.5" className={s.markFg} /><circle cx="28" cy="26" r="4.5" className={s.markFg} />
    </svg>
  );
  if (id === 'Covercast') return (
    <svg {...common}><rect width="40" height="40" rx="10" className={s.markBg} />
      <path d="M7 27 C12 19 15 23 20 17 S28 15 33 10 L33 18 C28 22 25 23 20 25 S12 30 7 32 Z" className={s.markBand} />
      <path d="M7 29.5 C12 22 15 25 20 21 S28 18 33 14" className={s.markAccentLine} />
    </svg>
  );
  if (id === 'Sous') return (
    <svg {...common}><rect width="40" height="40" rx="10" className={s.markBg} />
      <path d="M20 8 L22.6 17.4 L32 20 L22.6 22.6 L20 32 L17.4 22.6 L8 20 L17.4 17.4 Z" className={s.markAccent} />
      <circle cx="30" cy="10" r="2.5" className={s.markFg} />
    </svg>
  );
  return null;
}

/** Covercast's day-ahead record on this restaurant's own past days, against the usual-night method. Null when there isn't enough history in this browser. */
function covercastRecord(d) {
  if (d.room?.fromToast) return null;
  try {
    const r = backtestDays(seriesFromSample(d.room).days, 'covers', {});
    const h = r?.horizons?.[1];
    if (!h?.normalDays?.covercast?.n) return null;
    return { days: r.days, from: r.from, through: r.through, cc: h.normalDays.covercast.wape, usual: h.normalDays.current.wape, n: h.normalDays.covercast.n, inside: h.coverage };
  } catch { return null; }
}

const FLOW = [
  { icon: 'Database', t: 'Your data comes in', d: 'From your POS, scheduling, invoices and what you add.' },
  { icon: 'Brain', t: 'Mise understands it', d: 'Whenever new data lands, and every night.' },
  { icon: 'Lightbulb', t: 'You get one clear move', d: 'What to do, why, and how.' },
  { icon: 'UserCheck', t: 'You decide', d: 'Nothing changes without a person.' },
  { icon: 'BadgeCheck', t: 'A test proves it', d: 'Only then does it count as saved.' },
];

const SYSTEMS = [
  { icon: 'Brain', mark: true, name: 'Mise', tag: 'The brain built in', does: 'Reads your data on its own, whenever it arrives and every night, and understands your business at every level: the industry rules you work under, your group, each location, its managers and its team. Every suggestion you see carries what it knows: how to do it, how similar changes went, and how the result will be checked.', never: 'Acts on its own.' },
  { icon: 'CalendarClock', mark: true, name: 'Covercast', tag: 'Forecasts', does: 'Forecasts covers and sales by day, service and hour, with a range for how far off it could be, so staffing and prep start from the same number.', never: 'Presents a forecast as a promise.' },
  { icon: 'Sparkles', mark: true, name: 'Sous', tag: 'Your teammate on every page', does: 'Answers your questions and puts one move at the top of each page, in plain words, from your own records.', never: 'Shows a figure that isn’t in your records.' },
  { icon: 'GraduationCap', name: 'Consultants', tag: 'One for each money lever', does: 'Each one learns from how its suggestions turned out, and earns more room to help as its record grows. You choose how much it may do.', never: 'Gives itself more authority.' },
  { icon: 'Scale', name: 'Proof', tag: 'Results you can book', does: 'A change counts as saved only after a test compares it with similar services that didn’t change, and it keeps being checked after that.', never: 'Calls an estimate a saving.' },
];

const PROMISES = [
  'A person approves every change. Nothing is sent, approved or changed without you.',
  'Every number says how sure it is, and you can see where it came from.',
  'Your consultants learn from your own locations. Your numbers are not pooled with other restaurants’.',
  'When a feed is out of date, advice that depends on it waits, and we tell you.',
];

const CLAIMS = ['obs', 'est', 'mod', 'cau', 'book'];

function CvHow() {
  const eng = useEngine();
  const sample = eng.mode !== 'server' || !!eng.org?.sample;
  const own = eng.mode === 'server' && !!eng.org && !eng.org.sample;
  const room = CV_ROOM.short || CV_ROOM.name;
  const book = React.useMemo(() => roomBook(CV_D, { own, windows: eng.windows, group: CV_GROUP, today: CV_NOW.iso, levels: eng.actions?.[CV_D.id]?.autonomy }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, eng.windows, eng.version, eng.room]);
  // The backtest is the slow part (a fraction of a second), so it waits for the page to paint.
  const [cc, setCc] = React.useState(/** @type {ReturnType<typeof covercastRecord> | undefined} */ (undefined));
  React.useEffect(() => {
    setCc(undefined);
    const t = setTimeout(() => setCc(covercastRecord(CV_D)), 50);
    return () => clearTimeout(t);
  }, [eng.version, eng.room]);
  const pct = (x) => `${x.toFixed(1)}%`;
  return (
    <div className="cv-page wide">
      <PageHead over="Proof · How We Work" q="How Coversight works, and what it never does."
        sub="A plain summary of the systems inside Coversight: the brain, the forecasts, the teammate on every page and the consultants." />

      <ol className={s.flow} aria-label="How a decision moves through Coversight">
        {FLOW.map((f, i) => (
          <li key={f.t} className={s.step}>
            <span className={s.stepIcon} aria-hidden="true"><Icon name={f.icon} size={20} /></span>
            <span className={s.stepN}>{i + 1}</span>
            <b>{f.t}</b>
            <span>{f.d}</span>
          </li>
        ))}
      </ol>

      <div className={s.grid}>
        {SYSTEMS.map((x) => (
          <section key={x.name} className={`cv-card ${s.sys}`} aria-labelledby={`how-${x.name}`}>
            <header className={s.sysHead}>
              {x.mark ? <Mark id={x.name} /> : <span className={s.sysIcon} aria-hidden="true"><Icon name={x.icon} size={20} /></span>}
              <span><b id={`how-${x.name}`} className={s.sysName}>{x.name}</b><span className={s.tag}>{x.tag}</span></span>
            </header>
            <p className={s.p}>{x.does}</p>
            <p className={s.never}><Icon name="ShieldCheck" size={14} /><span><b>It never:</b> {x.never.charAt(0).toLowerCase()}{x.never.slice(1)}</span></p>
          </section>
        ))}
      </div>


      <section className="cv-card" aria-labelledby="how-team">
        <h3 id="how-team" className={s.h3}>The consultants Mise and Sous work with</h3>
        <p className={s.lead}>One consultant for each money lever. Each one checks what a specialist in that area would check, and learns from how its suggestions turned out at your restaurants.</p>
        <ul className={s.team}>
          {CONSULTANTS.map((c) => {
            const k = book.consultants.find((x) => x.page === c.page);
            const r = k?.record;
            return (
              <li key={c.page} className={s.member}>
                <span className={s.memberIcon} aria-hidden="true"><Icon name={CV_PAGES[c.page]?.icon || 'GraduationCap'} size={18} /></span>
                <span className={s.memberBody}>
                  <b>{c.name}</b>
                  <span className={s.tag}>{c.area.charAt(0).toUpperCase()}{c.area.slice(1)}</span>
                  <span className={s.rec}>{!r?.results ? (r?.open ? `${r.open} test${r.open === 1 ? '' : 's'} running` : 'No tests yet') : !r.reads ? `${r.results} test${r.results === 1 ? '' : 's'}, too small to tell` : <><b className={r.held ? 'cv-up' : ''}>{r.held}</b> of {r.reads} clear result{r.reads === 1 ? '' : 's'} held up</>}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className={s.small}>Records are across your rooms, counted from tests, not opinions. A consultant earns more room to help only as its record grows, and you grant it in Settings.</p>
      </section>

      <section className="cv-card" aria-labelledby="how-cc">
        <div className={s.ccHead}>
          <Mark id="Covercast" />
          <div><h3 id="how-cc" className={s.h3}>Why we forecast with Covercast</h3>
            <p className={s.lead}>Staffing and prep are only as good as the number they start from. Covercast forecasts each day from your own history, the day of the week, the season, holidays and what you tell it, and gives a range, not just one number.</p></div>
        </div>
        {cc === undefined ? <p className={s.small}>Checking Covercast against {room}’s past days…</p> : cc ? (
          <div className={s.acc}>
            <p className={s.accLead}>How accurate it has been at {room}: the day-before covers forecast for each of the last {cc.n} ordinary days, made without seeing the answer.</p>
            <div className={s.bars} role="img" aria-label={`Average miss: Covercast ${pct(cc.cc)}, the usual-night method ${pct(cc.usual)}`}>
              <div className={s.barRow}><span>Covercast</span><span className={s.barTrack}><i className={`${s.barCc} ${cc.cc < cc.usual ? s.good : ''}`} style={{ width: `${Math.min(100, (cc.cc / Math.max(cc.cc, cc.usual)) * 100)}%` }} /></span><b className={cc.cc < cc.usual ? s.good : ''}>{pct(cc.cc)}</b></div>
              <div className={s.barRow}><span>Usual night</span><span className={s.barTrack}><i className={s.barUsual} style={{ width: `${Math.min(100, (cc.usual / Math.max(cc.cc, cc.usual)) * 100)}%` }} /></span><b>{pct(cc.usual)}</b></div>
            </div>
            <p className={s.small}>Average miss, as a share of covers. Lower is better. “Usual night” is the average of the last 8 of the same weekday, the way most restaurants plan.{cc.inside != null ? ` The actual count landed inside Covercast’s likely range on ${pct(cc.inside)} of those days.` : ''} Past accuracy is not a guarantee of future accuracy.</p>
          </div>
        ) : <p className={s.small}>Covercast shows its accuracy on your own data on the Service page once it has enough days of sales.</p>}
      </section>

      <div className={s.two}>
        <section className="cv-card" aria-labelledby="how-sure">
          <h3 id="how-sure" className={s.h3}>How sure each number is</h3>
          <ul className={s.claims}>
            {CLAIMS.map((k) => <li key={k}><Claim k={k} /><span>{CV_CLAIM[k].tip}</span></li>)}
          </ul>
        </section>
        <section className="cv-card" aria-labelledby="how-promise">
          <h3 id="how-promise" className={s.h3}>What we stand by</h3>
          <ul className={s.promises}>
            {PROMISES.map((t) => <li key={t}><Icon name="CircleCheck" size={16} /><span>{t}</span></li>)}
          </ul>
        </section>
      </div>

      <section className={s.fine} aria-labelledby="how-fine">
        <h3 id="how-fine" className={s.fineH}>The fine print</h3>
        <p>Coversight gives decision support. It is not financial, accounting, tax, legal or employment advice. Pay and labor rules are shown as summaries to confirm with your payroll provider or advisor.</p>
        <p>Forecasts and estimates are not guarantees. Results depend on the quality of your data and on the decisions you make.</p>
        <p>Some features use artificial intelligence from a third-party provider when they are switched on. AI can make mistakes, so check anything important before you act on it.</p>
        {sample && <p>The restaurants, people and figures in this demo are sample data.</p>}
        <p>This page is a plain-language summary. It doesn’t change your agreement with Coversight, which is what governs.</p>
      </section>
    </div>
  );
}

export { CvHow };
