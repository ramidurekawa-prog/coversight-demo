'use client';

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { assigneeLabel, cardState, isActive, queueView, todayCards, worthOf, unlocksOf } from '../../../lib/data/page/today';
import { areaOf, comingUp } from '../../../lib/data/page/today-brief';
import { CV_D, CV_DS, CV_GROUP, CV_NOW, Claim, cvMoney } from '../core';
import { ACCRUAL_START, deriveRoom, serviceTimes } from '../../../lib/data/model';
import { Panel } from './today.review';
import { dayLabel, shortMoney } from './today.last';
import { MAX_METRICS, METRICS, SCENARIOS, WIDGETS } from './today.layout';
import { FONTS, THEMES, tokensFor } from './today.themes';
import { AgeBar, HoursBar, MarkBar, PaceCurve, RefundBars, Spark, StaffBar } from './today.viz';
import { StaffingHours } from '../staffing';
import s from './today.module.css';

const money = (v) => cvMoney(Math.round(v));
const signPct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;
const DOW = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const longDow = (d) => DOW[d] || d;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function PanelTop({ over, title, onClose }) {
  return (
    <div className={s.panelHead}>
      <div className={s.panelHeadText}>{over && <span className={s.panelOver}>{over}</span>}<h2 className={s.panelTitle} tabIndex={-1} data-autofocus>{title}</h2></div>
      <button type="button" className={s.iconBtn} aria-label="Close" onClick={onClose}><Icon name="X" size={18} /></button>
    </div>
  );
}

/* ================================================================ states */

/**
 * The page's one vocabulary for where something stands. Always an icon and
 * a word, never colour alone. Money keeps its own claim chip (<Claim>).
 */
export const STATES = {
  review: { icon: 'ShieldCheck', label: 'Needs review', tone: 'attn' },
  todo: { icon: 'CircleDot', label: 'To do', tone: 'attn' },
  waiting: { icon: 'Lock', label: 'Waiting on data', tone: 'mute' },
  approved: { icon: 'CircleCheck', label: 'Approved', tone: 'info' },
  handling: { icon: 'UserCheck', label: 'Being handled', tone: 'info' },
  measuring: { icon: 'FlaskConical', label: 'Being measured', tone: 'info' },
  confirmed: { icon: 'BadgeCheck', label: 'Confirmed', tone: 'good' },
  done: { icon: 'CircleCheck', label: 'Done', tone: 'good' },
  snoozed: { icon: 'CalendarClock', label: 'Snoozed', tone: 'mute' },
  dismissed: { icon: 'CircleMinus', label: 'Not worth acting on', tone: 'mute' },
  delayed: { icon: 'TriangleAlert', label: 'Feed delayed', tone: 'warn' },
  ontrack: { icon: 'CircleCheck', label: 'On track', tone: 'good' },
  attention: { icon: 'CircleDot', label: 'Needs attention', tone: 'attn' },
};

export function StateChip({ k, label, n, as = 'span', ...rest }) {
  const st = STATES[k];
  const Tag = as;
  return (
    <Tag className={`${s.chip} ${s[`chip_${st.tone}`]}`} {...rest}>
      <Icon name={st.icon} size={13} />
      {n != null && <b>{n}</b>}
      <span>{label || st.label}</span>
    </Tag>
  );
}

/* ================================================================ status */

/** Context and one status, the headline, and one supporting sentence. */
export function Status({ brief, explain, period, now, sum, onFeeds, onCustomize, trial }) {
  const calm = brief.tone === 'calm';
  const k = calm ? 'ontrack' : sum.ready ? 'attention' : 'delayed';
  return (
    <header className={s.status}>
      <div className={s.statusRow}>
        <StateChip k={k} label={k === 'delayed' ? 'Waiting on data' : undefined} />
        {period.label && <span className={s.context}>{period.label} · {now.time}</span>}
        {brief.warn.length > 0 && (
          <button type="button" className={s.contextWarn} onClick={onFeeds} aria-haspopup="dialog" title={brief.warn.map((f) => `${f.name}: ${f.what}`).join('. ')}>
            <Icon name="TriangleAlert" size={13} />{brief.warn.length === 1 ? `${brief.warn[0].name} delayed` : `${brief.warn.length} data feeds delayed`}
          </button>
        )}
        <span className={s.statusTune}>{trial}</span>
        <button type="button" className={s.customize} onClick={onCustomize} aria-haspopup="dialog" aria-label="Customize Today"><Icon name="SlidersHorizontal" size={15} /><span>Customize</span></button>
      </div>
      <h2 className={s.headline}>{brief.headline}</h2>
      {explain && <p className={s.explain}>{explain}</p>}
    </header>
  );
}

/**
 * Right after a decision: what just happened and what comes next, as a short
 * track of steps. The first step is done; the rest say who or what moves it.
 */
