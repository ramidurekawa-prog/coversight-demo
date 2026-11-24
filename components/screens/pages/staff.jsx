'use client';

import * as React from 'react';

import { Button, Icon, Tabs } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { CV_D, CV_DS, CV_ROOM, Callout, Claim, PageHead, Pill, cvMoney, useCv } from '../core';
import { METRICS, MIN_SHIFTS, SLOT_LABEL, SLOT_SHORT, fmtMetric, staffPage } from '../../../lib/data/page/staff';
import s from './staff.module.css';

/* Staff: every person on the team, ranked against people in the same job on
 * the same kind of shifts, from the restaurant's own POS. One answer, one
 * action, one picture; the full matrix and each person's profile behind a tap.
 * Names and rankings are for owners, admins and GMs (the server enforces it). */

const VERDICT = {
  star: { label: 'Star', plural: 'Stars', icon: 'Star', tone: 'good', cls: s.good, sub: 'Sell more on the same shifts' },
  coach: { label: 'Coach', plural: 'To coach', icon: 'GraduationCap', tone: 'warn', cls: s.warn, sub: 'One habit to train' },
  closer: { label: 'Closer look', plural: 'Closer look', icon: 'Eye', tone: 'bad', cls: s.bad, sub: 'A pattern worth a private word' },
  early: { label: 'Too early', plural: 'Too early', icon: 'Hourglass', tone: 'neutral', cls: s.quiet, sub: `Fewer than ${MIN_SHIFTS} shifts` },
  solid: { label: 'Solid', plural: 'Solid', icon: 'CircleCheck', tone: 'info', cls: '', sub: 'In line with peers' },
  info: { label: 'Hours only', plural: 'Hours only', icon: 'Clock', tone: 'neutral', cls: s.quiet, sub: 'The POS sees clock-ins only' },
};
const TILES = ['star', 'coach', 'closer', 'early'];
const MATRIX = ['fit', 'guestsHr', 'perGuest', 'checkAvg', 'items', 'starters', 'desserts', 'drinks', 'tipRate', 'tableMin', 'give', 'voids', 'blank', 'late'];
const M = Object.fromEntries(METRICS.map((m) => [m.k, m]));
const SLOT_COLOR = ['var(--teal-400, #5b8fa8)', 'var(--fg-2)', 'var(--fg-1)', 'var(--teal-600, #2f6a83)'];
const first = (name) => String(name).split(' ')[0];

function useCanSeeNames() {
  const cv = useCv();
  const eng = useEngine();
  if (cv.role === 'accountant') return false;
  if (eng.mode === 'server') return ['owner', 'admin', 'gm'].includes(eng.viewer?.role);
  return true;
}

function Verdict({ k, small }) {
  const v = VERDICT[k] || VERDICT.solid;
  return <Pill tone={v.tone} icon={v.icon}>{small ? v.label : v.label}</Pill>;
}

function CvStaff() {
  const eng = useEngine();
  const canSee = useCanSeeNames();
  const page = React.useMemo(() => staffPage(CV_DS, CV_D.id), [eng.version, eng.room]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!page?.source) return <NoPos />;
  if (!canSee) return <TeamOnly page={page} />;
  return <StaffBoard page={page} />;
}

