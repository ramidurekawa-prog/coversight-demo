'use client';

import * as React from 'react';

import { agentAnswer, agentRead, agentTeam } from '../lib/ai/agents';
import { SOUS, sousBrief, sousCites, sousFacts, sousNoticed, sousRole, sousSuggest, sousToday } from '../lib/ai/sous';
import { CV_PAGES } from '../lib/pages';
import { useEngine } from './engine';
import { Button, Icon } from './kit';
import { Claim, CV_D, CV_GROUP } from './screens/core';
import './sous.css';

/* Sous, the AI teammate. Every page has its own Sous agent (lib/ai/agents.js):
 * a named specialist that sits at the top of its page with its read of it, and
 * opens this panel as itself. The panel leads with that page, then the brief
 * for the whole restaurant (what changed, what it noticed, the one thing to
 * do), then answers questions from the restaurant's own records and shows
 * which ones. Every agent reads the same facts, and the conversation follows
 * the person from page to page.
 *
 * The brief and the answers come from lib/ai/sous.js, the same pure code the
 * server runs, so the panel works at once and works with no backend. Signed
 * in, /api/sous replaces them with what the AI engine wrote (when it is on);
 * if that call fails, what is already on screen stays. */

/** Everything Sous reads for the room in view, from this browser's copy of the data. */
function useLocalSous(role, page) {
  const eng = useEngine();
  return React.useMemo(() => {
    const saved = eng.actions?.[CV_D.id] || {};
    const today = sousToday(CV_D, { stored: saved.queue || null, dismissed: saved.findings || {}, windows: eng.windows || [], tasks: eng.tasks || [] });
    const noticed = sousNoticed(CV_D);
    const facts = sousFacts(CV_D, { role, windows: eng.windows || [], card: today.card, open: today.open, noticed, group: CV_GROUP });
    const brief = sousBrief(CV_D, { role, facts, noticed, card: today.card, open: today.open });
    return { facts, brief, noticed, suggest: sousSuggest(facts, role), agent: agentRead(page, facts, noticed) };
    // eng.version changes whenever the room or its data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, page, eng.version, eng.room, eng.actions, eng.windows, eng.tasks]);
}

/** How many things Sous has noticed in the room in view, for the top-bar button. */
export function useSousCount() {
  const eng = useEngine();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => sousNoticed(CV_D).filter((n) => n.tone === 'warn').length, [eng.version, eng.room]);
}

/** The top-bar way in. Ink, with the persimmon spark: present on every page without competing with the page's one action. */
export function SousButton({ onClick }) {
  const n = useSousCount();
  return (
    <button type="button" className="cv-sous-btn" onClick={onClick} aria-label={`Ask ${SOUS.name}, your AI teammate${n ? `. It noticed ${n} thing${n === 1 ? '' : 's'}` : ''}`} title={`${SOUS.name}, your AI teammate (press /)`}>
      <Icon name="Sparkles" size={16} />
      <span className="cv-sous-btn-l">Ask {SOUS.name}</span>
      {n > 0 && <span className="cv-sous-btn-n" aria-hidden="true">{n}</span>}
    </button>
  );
}

/**
 * The page's own agent, at the top of its page: who it is, the one thing it
 * sees here, and the way to ask it. Quiet by design (no filled button), so the
 * page keeps its one action.
 */
export function PageAgent({ page, role: shellRole = 'owner', onOpen }) {
  const eng = useEngine();
  const role = sousRole(eng.mode === 'server' ? eng.viewer?.role : shellRole);
  const { agent: read } = useLocalSous(role, page);
  if (!read.lead) return null;
  const warn = read.noticed.some((n) => n.tone === 'warn');
  return (
    <div className="cv-agent-wrap">
      <section className={`cv-agent${warn ? ' warn' : ''}`} aria-label={`${read.agent.name}, ${SOUS.name} on this page`}>
        <button type="button" className="cv-agent-main" onClick={() => onOpen()} title={`${read.agent.name}: ${read.agent.job}`}>
          <span className="cv-agent-mark" aria-hidden="true"><Icon name="Sparkles" size={16} /></span>
          <span className="cv-agent-tx">
            <span className="cv-agent-name">{read.agent.name}<i>{read.lead.noticed ? 'noticed' : `${SOUS.name} on this page`}</i></span>
            <span className="cv-agent-lead">{read.lead.text}</span>
          </span>
        </button>
        {read.ask[0] && <button type="button" className="cv-agent-q" onClick={() => onOpen(read.ask[0])}>{read.ask[0]}</button>}
        <button type="button" className="cv-agent-ask" onClick={() => onOpen()} aria-label={`Ask ${read.agent.name}`}>Ask<Icon name="ArrowRight" size={15} /></button>
      </section>
    </div>
  );
}

/** The first sentence of a fact, for a line that opens the rest on a click. */
const lead = (text) => String(text).split(/(?<=[a-z)%\d])\.\s+(?=[A-Z])/)[0].replace(/\.$/, '') + '.';
const TONE_ICON = { warn: 'TriangleAlert', good: 'BadgeCheck', info: 'Info' };

