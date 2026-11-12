'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { useCv, cvMoney, CV_GROUP, CV_NOW, Claim, Pill, PageHead } from '../core';
import { engine, useEngine } from '../../engine';
import { HANDLED_KEY, nextHandled, portfolioView } from '../../../lib/data/page/portfolio';
import { DensePortfolio } from '../dense-sections';
import s from './portfolio.module.css';

/* Room colours for the split bars: one teal family, darkest first. */
const SHADES = ['var(--teal-700)', 'var(--teal-500)', 'var(--teal-300)', 'var(--teal-200)', 'var(--neutral-400)', 'var(--neutral-300)'];
const WORDS = ['', 'one', 'both', 'all three', 'all four', 'all five', 'all six'];
const shortDate = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };

/** Each room's share of a total, as one bar with a legend. Rooms with nothing get no segment. */
function Split({ rooms, k, label }) {
  const total = rooms.reduce((x, r) => x + (r[k] || 0), 0);
  if (!total) return null;
  return (
    <div className="cv-col" style={{ gap: 6 }}>
      <div className={s.split} role="img" aria-label={`${label} by room: ${rooms.map((r) => `${r.short} ${cvMoney(Math.round(r[k] || 0))}`).join(', ')}`}>
        {rooms.map((r, i) => (r[k] > 0 ? <span key={r.id} style={{ width: `${(r[k] / total) * 100}%`, background: SHADES[i % SHADES.length] }} /> : null))}
      </div>
      <div className={s.legend} aria-hidden="true">
        {rooms.map((r, i) => <span key={r.id}><i style={{ background: SHADES[i % SHADES.length] }} />{r.short} {cvMoney(Math.round(r[k] || 0))}</span>)}
      </div>
    </div>
  );
}

function AttentionCard({ x, onOpen, onHandled }) {
  return (
    <article className="cv-q-card">
      <span className={`cv-q-ico ${x.tone === 'info' ? 'accent' : x.tone}`}><Icon name={x.icon} size={18} /></span>
      <div className="cv-col" style={{ gap: 6 }}>
        <span className={s.roomTag}><Icon name="MapPin" size={12} />{x.room}</span>
        <span style={{ fontWeight: 600 }}>{x.title}</span>
        <span className="cv-small cv-muted" style={{ lineHeight: 1.5 }}>{x.body}</span>
        {x.value && <div className="cv-row" style={{ gap: 8 }}><Claim k={x.claim || 'none'} /><span className="cv-xs cv-num cv-muted">{x.value}</span></div>}
      </div>
      <div className="cv-q-acts">
        <Button variant="ghost" size="sm" icon="Check" onClick={onHandled}>Handled</Button>
        <Button size="sm" variant={x.tone === 'bad' ? 'primary' : 'secondary'} iconRight="ArrowRight" onClick={onOpen}>{x.cta}</Button>
      </div>
    </article>
  );
}