export function Receipt({ r, onUndo, onClose }) {
  return (
    <section className={s.receipt} role="status" aria-live="polite" aria-label="What just happened">
      <span className={s.receiptIcon} aria-hidden="true"><Icon name={r.icon || 'CircleCheck'} size={18} /></span>
      <div className={s.receiptMain}>
        <span className={s.receiptTitle}>{r.title}</span>
        <ol className={s.track}>
          {r.steps.map((st, i) => (
            <li key={st} className={i === 0 ? s.trackDone : i === 1 ? s.trackNext : s.trackLater}>
              <span className={s.trackDot} aria-hidden="true">{i === 0 && <Icon name="Check" size={10} />}</span>
              <span>{st}</span>
            </li>
          ))}
        </ol>
      </div>
      <span className={s.receiptActs}>
        {onUndo && <button type="button" className={s.textBtn} onClick={onUndo}>Undo</button>}
        <button type="button" className={s.iconBtn} aria-label="Dismiss" onClick={onClose}><Icon name="X" size={16} /></button>
      </span>
    </section>
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
export function tileData({ d, dense, sv, flags, now, live = null }) {
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
      label, when: `Last service · ${day.dow} ${dayLabel(day.iso)}`, fig: k === 'net' ? money(day[k]) : String(day[k]), cmp: `${signPct(delta)} vs comparable ${longDow(day.dow)}s`, delta,
      viz: <Spark values={same.map((x) => x[k])} avg={avg} fmt={k === 'net' ? money : (v) => String(Math.round(v))} first={dayLabel(same[0].iso)} last={dayLabel(day.iso)} caption={`Last ${same.length} ${longDow(day.dow)}s`} />, claim: 'obs',
      facts: [[`${day.dow}, ${dayLabel(day.iso)}`, k === 'net' ? money(day[k]) : String(day[k])], [`Average of the ${prior.length} ${longDow(day.dow)}s before`, k === 'net' ? money(avg) : String(Math.round(avg))], ['Their range', k === 'net' ? `${money(Math.min(...prior.map((x) => x[k])))} to ${money(Math.max(...prior.map((x) => x[k])))}` : `${Math.min(...prior.map((x) => x[k]))} to ${Math.max(...prior.map((x) => x[k]))}`], ['Source', src(`through ${dayLabel(day.iso)}`)]],
      go: 'daily',
    };
  };
  const byWeek = (k, label) => {
    const isMoney = k === 'net' || k === 'earned';
    if (!(last && before.length >= 4) || flags.noHistory) return { label, when: last ? `Week of ${last.label}` : null, fig: last ? (isMoney ? money(last[k]) : String(last[k])) : null, cmp: 'Comparisons after 4 weeks of data', facts: [['Source', src()]], go: 'trends' };
    const avg = mean(before.map((r) => r[k]));
    return {
      label, when: `Week of ${last.label}`, fig: isMoney ? money(last[k]) : String(last[k]), cmp: `${signPct((last[k] - avg) / avg)} vs the 4 weeks before`, delta: (last[k] - avg) / avg,
      viz: <Spark values={rows.slice(-5).map((r) => r[k])} avg={avg} fmt={isMoney ? money : (v) => String(Math.round(v))} first={rows.at(-5).label} last={last.label} caption="Last 5 weeks" />, claim: 'obs',
      facts: [[`Week of ${last.label}`, isMoney ? money(last[k]) : String(last[k])], ['Average of the 4 weeks before', isMoney ? money(avg) : String(Math.round(avg))], ['Source', src()]], go: 'trends',
    };
  };
  t.sales = byDay('net', 'Sales') || byWeek('net', 'Sales');
  t.covers = byDay('covers', 'Covers') || byWeek('covers', 'Covers');
  // What's left of sales after food and labor: the owner's "are we making money", by week.
  t.margin = byWeek('earned', 'After food & labor');
  if (last && t.margin.fig) t.margin.facts = [[`Sales, week of ${last.label}`, money(last.net)], ['Food', money(last.food)], ['Labor', money(last.labour)], ['Left after food & labor', `${money(last.earned)} (${((last.earned / last.net) * 100).toFixed(1)}% of sales)`], ...t.margin.facts.filter(([k]) => k !== `Week of ${last.label}`)];
  if (flags.laborDown) {
    t.labor = { label: 'Labor', when: 'Last week', fig: null, cmp: 'Not updating', warn: '7shifts delayed', facts: [['Status', 'Labor shows again once 7shifts updates. Nothing here is guessed in the meantime.']], go: 'sources' };
  } else if (last && before.length >= 4 && !flags.noHistory) {
    const avg = mean(before.map((r) => r.labourRate));
    // Compare the figures as shown, so the words and the two numbers always agree.
    const pts = (a, b) => Math.round(a * 1000) / 10 - Math.round(b * 1000) / 10;
    const vs = (diff, what) => (Math.abs(diff) < 0.05 ? `Same as ${what}` : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} pts vs ${what}`);
    const pc = (v) => `${(v * 100).toFixed(1)}%`;
    // A target, when the owner has set one, comes first; "usual" is history, not a goal, so it's second.
    const target = d.profile?.laborTarget > 0 ? d.profile.laborTarget : null;
    const diff = pts(last.labourRate, target ?? avg);
    t.labor = {
      label: 'Labor', when: `Week of ${last.label}`, fig: pc(last.labourRate),
      cmp: target ? `${vs(diff, 'target')} · ${pc(avg)} usual` : `${vs(diff, 'usual')} · no target set`, delta: Math.abs(diff) < 0.05 ? 0 : diff / 100,
      viz: <MarkBar value={last.labourRate} mark={target ?? avg} max={Math.max(last.labourRate, target ?? avg) * 1.25} fmt={pc} label="Share of sales" tickLabel={target ? 'Target' : 'Usual'} />, claim: 'obs',
      warn: labor7?.state === 'stale' ? '7shifts delayed' : null,
      facts: [['Labor, share of sales', `${pc(last.labourRate)} (week of ${last.label})`], ...(target ? [['Your target', pc(target)]] : [['Target', 'Not set. Add one in your restaurant profile (Add & Manage Data).']]), ['Usual (the 4 weeks before)', pc(avg)], ['Labor cost', money(last.labour)], ['Source', `${src()}${labor7?.state === 'stale' ? `; 7shifts last updated ${labor7.last}` : ''}`]],
      go: 'labour',
    };
  } else {
    t.labor = { label: 'Labor', when: last ? `Week of ${last.label}` : null, fig: last ? `${(last.labourRate * 100).toFixed(1)}%` : null, cmp: 'Comparisons after 4 weeks of data', facts: [['Source', src()]], go: 'labour' };
  }
  const lt = live?.tonight;
  const clockOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: live?.tz }).toLowerCase() : null);
  const feedWarn = lt ? (lt.feeds.toast === 'down' ? 'Toast not updating' : lt.feeds.toast === 'stale' ? 'Toast delayed' : null) : null;
  const liveSrc = lt ? (lt.source === 'manual' ? `Entered by hand${lt.enteredBy ? ` by ${lt.enteredBy}` : ''} at ${clockOf(lt.asOf)}` : `Your Toast orders, updated ${clockOf(lt.asOf)}`) : null;
  const entry = lt ? { feeds: lt.feeds, error: lt.error, staffError: lt.staffError } : null;
  t.tonight = sv && sv.live
    ? {
      // Live pace on a room's own data: from Toast (or a manager's count), against its usual nights.
      label: 'Dinner pace', when: sv.source === 'manual' ? 'Tonight, your count' : 'Tonight, so far', live: true,
      fig: `${sv.pace >= 0 ? '+' : '−'}${Math.abs(sv.pace)}%`, cmp: `${sv.so} covers vs ${sv.usual} usual by ${clockOf(sv.asOf) || now?.time || 'now'}`, delta: sv.pace / 100,
      viz: sv.actual ? <PaceCurve comp={sv.comp} actual={sv.actual} times={serviceTimes(sv.comp.length)} /> : null, claim: sv.source === 'toast' ? 'obs' : null, warn: feedWarn,
      facts: [['Covers so far', String(sv.so)], sv.engine ? [`A usual ${sv.weekday}`, `${sv.usual} by the same time (Covercast’s forecast for tonight, the same one Service uses)`] : [`A usual ${sv.weekday}`, `${sv.usual} by the same time (average of the last ${sv.nights} ${sv.weekday}s)`], ['Pace so far', `${Math.abs(sv.pace)}% ${sv.pace >= 0 ? 'over' : 'under'} a usual ${sv.weekday}`],
        ...(sv.servers != null ? [['Servers on', `${sv.servers} (${sv.serversFrom === 'manual' ? 'entered by hand' : 'from 7shifts'})`]] : [['Servers on', 'Not known: connect 7shifts or enter it below']]), ['Source', liveSrc]],
      entry, go: 'service',
    }
    : lt && live.inService && lt.started
      ? {
        // In service with no pace to show: say why, and let the floor enter tonight's count.
        label: 'Tonight', when: 'Dinner', live: lt.so != null, fig: lt.so != null ? `${lt.so}` : null,
        cmp: lt.so != null ? `covers so far · no usual ${lt.weekday} to compare yet` : lt.feeds.toast === 'off' ? 'No live feed · enter covers' : 'Toast not updating · enter covers',
        warn: feedWarn, claim: lt.so != null && lt.source === 'toast' ? 'obs' : null,
        facts: [['Covers so far', lt.so != null ? String(lt.so) : 'Not known yet'], ...(lt.servers != null ? [['Servers on', `${lt.servers} (${lt.serversFrom === 'manual' ? 'entered by hand' : 'from 7shifts'})`]] : []), ['Pace', lt.comp ? 'Shows once covers come in' : `Needs at least 2 past ${lt.weekday}s of Toast orders (${lt.nights} so far)`], ['Source', liveSrc && lt.so != null ? liveSrc : lt.feeds.toast === 'off' ? 'Toast isn’t connected. Connect it, or enter tonight’s covers below.' : `Toast hasn’t answered${lt.error ? `: ${lt.error}` : ''}. Enter tonight’s covers below meanwhile.`]],
        entry, go: lt.feeds.toast === 'off' ? 'connect' : 'service',
      }
      : null;
  if (t.tonight) return t;
  t.tonight = sv
    ? {
      label: 'Dinner pace', when: 'Tonight, so far', live: true, fig: `${sv.pace >= 0 ? '+' : '−'}${Math.abs(sv.pace)}%`, cmp: `${sv.so} covers vs ${sv.usual} usual by ${CV_NOW.time}`, delta: sv.pace / 100,
      viz: <PaceCurve comp={sv.comp} actual={sv.actual} times={serviceTimes(sv.comp.length)} />, claim: 'obs',
      facts: [['Covers so far', `${sv.so} by ${CV_NOW.time} (the sample’s last count)`], [`A usual ${String(sv.day).split(' ')[0]}`, `${sv.usual} by the same time${sv.engine ? ' (Covercast’s forecast for tonight, the same one Service uses)' : ''}`], ['Pace so far', `${Math.abs(sv.pace)}% ${sv.pace >= 0 ? 'over' : 'under'} a usual ${String(sv.day).split(' ')[0]}`], ...(sv.tiles || []).map(([k, v, g]) => [k, `${v} (${g})`]), ['Source', src('live')]],
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
        const dir = t.delta == null || Math.abs(t.delta) < 0.0005 ? null : t.delta > 0 ? 'ArrowUpRight' : 'ArrowDownRight';
        return (
          <button key={id} type="button" className={s.tile} onClick={() => onOpen(id)} aria-haspopup="dialog">
            <span className={s.tileLabel}>{t.label}{t.when && <span className={`${s.tileWhen} ${t.live ? s.tileLive : ''}`}>{t.live && <i aria-hidden="true" />}{t.when}</span>}</span>
            <span className={s.tileFig}>{t.fig ?? <span className={s.tileNone}>—</span>}</span>
            <span className={s.tileFoot}>
              <span className={s.tileCmp}>{dir && <Icon name={dir} size={13} />}{t.cmp}</span>
              {t.warn && <StateChip k="delayed" label={typeof t.warn === 'string' ? t.warn : 'Feed delayed'} />}
            </span>
            {t.viz && <span className={s.tileViz}>{t.viz}</span>}
          </button>
        );
      })}
    </section>
  );
}

/**
 * Tonight by hand: covers so far and servers on, for while Toast or 7shifts
 * is missing or down. Saved for the room, labelled as entered by hand, and
 * replaced by the feed again once it's newer.
 */
export function LiveEntry({ entry, onSave }) {
  const [covers, setCovers] = React.useState('');
  const [servers, setServers] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const num = (v) => (v.trim() === '' ? null : Math.max(0, Math.round(+v)));
  const ok = (covers.trim() !== '' && Number.isFinite(+covers)) || (servers.trim() !== '' && Number.isFinite(+servers));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await onSave({ covers: num(covers), servers: num(servers) });
    setBusy(false);
    setMsg(r.ok ? 'Saved. Today uses your count until the feed is newer.' : r.error);
    if (r.ok) { setCovers(''); setServers(''); }
  };
  const down = [entry.feeds.toast === 'down' && 'Toast isn’t answering', entry.feeds.toast === 'off' && 'Toast isn’t connected', entry.feeds.staff === 'down' && '7shifts isn’t answering', entry.feeds.staff === 'off' && '7shifts isn’t connected'].filter(Boolean);
  return (
    <form className={s.entry} onSubmit={save} aria-label="Enter tonight by hand">
      <span className={s.entryHead}>Enter tonight by hand</span>
      {down.length > 0 && <span className={s.entryNote}>{down.join(' · ')}. Your count keeps Today working meanwhile.</span>}
      <span className={s.entryRow}>
        <label className={s.entryField}><span>Covers so far</span><input inputMode="numeric" pattern="[0-9]*" value={covers} onChange={(e) => setCovers(e.target.value)} placeholder="e.g. 64" /></label>
        <label className={s.entryField}><span>Servers on now</span><input inputMode="numeric" pattern="[0-9]*" value={servers} onChange={(e) => setServers(e.target.value)} placeholder="e.g. 4" /></label>
        <Button size="sm" type="submit" disabled={busy || !ok}>{busy ? 'Saving…' : 'Save'}</Button>
      </span>
      {msg && <span className={s.entryNote} role="status">{msg}</span>}
    </form>
  );
}

export function TilePanel({ t, onClose, onGo, onEntry }) {
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
        {t.entry && onEntry && <LiveEntry entry={t.entry} onSave={onEntry} />}
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
  // A range that spans a loss and a gain is uncertain, not a saving: say so and keep it quiet.
  const range = !un && / to /.test(w.figure || '');
  if (range) {
    return (
      <span className={`${s.worth} ${s.worthRange} ${big ? s.worthBig : ''}`} title={w.means || undefined}>
        <span className={s.worthTag}>Uncertain{(w.dollars ?? 0) < 0 ? ', could lose' : ''}</span>
        <span className={s.worthRangeFig}>{w.figure}{unit && <span className={s.worthUnit}>{unit.startsWith('/') ? '' : ' '}{unit}</span>}</span>
      </span>
    );
  }
  if (big) {
    return (
      <span className={`${s.worth} ${s.worthBig}`}>
        <span className={s.worthRow}>
          <span className={s.worthFig}>{w.about && <span className={s.worthPre}>about </span>}{w.figure || un.figure}{unit?.startsWith('/') && <span className={s.worthUnit}>{unit}</span>}</span>
          <Claim k={un ? un.claim : q.claim} label={un ? undefined : q.claimLabel} />
        </span>
        <span className={s.worthMeans}>{un ? 'What finishing this unlocks' : w.means}</span>
      </span>
    );
  }
  return (
    <span className={s.worth} title={w.means || 'What finishing this unlocks'}>
      <span className={s.worthFig}>
        {un && <span className={s.worthPre}>unlocks </span>}
        {w.about && <span className={s.worthPre}>about </span>}
        {w.figure || un.figure}
        {unit && <span className={s.worthUnit}>{unit.startsWith('/') ? '' : ' '}{unit}</span>}
      </span>
    </span>
  );
}

/** The one picture that says why: staffing, hours, data age. Null when there's none worth drawing. */
export function evidenceFor(q, d, sv) {
  const plan = d.room?.labour?.tue;
  if (sv && plan && q.approval && q.approval === sv.approval) {
    const at = /at (\d{1,2}):00/.exec(q.title)?.[1];
    const i = at ? plan.hours.indexOf(`${at} pm`) : -1;
    if (i >= 0) return <StaffBar on={plan.sched[i]} need={plan.need[i]} />;
  }
  if (/refund/i.test(`${q.means || ''} ${q.unit || ''}`)) {
    const apps = (d.room?.channels || []).filter((c) => /doordash|uber/i.test(c.name) && c.refunds > 0);
    if (apps.length) return <RefundBars rows={apps.map((c) => [c.name, c.refunds])} />;
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

/**
 * How the lead card reads, top to bottom: the problem, why, the picture that
 * shows it, then (beside it) the fix, what it's worth and the button. Every
 * word comes from the room's data; a staffing card names the hour from the
 * schedule against what's needed, and says so when the schedule is behind.
 */
export function frameFor(q, d, sv, trust = {}) {
  // A pre-shift staffing call: its own hours chart, from the schedule against the forecast's need.
  if (q.staffing && q.staffing.hoursRows && q.staffing.state === 'act') {
    return { problem: q.title, why: q.staffing.why, fix: q.staffing.short, viz: <StaffingHours dec={q.staffing} compact /> };
  }
  const plan = d.room?.labour?.tue;
  const first = (q.body || '').split(/(?<=\.)\s/)[0];
  if (sv && plan && q.approval && q.approval === sv.approval) {
    const at = /at (\d{1,2}):00/.exec(q.title)?.[1];
    const i = at ? plan.hours.indexOf(`${at} pm`) : -1;
    if (i >= 0) {
      const on = plan.sched[i];
      const need = plan.need[i];
      const fix = q.title.replace(/^Approve:\s*/i, '').replace(/^./, (c) => c.toUpperCase());
      const viz = <StaffBar on={on} need={need} />;
      const lighter = on > need && sv.pace < 0;
      if (trust.delayed) {
        return {
          problem: `Check ${at} pm staffing`,
          why: `${lighter ? 'Demand is lighter than planned. ' : ''}Confirm current coverage before reducing staff.`,
          fix, viz,
        };
      }
      return {
        problem: on > need ? `Overstaffed at ${at} pm` : on < need ? `Short-staffed at ${at} pm` : q.title,
        why: lighter ? 'Demand is lighter than planned.' : first,
        fix, viz,
      };
    }
  }
  const viz = evidenceFor(q, d, sv);
  // The picture already says it in numbers, so the sentence would only repeat it.
  return { problem: q.title, why: viz ? null : first, fix: null, viz };
}

/** When to act, as plainly as the data allows: "Review before 8 pm · 45 min left". */
export function dueFor(q, trust) {
  if (q.due) return q.due;
  if (trust?.before && trust.minsLeft != null) {
    return trust.minsLeft > 0 ? `Review before ${trust.before} · ${trust.minsLeft} min left` : `Past ${trust.before}`;
  }
  return q.deadline === 'today' ? 'Due today' : q.deadline ? `Due ${q.deadline}` : null;
}

/**
 * The lead card: problem → why → picture, then the fix, its worth and one
 * button. Calm by default (a light surface with an accent strip); the strong
 * dark treatment is kept for critical cards only. A card resting on a
 * delayed feed says so, and its button asks to verify first.
 */
export function ActionCard({ q, cards, frame, trust, label, busy, due, onPrimary, onDetails }) {
  const strong = !!q.critical;
  const one = trust?.delayed ? 'delayed' : q.approval ? 'review' : 'todo';
  return (
    <section id={`card-${q.id}`} className={`${s.action} ${strong ? s.actionStrong : ''}`} aria-labelledby={`a-${q.id}`} aria-busy={busy || undefined}>
      <div className={s.actionMain}>
        <div className={s.actionTop}>
          <StateChip k={one} label={one === 'delayed' ? 'Data delayed' : undefined} />
          {due && <span className={s.actionDue}><Icon name="Clock" size={13} />{due}</span>}
        </div>
        <h3 id={`a-${q.id}`} className={s.actionTitle}>{frame.problem}</h3>
        {frame.why && <p className={s.actionWhy}>{frame.why}</p>}
        {frame.viz && <div className={s.actionViz}>{frame.viz}</div>}
      </div>
      <div className={s.actionSide}>
        {frame.fix && <span className={s.actionFix}><Icon name={q.icon || 'CircleDot'} size={15} />{frame.fix}</span>}
        <Worth q={q} cards={cards} big />
        <Button size="lg" className={s.actionBtn} iconRight="ArrowRight" disabled={busy} aria-busy={busy || undefined} onClick={onPrimary}>{label}</Button>
        <button type="button" className={s.seeWhy} onClick={onDetails} aria-haspopup="dialog">See why<Icon name="ChevronRight" size={14} /></button>
      </div>
    </section>
  );
}

/** A compact card: icon, title, the money; the whole thing opens its details. */
/** Who can act on a row, in two or three words. */
function actorOf(q) {
  if (q.blocked) return null;
  if (q.approval) return 'GM or owner';
  if (q.task) return `In ${q.task.system}`;
  if (q.kind === 'data' || q.go === 'inputs') return 'Anyone';
  return null;
}

export function IssueRow({ q, cards, onOpen, waitingOn = null }) {
  const due = q.due || (q.deadline === 'today' ? 'Today' : q.deadline ? `Due ${q.deadline}` : null);
  const who = actorOf(q);
  return (
    <li>
      <button type="button" className={`${s.row} ${q.blocked ? s.rowBlocked : ''}`} onClick={onOpen} aria-haspopup="dialog">
        <span className={s.rowIcon} aria-hidden="true"><Icon name={q.blocked ? 'Lock' : q.icon || 'CircleDot'} size={16} /></span>
        <span className={s.rowText}>
          <span className={s.rowTitle}>{q.title}</span>
          {q.affects && !q.blocked && <span className={s.rowSub}>{q.affects}</span>}
          {q.blocked ? (waitingOn ? <span className={s.rowSub}>Waiting on: {waitingOn}</span> : <StateChip k="waiting" />)
            : (due || who) ? <span className={s.rowMeta}>{due && <span className={s.rowDue}><Icon name="Clock" size={12} />{due}</span>}{who && <span className={s.rowWho}><Icon name="UserCheck" size={12} />{who}</span>}</span> : null}
        </span>
        <span className={s.rowEnd}>
          <Worth q={q} cards={cards} />
          <Icon name="ChevronRight" size={16} className={s.rowChev} />
        </span>
      </button>
    </li>
  );
}

/* ================================================================ the three summaries */

const TASK_STATE = {
  open: { icon: 'CircleDashed', label: 'To make' },
  mismatch: { icon: 'MessageSquareWarning', label: 'Marked made; data doesn’t show it yet' },
  done: { icon: 'Hourglass', label: 'Made · checking the data' },
};

/** Everything under way, counted once, for the card and its panel. */
export function handledOf({ cards, view, tasks, windows, d }) {
  const assigned = cards.filter((c) => cardState(c, view) === 'assigned');
  const live = tasks.filter((t) => TASK_STATE[t.status]);
  const tests = (d.proofs || []).filter((p) => p.outcome === 'testing');
  const extra = windows.filter((w) => !tests.some((p) => p.lever === w.lever));
  const decided = Object.keys(view.done).length + Object.keys(view.refused).length + Object.keys(view.snoozed).length;
  const states = [
    { k: 'approved', n: live.filter((t) => t.status === 'open').length, label: 'approved, to make' },
    { k: 'handling', n: live.filter((t) => t.status !== 'open').length, label: 'made, checking data' },
    { k: 'handling', n: assigned.length, label: 'assigned' },
    { k: 'measuring', n: tests.length + extra.length, label: 'being measured' },
    { k: 'done', n: decided, label: 'decided today' },
  ].filter((x) => x.n);
  return { assigned, live, tests, extra, states };
}

export function HandledPanel({ h, view, d, busy, onUndo, onDone, onAck, meId, steps, decided, onClose }) {
  return (
    <Panel label="Being handled" onClose={onClose}>
      <PanelTop over="Today" title="Being handled" onClose={onClose} />
      <div className={s.panelBody}>
        {(h.live.length + h.assigned.length + h.tests.length + h.extra.length) > 0 ? (
          <ul className={s.handled}>
            {h.live.map((t) => (
              <li key={t.id}>
                <Icon name={TASK_STATE[t.status].icon} size={15} className={s.hIcon} />
                <span className={s.hText}><span className={s.hTitle}>{t.title}</span><span className={s.hSub}>{t.system} · {TASK_STATE[t.status].label}</span></span>
              </li>
            ))}
            {h.assigned.map((c) => (
              <li key={c.id}>
                <Icon name="UserCheck" size={15} className={s.hIcon} />
                <span className={s.hText}><span className={s.hTitle}>{c.title}</span><span className={s.hSub}>{(() => { const a = view.assigned[c.id]; const mine = meId && a.to === meId; return `${mine ? 'You' : assigneeLabel(a.to, d.profile, a.name)} · ${a.ack ? 'seen' : a.to.startsWith('user:') ? 'not seen yet' : 'not done yet'}`; })()}</span></span>
                <span className={s.hActs}>
                  {meId && view.assigned[c.id].to === meId && !view.assigned[c.id].ack && onAck && <button type="button" className={s.textBtn} disabled={busy === c.id} onClick={() => onAck(c)}>Got it</button>}
                  {!c.approval && !c.task && !c.start && !c.blocked && <button type="button" className={s.textBtn} disabled={busy === c.id} onClick={() => onDone(c)}>Done</button>}
                  <button type="button" className={s.textBtn} disabled={busy === c.id} onClick={() => onUndo(c.id)}>Take back</button>
                </span>
              </li>
            ))}
            {h.tests.map((p) => (
              <li key={p.id}>
                <Icon name="FlaskConical" size={15} className={s.hIcon} />
                <span className={s.hText}><span className={s.hTitle}>{p.title}</span><span className={s.hSub}>{p.checkpoint || 'Measuring'} · result {p.closes}</span></span>
                {typeof p.progress === 'number' && <span className={s.hMeter} aria-label={`${p.progress}% of the test window`}><span style={{ width: `${p.progress}%` }} /></span>}
              </li>
            ))}
            {h.extra.map((w) => (
              <li key={w.id || w.lever}>
                <Icon name="FlaskConical" size={15} className={s.hIcon} />
                <span className={s.hText}><span className={s.hTitle}>{w.title || w.lever}</span><span className={s.hSub}>{w.status === 'waiting' ? 'Waiting to start' : 'Measuring'}</span></span>
              </li>
            ))}
          </ul>
        ) : <p className={s.blockText}>Nothing is under way. Approvals, assignments and tests show here.</p>}
        {steps}
        {decided}
      </div>
    </Panel>
  );
}

/** Coming up: a few time markers, only when there's something to prepare for. */
export function comingSoon({ d, cards, view, now, todayIso, skip = [] }) {
  const year = todayIso.slice(0, 4);
  const soon = (when) => {
    const t = Date.parse(`${when} ${year} 12:00 UTC`);
    return Number.isNaN(t) || (t - Date.parse(`${todayIso}T12:00:00Z`)) / 864e5 <= 7;
  };
  return comingUp(d, { cards, view, now, max: 8 }).filter((x) => x.tone !== 'ok' && soon(x.when) && !skip.includes(x.key)).slice(0, 2);
}

/**
 * One slim strip under the list: what's being handled, the confirmed results
 * (never mixed with estimates) and the next thing coming up. Each part opens
 * its detail.
 */
export function ActivityStrip({ h, confirmed, soon, onHandled, onResults, onGo, flash }) {
  const next = soon[0];
  // The test that reports first: what it measures and when, so "being measured" says something.
  const tests = [...h.tests].filter((p) => p.closes).sort((a, b) => Date.parse(`${a.closes} 2026`) - Date.parse(`${b.closes} 2026`));
  const first = tests[0];
  return (
    <section className={`${s.strip} ${flash ? s.stripFlash : ''}`} aria-label="Activity and results">
      <button type="button" className={s.stripPart} onClick={onHandled} aria-haspopup="dialog">
        <span className={s.stripHead}>Being handled</span>
        <span className={s.stripBody}>
          {h.states.length ? h.states.map((x) => (
            <span key={`${x.k}-${x.label}`} className={s.stripState}><Icon name={STATES[x.k].icon} size={14} className={s[`ic_${STATES[x.k].tone}`]} /><b>{x.n}</b> {x.label}</span>
          )) : <span className={s.stripMute}>Nothing under way</span>}
          {first && <span className={s.stripDetail}>{first.title} · result {first.closes}</span>}
        </span>
      </button>
      <button type="button" className={s.stripPart} onClick={onResults} aria-haspopup="dialog">
        <span className={s.stripHead}>Your improvements</span>
        <span className={s.stripBody}>
          {confirmed.week > 0 ? (
            <>
              <span className={s.stripState}><Icon name="BadgeCheck" size={14} className={s.ic_good} /><b>{money(confirmed.week)}/wk</b> confirmed</span>
              <span className={s.stripMute}>{money(confirmed.toDate)} since {ACCRUAL_START}</span>
            </>
          ) : (
            <>
              <span className={s.stripState}><Icon name="Hourglass" size={14} className={s.ic_muted} />None confirmed yet</span>
              {first && <span className={s.stripDetail}>{h.tests.length} {h.tests.length === 1 ? 'test' : 'tests'} running · first result {first.closes}</span>}
            </>
          )}
        </span>
      </button>
      {next && (
        <button type="button" className={s.stripPart} onClick={() => next.go && onGo(next.go)} disabled={!next.go}>
          <span className={s.stripHead}>Coming up</span>
          <span className={s.stripBody}>
            {soon.map((x) => (
              <span key={x.key} className={s.stripState}><b>{x.when}</b> <span className={s.stripMute}>{/^hour-/.test(x.key) ? x.detail : x.detail === 'Test result due' ? 'test result' : x.title}</span></span>
            ))}
          </span>
        </button>
      )}
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
        <span className={s.sectionSub}>Ranked by what needs you</span>
      </div>
      <ul className={s.locList}>
        {rows.map((r) => {
          const d = deriveRoom(CV_DS, r.id);
          const cards = todayCards(d, { today, testing: [], dismissed: eng.actions?.[r.id]?.findings || {}, tasks: (eng.tasks || []).filter((t) => t.roomId === r.id) });
          const view = queueView(eng.actions?.[r.id]?.queue, { today, own: !!d.room.fromToast, tz: d.room.tz || tz, cards });
          const ready = cards.filter((c) => isActive(c, view) && !c.blocked);
          const open = ready.length;
          // Material first: what's due tonight, then the money on the table, then how many.
          const due = ready.filter((c) => c.deadline === 'today' || c.approval).length;
          const stake = Math.max(0, ...ready.map((c) => worthOf(c).dollars ?? 0));
          const top = ready.find((c) => areaOf(c) !== 'data') || ready[0];
          return { r, d, open, due, stake, top };
        }).sort((a, b) => b.due - a.due || b.stake - a.stake || b.open - a.open).map(({ r, d, open, due, top }) => (
          <li key={r.id}>
            <button type="button" className={`${s.loc} ${r.id === CV_D.id ? s.locOn : ''}`} aria-current={r.id === CV_D.id ? 'true' : undefined} onClick={() => onPick(r.id)}>
              <span className={s.locName}>{r.name}</span>
              <span className={s.locFig}>{open}<span className={s.locUnit}> to decide{due ? ` · ${due} due today` : ''}</span></span>
              <span className={s.locSub}>
                {r.stale ? <span className={s.snapWarn}><Icon name="TriangleAlert" size={12} />{r.stale} feed{r.stale === 1 ? '' : 's'} behind</span> : <span>Data current</span>}
                <span>{r.banked ? `${money(r.banked)}/wk confirmed` : 'No confirmed savings yet'}</span>
              </span>
              <span className={s.locNote}>{top ? top.title : 'Nothing needs a decision'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ================================================================ customize */

export function CustomizePanel({ layout, custom, role, tiles, onSave, onRestore, onClose }) {
  // Every change applies at once and is kept in this browser; "Done" just closes.
  const m = layout.metrics;
  const w = layout.widgets;
  const full = m.length >= MAX_METRICS;
  const setM = (next) => next.length && onSave({ metrics: next, widgets: w });
  const toggleM = (id) => setM(m.includes(id) ? m.filter((x) => x !== id) : full ? m : [...m, id]);
  const move = (id, by) => {
    const i = m.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= m.length) return;
    const next = [...m];
    [next[i], next[j]] = [next[j], next[i]];
    setM(next);
  };
  const toggleW = (id) => onSave({ metrics: m, widgets: w.includes(id) ? w.filter((x) => x !== id) : [...w, id] });
  const order = [...m, ...Object.keys(METRICS).filter((id) => !m.includes(id))];
  return (
    <Panel label="Customize Today" onClose={onClose}>
      <PanelTop over={{ gm: 'General manager view', floor: 'Floor manager view' }[role] || 'Owner view'} title="Customize Today" onClose={onClose} />
      <div className={s.panelBody}>
        <section className={s.block}>
          <h3 className={s.blockTitle}>Key numbers <span className={s.blockCount}>{m.length} of {MAX_METRICS} shown</span></h3>
          <ul className={s.pickList}>
            {order.map((id) => {
              const on = m.includes(id);
              const t = tiles?.[id];
              const i = m.indexOf(id);
              const blocked = !on && full;
              return (
                <li key={id} className={`${s.pick} ${on ? s.pickOn : ''}`}>
                  <button type="button" className={s.pickMain} aria-pressed={on} disabled={blocked || (on && m.length === 1)} onClick={() => toggleM(id)}
                    title={blocked ? 'Hide one to add another' : undefined}>
                    <span className={s.pickBox} aria-hidden="true">{on && <Icon name="Check" size={13} />}</span>
                    <span className={s.pickText}>
                      <span className={s.pickLabel}>{t?.label || METRICS[id]}</span>
                      {t?.when && <span className={s.pickWhen}>{t.when}</span>}
                    </span>
                    <span className={s.pickFig}>{t?.fig ?? '—'}</span>
                  </button>
                  {on && (
                    <span className={s.orderBtns}>
                      <button type="button" className={s.iconBtn} aria-label={`Move ${METRICS[id]} up`} disabled={i === 0} onClick={() => move(id, -1)}><Icon name="ChevronUp" size={16} /></button>
                      <button type="button" className={s.iconBtn} aria-label={`Move ${METRICS[id]} down`} disabled={i === m.length - 1} onClick={() => move(id, 1)}><Icon name="ChevronDown" size={16} /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className={s.blockNote}>{full ? 'Showing 3. Hide one to add another.' : 'Tap a number to show it.'} Arrows set the order: top shows first.</p>
        </section>
        <section className={s.block}>
          <h3 className={s.blockTitle}>Extras, below everything else</h3>
          <ul className={s.pickList}>
            {Object.entries(WIDGETS).map(([id, x]) => {
              const on = w.includes(id);
              return (
                <li key={id} className={`${s.pick} ${on ? s.pickOn : ''}`}>
                  <button type="button" className={s.pickMain} aria-pressed={on} onClick={() => toggleW(id)}>
                    <span className={s.pickBox} aria-hidden="true">{on && <Icon name="Check" size={13} />}</span>
                    <span className={s.pickText}><span className={s.pickLabel}>{x.label}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <p className={s.blockNote}>Changes show right away and are kept in this browser. The status, the action and what’s in progress always show.</p>
      </div>
      <div className={s.panelFoot}>
        <Button size="lg" className={s.panelPrimary} onClick={onClose}>Done</Button>
        <div className={s.panelMore}>
          <Button size="sm" variant="secondary" disabled={!custom} onClick={onRestore}>Restore defaults</Button>
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

/* ================================================================ color trial */

const TRIAL = [['original', 'Original'], ...Object.entries(THEMES).map(([id, t]) => [id, t.label])];

/** The experimental palette switch: a segmented control on wide screens, a menu on small ones. */
/** The font trial: each option shows its name in its own typeface. Tools only. */
export function FontPicker({ font, onPick }) {
  return (
    <div className={s.trial} title="Font trial. Changes the type on Today and the top bar; nothing else.">
      <span className={s.trialLbl}><Icon name="Type" size={14} /><span className={s.srOnly}>Font trial</span></span>
      <div className={s.seg} role="radiogroup" aria-label="Font trial">
        {Object.entries(FONTS).map(([id, f]) => (
          <button key={id} type="button" role="radio" aria-checked={font === id} className={s.segBtn} title={f.note} onClick={() => onPick(id)}
            style={{ fontFamily: f.sans || "'IBM Plex Sans', sans-serif" }}>{f.label}</button>
        ))}
      </div>
      <select className={s.trialSelect} aria-label="Font trial" value={font} onChange={(e) => onPick(e.target.value)}>
        {Object.entries(FONTS).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}
      </select>
    </div>
  );
}

export function ThemePicker({ theme, onPick, onCompare }) {
  const tip = 'Experimental color trial. Changes the colors on Today only; the data and layout stay the same.';
  return (
    <div className={s.trial} title={tip}>
      <span className={s.trialLbl}><Icon name="Palette" size={14} /><span className={s.srOnly}>Color trial</span></span>
      <div className={s.seg} role="radiogroup" aria-label="Color trial">
        {TRIAL.map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={theme === id} className={s.segBtn} onClick={() => onPick(id)}>
            {id !== 'original' && <span className={s.segDot} style={{ background: THEMES[id].p.cta }} aria-hidden="true" />}
            {id === 'original' ? 'Original' : label}
          </button>
        ))}
      </div>
      <select className={s.trialSelect} aria-label="Color trial" value={theme} onChange={(e) => onPick(e.target.value)}>
        {TRIAL.map(([id, label]) => <option key={id} value={id}>{id === 'original' ? 'Original colors' : label}</option>)}
      </select>
      <button type="button" className={s.iconBtn} onClick={onCompare} aria-haspopup="dialog" aria-label="Compare color themes" title="Compare themes"><Icon name="Columns3" size={16} /></button>
    </div>
  );
}

/**
 * All three palettes side by side, each drawn with the page's real figures
 * (the first key number and the lead card), so nothing here is made up.
 * Picking one applies it to the page.
 */
export function ComparePanel({ theme, onPick, onClose, metric, lead, worth }) {
  return (
    <Panel label="Compare color themes" onClose={onClose} wide>
      <PanelTop over="Color trial" title="Compare themes" onClose={onClose} />
      <div className={s.panelBody}>
        <p className={s.blockNote}>A visual trial only: the data, layout and actions are identical in every theme.</p>
        <div className={s.cmpGrid}>
          {Object.entries(THEMES).map(([id, t]) => (
            <button key={id} type="button" className={`${s.pv} ${theme === id ? s.pvOn : ''}`} style={tokensFor(id)} onClick={() => { onPick(id); onClose(); }} aria-pressed={theme === id}>
              <span className={s.pvHead}><b>{t.label}</b>{theme === id && <span className={s.pvOnTag}><Icon name="Check" size={12} />In use</span>}</span>
              <span className={s.pvNote}>{t.note}</span>
              <span className={s.pvSw} aria-hidden="true">{[t.p.bg, t.p.surface, t.p.text, t.p.cta, t.p.accent].map((c, i) => <span key={i} style={{ background: c }} />)}</span>
              {metric && (
                <span className={s.pvMetric}><span className={s.pvLbl}>{metric.label}</span><span className={s.pvFig}>{metric.fig ?? '—'}</span><span className={s.pvLbl}>{metric.when}</span></span>
              )}
              {lead && (
                <span className={s.pvCard}><span className={s.pvTitle}>{lead}</span>{worth && <span className={s.pvLbl}>{worth}</span>}</span>
              )}
              <span className={`btn btn-primary ${s.pvBtn}`}>Use {t.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className={s.textLink} onClick={() => { onPick('original'); onClose(); }}>Reset to original colors<Icon name="RotateCcw" size={13} /></button>
      </div>
    </Panel>
  );
}