function Cites({ cites, onGo }) {
  if (!cites?.length) return null;
  return (
    <div className="cv-sous-cites">
      <span className="cv-sous-cites-l">From your records</span>
      {cites.map((c) => (
        <button key={c.go} type="button" className="cv-sous-cite" onClick={() => onGo(c.go)}>
          <Icon name={CV_PAGES[c.go]?.icon || 'Info'} size={13} />{CV_PAGES[c.go]?.title || c.label}
        </button>
      ))}
    </div>
  );
}

export function SousPanel({ onClose, go, role: shellRole = 'owner', tools = false, page = '', first = '', turns, setTurns }) {
  const eng = useEngine();
  const server = eng.mode === 'server';
  const role = sousRole(server ? eng.viewer?.role : shellRole);
  const local = useLocalSous(role, page);
  const [remote, setRemote] = React.useState(null);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [allNoticed, setAllNoticed] = React.useState(false);
  const [whole, setWhole] = React.useState(false);
  const [team, setTeam] = React.useState(false);
  const endRef = React.useRef(null);
  const roomId = CV_D.id;

  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  // Signed in: the server's copy (the AI-written brief when the engine is on).
  React.useEffect(() => {
    if (!server) return undefined;
    let live = true;
    fetch(`/api/sous?room=${encodeURIComponent(roomId)}&page=${encodeURIComponent(page)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live && b?.brief) setRemote(b); })
      .catch(() => { /* the built-in brief is already on screen */ });
    return () => { live = false; };
  }, [server, roomId, eng.version]);

  React.useEffect(() => { if (turns.length) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns, busy]);

  const brief = remote?.roomId === roomId && remote.engine === 'ai' ? remote.brief : local.brief;
  const me = local.agent;
  const special = me.agent.id !== 'sous';
  const suggest = special && me.ask.length ? me.ask : local.suggest;
  const noticed = special ? me.elsewhere : brief.noticed || [];
  const pageTitle = CV_PAGES[page]?.title || '';
  const open = (page) => { onClose(); go(page); };
  const push = (t) => setTurns((xs) => [...xs, t]);

  /** Show the whole record behind a line of the brief or something Sous noticed. */
  const explain = (label, textFull, goTo, claim) => push({ by: me.agent.name, q: label, a: textFull, cites: goTo ? [{ go: goTo, label }] : [], claim, grounded: true, suggest: [] });

  const ask = async (question) => {
    const q = String(question || '').trim().slice(0, 500);
    if (!q || busy) return;
    setText('');
    setBusy(true);
    setTurns((xs) => [...xs, { q, pending: true, by: me.agent.name }]);
    let a = null;
    if (server) {
      try {
        const res = await fetch('/api/sous', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomId, page, question: q, history: turns.filter((t) => t.a).slice(-4).map((t) => ({ q: t.q, a: t.a })) }) });
        if (res.ok) a = await res.json();
      } catch { /* fall through to the built-in answer */ }
    }
    if (!a) a = agentAnswer(page, q, local.facts, { room: local.brief.room, role });
    setTurns((xs) => xs.map((t, i) => (i === xs.length - 1 ? { q, by: me.agent.name, a: a.text, cites: a.cites || sousCites([]), claim: a.claim, grounded: a.grounded, suggest: a.suggest || [] } : t)));
    setBusy(false);
  };

  const asked = React.useRef(false);
  React.useEffect(() => {
    if (first && !asked.current) { asked.current = true; ask(first); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  return (
    <>
      <div className="cv-scrim" onClick={onClose} />
      <aside className="cv-drawer cv-sous" role="dialog" aria-label={`${SOUS.name}, your AI teammate`}>
        <div className="hd">
          <div className="cv-sous-id">
            <span className="cv-sous-mark" aria-hidden="true"><Icon name="Sparkles" size={20} /></span>
            <div className="cv-col" style={{ gap: 2, minWidth: 0 }}>
              <span className="cv-sous-name">{special ? me.agent.name : SOUS.name}</span>
              <span className="cv-sous-sub">{special ? `${SOUS.name} on ${pageTitle}${me.agent.id === 'portfolio' ? '' : ` at ${brief.room}`}` : `${SOUS.tagline} at ${brief.room}`}</span>
            </div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close Sous"><Icon name="X" size={18} /></button>
        </div>

        <div className="bd">
          {special && me.lead && (
            <section className="cv-sous-brief cv-sous-here" aria-label={`${me.agent.name} on this page`}>
              <span className="cv-sous-over">On this page · {me.agent.job}</span>
              <p className="cv-sous-headline">{me.lead.text}</p>
              {me.lead.full.length > me.lead.text.length + 2 && <p className="cv-sous-full">{me.lead.full.slice(me.lead.text.length).trim()}</p>}
              {me.lead.claim && <span className="cv-sous-claim"><Claim k={me.lead.claim} /></span>}
              {(me.noticed.length > 0 || me.more.length > 0) && (
                <ul className="cv-sous-lines">
                  {me.noticed.filter((n) => `noticed:${n.id}` !== me.lead.id).map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => explain(n.title, n.text, n.go, n.claim)}>
                        <span className="ic warn"><Icon name={n.icon || TONE_ICON[n.tone]} size={16} /></span>
                        <span className="tx"><b>Noticed</b>{n.title}</span>
                        <Icon name="ChevronRight" size={15} />
                      </button>
                    </li>
                  ))}
                  {me.more.map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => explain(l.label, l.text, l.go, l.claim)} title="Show the full record">
                        <span className="ic"><Icon name={CV_PAGES[l.go]?.icon || 'Info'} size={16} /></span>
                        <span className="tx"><b>{l.label}</b>{lead(l.text)}</span>
                        <Icon name="ChevronRight" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className={`cv-sous-brief${special ? ' compact' : ''}`} aria-label="Your brief">
            <span className="cv-sous-over">{special ? `All of ${brief.room}` : 'Your brief'}{remote?.engine === 'ai' && brief === remote.brief ? ' · written by Sous just for you' : ''}</span>
            <p className="cv-sous-headline">{brief.headline}</p>
            {brief.action && (
              <div className="cv-sous-action">
                <span className="cv-sous-over">Do this first</span>
                <span className="cv-sous-action-t">{brief.action.title}</span>
                <span className="cv-sous-action-w">{brief.action.why.length <= 140 ? brief.action.why : lead(brief.action.why)}</span>
                {brief.action.value && <span className="cv-sous-action-v"><b>{brief.action.value}</b>{brief.action.claim && <Claim k={brief.action.claim} />}</span>}
                <Button iconRight="ArrowRight" onClick={() => open(brief.action.go)}>{brief.action.cta}</Button>
              </div>
            )}
            {special && !whole && <button type="button" className="cv-sous-more" onClick={() => setWhole(true)}>Show the full brief</button>}
            {(!special || whole) && <ul className="cv-sous-lines">
              {brief.lines.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => explain(l.label, local.facts.find((f) => f.id === l.id)?.text || l.text, l.go, l.claim)} title="Show the full record">
                    <span className="ic"><Icon name={l.icon} size={16} /></span>
                    <span className="tx"><b>{l.label}</b>{lead(l.text)}</span>
                    <Icon name="ChevronRight" size={15} />
                  </button>
                </li>
              ))}
            </ul>}
          </section>

          <section className="cv-sous-sec" aria-label="Sous noticed">
            <span className="cv-sous-over">{special ? 'Noticed on other pages' : 'Sous noticed'}</span>
            {noticed.length === 0 ? (
              <p className="cv-sous-quiet"><Icon name="BadgeCheck" size={16} />Nothing unusual. Every number I watch is inside its normal range.</p>
            ) : (
              <ul className="cv-sous-noticed">
                {(allNoticed ? noticed : noticed.slice(0, 3)).map((n) => (
                  <li key={n.id}>
                    <button type="button" className={n.tone} onClick={() => explain(n.title, n.text, n.go, n.claim)}>
                      <span className="ic"><Icon name={n.icon || TONE_ICON[n.tone]} size={16} /></span>
                      <span className="tx">{n.title}</span>
                      <Icon name="ChevronRight" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {noticed.length > 3 && !allNoticed && <button type="button" className="cv-sous-more" onClick={() => setAllNoticed(true)}>Show {noticed.length - 3} more</button>}
          </section>

          {turns.length === 0 && suggest.length > 0 && (
            <section className="cv-sous-sec" aria-label="Ask Sous">
              <span className="cv-sous-over">{special ? `Ask ${me.agent.name}, or anything about ${brief.room}` : `Ask me anything about ${brief.room}`}</span>
              <div className="cv-sous-chips">
                {suggest.map((q) => <button key={q} type="button" onClick={() => ask(q)}>{q}</button>)}
              </div>
            </section>
          )}

          {turns.length === 0 && (
            <section className="cv-sous-sec" aria-label="Sous's team">
              <button type="button" className="cv-sous-teamtog" onClick={() => setTeam((x) => !x)} aria-expanded={team}>
                <span className="cv-sous-over">One brain, a specialist on every page</span>
                <Icon name={team ? 'ChevronDown' : 'ChevronRight'} size={15} />
              </button>
              {team && (
                <ul className="cv-sous-team">
                  {agentTeam(local.facts, local.noticed).map((a) => (
                    <li key={a.page}>
                      <button type="button" className={a.page === me.agent.id ? 'on' : ''} onClick={() => open(a.page)} title={a.job}>
                        <Icon name={CV_PAGES[a.page]?.icon || 'Sparkles'} size={15} />
                        <span className="nm">{a.name}</span>
                        <span className="pg">{CV_PAGES[a.page]?.title}</span>
                        {a.noticed > 0 && <span className="n" aria-label={`${a.noticed} noticed`}>{a.noticed}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {turns.length > 0 && (
            <section className="cv-sous-talk" aria-live="polite" aria-label="Conversation with Sous">
              {turns.map((t, i) => (
                <div key={i} className="cv-sous-turn">
                  <p className="q">{t.q}</p>
                  {t.by && t.by !== SOUS.name && !t.pending && <span className="cv-sous-by"><Icon name="Sparkles" size={12} />{t.by}</span>}
                  {t.pending ? (
                    <p className="a pending"><span className="cv-sous-dots" aria-hidden="true"><i /><i /><i /></span>Reading your records…</p>
                  ) : (
                    <div className="a">
                      {String(t.a).split(/\n\n+/).map((para, n) => <p key={n}>{para}</p>)}
                      {t.claim && <span className="cv-sous-claim"><Claim k={t.claim} /></span>}
                      <Cites cites={t.cites} onGo={open} />
                      {t.suggest?.length > 0 && i === turns.length - 1 && (
                        <div className="cv-sous-chips">{t.suggest.map((q) => <button key={q} type="button" onClick={() => ask(q)}>{q}</button>)}</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <span ref={endRef} />
            </section>
          )}
        </div>

        <div className="cv-sous-foot">
          <form className="cv-sous-form" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
            <input id="cv-sous-q" value={text} onChange={(e) => setText(e.target.value)} placeholder={special ? `Ask ${me.agent.name}` : `Ask Sous about ${brief.room}`} maxLength={500} autoComplete="off" aria-label={`Ask Sous about ${brief.room}`} />
            <button type="submit" className="cv-sous-send" disabled={!text.trim() || busy} aria-label="Send"><Icon name="ArrowUp" size={18} /></button>
          </form>
          <span className="cv-sous-note">Sous answers only from {brief.room}&apos;s records and shows which ones. Estimates are always labeled.</span>
          {tools && <span className="cv-sous-note">Engine: {!server ? 'built-in (browser preview)' : remote?.ai ? 'Claude Opus 5.5, checked against the records' : 'built-in (no AI key on the server)'}</span>}
        </div>
      </aside>
    </>
  );
}