function RoomCard({ r, real, onOpen }) {
  const status = r.status === 'sample' ? <Pill icon="FlaskConical">Sample data</Pill>
    : r.status === 'attention' ? <Pill tone="warn" icon="TriangleAlert">{r.open} to look at</Pill>
      : <Pill tone="good" icon="ShieldCheck">Quiet</Pill>;
  const feeds = r.feeds === 'sample' ? null
    : r.feeds === 'stale' ? <Pill tone="warn" icon="Clock">{real ? `Data ${r.dataAge} days old` : `${r.stale} feed${r.stale === 1 ? '' : 's'} stale`}</Pill>
      : <Pill tone="good" icon="CircleCheck">{real && r.dataEnd ? `Data to ${shortDate(r.dataEnd)}` : 'Feeds healthy'}</Pill>;
  return (
    <button type="button" className={`${s.room} ${s[r.status]}`} onClick={onOpen} aria-label={`Open ${r.name}'s week`}>
      <div className={s.roomHead}>
        <span className={s.roomName}>{r.name}</span>
        {status}
      </div>
      {r.counted ? (
        <div className={s.figs}>
          <div className={s.fig}>
            <span className={s.figLabel}>Banked /wk</span>
            <span className={`cv-fig md ${r.banked ? 'cv-up' : ''}`}>{cvMoney(r.banked)}</span>
            <span className={s.figFoot}><Claim k="book" />{r.paused > 0 && <span className="cv-xs cv-faint">{cvMoney(r.paused)} paused</span>}</span>
          </div>
          <div className={s.fig}>
            <span className={s.figLabel}>Earned /wk</span>
            <span className="cv-fig md">{cvMoney(Math.round(r.earned))}</span>
            <span className={s.figFoot}><Claim k="obs" /><span className="cv-xs cv-faint">on {cvMoney(Math.round(r.net))} sales</span></span>
          </div>
        </div>
      ) : (
        <div className={s.figs}>
          <div className={s.fig}>
            <span className={s.figLabel}>Banked /wk</span>
            <span className={`cv-fig md ${r.banked ? 'cv-up' : ''}`}>{cvMoney(r.banked)}</span>
            <span className={s.figFoot}><Claim k="book" /></span>
          </div>
          <div className={s.fig}>
            <span className={s.figLabel}>Earned /wk</span>
            <span className="cv-fig md cv-faint">—</span>
            <span className={s.figFoot}><span className="cv-xs cv-faint">Needs its own Toast data</span></span>
          </div>
        </div>
      )}
      {r.share != null && (
        <div className={s.share}>
          <span className="cv-xs cv-faint">{Math.round(r.share * 100)}% of what your rooms earned</span>
          <div className={s.shareBar}><span style={{ width: `${r.share * 100}%` }} /></div>
        </div>
      )}
      <div className={s.meta}>
        {r.alarms ? <Pill tone="bad" icon={real ? 'Undo2' : 'Siren'}>{r.alarms} {real ? 'reversed' : r.alarms === 1 ? 'alarm' : 'alarms'}</Pill> : <Pill tone="good" icon="ShieldCheck">No alarms</Pill>}
        <Pill tone={r.tests ? 'info' : 'neutral'} icon="Timer">{r.tests} test{r.tests === 1 ? '' : 's'} in flight</Pill>
        {feeds}
      </div>
      <span className={s.note}>{r.note}</span>
      <span className={s.open}>Open this room&apos;s week <Icon name="ArrowRight" size={16} /></span>
    </button>
  );
}

