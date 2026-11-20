'use client';

import * as React from 'react';

import { Icon } from '../../kit';
import { useCv, CV_GROUP, CV_NOW } from '../core';
import { useEngine } from '../../engine';
import { HANDLED_KEY, portfolioView } from '../../../lib/data/page/portfolio';
import { MARKS, roomMark } from '../../../lib/data/page/scoreboard';
import s from './portfolio.module.css';

/**
 * The Scoreboard's two tabs: every room ranked (the `portfolio` page) and
 * one room day by day (the `daily` page). Both page ids stay, so every link
 * to Daily detail and All rooms still lands on the right tab.
 */
export const SCORE_TABS = [
  { id: 'portfolio', label: 'Every room', icon: 'Building2' },
  { id: 'daily', label: 'Day by day', icon: 'CalendarDays' },
];

/** The group's rooms with their mark (good, mid, bad), worked out the way the Every room tab does. */
export function useRoomMarks(period = 'week') {
  const eng = useEngine();
  const real = eng.mode === 'server' && !!eng.org && !eng.org.sample;
  const now = real ? Date.now() : Date.parse(`${CV_NOW.iso}T19:15:00Z`);
  const handled = Object.fromEntries(CV_GROUP.rows.map((r) => [r.id, eng.actions[r.id]?.[HANDLED_KEY] || {}]));
  const v = portfolioView(CV_GROUP, { real, windows: eng.windows || [], now, handled, period, comparison: 'own' });
  return v.rooms.map((r) => ({ id: r.id, name: r.name, short: r.short, mark: roomMark(r), rank: r.rank }));
}

/** The tab bar. On Day by day it also shows each room, marked, so switching rooms is one tap. */
export function ScoreTabs({ tab }) {
  const cv = useCv();
  const eng = useEngine();
  const rooms = useRoomMarks();
  const many = rooms.length > 1;
  const pick = (id) => {
    if (id === tab) return;
    if (id === 'daily' && !rooms.some((r) => r.id === eng.room)) cv.pickRoom(rooms[0]?.id);
    cv.go(id);
  };
  return (
    <div className={s.scoreBar}>
      <div className={s.scoreTabs} role="tablist" aria-label="Scoreboard">
        {SCORE_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? s.on : ''} onClick={() => pick(t.id)}>
            <Icon name={t.icon} size={16} />{t.label}
            {t.id === 'portfolio' && many && <span className={s.scoreCount}>{rooms.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'daily' && many && (
        <div className={s.roomChips} role="radiogroup" aria-label="Restaurant">
          {[...rooms].sort((a, b) => a.rank - b.rank).map((r) => {
            const M = MARKS[r.mark];
            return (
              <button key={r.id} type="button" role="radio" aria-checked={eng.room === r.id} className={`${s.roomChip} ${s['m' + r.mark]} ${eng.room === r.id ? s.on : ''}`} onClick={() => cv.pickRoom(r.id)} title={`${r.name}: ${M.room}`}>
                <Icon name={M.icon} size={13} />{r.short}<span className={s.sr}> · {M.room}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A sortable column header: tap to sort, tap again to flip. */
export function SortTh({ k, label, sort, setSort, right, first = 'desc' }) {
  const on = sort.key === k;
  const dir = on ? sort.dir : null;
  return (
    <th scope="col" className={right ? 'r' : undefined} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`${s.sortBtn} ${on ? s.on : ''}`} onClick={() => setSort({ key: k, dir: on ? (dir === 'asc' ? 'desc' : 'asc') : first })}>
        {label}<Icon name={!on ? 'ArrowUpDown' : dir === 'asc' ? 'ArrowUp' : 'ArrowDown'} size={12} />
      </button>
    </th>
  );
}

/** A good / mid / bad mark as a chip: icon and words, never colour alone. */
export function Mark({ mark, kind = 'day', label }) {
  const M = MARKS[mark] ?? MARKS.none;
  return <span className={`${s.mark} ${s['m' + mark]}`}><Icon name={M.icon} size={13} />{label ?? M[kind]}</span>;
}
