'use client';

import * as React from 'react';

import { Icon, Button } from '../../kit';
import { useEngine, useSaved } from '../../engine';
import { REVIEW_KEY, trimReviews, weekView } from '../../../lib/data/page/week';
import { useCv, cvMoney, CV_D, CV_ROOM, Claim, Money, Callout, Interval, PageHead, Pill } from '../core';
import { DenseWeek } from '../dense-sections';
import s from './week.module.css';

/* This week: what happened, why, and what you're doing about it, for the
   room in view. Every figure comes from weekView() (lib/data/page/week.js),
   which the week API and the Monday digest also use. A real group's banked
   dollars and tests come from its own test windows, never the sample's. */

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const minutes = (h) => `${Math.round(h * 60)} min`;
const hrs = (h) => `${+h.toFixed(2)} manager-hour${h === 1 ? '' : 's'}`;
const chance = (p) => `${Math.round(p * 100)}% chance it verifies`;

/** A dollar that opens its derivation, but only when that derivation describes this figure. */
function Fig({ id, show, children }) {
  return show ? <Money id={id}>{children}</Money> : <span>{children}</span>;
}

/* ---------------------------------------------------------------- scoreboard */
function Board({ v }) {
  const sample = !v.real;
  const vsLast = v.earned.vsLast;
  const m = v.margin;
  return (
    <section className={`cv-card ${s.board}`} aria-label="The week in four numbers">
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Earned</span><Claim k="obs" /></div>
        <span className="cv-fig lg"><Money id="earned-week">{cvMoney(Math.round(v.earned.value))}</Money></span>
        <span className={s.tileFoot}>
          {vsLast == null ? 'Contribution margin from your register' : <>
            <Icon name={vsLast >= 0 ? 'TrendingUp' : 'TrendingDown'} size={14} className={vsLast >= 0 ? 'cv-up' : 'cv-down'} />
            <span className={`cv-num ${vsLast >= 0 ? 'cv-up' : 'cv-down'}`}>{cvMoney(Math.abs(Math.round(vsLast)))}</span> {vsLast >= 0 ? 'up' : 'down'} on last week
          </>}
        </span>
      </div>
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Banked</span><Claim k="book" /></div>
        <span className={`cv-fig lg ${v.banked.week ? 'cv-up' : ''}`}><Fig id="banked-week" show={sample}>{cvMoney(v.banked.week, { cents: !sample })}</Fig></span>
        <span className={s.tileFoot}>
          {v.banked.liveCount ? `From ${v.banked.liveCount} verified change${v.banked.liveCount === 1 ? '' : 's'}` : v.banked.running ? `${v.banked.running} test${v.banked.running === 1 ? '' : 's'} running, none verified yet` : 'Nothing verified yet'}
        </span>
      </div>
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Vs 6 matched weeks</span><Claim k="mod" /></div>
        <span className={`cv-fig lg ${m.move >= 0 ? 'cv-up' : 'cv-down'}`}><Fig id="margin-move" show={sample || !v.banked.week}>{cvMoney(Math.round(m.move), { sign: true })}</Fig></span>
        {m.move > 0 ? (
          <div className="cv-col" style={{ gap: 6 }}>
            <div className="cv-decomp" role="img" aria-label={`${cvMoney(Math.round(m.claimable))} accounted for, ${cvMoney(Math.round(m.unexplained))} unexplained`}>
              <span style={{ width: `${(m.claimable / m.move) * 100}%`, background: 'var(--claim-book)' }} />
              <span style={{ width: `${(m.unexplained / m.move) * 100}%`, background: 'var(--border-strong)' }} />
            </div>
            <span className={s.tileFoot} style={{ minHeight: 0 }}>We account for {cvMoney(Math.round(m.claimable))}; the rest isn’t claimed</span>
          </div>
        ) : <span className={s.tileFoot}>Below matched weeks; we don’t claim a cause we didn’t measure</span>}
      </div>
      <div className={s.tile}>
        <div className={s.tileHead}><span className="cv-over">Open exposure</span><Claim k="est" /></div>
        <span className="cv-fig lg"><Money id="exposure">{cvMoney(Math.round(v.exposure.value))}<span className="cv-faint" style={{ fontSize: '0.55em' }}>/wk</span></Money></span>
        <span className={s.tileFoot}>{v.exposure.count} candidate{v.exposure.count === 1 ? '' : 's'} · never added to banked</span>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the brief */
function Spark({ pts }) {
  const w = 180, h = 40, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * (w - 6) + 3, h - 4 - ((v - lo) / span) * (h - 8)]);
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ maxWidth: '100%' }}>
      <polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill="var(--accent)" />
    </svg>
  );
}

