'use client';

/* Data inputs, at a glance: big numbers, a coverage ring, the opportunity
 * each kind of data holds up, the next fixes as cards, and the seven kinds as
 * tiles. Every chart answers on hover, focus and tap, and every value is also
 * reachable without hovering (labels, tiles, the editor). */

import * as React from 'react';
import Link from 'next/link';

import { Button, Icon } from '../../kit';
import { CV_ROOM, Claim, Pill } from '../core';
import { METHODS, SCHEMAS, STEP_ORDER } from '../../../lib/data/page/inputs';
import s from './inputs.module.css';

const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

/* Status of a kind's data, in the system's status colours (always with icon and label). */
export const STATE = {
  hand: { label: 'Yours', color: 'var(--success-500)', icon: 'CircleCheck' },
  linked: { label: 'Linked', color: 'var(--info-500)', icon: 'Link2' },
  stale: { label: 'Stale', color: 'var(--warning-500)', icon: 'TriangleAlert' },
  sample: { label: 'Sample', color: 'var(--neutral-300)', icon: 'CircleDashed' },
  none: { label: 'Missing', color: 'var(--neutral-600)', icon: 'CircleX' },
};
const ORDER = ['hand', 'linked', 'stale', 'sample', 'none'];

/* ------------------------------------------------------------------ hero numbers */
export function Hero({ rows, stakes, items }) {
  const own = rows.filter((r) => r.src.key === 'hand' || r.src.key === 'linked').length;
  const blocked = stakes.reduce((x, k) => x + k.blocked, 0);
  const blockedN = stakes.reduce((x, k) => x + k.blockedCount, 0);
  const attention = items.length;
  return (
    <div className={s.hero} role="group" aria-label="Data at a glance">
      <div className={s.stat}><span className={s.statLabel}>Your own data</span><b className={s.big}>{own}<small>/{rows.length}</small></b><span className={s.statSub}>kinds</span></div>
      <div className={`${s.stat} ${attention ? s.statWarn : ''}`}><span className={s.statLabel}>Need attention</span><b className={s.big}>{attention}</b><span className={s.statSub}>kinds missing or stale</span></div>
      <div className={`${s.stat} ${blockedN ? s.statBad : ''}`}><span className={s.statLabel}>Findings blocked</span><b className={s.big}>{blockedN}</b><span className={s.statSub}>until data arrives</span></div>
      <div className={s.stat}>
        <span className={s.statLabel}>Opportunity on hold</span>
        <b className={s.big}>{usd(blocked)}<small>/wk</small></b>
        <span className={s.statSub}><Claim k="est" /></span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ coverage ring */
export function Coverage({ rows, onPick }) {
  const [hover, setHover] = React.useState(null);
  const counts = ORDER.map((k) => ({ k, n: rows.filter((r) => r.src.key === k).length })).filter((x) => x.n);
  const total = rows.length;
  const R = 52, C = 2 * Math.PI * R, GAP = 3;
  let at = 0;
  const own = rows.filter((r) => r.src.key === 'hand' || r.src.key === 'linked').length;
  const shown = hover ? counts.find((c) => c.k === hover) : null;
  return (
    <div className={s.ringWrap}>
      <svg viewBox="0 0 140 140" className={s.ring} role="img" aria-label={`${own} of ${total} kinds are your own data. ${counts.map((c) => `${STATE[c.k].label} ${c.n}`).join(', ')}.`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--surface-sunken)" strokeWidth="14" />
        {counts.map((c) => {
          const len = (c.n / total) * C;
          const seg = (
            <circle key={c.k} cx="70" cy="70" r={R} fill="none" stroke={STATE[c.k].color} strokeWidth={hover === c.k ? 18 : 14}
              strokeDasharray={`${Math.max(0, len - GAP)} ${C}`} strokeDashoffset={-at} transform="rotate(-90 70 70)"
              style={{ transition: 'stroke-width var(--dur-fast)', cursor: 'pointer' }}
              onPointerEnter={() => setHover(c.k)} onPointerLeave={() => setHover(null)} />
          );
          at += len;
          return seg;
        })}
        <text x="70" y="68" textAnchor="middle" className={s.ringBig}>{shown ? shown.n : `${Math.round((own / total) * 100)}%`}</text>
        <text x="70" y="88" textAnchor="middle" className={s.ringSub}>{shown ? STATE[shown.k].label.toLowerCase() : 'your own data'}</text>
      </svg>
      <ul className={s.legendList} aria-label="Where this room's data comes from">
        {counts.map((c) => (
          <li key={c.k}>
            <button type="button" className={`${s.legendBtn} ${hover === c.k ? s.on : ''}`} onPointerEnter={() => setHover(c.k)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(c.k)} onBlur={() => setHover(null)}
              onClick={() => { const r = rows.find((x) => x.src.key === c.k); if (r) onPick(r.kind); }}>
              <i style={{ background: STATE[c.k].color }} /><Icon name={STATE[c.k].icon} size={13} /> {STATE[c.k].label} <b>{c.n}</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ opportunity bars */
export function StakeBars({ stakes, onPick }) {
  const [tip, setTip] = React.useState(null);
  const max = Math.max(1, ...stakes.map((k) => k.value));
  const rows = [...stakes].filter((k) => k.value > 0).sort((a, b) => b.blocked - a.blocked || b.value - a.value);
  if (!rows.length) return <div className={s.empty}>No finding rests on hand-entered data yet.</div>;
  return (
    <div className={s.bars}>
      <div className={s.barsLegend} aria-hidden="true">
        <span><i style={{ background: 'var(--error-500)' }} />On hold: data missing</span>
        <span><i style={{ background: 'var(--accent)' }} />Ready to act on</span>
      </div>
      {rows.map((k) => {
        const ready = k.value - k.blocked;
        const label = `${SCHEMAS[k.kind].title}: ${usd(k.value)} a week of potential opportunity across ${k.findings} finding${k.findings === 1 ? '' : 's'}${k.blocked ? `, ${usd(k.blocked)} on hold until the data arrives` : ''}. Open ${SCHEMAS[k.kind].title}.`;
        return (
          <button key={k.kind} type="button" className={s.barRow} aria-label={label} onClick={() => onPick(k.kind)}
            onPointerEnter={() => setTip(k.kind)} onPointerLeave={() => setTip(null)} onFocus={() => setTip(k.kind)} onBlur={() => setTip(null)}>
            <span className={s.barName}><Icon name={SCHEMAS[k.kind].icon} size={14} />{SCHEMAS[k.kind].title}</span>
            <span className={s.barTrack}>
              {k.blocked > 0 && <span className={s.barSeg} style={{ width: `${(k.blocked / max) * 100}%`, background: 'var(--error-500)' }} />}
              {ready > 0 && <span className={s.barSeg} style={{ width: `${(ready / max) * 100}%`, background: 'var(--accent)' }} />}
              {tip === k.kind && (
                <span className={s.tip} role="tooltip">
                  <b>{usd(k.value)}/wk</b> potential opportunity
                  {k.blocked > 0 && <><br /><b>{usd(k.blocked)}/wk</b> on hold</>}
                  <br />{k.findings} finding{k.findings === 1 ? '' : 's'}
                </span>
              )}
            </span>
            <span className={s.barVal}>{usd(k.value)}</span>
          </button>
        );
      })}
      <span className={s.barsFoot}>Potential opportunity per week, estimated <Claim k="est" /> · tap a bar to open that data</span>
    </div>
  );
}

/* ------------------------------------------------------------------ next fixes */
export function FixNext({ items, onOpen, onLink, server }) {
  const [why, setWhy] = React.useState(null);
  if (!items.length) {
    return (
      <div className={s.allGood}><Icon name="CircleCheck" size={22} color="var(--success-600)" /><div><b>Nothing missing</b><span>Every finding at {CV_ROOM.short} has the data it needs.</span></div></div>
    );
  }
  return (
    <div className={s.fixes}>
      {items.slice(0, 3).map((it, i) => {
        const m = METHODS[it.method];
        const action = it.method === 'toast'
          ? <Link className="btn btn-primary btn-sm" href="/connect"><Icon name="PlugZap" size={15} />Connect Toast</Link>
          : it.method === 'link' && server
            ? <Button size="sm" icon="Link2" onClick={() => onLink(it.kind)}>Link a sheet</Button>
            : <Button size="sm" icon={it.method === 'type' ? 'PencilLine' : 'Upload'} onClick={() => onOpen(it.kind, it.method === 'type' ? 'grid' : 'csv')}>{it.method === 'type' ? 'Enter it' : 'Upload it'}</Button>;
        const open = why === it.kind;
        return (
          <article key={it.kind} className={`${s.fix} ${i === 0 ? s.fixTop : ''}`} aria-labelledby={`fix-${it.kind}`}>
            <div className={s.fixHead}>
              <span className={`cv-q-ico ${it.blocked.length ? 'bad' : 'warn'}`}><Icon name={SCHEMAS[it.kind].icon} size={18} /></span>
              <span className={s.fixRank}>{i + 1}</span>
            </div>
            <b id={`fix-${it.kind}`} className={s.fixTitle}>{it.title}</b>
            {it.exposure > 0
              ? <span className={s.fixBig}>{usd(it.exposure)}<small>/wk on hold</small></span>
              : <span className={s.fixBig}>{it.feed?.state === 'off' ? 'Missing' : it.feed?.state === 'partial' ? 'Incomplete' : 'Stale'}</span>}
            <span className={s.fixMeta}>
              {it.blocked.length > 0 ? <Pill tone="bad" icon="Ban">{it.blocked.length} blocked</Pill> : <Pill tone="warn" icon="Clock">{it.last}</Pill>}
              <Pill icon={m.icon}>~{it.minutes} min</Pill>
            </span>
            <div className={s.fixAct}>
              {action}
              <button type="button" className={s.whyBtn} aria-expanded={open} onClick={() => setWhy(open ? null : it.kind)}>Why?</button>
            </div>
            {open && (
              <div className={s.whyBox}>
                <p>{it.missing}</p>
                <p><b>Why:</b> {it.why}</p>
                <p><b>Unlocks:</b> {it.unlocks}</p>
                {it.blocked.map((b) => <p key={b.id} className="cv-row" style={{ gap: 6 }}>{b.title} · {usd(b.value)}/wk <Claim k={b.claim || 'est'} /></p>)}
                <p><b>Best way in:</b> {m.label}. {m.how}</p>
                {it.method !== 'type' && <Button size="sm" variant="ghost" onClick={() => onOpen(it.kind, 'grid')}>Type it in instead</Button>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ the seven kinds */
export function KindTiles({ rows, kind, onPick }) {
  return (
    <div className={s.tiles} role="list" aria-label={`Data kinds for ${CV_ROOM.short}`}>
      {STEP_ORDER.map((k) => {
        const r = rows.find((x) => x.kind === k);
        const st = STATE[r.src.key] || STATE.sample;
        return (
          <button key={k} type="button" role="listitem" className={`${s.tile} ${k === kind ? s.on : ''}`} onClick={() => onPick(k)} aria-current={k === kind ? 'true' : undefined}
            aria-label={`${r.schema.title}: ${r.src.label}. ${r.entry ? `${r.entry.n} rows, ${r.entry.date}` : r.feed ? r.feed.last : ''}. Open.`}>
            <span className={s.tileBar} style={{ background: st.color }} />
            <Icon name={r.schema.icon} size={20} />
            <b>{r.schema.title}</b>
            <span className={s.tileState}><Icon name={st.icon} size={12} />{st.label}</span>
            <span className={s.tileWhen}>{r.entry ? `${r.entry.n.toLocaleString('en-US')} rows · ${r.entry.date}` : r.feed ? r.feed.last : 'Sample'}</span>
          </button>
        );
      })}
    </div>
  );
}