function StaffBoard({ page }) {
  const cv = useCv();
  const eng = useEngine();
  const [filter, setFilter] = React.useState(null);
  const [open, setOpen] = React.useState(null);
  const [showMatrix, setShowMatrix] = React.useState(false);
  const [job, setJob] = React.useState(null);
  const { team, sellers, period } = page;
  const c = team.counts;
  const jobs = [...new Set(sellers.map((p) => p.job))];
  const curJob = job && jobs.includes(job) ? job : jobs[0];
  const person = open ? page.people.find((p) => p.id === open) : null;
  const stars = sellers.filter((p) => p.read.kind === 'star');
  const starShare = page.reconcile.sales ? Math.round((stars.reduce((t, p) => t + p.R.sales, 0) / page.reconcile.sales) * 100) : 0;
  const a = team.action;
  const task = a && (eng.tasks || []).find((t) => t.roomId === CV_D.id && t.approvalId === a.approvalId && t.status !== 'cancelled');
  const headline = [c.star ? `${c.star} star${c.star === 1 ? '' : 's'}` : null, c.coach ? `${c.coach} to coach` : null, c.closer ? `${c.closer} for a closer look` : null].filter(Boolean).join(', ') || 'Everyone in line';

  const addTask = async () => {
    const t = await engine.createTask(a.approvalId, a.task);
    if (t) cv.toast('Added to Today, with the numbers to bring.');
  };

  return (
    <div className="cv-page wide">
      <PageHead over={`Staff · ${CV_ROOM.name} · ${sellers.length} people who sell · ${period.label}`} q={`${headline}.`}
        sub={stars.length ? `Your ${stars.length} star${stars.length === 1 ? '' : 's'} sold ${starShare}% of everything. Everyone is ranked against people in the same job on the same kind of shifts, from your own POS.` : 'Everyone is ranked against people in the same job on the same kind of shifts, from your own POS.'} />

      <div className={s.top}>
        {a ? (
          <section className={`cv-card ${s.action}`}>
            <span className={s.eyebrow}>Do this first</span>
            <span className={s.actTitle}>{a.title}</span>
            <span className="cv-small cv-muted">{a.line}</span>
            {a.money != null && a.money >= 1 && (
              <div className={s.money}><span className={`cv-fig lg ${s.good}`}>{cvMoney(Math.round(a.money))}</span><span className="cv-small">{a.moneyNote}</span><Claim k="est" /></div>
            )}
            <div className={s.btns}>
              {task ? <Pill tone="good" icon="ListChecks">On Today</Pill> : <Button icon="ListChecks" onClick={addTask}>{a.cta}</Button>}
              {a.person && <Button variant="secondary" onClick={() => setOpen(a.person)}>See {first(page.people.find((p) => p.id === a.person)?.name || '')}’s numbers</Button>}
            </div>
          </section>
        ) : (
          <section className={`cv-card ${s.action}`}>
            <span className={s.eyebrow}>Do this first</span>
            <span className={s.actTitle}>Nothing urgent this month</span>
            <span className="cv-small cv-muted">No one is outside their normal range and no habit stands out. Thank your stars.</span>
          </section>
        )}
        <div className={s.tiles}>
          {TILES.map((k) => (
            <button key={k} type="button" className={`${s.tile} ${filter === k ? s.on : ''}`} aria-pressed={filter === k} onClick={() => { setFilter(filter === k ? null : k); setShowMatrix(true); }}>
              <span className={`${s.tileNum} ${VERDICT[k].cls}`}><Icon name={VERDICT[k].icon} size={24} />{c[k] || 0}</span>
              <span className={s.tileLbl}>{VERDICT[k].plural}</span>
              <span className={s.tileSub}>{VERDICT[k].sub}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="cv-card">
        <div className="cv-card-head">
          <span className="cv-h4">Who sells the most per hour, on the same kind of shifts</span>
          {jobs.length > 1 && <Tabs value={curJob} onChange={setJob} tabs={jobs.map((j) => ({ value: j, label: `${j}s` }))} />}
        </div>
        <SalesBars people={sellers.filter((p) => p.job === curJob)} onOpen={setOpen} />
        <span className="cv-xs cv-faint">The line is your middle {String(curJob).toLowerCase()}, on the same mix of lunches, weeknights and Friday–Saturday dinners as each person. {sellers.find((p) => p.job === curJob)?.peers?.scope === 'group' ? `Too few ${String(curJob).toLowerCase()}s here to compare, so it’s every room’s ${String(curJob).toLowerCase()}s.` : ''} Tap anyone for their full profile.</span>
      </section>

      <div className={s.two}>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">What you might be missing</span><Icon name="Search" size={18} /></div>
          <NoteList items={team.missing.slice(0, 4)} empty="Nothing hidden in the totals this month." icon={(m) => (m.kind === 'not-scheduled' ? ['UserPlus', s.good] : m.kind === 'slipping' ? ['TrendingDown', s.warn] : ['Eye', s.warn])} onOpen={setOpen} />
        </section>
        <section className="cv-card">
          <div className="cv-card-head"><span className="cv-h4">Where you might over-correct</span><Icon name="Scale" size={18} /></div>
          <NoteList items={team.overCorrect.slice(0, 4)} empty="No number here is being misread." icon={(m) => (m.kind === 'early' ? ['Hourglass', s.quiet] : m.kind === 'team-habit' ? ['Users', s.warn] : ['CircleCheck', s.good])} onOpen={setOpen} />
        </section>
      </div>

      <TeamCoach person={null} />

      <section className="cv-card flush">
        <div className={s.matrixHead}>
          <span className="cv-h4">The full matrix{filter ? `: ${VERDICT[filter].plural.toLowerCase()}` : ''}</span>
          <div className="cv-row" style={{ gap: 8 }}>
            {filter && <Button variant="ghost" size="sm" icon="X" onClick={() => setFilter(null)}>Show everyone</Button>}
            <Button variant="secondary" size="sm" icon={showMatrix ? 'ChevronUp' : 'ChevronDown'} onClick={() => setShowMatrix(!showMatrix)}>{showMatrix ? 'Hide' : `See all ${MATRIX.length} measures for everyone`}</Button>
          </div>
        </div>
        {showMatrix && <Matrix people={filter ? page.people.filter((p) => p.read.kind === filter) : sellers} onOpen={setOpen} />}
        {showMatrix && !filter && <Others people={page.others} onOpen={setOpen} />}
      </section>

      <Callout icon="Info">Every number comes from {page.source === 'toast' ? `your Toast data through ${page.reconcile && CV_D.room.fromToast?.end}` : 'the sample group’s POS'}, {period.label.toLowerCase()}, and adds up to the same sales, giveaways and hours as Labor and Giveaways. Unmarked numbers are observed. Green is ahead of peers, red behind.</Callout>
      <Callout icon="ShieldCheck">This is coaching evidence, not an HR verdict. It never says to let anyone go: decisions about discipline stay with you and your own records, and employment rules (California’s included) apply. It ranks only what the POS sees about the job.</Callout>

      {person && <Profile p={person} page={page} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SalesBars({ people, onOpen }) {
  const ranked = people.filter((p) => p.enough && p.m.fit?.index != null).sort((x, y) => y.m.fit.index - x.m.fit.index);
  const early = people.filter((p) => !p.enough);
  const max = Math.min(260, Math.max(150, ...ranked.map((p) => p.m.fit.index)) * 1.04);
  const x = (v) => `${(Math.min(v, max) / max) * 100}%`;
  return (
    <div className={s.bars} style={{ paddingTop: 20 }}>
      {ranked.map((p, i) => {
        const d = Math.round(p.m.fit.index - 100);
        return (
          <button type="button" key={p.id} className={s.bar} onClick={() => onOpen(p.id)} aria-label={`${p.name}: ${d >= 0 ? `${d}% more` : `${-d}% less`} per hour than normal. ${VERDICT[p.read.kind].label}.`}>
            <span className={s.barName}><Icon name={VERDICT[p.read.kind].icon} size={15} className={VERDICT[p.read.kind].cls} />{p.name}</span>
            <span className={s.track}>
              <span className={`${s.fill} ${s[p.read.kind] || s.solid}`} style={{ width: x(p.m.fit.index) }} />
              <span className={s.norm} style={{ left: x(100) }}>{i === 0 && <span className={s.normLbl}>normal</span>}</span>
            </span>
            <span className={`${s.barVal} ${d >= 10 ? s.good : d <= -10 ? s.bad : ''}`}>{d > 0 ? '+' : ''}{d}%</span>
          </button>
        );
      })}
      {early.map((p) => (
        <button type="button" key={p.id} className={s.bar} onClick={() => onOpen(p.id)}>
          <span className={`${s.barName} ${s.quiet}`}><Icon name="Hourglass" size={15} />{p.name}</span>
          <span className="cv-small cv-faint">Too early to tell: {p.shifts} shift{p.shifts === 1 ? '' : 's'}</span>
          <span />
        </button>
      ))}
    </div>
  );
}

function NoteList({ items, empty, icon, onOpen }) {
  if (!items.length) return <span className="cv-small cv-muted">{empty}</span>;
  return (
    <div className={s.notes}>
      {items.map((m, i) => {
        const [ic, cls] = icon(m);
        const body = <><Icon name={ic} size={18} className={cls} /><div><b>{m.title}</b><span>{m.line}</span></div></>;
        return m.person
          ? <button type="button" key={i} className={s.note} onClick={() => onOpen(m.person)}>{body}</button>
          : <div key={i} className={s.note} style={{ cursor: 'default' }}>{body}</div>;
      })}
    </div>
  );
}

/* Team Coach: Claude talks the computed read through (server, with a key); otherwise Coversight's own words. */
function TeamCoach({ person }) {
  const eng = useEngine();
  const [ans, setAns] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const ask = async () => {
    setBusy(true);
    try {
      if (eng.mode !== 'server') throw new Error('local');
      const r = await fetch('/api/page/staff/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: CV_D.id, person: person?.id ?? null }) });
      if (!r.ok) throw new Error(String(r.status));
      setAns(await r.json());
    } catch {
      setAns({ text: localCoach(person), by: 'coversight' });
    } finally { setBusy(false); }
  };
  return (
    <section className="cv-card" style={{ gap: 10 }}>
      <div className="cv-card-head">
        <span className="cv-h4" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="MessageSquare" size={18} className={s.good} />Team Coach{person ? ` on ${first(person.name)}` : ''}</span>
        <Button variant="secondary" size="sm" icon="MessageSquare" onClick={ask} disabled={busy}>{busy ? 'Thinking…' : ans ? 'Ask again' : person ? `What should I do about ${first(person.name)}?` : 'What should I focus on this week?'}</Button>
      </div>
      {ans ? (
        <div className={s.coachBox}>
          <span>{ans.text}</span>
          <span className="cv-xs cv-faint">{ans.by === 'claude' ? 'Team Coach, from the numbers on this page only' : 'Coversight’s read, from the numbers on this page'}</span>
        </div>
      ) : <span className="cv-small cv-muted">Ask in one tap. It only uses the numbers on this page and never tells you to let anyone go.</span>}
    </section>
  );
}
function localCoach(person) {
  const page = staffPage(CV_DS, CV_D.id);
  if (person) {
    const r = person.read;
    return [`${r.title}. ${r.line}`, ...r.why.slice(0, 2), r.alt[0] ? `Before acting: ${r.alt[0]}` : ''].filter(Boolean).join(' ');
  }
  const a = page.team.action, m = page.team.missing[0], o = page.team.overCorrect[0];
  return [a ? `This week: ${a.title.replace(/\.$/, "")}. ${a.line}` : 'Nothing urgent this week.', m ? `You might be missing: ${m.line}` : '', o ? `Don’t over-correct: ${o.line}` : ''].filter(Boolean).join(' ');
}

/* ---------------------------------------------------------------- the matrix */
function Matrix({ people, onOpen }) {
  const [sort, setSort] = React.useState({ k: 'fit', dir: -1 });
  const [mode, setMode] = React.useState('num');
  const keyOf = (p) => (sort.k === 'name' ? p.name : mode === 'rank' ? p.m[sort.k]?.pct ?? -1 : p.m[sort.k]?.raw ?? -Infinity);
  const rows = [...people].sort((a, b) => { const x = keyOf(a), y = keyOf(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  const head = (k, label) => (
    <button type="button" className={s.th} onClick={() => setSort({ k, dir: sort.k === k ? -sort.dir : -1 })} aria-label={`Sort by ${label}`}>
      {label}{sort.k === k ? <Icon name={sort.dir < 0 ? 'ArrowDown' : 'ArrowUp'} size={12} /> : <Icon name="ArrowUpDown" size={12} />}
    </button>
  );
  return (
    <>
      <div style={{ padding: '0 18px 10px' }}><Tabs value={mode} onChange={setMode} tabs={[{ value: 'num', label: 'Numbers' }, { value: 'rank', label: 'Rank in their job' }]} /></div>
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Staff matrix, scrolls sideways">
        <table className="cv-table">
          <thead><tr><th>{head('name', 'Person')}</th><th>Read</th><th className="r">Shifts</th>{MATRIX.map((k) => <th key={k} className="r" title={M[k].plain}>{head(k, M[k].label)}</th>)}</tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="cv-tr" onClick={() => onOpen(p.id)}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.name}<div className="cv-xs cv-faint">{p.job}</div></td>
                <td><Verdict k={p.read.kind} /></td>
                <td className="r">{p.shifts}</td>
                {MATRIX.map((k) => {
                  const m = p.m[k];
                  const tier = m?.tier;
                  const txt = mode === 'rank' ? (m?.pct != null ? `${m.pct}` : '—') : fmtMetric(k, m?.raw);
                  return <td key={k} className={`r ${s.cell} ${tier === 'top' ? s.cellTop : tier === 'bottom' ? s.cellBottom : ''}`}>{txt}{tier === 'top' ? <span className={s.mark} aria-label="top third">▲</span> : tier === 'bottom' ? <span className={s.mark} aria-label="bottom third">▼</span> : null}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cv-xs cv-faint" style={{ padding: '10px 18px 14px' }}>▲ top third and ▼ bottom third of their job, on the same kind of shifts. Rank is 0 (lowest) to 100 (highest). Table time is shown, not judged. Tips and late clock-ins appear when the POS records them.</div>
    </>
  );
}

function Others({ people, onOpen }) {
  if (!people.length) return null;
  return (
    <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Everyone else" style={{ borderTop: '1px solid var(--border)' }}>
      <table className="cv-table">
        <thead><tr><th>Everyone else (from clock-ins)</th><th>Read</th><th className="r">Shifts</th><th className="r">Hours, 4 weeks</th><th className="r">Hours this week</th><th className="r">Late per 10 shifts</th><th className="r">Overtime, 4 weeks</th></tr></thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} className="cv-tr" onClick={() => onOpen(p.id)}>
              <td style={{ fontWeight: 600 }}>{p.name}<div className="cv-xs cv-faint">{p.job}</div></td>
              <td><Verdict k={p.read.kind} /></td>
              <td className="r">{p.shifts}</td>
              <td className="r">{Math.round(p.hours)}</td>
              <td className="r">{Math.round(p.hoursThisWeek * 10) / 10}</td>
              <td className={`r ${p.m.late?.tier === 'bottom' ? s.cellBottom : ''} ${s.cell}`}>{p.m.late?.raw != null ? p.m.late.raw.toFixed(1) : '—'}</td>
              <td className="r">{p.m.ot?.raw ? `${Math.round(p.m.ot.raw * 10) / 10} h` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- one person */
const PROFILE = ['fit', 'guestsHr', 'perGuest', 'items', 'starters', 'desserts', 'drinks', 'tipRate', 'give', 'voids'];
const NOTE_KINDS = [['note', 'Note'], ['praise', 'Praise'], ['training', 'Training done'], ['talk', 'Talk held'], ['disagree', 'I disagree']];

function Profile({ p, page, onClose }) {
  const eng = useEngine();
  const cv = useCv();
  const [notes, setNotes] = useSaved('staff.notes', {});
  const [kind, setKind] = React.useState('note');
  const [text, setText] = React.useState('');
  const mine = notes?.[p.id] || [];
  const r = p.read;
  React.useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const save = () => {
    const t = text.trim();
    if (!t && kind === 'note') return;
    const by = eng.viewer ? undefined : cv.role === 'gm' ? 'GM' : 'Owner';
    setNotes((cur) => ({ ...(cur || {}), [p.id]: [{ at: new Date().toISOString(), kind, text: t, ...(by ? { by } : {}) }, ...((cur || {})[p.id] || [])].slice(0, 40) }), `Staff note on ${p.name}`);
    setText('');
    cv.toast('Saved to their notes.');
  };
  const coachTask = r.habitKey || r.kind === 'closer'
    ? { approvalId: r.kind === 'closer' ? `staff:${p.id}:talk` : `staff:${p.id}:${r.habitKey}`, title: r.kind === 'closer' ? `A private word with ${p.name}` : `Coach ${p.name} on ${r.habitKey}`, diff: r.kind === 'closer' ? [[`${p.name}: ${r.habit}`, 'Not yet', 'Talk before their next shift']] : [[`${r.habitKey} per 100 guests`, String(r.now), String(r.goal)]] }
    : null;
  const task = coachTask && (eng.tasks || []).find((t) => t.roomId === CV_D.id && t.approvalId === coachTask.approvalId && t.status !== 'cancelled');
  const trend = p.trend?.filter((v) => v != null) || [];
  return (
    <>
      <div className="cv-scrim" onClick={onClose} />
      <aside className="cv-drawer" role="dialog" aria-label={`${p.name}'s profile`} style={{ width: 'min(560px, 100%)' }}>
        <div className="hd">
          <div className="cv-col" style={{ gap: 6 }}>
            <span className="cv-over">{p.job} · {p.shifts} shifts · {Math.round(p.hours)} hours · {page.period.short}</span>
            <span className="cv-h3">{p.name}</span>
            <div className="cv-row" style={{ gap: 8, flexWrap: 'wrap' }}><Verdict k={r.kind} /><span className="cv-small">{r.line}</span></div>
          </div>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="X" /></button>
        </div>
        <div className="bd">
          {(r.why.length > 0 || r.alt.length > 0) && (
            <div className="cv-col" style={{ gap: 8 }}>
              {r.why.length > 0 && <><span className="cv-h4">Why</span><ul className={s.list}>{r.why.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
              {r.alt.length > 0 && <><span className="cv-h4">What else could explain it</span><ul className={s.list}>{r.alt.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
            </div>
          )}
          {coachTask && <div>{task ? <Pill tone="good" icon="ListChecks">On Today</Pill> : <Button variant="secondary" icon="ListChecks" onClick={async () => { const t = await engine.createTask(coachTask.approvalId, { title: coachTask.title, system: 'Coaching', diff: coachTask.diff }); if (t) cv.toast('Added to Today.'); }}>Add {r.kind === 'closer' ? 'the talk' : 'the coaching'} to Today</Button>}</div>}

          {p.kind === 'sell' && p.enough && (
            <div className="cv-col" style={{ gap: 12 }}>
              <span className="cv-h4">Against {p.peers.n} {p.job.toLowerCase()}s{p.peers.scope === 'group' ? ' in all your rooms' : ''}, same kind of shifts</span>
              {PROFILE.filter((k) => p.m[k]?.raw != null).map((k) => {
                const m = p.m[k];
                const pos = m.pct == null ? null : M[k].better === 'low' ? 100 - m.pct : m.pct;
                return (
                  <div key={k} className={s.mrow}>
                    <span className={s.mlabel}>{M[k].label}</span>
                    <span className={`${s.mval} ${m.tier === 'top' ? s.good : m.tier === 'bottom' ? s.bad : ''}`}>{fmtMetric(k, m.raw)}</span>
                    {pos != null && <span className={s.pct} role="img" aria-label={`${m.tier} third`}><span className={s.dot} style={{ left: `${Math.max(3, Math.min(97, pos))}%` }} /></span>}
                    <span className={s.msub}>{M[k].plain}{m.peerMedian != null ? `. Typical: ${fmtMetric(k, m.peerMedian)}` : ''}{m.tier ? ` · ${m.tier === 'top' ? 'ahead' : m.tier === 'bottom' ? 'behind' : 'middle'}` : ''}</span>
                  </div>
                );
              })}
              <span className="cv-xs cv-faint">Left is behind, right is ahead (for giveaways, fewer is ahead).</span>
            </div>
          )}

          {p.kind === 'sell' && (
            <div className="cv-col" style={{ gap: 8 }}>
              <span className="cv-h4">When they work</span>
              <div className={s.mix} role="img" aria-label={p.mix.map((x, i) => `${SLOT_LABEL[i]} ${Math.round(x * 100)}%`).join(', ')}>
                {p.mix.map((x, i) => x > 0 && <span key={i} style={{ width: `${x * 100}%`, background: SLOT_COLOR[i] }}>{x >= 0.12 ? `${SLOT_SHORT[i]} ${Math.round(x * 100)}%` : ''}</span>)}
              </div>
              <span className="cv-xs cv-faint">{SLOT_LABEL.map((l, i) => `${l} ${Math.round(p.mix[i] * 100)}%`).join(' · ')}</span>
            </div>
          )}

          {p.kind === 'sell' && trend.length >= 4 && <Trend p={p} labels={page.labels} />}

          {p.reg && (
            <div className="cv-col" style={{ gap: 6 }}>
              <span className="cv-h4">At the register, 28 days</span>
              {[['postVoid', 'Cancelled after the kitchen'], ['comps', 'Comps'], ['disc', 'Discounts']].map(([k, l]) => (
                <div key={k} className="cv-row" style={{ justifyContent: 'space-between', gap: 10 }}>
                  <span className="cv-small">{l}</span>
                  <span className={`cv-small ${p.reg[`${k}Signal`] ? s.bad : s.good}`} style={{ fontWeight: 600 }}>
                    {cvMoney(Math.round(p.reg[k]))} · ${(p.reg[`${k}Rate`] * 100).toFixed(2)} per $100 · {p.reg[`${k}Signal`] ? 'above' : 'inside'} their normal range (up to ${(p.reg[`${k}Ucl`] * 100).toFixed(2)})
                  </span>
                </div>
              ))}
              <span className="cv-xs cv-faint">The same limits as the Giveaways page, set by their own volume.</span>
            </div>
          )}

          {p.kind !== 'sell' && (
            <div className="cv-col" style={{ gap: 6 }}>
              <span className="cv-h4">From their clock-ins</span>
              <span className="cv-small">{Math.round(p.hours)} hours over {p.shifts} shifts in 4 weeks; {Math.round(p.hoursThisWeek * 10) / 10} this week.{p.m.late?.raw != null ? ` Late on ${p.m.late.raw.toFixed(1)} of every 10 shifts.` : ''}{p.m.ot?.raw ? ` ${Math.round(p.m.ot.raw * 10) / 10} overtime hours.` : ''}</span>
            </div>
          )}

          <TeamCoach person={p} />

          <div className="cv-col" style={{ gap: 8 }}>
            <span className="cv-h4">Your notes</span>
            <div className={s.form}>
              <div className={s.kinds} role="radiogroup" aria-label="Kind of note">
                {NOTE_KINDS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={`cv-kind${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}
              </div>
              <textarea className="input" rows={2} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'disagree' ? 'What does the read miss? (it helps the next one)' : 'What happened, in a line'} aria-label="Note" style={{ padding: 10, resize: 'vertical' }} />
              <div><Button variant="secondary" size="sm" icon="NotebookPen" onClick={save} disabled={!text.trim() && kind === 'note'}>Save note</Button></div>
            </div>
            {mine.map((n, i) => (
              <div key={i} className={s.entry}>
                <span className="cv-xs cv-faint">{NOTE_KINDS.find(([k]) => k === n.kind)?.[1]} · {new Date(n.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{n.by ? ` · ${n.by}` : ''} · hand-entered</span>
                {n.text && <span>{n.text}</span>}
              </div>
            ))}
          </div>
          <span className="cv-xs cv-faint">Coaching evidence from the POS, {page.period.label.toLowerCase()}. Not an HR verdict.</span>
        </div>
      </aside>
    </>
  );
}

function Trend({ p, labels }) {
  const W = 500, H = 120, P = { l: 34, r: 10, t: 12, b: 22 };
  const vals = p.trend;
  const defined = vals.filter((v) => v != null);
  const lo = Math.min(60, ...defined) - 5, hi = Math.max(140, ...defined) + 5;
  const n = vals.length;
  const x = (i) => P.l + (i / Math.max(1, n - 1)) * (W - P.l - P.r);
  const y = (v) => H - P.b - ((v - lo) / (hi - lo)) * (H - P.t - P.b);
  const pts = vals.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
  return (
    <div className="cv-col" style={{ gap: 6 }}>
      <span className="cv-h4">Sales per hour, week by week</span>
      <svg className="cv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.name}'s sales per hour against a normal ${p.job.toLowerCase()} on the same shifts, last ${n} weeks`}>
        <rect x={x(n - 4) - 6} y={P.t} width={x(n - 1) - x(n - 4) + 12} height={H - P.t - P.b} fill="var(--surface-sunken)" rx="4" />
        <line className="grid" x1={P.l} x2={W - P.r} y1={y(100)} y2={y(100)} style={{ stroke: 'var(--fg-2)', strokeDasharray: '4 4' }} />
        <text x={P.l - 6} y={y(100) + 4} textAnchor="end">normal</text>
        <path d={pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a},${b}`).join(' ')} fill="none" stroke="var(--fg-1)" strokeWidth="2.25" />
        {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill="var(--fg-1)" />}
        {labels && [0, n - 4, n - 1].map((i) => labels[i] && <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{labels[i]}</text>)}
      </svg>
      <span className="cv-xs cv-faint">The shaded weeks are the last 4, the ones ranked above.{p.trendMove != null ? ` ${p.trendMove >= 0 ? 'Up' : 'Down'} ${Math.abs(Math.round(p.trendMove * 100))}% on their own 9 weeks before.` : ''}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- other views */
function TeamOnly({ page }) {
  const c = page.team.counts || {};
  return (
    <div className="cv-page wide">
      <PageHead over={`Staff · ${CV_ROOM.name} · ${page.period.label}`} q="How the team is doing" sub="Names and rankings are for owners and GMs. Here is the team as a whole." />
      <div className={s.tiles} style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        {TILES.map((k) => <div key={k} className={s.tile} style={{ cursor: 'default' }}><span className={`${s.tileNum} ${VERDICT[k].cls}`}><Icon name={VERDICT[k].icon} size={24} />{c[k] || 0}</span><span className={s.tileLbl}>{VERDICT[k].plural}</span></div>)}
      </div>
      {page.team.habits?.map((h, i) => <Callout key={i} icon="Users">{h.line}</Callout>)}
      <Callout icon="Lock">Ask an owner or GM to go through your own numbers with you.</Callout>
    </div>
  );
}

function NoPos() {
  const cv = useCv();
  return (
    <div className="cv-page wide">
      <PageHead over={`Staff · ${CV_ROOM.name}`} q="See who your best people are, from your own POS" sub="Once Toast is connected, every server and bartender is ranked against people in the same job on the same kind of shifts: sales per hour, desserts, starters, drinks, giveaways and cancellations, with a coaching read for each." />
      <section className={`cv-card ${s.action}`}>
        <span className={s.eyebrow}>To start</span>
        <span className={s.actTitle}>Connect Toast, or add its exports</span>
        <span className="cv-small cv-muted">The page needs each person’s orders and clock-ins: ItemSelectionDetails, OrderDetails and TimeEntries (13 weeks is best). Nothing on this page is ever typed in.</span>
        <div className={s.btns}>
          <Button icon="PlugZap" onClick={() => cv.go('connect')}>Connect Toast</Button>
          <Button variant="secondary" icon="Upload" onClick={() => cv.go('inputs', { kind: 'toast' })}>Add Toast exports</Button>
        </div>
      </section>
    </div>
  );
}

export { CvStaff };