function Brief({ v }) {
  const cv = useCv();
  const b = v.brief;
  if (!b) return null;
  const up = b.vsLast.earned >= 0;
  const max = Math.max(...b.parts.map((p) => Math.abs(p.amount)), 1);
  const next = v.plan.next;
  const rate = { food: ` · ${pct(b.week.foodRate)}`, labour: ` · ${pct(b.week.labourRate)}` };
  return (
    <section className="cv-card" aria-label="What changed this week">
      <div className="cv-card-head"><span className="cv-over">What changed · why · what next</span><Claim k="obs" /></div>
      <div className={s.brief}>
        <div className={s.briefCol}>
          <span className="cv-xs cv-faint">What changed</span>
          <span className={s.lead}>Margin {up ? 'up' : 'down'} <span className={`cv-num ${up ? 'cv-up' : 'cv-down'}`}>{cvMoney(Math.abs(Math.round(b.vsLast.earned)))}</span> on last week</span>
          <span className="cv-small cv-muted">{cvMoney(Math.round(b.vsAvg4.earned), { sign: true })} against the 4 weeks before. Sales {cvMoney(Math.round(b.vsLast.net), { sign: true })}, covers {b.vsLast.covers >= 0 ? '+' : '−'}{Math.abs(Math.round(b.vsLast.covers))}.</span>
          <div className="cv-col" style={{ gap: 2, marginTop: 4 }}>
            <Spark pts={b.trend.map((t) => t.earned)} />
            <span className="cv-xs cv-faint">Margin, last {b.trend.length} weeks{b.trend[0]?.label ? ` (${b.trend[0].label} to ${b.trend[b.trend.length - 1].label})` : ''}</span>
          </div>
        </div>
        <div className={s.briefCol}>
          <span className="cv-xs cv-faint">Why</span>
          <span className={s.lead}>{b.driver.label} moved it most</span>
          <div className={s.parts} role="list" aria-label="What moved the margin">
            {b.parts.map((p) => (
              <React.Fragment key={p.key}>
                <span role="listitem">{p.label}<span className="cv-faint">{rate[p.key] || ''}</span></span>
                <span className={s.track} aria-hidden="true"><span className={`${s.bar} ${p.amount >= 0 ? s.barUp : s.barDown}`} style={{ width: `max(6px, ${(Math.abs(p.amount) / max) * 50}%)` }} /></span>
                <span className={`cv-num ${p.amount >= 0 ? 'cv-up' : 'cv-down'}`} style={{ textAlign: 'right' }}>{cvMoney(Math.round(p.amount), { sign: true })}</span>
              </React.Fragment>
            ))}
          </div>
          <span className="cv-xs cv-faint">The parts add up exactly to the change. They describe the week; they aren’t savings we claim.</span>
        </div>
        <div className={s.briefCol}>
          <span className="cv-xs cv-faint">What next</span>
          {next ? <>
            <span className={s.lead}>{next.title}</span>
            <span className="cv-small cv-muted">{next.lever} · {minutes(next.hours)} · {chance(next.p)}</span>
            <div className="cv-row" style={{ gap: 8 }}><span className="cv-num" style={{ fontWeight: 600 }}>{cvMoney(Math.round(next.value))}/wk</span><Claim k={next.claim} /></div>
            <div style={{ marginTop: 4 }}><Button size="sm" iconRight="ArrowRight" onClick={() => cv.go('plan')}>Decide in the plan</Button></div>
          </> : <span className="cv-small cv-muted">Nothing worth a manager’s time this week. The next check runs when new data arrives.</span>}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- plan + needs you */
function Plan({ v }) {
  const cv = useCv();
  const { chosen, hours, used } = v.plan;
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4">Chosen for this week</span>
          <span className="cv-small cv-faint">{used ? `Uses ${+used.toFixed(2)} of the ${hrs(hours)} you set aside, ordered by expected value that lasts` : `Nothing fits the ${hrs(hours)} you set aside`}</span>
        </div>
        <Button variant="secondary" size="sm" iconRight="ArrowRight" onClick={() => cv.go('plan')}>Open the plan</Button>
      </div>
      {chosen.length === 0 ? <span className="cv-small cv-muted">No change clears the bar this week. New data re-ranks the candidates.</span> : (
        <div className={s.list}>
          {chosen.map((c, i) => (
            <div key={c.id} className={s.item} style={{ alignItems: 'center' }}>
              <span className="cv-rank">{i + 1}</span>
              <div className={s.grow}>
                <span style={{ fontWeight: 600 }}>{c.title}</span>
                <span className="cv-xs cv-faint">{c.lever} · {minutes(c.hours)} · {chance(c.p)}{c.needs ? ' · needs current recipe costs' : ''}{c.prevent ? ' · prevented, not saved' : ''}</span>
              </div>
              <div className={s.right}>
                <span className="cv-num" style={{ fontWeight: 600 }}>{cvMoney(Math.round(c.value))}/wk</span>
                <Claim k={c.claim} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NeedsYou({ v }) {
  const cv = useCv();
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <span className="cv-h4">Needs you</span>
        {v.attention.length > 0 && <Pill tone="warn">{v.attention.length}</Pill>}
      </div>
      {v.attention.length === 0 && <Callout tone="good" icon="ShieldCheck">Nothing needs you at {v.short}. Every control chart stayed inside its limits and every feed is current.</Callout>}
      <div className={s.list}>
        {v.attention.map((a) => (
          <div key={a.id} className={s.item}>
            <span className={`cv-q-ico ${a.tone === 'neutral' ? '' : a.tone}`}><Icon name={a.icon} size={18} /></span>
            <div className={s.grow}>
              <span style={{ fontWeight: 600 }}>{a.title}</span>
              {a.body && <span className="cv-small cv-muted">{a.body}</span>}
              <button className="cv-link" style={{ alignSelf: 'flex-start' }} onClick={() => cv.go(a.go, a.goId ? { id: a.goId } : undefined)}>{a.cta} <Icon name="ArrowRight" size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- tests + proof */
function InFlight({ v }) {
  const cv = useCv();
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <span className="cv-h4">Tests in flight</span>
        <button className="cv-link" onClick={() => cv.go(v.real ? 'windows' : 'proof')}>All tests <Icon name="ArrowRight" size={14} /></button>
      </div>
      {v.inFlight.length === 0 && <span className="cv-small cv-muted">No tests running at {v.short}. Start a 28-day test from The plan or Levers.</span>}
      <div className={s.list}>
        {v.inFlight.map((t) => (
          <div key={t.id} className={s.item}>
            <span className={`cv-q-ico ${t.waiting ? 'warn' : 'accent'}`}><Icon name={t.waiting ? 'Hourglass' : 'Timer'} size={18} /></span>
            <div className={s.grow}>
              <span style={{ fontWeight: 600 }}>{t.title}</span>
              <span className="cv-small cv-muted">{t.note}</span>
              <div className="progress" style={{ marginTop: 4 }} role="progressbar" aria-valuenow={t.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.title}: ${t.progress}% of the window`}><span style={{ width: `${Math.max(2, t.progress)}%` }} /></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Proof({ v }) {
  const cv = useCv();
  const b = v.banked;
  const lead = b.lead;
  const sample = !v.real;
  return (
    <section className="cv-card">
      <div className="cv-card-head">
        <span className="cv-h4">What the banked figure rests on</span>
        <Claim k="book" />
      </div>
      {lead ? <>
        <div className="cv-col" style={{ gap: 4 }}>
          <span style={{ fontWeight: 600 }}>{lead.title}</span>
          <span className="cv-small cv-muted">{sample ? (b.note || `Holding ${lead.held}.`) : `Verified. We bill on the lower bound, ${cvMoney(lead.bookable, { cents: true })}/wk${lead.point != null ? `, of a measured ${cvMoney(lead.point, { cents: true })}/wk` : ''}.`}</span>
        </div>
        {sample && lead.lo != null && <Interval lo={lead.lo} pt={lead.point} hi={lead.hi} min={Math.round(lead.lo * 0.6)} max={Math.round(lead.hi * 1.25)} billedLabel="what we bill on" />}
      </> : <span className="cv-small cv-muted">{b.running ? `Nothing verified yet. ${b.running} test${b.running === 1 ? ' is' : 's are'} running; each closes at day 28 of data.` : 'Nothing verified yet. A change has to pass every gate before a dollar of it is banked.'}</span>}
      <div className="cv-sep" />
      <div className="cv-row" style={{ gap: 24 }}>
        <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">Banked to date</span><span className="cv-num" style={{ fontWeight: 600 }}><Fig id="to-date" show={sample}>{cvMoney(sample ? Math.round(b.toDate) : b.toDate, { cents: !sample })}</Fig></span></div>
        {sample && b.coverage != null && <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">September vs subscription</span><span className="cv-num" style={{ fontWeight: 600 }}><Money id="coverage">{b.coverage.toFixed(1)}×</Money></span></div>}
        <div className="cv-col" style={{ gap: 2 }}><span className="cv-xs cv-faint">Tests running</span><span className="cv-num" style={{ fontWeight: 600 }}>{b.running}</span></div>
        <button className="cv-link" style={{ marginLeft: 'auto' }} onClick={() => (sample && lead ? cv.go('packet', { id: lead.id }) : cv.go(v.real ? 'windows' : 'proof'))}>See the proof <Icon name="ArrowRight" size={14} /></button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- close out */
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const weekLabel = (start) => new Date(`${start}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function CloseOut({ v }) {
  const cv = useCv();
  const eng = useEngine();
  const [rec, setRec] = useSaved(REVIEW_KEY, {});
  const [names, setNames] = React.useState({});
  const key = v.period?.start;
  const mine = key ? rec[key] : null;
  const [note, setNote] = React.useState(mine?.note || '');
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { setNote(mine?.note || ''); setEditing(false); }, [key, eng.room]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Who reviewed each week comes from the server (the person who saved it), never from the browser. */
  const stamp = JSON.stringify(rec);
  React.useEffect(() => {
    if (eng.mode !== 'server') return;
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/page/week?room=${encodeURIComponent(eng.room)}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => { if (live && b) setNames(Object.fromEntries((b.reviews || []).map((r) => [r.week, r.by]))); })
        .catch(() => { /* names are a nicety */ });
    }, 600);
    return () => { live = false; clearTimeout(t); };
  }, [eng.mode, eng.room, stamp]);

  if (!key) return null;
  const save = () => {
    const entry = { at: new Date().toISOString(), ...(note.trim() ? { note: note.trim().slice(0, 1000) } : {}) };
    setRec((cur) => trimReviews({ ...cur, [key]: mine && editing ? { ...entry, at: mine.at } : entry }), `Week of ${v.period.label} ${mine ? 'note updated' : 'marked reviewed'}`);
    setEditing(false);
    cv.toast(mine ? 'Note saved.' : `The week of ${v.period.label} is marked reviewed.`);
  };
  const reopen = () => {
    setRec((cur) => { const next = { ...cur }; delete next[key]; return next; }, `Week of ${v.period.label} reopened`);
    cv.toast('Reopened.');
  };
  const by = (k) => (eng.mode === 'server' ? names[k] : null);
  const past = Object.keys(rec).filter((k) => k !== key).sort().reverse().slice(0, 4);
  return (
    <section className="cv-card" id="week-review">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4">Close out the week</span>
          <span className="cv-small cv-faint">Mark the week of {v.period.label} reviewed, with a line on what you decided. Everyone with this room sees it.</span>
        </div>
        {mine && <Pill tone="good" icon="ClipboardCheck">Reviewed {fmtDay(mine.at)}{by(key) ? ` by ${by(key)}` : ''}</Pill>}
      </div>
      {mine && !editing ? (
        <div className="cv-col" style={{ gap: 10 }}>
          {mine.note ? <p className="cv-small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{mine.note}</p> : <span className="cv-small cv-muted">No note.</span>}
          <div className="cv-row" style={{ gap: 8 }}>
            <Button variant="secondary" size="sm" icon="Pencil" onClick={() => setEditing(true)}>Edit the note</Button>
            <Button variant="ghost" size="sm" icon="RotateCcw" onClick={reopen}>Reopen</Button>
          </div>
        </div>
      ) : (
        <div className="cv-col" style={{ gap: 10 }}>
          <label htmlFor="week-note" className="cv-xs cv-faint">Note (optional)</label>
          <textarea id="week-note" className={`input ${s.note}`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={v.plan.next ? `e.g. Going ahead with “${v.plan.next.title.toLowerCase()}” on Tuesday.` : 'What you decided this week'} />
          <div className="cv-row" style={{ gap: 8 }}>
            <Button size="sm" icon="ClipboardCheck" onClick={save}>{mine ? 'Save the note' : 'Mark the week reviewed'}</Button>
            {editing && <Button variant="ghost" size="sm" onClick={() => { setNote(mine?.note || ''); setEditing(false); }}>Cancel</Button>}
            <span className="cv-xs cv-faint">{note.length > 900 ? `${1000 - note.length} characters left` : eng.mode === 'server' ? 'Saved to your group.' : 'Saved in this browser.'}</span>
          </div>
        </div>
      )}
      {past.length > 0 && (
        <div className={s.past}>
          <span className="cv-xs cv-faint" style={{ paddingBottom: 6 }}>Earlier weeks</span>
          {past.map((k) => (
            <div key={k} className={s.pastRow}>
              <span className="cv-num cv-muted">Week of {weekLabel(k)}</span>
              <span>{rec[k].note || <span className="cv-faint">No note</span>}<span className="cv-xs cv-faint"> · reviewed {fmtDay(rec[k].at)}{by(k) ? ` by ${by(k)}` : ''}</span></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- waiting for data */
function Waiting({ v }) {
  const cv = useCv();
  return (
    <div className="cv-empty">
      <span className="ico" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}><Icon name="PlugZap" size={22} /></span>
      <span className="cv-h4">This week fills in from {v.room}’s own sales</span>
      <span className="cv-small cv-muted" style={{ maxWidth: 520 }}>Until your Toast data is in, every figure here would be the template’s, so we don’t show them. Connect Toast for a nightly pull, or upload its data exports once.</span>
      <div className="cv-row" style={{ justifyContent: 'center', gap: 8 }}>
        <Button icon="PlugZap" onClick={() => cv.go('connect')}>Connect Toast</Button>
        <Button variant="secondary" icon="Upload" onClick={() => cv.go('inputs')}>Upload exports</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the page */
function CvThisWeek() {
  const eng = useEngine();
  const real = eng.mode === 'server' && !!eng.org && !eng.org.sample;
  const [plan] = useSaved('plan', { hours: CV_D.room.managerHours });
  const [dismissed] = useSaved('findings', {});
  const [reviews] = useSaved(REVIEW_KEY, {});
  const v = weekView(CV_D, { windows: real ? eng.windows || [] : null, hours: plan.hours, dismissed });
  const own = CV_D.room.fromToast;
  const over = `${CV_ROOM.name}${v.period ? ` · week of ${v.period.label}` : ''}${own ? ' · your Toast data' : ''}`;
  if (v.awaiting) {
    return (
      <div className="cv-page">
        <PageHead over={CV_ROOM.name} q="What happened this week, and what you're doing about it" />
        <Waiting v={v} />
      </div>
    );
  }
  return (
    <div className="cv-page">
      <PageHead over={over} q="What happened this week, and what you're doing about it"
        right={v.period && reviews[v.period.start]
          ? <Pill tone="good" icon="ClipboardCheck">Week reviewed</Pill>
          : <a className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }} href="#week-review"><Icon name="ClipboardCheck" size={14} /> Close out the week</a>} />
      <Board v={v} />
      <Brief v={v} />
      <div className="cv-grid g-hero" style={{ alignItems: 'start' }}>
        <Plan v={v} />
        <NeedsYou v={v} />
      </div>
      <div className="cv-grid g2" style={{ alignItems: 'start' }}>
        <InFlight v={v} />
        <Proof v={v} />
      </div>
      <DenseWeek />
      <CloseOut v={v} />
    </div>
  );
}

export { CvThisWeek };
