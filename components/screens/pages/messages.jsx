'use client';

/* What we send · every message Coversight writes for the team, shown as the
   person gets it: the GM's morning text, the owner's Monday email, the "it
   worked" note, the chef's prep list and order guide, and the first-week
   report. All written by lib/data/page/messages.js (and portfolio.js for the
   owner) from the room's own records; nothing here is typed in. */

import * as React from 'react';
import { Button, Icon } from '../../kit';
import { useEngine } from '../../engine';
import { useCv, cvMoney, CV_D, CV_DS, CV_GROUP, CV_NOW, Claim, Callout, PageHead, Pill } from '../core';
import { useCovercast } from '../covercast';
import { dayLoop } from '../../../lib/ai/loop.js';
import { portfolioView, weeklySummary } from '../../../lib/data/page/portfolio';
import { firstWeek, itWorked, morningText, orderGuide, prepList } from '../../../lib/data/page/messages.js';

const WHO = [
  ['gm', 'GM', 'MessageSquare'],
  ['owner', 'Owner', 'Mail'],
  ['chef', 'Chef', 'ChefHat'],
  ['worked', 'It worked', 'Sparkles'],
  ['first', 'First week', 'Sprout'],
];
const dateWord = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

function Copy({ text }) {
  const cv = useCv();
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); cv.toast('Copied.'); } catch { cv.toast('Couldn’t copy here. Select the text instead.'); }
  };
  return <Button size="sm" variant="secondary" icon="Copy" onClick={copy}>Copy</Button>;
}