/* ================================================================ Portfolio */
function CvPortfolio() {
  const cv = useCv();
  const eng = useEngine();
  const real = eng.mode === 'server' && !!eng.org && !eng.org.sample;
  /* One clock for the render: the sample group lives on its own date. */
  const now = real ? Date.now() : Date.parse(`${CV_NOW.iso}T19:15:00Z`);
  const handled = Object.fromEntries(CV_GROUP.rows.map((r) => [r.id, eng.actions[r.id]?.[HANDLED_KEY] || {}]));
  const v = portfolioView(CV_GROUP, { real, windows: eng.windows || [], now, handled });
  const { rooms, totals, open } = v;
  const live = [...v.open, ...v.handled].map((x) => x.id);
  const n = rooms.length;
  const [showAll, setShowAll] = React.useState(false);
  const shown = showAll ? open : open.slice(0, 5);

  const mark = (x, on) => {
    const next = nextHandled(eng.actions[x.roomId]?.[HANDLED_KEY], x.roomId, x.id, on, live.filter((id) => id.startsWith(`${x.roomId}:`)));
    engine.act(HANDLED_KEY, next, { room: x.roomId, summary: `${x.room}: ${x.title}${on ? ' marked handled' : ' back on the list'}` });
    if (on) cv.toast('Marked handled. It comes back if anything changes.');
  };
  const openItem = (x) => { cv.pickRoom(x.roomId); cv.go(x.go, x.params); };
  const openRoom = (id) => { cv.pickRoom(id); cv.go('week'); };

  const over = `${eng.org?.name ?? 'Rosewood Restaurant Group'} · ${real ? (totals.dataEnd ? `data to ${shortDate(totals.dataEnd)}` : 'waiting for your data') : CV_NOW.week}`;
  const q = n === 1 ? 'How is the room doing this week?' : `How are ${WORDS[n] || `all ${n}`} rooms doing this week?`;
  const attentionRooms = new Set(open.filter((x) => x.tone !== 'info').map((x) => x.roomId)).size;

  return (
    <div className="cv-page wide">
      <PageHead over={over} q={q} sub="Every room on one page: what it banked and earned, and the few things worth your attention this week, most urgent first." />

      <div className={s.kpis}>
        <div className={`cv-card ${s.kpi}`}>
          <div className={s.kpiHead}><span className="cv-xs cv-faint">Banked this week, all rooms</span><Claim k="book" /></div>
          <span className={`cv-fig lg ${totals.banked ? 'cv-up' : ''}`}>{cvMoney(totals.banked)}</span>
          <span className="cv-xs cv-faint">{real ? 'Verified tests, at the lower bound of each interval' : totals.paused ? `${cvMoney(totals.paused)} paused while a guardrail is amber` : 'Nothing paused'}</span>
          {n > 1 && <Split rooms={rooms} k="banked" label="Banked" />}
        </div>
        <div className={`cv-card ${s.kpi}`}>
          <div className={s.kpiHead}><span className="cv-xs cv-faint">Earned this week{totals.counted < n ? `, ${totals.counted} of ${n} rooms` : ', all rooms'}</span><Claim k={totals.earned == null ? 'none' : 'obs'} /></div>
          <span className="cv-fig lg">{totals.earned == null ? '—' : cvMoney(Math.round(totals.earned))}</span>
          <span className="cv-xs cv-faint">{totals.earned == null ? 'Connect Toast to see what your rooms earn' : `Contribution margin on ${cvMoney(Math.round(totals.net))} of sales, from your registers`}</span>
          {n > 1 && totals.counted > 1 && <Split rooms={rooms.filter((r) => r.counted)} k="earned" label="Earned" />}
        </div>
        <div className={`cv-card ${s.kpi}`}>
          <div className={s.kpiHead}><span className="cv-xs cv-faint">Needs your attention</span>{open.length ? <Pill tone="warn" icon="TriangleAlert">{attentionRooms} of {n} rooms</Pill> : <Pill tone="good" icon="ShieldCheck">All quiet</Pill>}</div>
          <span className="cv-fig lg">{open.length}</span>
          <span className="cv-xs cv-faint">
            {[`${open.filter((x) => x.tone === 'bad').length} urgent`, `${open.filter((x) => x.tone === 'warn').length} to watch`, `${totals.tests} test${totals.tests === 1 ? '' : 's'} in flight`].join(' · ')}
            {v.handled.length ? ` · ${v.handled.length} handled` : ''}
          </span>
        </div>
      </div>

      <section className="cv-col" style={{ gap: 12 }} aria-labelledby="pf-attention">
        <div className={s.sectionHead}>
          <h3 id="pf-attention" className="cv-h4">Where to spend your attention</h3>
          <span className="cv-xs cv-faint">Mark an item handled and it stays off the list until something about it changes.</span>
        </div>
        {open.length ? (
          <div className={s.list}>
            {shown.map((x) => <AttentionCard key={x.id} x={x} onOpen={() => openItem(x)} onHandled={() => mark(x, true)} />)}
            {open.length > 5 && <Button variant="ghost" size="sm" icon={showAll ? 'ChevronUp' : 'ChevronDown'} onClick={() => setShowAll((x) => !x)} style={{ alignSelf: 'flex-start' }}>{showAll ? 'Show fewer' : `Show all ${open.length}`}</Button>}
          </div>
        ) : (
          <div className="cv-empty">
            <span className="ico"><Icon name="ShieldCheck" size={22} /></span>
            <span style={{ fontWeight: 600 }}>Nothing needs you across {n === 1 ? 'the room' : `${WORDS[n] || `all ${n}`} rooms`}</span>
            <span className="cv-small cv-muted">No alarms, no stale data, no reversed tests. Anything new shows up here first.</span>
          </div>
        )}
        {v.handled.length > 0 && (
          <details className={s.handled}>
            <summary><Icon name="CircleCheck" size={16} />Handled ({v.handled.length})</summary>
            {v.handled.map((x) => (
              <div key={x.id} className={s.handledRow}>
                <span><b>{x.room}</b> · {x.title} <span className="cv-faint">· {shortDate(x.handledAt)}</span></span>
                <Button variant="ghost" size="sm" icon="Undo2" onClick={() => mark(x, false)}>Put back</Button>
              </div>
            ))}
          </details>
        )}
      </section>

      <section className="cv-col" style={{ gap: 12 }} aria-labelledby="pf-rooms">
        <div className={s.sectionHead}>
          <h3 id="pf-rooms" className="cv-h4">{n === 1 ? 'Your room' : 'Room by room'}</h3>
          <span className="cv-xs cv-faint">Open a room to see its week. Every screen then follows that room.</span>
        </div>
        <div className={s.rooms}>
          {rooms.map((r) => <RoomCard key={r.id} r={r} real={real} onOpen={() => openRoom(r.id)} />)}
        </div>
      </section>

      {!real && <DensePortfolio />}
    </div>
  );
}

export { CvPortfolio };