/** The head of each message: who gets it, when, and how. */
function Head({ icon, who, when, how, right }) {
  return (
    <div className="cv-card-head" style={{ alignItems: 'flex-start' }}>
      <div className="cv-row nowrap" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="cv-q-ico"><Icon name={icon} size={18} /></span>
        <div className="cv-col" style={{ gap: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>{who}</span>
          <span className="cv-small cv-muted">{when} · {how}</span>
        </div>
      </div>
      {right}
    </div>
  );
}

const bubble = { maxWidth: 420, padding: '12px 14px', borderRadius: 18, borderBottomLeftRadius: 6, background: 'var(--surface-sunken)', fontSize: 16, lineHeight: 1.45 };
const paper = { padding: 16, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.55 };

function GmText({ L }) {
  const t = morningText(CV_D, L, { link: 'coversight-demo.vercel.app' });
  return (
    <section className="cv-card" aria-label="The GM's morning text">
      <Head icon="MessageSquare" who={`Morning text to ${CV_D.profile?.gm ?? 'the GM'}`} when="Every day, 8 am" how={`${t.text.length} characters, one text`} right={<Copy text={t.text} />} />
      <div style={bubble}>{t.text}</div>
      <span className="cv-row" style={{ gap: 8 }}>
        <Claim k="obs" label="Last night and invoice dollars: from your data" />
        <Claim k="mod" label="Today's guests and staffing: Covercast" />
      </span>
    </section>
  );
}

function OwnerEmail() {
  const eng = useEngine();
  const real = eng.mode === 'server' && !!eng.org && !eng.org.sample;
  const now = real ? Date.now() : Date.parse(`${CV_NOW.iso}T19:15:00Z`);
  const v = portfolioView(CV_GROUP, { real, windows: eng.windows || [], now });
  const g = weeklySummary(v, eng.org?.name || 'Your group');
  return (
    <section className="cv-card" aria-label="The owner's Monday email">
      <Head icon="Mail" who="Monday email to the owner" when="Mondays, 7 am" how="Email" right={<Copy text={`${g.title}\n\n${g.body}`} />} />
      <div style={paper}><b>{g.title}</b>{'\n\n'}{g.body}</div>
      <span className="cv-row" style={{ gap: 8 }}><Claim k="book" label="Only verified savings are called savings" /></span>
    </section>
  );
}

function ChefLists({ cc }) {
  const prep = prepList(cc);
  const guide = orderGuide(CV_D.room, CV_DS.recipes, cc);
  if (!prep.ready) return <Callout icon="Info">{prep.why}</Callout>;
  const prepText = `Prep for ${dateWord(prep.iso)} (about ${prep.guests} guests)\n${prep.rows.map((r) => `${r.item}: ${r.prep}`).join('\n')}`;
  const orderText = guide.ready ? Object.entries(guide.byVendor).map(([v, rows]) => `${v}\n${rows.map((r) => `  ${r.item}: ${r.order} ${r.unit}`).join('\n')}`).join('\n\n') : '';
  return (
    <div className="cv-grid g2">
      <section className="cv-card" aria-label="The chef's prep list">
        <Head icon="ChefHat" who="Prep list for the chef" when={`${dateWord(prep.iso)}, sent the night before`} how="Text or printed" right={<Copy text={prepText} />} />
        <span className="cv-small cv-muted">About {prep.guests} guests ({prep.low} to {prep.high}). Each dish is sized so running out and throwing away cost about the same.</span>
        <table className="cv-table">
          <thead><tr><th>Dish</th><th className="num">We expect</th><th className="num">Prep</th></tr></thead>
          <tbody>{prep.rows.map((r) => <tr key={r.item}><td>{r.item}</td><td className="num">{r.expect}</td><td className="num"><b>{r.prep}</b></td></tr>)}</tbody>
        </table>
        <span style={{ alignSelf: 'flex-start' }}><Claim k="mod" label="From Covercast's guest forecast" /></span>
      </section>
      <section className="cv-card" aria-label="The order guide">
        <Head icon="Truck" who="Order guide" when={guide.ready ? `Next ${guide.days} days, ${guide.guests} guests` : 'Next 3 days'} how="By vendor" right={guide.ready ? <Copy text={orderText} /> : null} />
        {guide.ready ? (
          <>
            <span className="cv-small cv-muted">What the dishes above use, from their recipes, less what the last count had on hand{guide.counted ? '' : ' (no count on file yet, so nothing is taken off)'}.</span>
            {Object.entries(guide.byVendor).map(([vendor, rows]) => (
              <div key={vendor} className="cv-col" style={{ gap: 6 }}>
                <span className="cv-over">{vendor}</span>
                {rows.map((r) => (
                  <div key={r.item} className="cv-row nowrap" style={{ gap: 8, justifyContent: 'space-between' }}>
                    <span className="cv-col" style={{ gap: 2, minWidth: 0 }}>
                      <span>{r.item}: <b>{r.order} {r.unit}</b>{r.have != null ? <span className="cv-xs cv-faint"> · {r.have} on hand</span> : null}</span>
                      {r.ask && <span className="cv-xs" style={{ color: 'var(--money-down)' }}>{r.ask}</span>}
                    </span>
                    <span className="cv-num cv-small">{r.cents != null ? cvMoney(Math.round(r.cents / 100)) : '—'}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="cv-row" style={{ justifyContent: 'space-between' }}>
              <Claim k="mod" label="From the forecast and recipes, at the latest invoice prices" />
              <span className="cv-num" style={{ fontWeight: 700 }}>{cvMoney(Math.round(guide.cents / 100))}</span>
            </div>
          </>
        ) : <Callout icon="Info">{guide.why}</Callout>}
      </section>
    </div>
  );
}

function Worked() {
  const notes = (CV_D.proofs || []).map((p) => itWorked(p, { room: CV_D.profile?.name })).filter(Boolean);
  if (!notes.length) {
    return (
      <section className="cv-card" aria-label="It worked">
        <Head icon="Sparkles" who="“It worked” note" when="The morning a test is verified" how="Email and in the app" />
        <span className="cv-small cv-muted">Nothing is verified here yet, so there is no note to send. The first one goes out the morning a test passes.</span>
      </section>
    );
  }
  return notes.map((n) => (
    <section key={n.subject} className="cv-card" aria-label={n.subject} style={{ borderLeft: '4px solid var(--money-up)' }}>
      <Head icon="Sparkles" who="“It worked” note to the owner and GM" when="The morning a test is verified" how="Email and in the app" right={<Copy text={`${n.subject}\n\n${n.body}`} />} />
      <div className="cv-row nowrap" style={{ gap: 12, alignItems: 'baseline' }}>
        <span className="cv-num" style={{ fontSize: 36, fontWeight: 800, color: 'var(--money-up)' }}>{cvMoney(Math.round(n.cents / 100))}</span>
        <span className="cv-small cv-muted">a week, verified</span>
      </div>
      <div style={paper}><b>{n.subject}</b>{'\n\n'}{n.body}</div>
      <span style={{ alignSelf: 'flex-start' }}><Claim k="book" label="Verified: the low end of what was measured" /></span>
    </section>
  ));
}

function First({ L }) {
  const r = firstWeek(CV_D, L);
  const text = [r.headline, '', 'What we found', ...r.found.map((f) => `- ${f.text}`), '', 'Being tested', ...(r.testing.length ? r.testing.map((t) => `- ${t.title}${t.closes ? ` (reports ${t.closes})` : ''}`) : ['- Nothing yet']), '', `Verified: ${r.verified.length ? `${cvMoney(r.verifiedWeekly)} a week` : 'nothing yet'}`, '', `Do next: ${r.next}`].join('\n');
  return (
    <section className="cv-card" aria-label="The first-week report">
      <Head icon="Sprout" who={`First-week report for ${r.room}`} when="Day 7 after the data is in" how="Email to the owner" right={<Copy text={text} />} />
      <span style={{ fontWeight: 800, fontSize: 22 }}>{r.headline}</span>
      <div className="cv-col" style={{ gap: 10 }}>
        {r.found.map((f) => (
          <div key={f.key} className="cv-row nowrap" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Icon name="Search" size={16} style={{ marginTop: 3 }} />
            <span className="cv-col" style={{ gap: 4, alignItems: 'flex-start' }}><span>{f.text}</span><Claim k={f.claim} label={f.claim === 'obs' ? 'From your data' : 'Forecast'} /></span>
          </div>
        ))}
      </div>
      <div className="cv-grid g2">
        <div className="cv-col" style={{ gap: 6 }}>
          <span className="cv-over">Being tested</span>
          {r.testing.length ? r.testing.map((t) => <span key={t.title} className="cv-small">{t.title}{t.closes ? <span className="cv-faint"> · reports {t.closes}</span> : null}</span>) : <span className="cv-small cv-muted">Nothing yet.</span>}
        </div>
        <div className="cv-col" style={{ gap: 6 }}>
          <span className="cv-over">Verified</span>
          {r.verified.length
            ? <span className="cv-row nowrap" style={{ gap: 8 }}><span className="cv-num" style={{ fontWeight: 800, fontSize: 22, color: 'var(--money-up)' }}>{cvMoney(r.verifiedWeekly)}/wk</span><Claim k="book" label="Verified" /></span>
            : <span className="cv-small cv-muted">Nothing yet. The first test takes about 4 weeks.</span>}
        </div>
      </div>
      {r.needs.length > 0 && <span className="cv-small cv-muted">Still missing: {r.needs.join(', ')}.</span>}
      <span style={{ alignSelf: 'flex-start' }}><Pill tone="good" icon="ArrowRight">Do next: {r.next}</Pill></span>
    </section>
  );
}

function CvMessages() {
  const eng = useEngine();
  const [who, setWho] = React.useState('gm');
  const cc = useCovercast(CV_D.room, CV_D.id, eng.mode === 'server');
  const L = React.useMemo(() => { try { return dayLoop(CV_D, { cc, tasks: eng.tasks || [] }); } catch { return null; } }, [cc, eng.tasks]);
  return (
    <div className="cv-page">
      <PageHead over={`What we send · ${CV_D.profile?.name ?? ''}`} q="What your team gets from Coversight, and when" sub="Each message is written from your own numbers. Tap a person to see theirs." />
      <div className="cv-row" role="tablist" aria-label="Who gets it" style={{ gap: 8 }}>
        {WHO.map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={who === id} className={`btn btn-sm ${who === id ? 'btn-secondary' : 'btn-ghost'}`} style={who === id ? { borderColor: 'var(--fg-1)', fontWeight: 700 } : undefined} onClick={() => setWho(id)}>
            <Icon name={icon} size={14} /> {label}
          </button>
        ))}
      </div>
      {who === 'gm' && (L ? <GmText L={L} /> : <Callout icon="Info">The morning text needs a forecast. It appears once a few weeks of days are in.</Callout>)}
      {who === 'owner' && <OwnerEmail />}
      {who === 'chef' && (cc ? <ChefLists cc={cc} /> : <Callout icon="Info">The prep list and order guide need a forecast. They appear once a few weeks of days are in.</Callout>)}
      {who === 'worked' && <Worked />}
      {who === 'first' && (L ? <First L={L} /> : <Callout icon="Info">The first-week report needs a week of your data.</Callout>)}
    </div>
  );
}

export { CvMessages };
