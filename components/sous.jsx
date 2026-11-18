'use client';

import * as React from 'react';

import { agentAnswer, agentRead, agentTeam } from '../lib/ai/agents';
import { agentRecord, noticedSig, sousMoves, sousRemember } from '../lib/ai/moves';
import { SOUS, firstSentence, sousBrief, sousCites, sousFacts, sousNoticed, sousRole, sousSuggest, sousToday } from '../lib/ai/sous';
import { money } from '../lib/data/model';
import { CV_PAGES } from '../lib/pages';
import { engine, useEngine, useSaved } from './engine';
import { Button, Icon } from './kit';
import { Claim, CV_D, CV_GROUP, useCv } from './screens/core';
import './sous.css';

/* Sous, the AI teammate. Every page has its own Sous agent (lib/ai/agents.js):
 * a named specialist that sits at the top of its page with the one move it
 * recommends there, what that is worth, and the way to do it. It speaks up
 * when something is new and shrinks to a line when nothing is. Opening it
 * shows the move, why, how its area connects to the others, and answers
 * questions in a sentence with the records behind a click.
 *
 * Everything comes from lib/ai (the same pure code the server runs), so it
 * works at once and with no backend. Signed in, /api/sous replaces the brief
 * and the answers with what the AI engine wrote (when it is on); if that call
 * fails, what is already on screen stays. An agent never acts by itself:
 * every move ends at the person's approval or a draft they send. */

/** Everything Sous reads for the room in view, from this browser's copy of the data. */
function useLocalSous(role, page) {
  const eng = useEngine();
  const mem = eng.actions?.[CV_D.id]?.sous;
  return React.useMemo(() => {
    const saved = eng.actions?.[CV_D.id] || {};
    const today = sousToday(CV_D, { stored: saved.queue || null, dismissed: saved.findings || {}, windows: eng.windows || [], tasks: eng.tasks || [] });
    const memory = sousRemember(sousNoticed(CV_D), mem || {});
    const noticed = memory.active;
    const facts = sousFacts(CV_D, { role, windows: eng.windows || [], card: today.card, open: today.open, noticed, group: CV_GROUP });
    const brief = sousBrief(CV_D, { role, facts, noticed, card: today.card, open: today.open });
    const moves = sousMoves(CV_D, { noticed, card: today.card, role, quietIds: memory.quietIds });
    return { facts, brief, noticed, memory, moves, record: agentRecord(CV_D), suggest: sousSuggest(facts, role), agent: agentRead(page, facts, noticed, { role, moves }) };
    // eng.version changes whenever the room or its data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, page, mem, eng.version, eng.room, eng.actions, eng.windows, eng.tasks]);
}

/** How many things Sous has noticed in the room in view and the person hasn't answered, for the top-bar button. */
export function useSousCount() {
  const eng = useEngine();
  const mem = eng.actions?.[CV_D.id]?.sous;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => sousRemember(sousNoticed(CV_D), mem || {}).active.filter((n) => n.tone === 'warn').length, [mem, eng.version, eng.room]);
}

/** The top-bar way in: all of Sous, from any page. */
export function SousButton({ onClick }) {
  const n = useSousCount();
  return (
    <button type="button" className="cv-sous-btn" onClick={onClick} aria-label={`${SOUS.name}, your AI teammate${n ? `. It noticed ${n} thing${n === 1 ? '' : 's'}` : ''}`} title={`${SOUS.name}, your AI teammate (press /)`}>
      <Icon name="Sparkles" size={16} />
      <span className="cv-sous-btn-l">{SOUS.name}</span>
      {n > 0 && <span className="cv-sous-btn-n" aria-hidden="true">{n}</span>}
    </button>
  );
}

const TONE_ICON = { warn: 'TriangleAlert', good: 'BadgeCheck', info: 'Info' };
const ACT = { email: { cta: 'Draft the email', icon: 'Mail' }, approve: { cta: 'Review and approve', icon: 'Check' } };
/** What the button for a move says. */
const ctaFor = (move) => ACT[move.act.kind]?.cta || `Open ${(CV_PAGES[move.act.page === 'finding' ? 'plan' : move.act.page]?.title || 'it').replace(/^The /, 'the ')}`;

/** The figure a move is worth, big, with how sure it is. */
function Stake({ move, size = '' }) {
  if (!move?.value) return null;
  return (
    <span className={`cv-stake ${size}`}>
      <b>{move.value}</b>
      <span className="u">{move.unit}</span>
      {move.claim && <Claim k={move.claim} />}
    </span>
  );
}

/**
 * The page's own agent, at the top of its page. New since the person last
 * looked: full size, with the move, its stake and the way to do it. Already
 * seen: one slim line. The page keeps its one filled button; the agent's are
 * outlined.
 */
export function PageAgent({ page, role: shellRole = 'owner', onOpen }) {
  const eng = useEngine();
  const role = sousRole(eng.mode === 'server' ? eng.viewer?.role : shellRole);
  const { agent: read } = useLocalSous(role, page);
  const [seen, setSeen] = useSaved('sous.seen', {}, { person: true });
  const key = `${CV_D.id}:${page}`;
  const fresh = seen?.[key] !== read.sig;
  // Once the person has had the page in front of them, what the agent said is no longer news.
  const latest = React.useRef({ key, sig: read.sig, fresh });
  latest.current = { key, sig: read.sig, fresh };
  React.useEffect(() => {
    const t0 = Date.now();
    return () => {
      const l = latest.current;
      if (l.fresh && Date.now() - t0 > 2500) setSeen((s) => ({ ...Object.fromEntries(Object.entries(s || {}).slice(-250)), [l.key]: l.sig }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!read.lead && !read.move) return null;
  const { move } = read;
  const warn = move?.source === 'noticed' || read.noticed.some((n) => n.tone === 'warn');
  const icon = CV_PAGES[read.agent.id]?.icon || CV_PAGES[page]?.icon || 'Sparkles';
  const title = move ? move.title : read.lead.text;

  // Today's own page already leads with its first card, so its agent stays a line there instead of saying it twice.
  // Full size only when there is something to do and it is news. With nothing to do, the agent is a quiet line.
  if (!move || !fresh || (move.source === 'today' && page === 'today')) {
    return (
      <div className="cv-agent-wrap">
        <button type="button" className={`cv-agent slim${warn ? ' warn' : ''}`} onClick={() => onOpen()} aria-label={`${read.agent.name}, ${SOUS.name} on this page: ${title}`}>
          <span className="cv-agent-mark" aria-hidden="true"><Icon name={icon} size={14} /></span>
          <span className="cv-agent-name">{read.agent.name}</span>
          <span className="cv-agent-lead">{title}</span>
          {move?.value && <span className="cv-agent-v">{move.value}</span>}
          <Icon name="ChevronRight" size={15} />
        </button>
      </div>
    );
  }
  return (
    <div className="cv-agent-wrap">
      <section className={`cv-agent${warn ? ' warn' : ''}`} aria-label={`${read.agent.name}, ${SOUS.name} on this page`}>
        <span className="cv-agent-mark" aria-hidden="true"><Icon name={icon} size={20} /><i><Icon name="Sparkles" size={11} /></i></span>
        <button type="button" className="cv-agent-main" onClick={() => onOpen()} title={`${read.agent.name}: ${read.agent.job}`}>
          <span className="cv-agent-name">{read.agent.name}<i className="new">{warn ? 'Noticed' : 'Suggests'}</i></span>
          <span className="cv-agent-lead">{title}</span>
        </button>
        <Stake move={move} />
        <span className="cv-agent-acts">
          <Button variant="secondary" icon={ACT[move.act.kind]?.icon} iconRight={ACT[move.act.kind] ? undefined : 'ArrowRight'} onClick={() => onOpen('', move)}>{ctaFor(move)}</Button>
          <button type="button" className="cv-agent-why" onClick={() => onOpen()}>Why<Icon name="ChevronRight" size={14} /></button>
        </span>
      </section>
    </div>
  );
}

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

/** A section that stays closed until asked for: a title, a count, and what's inside. */
function Fold({ icon, title, n, open, onToggle, children }) {
  return (
    <section className={`cv-fold${open ? ' open' : ''}`}>
      <button type="button" className="cv-fold-h" onClick={onToggle} aria-expanded={open}>
        <span className="ic"><Icon name={icon} size={16} /></span>
        <span className="t">{title}</span>
        {n > 0 && <span className="n">{n}</span>}
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={16} />
      </button>
      {open && <div className="cv-fold-b">{children}</div>}
    </section>
  );
}

/** One answer: a sentence, the figure when there is one, one button, and the records behind "Show why". */
function Answer({ t, last, onGo, onAsk, onDo }) {
  const [why, setWhy] = React.useState(false);
  const paras = String(t.a).split(/\n\n+/);
  const short = t.short || paras[0];
  const rest = t.short ? (t.a.trim() === t.short.trim() ? [] : paras) : paras.slice(1);
  if (t.draft) {
    return (
      <div className="a">
        <p className="short">Your email to {t.draft.to} is drafted. Nothing goes out until you send it.</p>
        <div className="cv-sous-draft"><b>{t.draft.subject}</b><pre>{t.draft.body}</pre></div>
        <div className="cv-sous-acts">
          <a className="btn btn-primary" href={`mailto:?subject=${encodeURIComponent(t.draft.subject)}&body=${encodeURIComponent(t.draft.body)}`}><Icon name="Mail" size={17} />Open in email</a>
          <Button variant="secondary" icon="Copy" onClick={() => navigator.clipboard?.writeText(`${t.draft.subject}\n\n${t.draft.body}`)}>Copy</Button>
        </div>
        {t.saved && <span className="cv-sous-fine">Saved to your drafts in Coversight.</span>}
      </div>
    );
  }
  return (
    <div className="a">
      <p className="short">{short}</p>
      {t.move && <Stake move={t.move} />}
      {t.move && <div className="cv-sous-acts"><Button icon={ACT[t.move.act.kind]?.icon} iconRight={ACT[t.move.act.kind] ? undefined : 'ArrowRight'} onClick={() => onDo(t.move)}>{ctaFor(t.move)}</Button></div>}
      {!t.move && t.claim && <span className="cv-sous-claim"><Claim k={t.claim} /></span>}
      {(rest.length > 0 || t.cites?.length > 0) && (
        <>
          <button type="button" className="cv-sous-more" onClick={() => setWhy((x) => !x)} aria-expanded={why}>{why ? 'Hide' : 'Show why'}</button>
          {why && <div className="cv-sous-why">{rest.map((para, n) => <p key={n}>{para}</p>)}<Cites cites={t.cites} onGo={onGo} /></div>}
        </>
      )}
      {t.suggest?.length > 0 && last && <div className="cv-sous-chips">{t.suggest.map((q) => <button key={q} type="button" onClick={() => onAsk(q)}>{q}</button>)}</div>}
    </div>
  );
}

export function SousPanel({ onClose, go, role: shellRole = 'owner', tools = false, page = '', first = '', run = null, turns, setTurns }) {
  const eng = useEngine();
  const cv = useCv();
  const server = eng.mode === 'server';
  const role = sousRole(server ? eng.viewer?.role : shellRole);
  const local = useLocalSous(role, page);
  const [, setMem] = useSaved('sous', {});
  const [remote, setRemote] = React.useState(null);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState('');
  const [why, setWhy] = React.useState(false);
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
  }, [server, roomId, page, eng.version]);

  React.useEffect(() => { if (turns.length) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns, busy]);

  const brief = remote?.roomId === roomId && remote.engine === 'ai' ? remote.brief : local.brief;
  const me = local.agent;
  const { move } = me;
  const special = me.agent.id !== 'sous';
  const suggest = special && me.ask.length ? me.ask : local.suggest;
  const pageTitle = CV_PAGES[page]?.title || '';
  const icon = CV_PAGES[me.agent.id]?.icon || 'Sparkles';
  const rec = local.record[me.agent.id] || (['today', 'proof', 'ledger', 'plan', 'week', 'portfolio', 'sous'].includes(me.agent.id) ? local.record.all : null);
  const others = special ? me.elsewhere : local.noticed;
  const leave = (p, params) => { onClose(); go(p, params); };
  const push = (t) => setTurns((xs) => [...xs, { by: me.agent.name, ...t }]);
  const toggle = (k) => setOpen((x) => (x === k ? '' : k));

  /** Show the whole record behind a line. */
  const explain = (label, textFull, goTo, claim) => push({ q: label, a: textFull, short: firstSentence(textFull), cites: goTo ? [{ go: goTo, label }] : [], claim, grounded: true, suggest: [] });

  /** Carry out a move, up to the point where the person decides: a draft to send, an approval to give, or the screen to do it on. */
  const act = async (m) => {
    if (m.act.kind === 'email') {
      let saved = false;
      if (server) saved = !!(await engine.draftEmail({ kind: 'vendor', subject: m.act.subject, body: m.act.body }).catch(() => null));
      push({ q: m.title, a: '', draft: m.act, saved });
    } else if (m.act.kind === 'approve') { onClose(); cv.approve(m.act.id); }
    else leave(m.act.page, m.act.goId ? { id: m.act.goId } : undefined);
  };

  /** Tell Sous it is dealt with, or not for this room. It stays quiet until it is due again or the numbers change. */
  const remember = (n, how) => {
    setMem((m) => ({ ...(m || {}), [n.id]: { at: new Date().toISOString(), how, sig: noticedSig(n), title: n.title } }), `Sous: ${how === 'handled' ? 'handled' : 'set aside'}: ${n.title}`);
    cv.toast(how === 'handled' ? 'Got it. I will check back in two weeks.' : 'Set aside. I will only raise it again if the numbers change.');
  };
  const moveNoticed = move?.noticedId ? local.noticed.find((n) => n.id === move.noticedId) : null;

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
    if (!a) a = agentAnswer(page, q, local.facts, { room: local.brief.room, role, move });
    // The button on an answer always comes from this browser's own move, never from text.
    const m = a.move ? local.moves.find((x) => x.id === a.move.id) || null : null;
    setTurns((xs) => xs.map((t, i) => (i === xs.length - 1 ? { q, by: me.agent.name, a: a.text, short: a.short, move: m, cites: a.cites || sousCites([]), claim: a.claim, grounded: a.grounded, suggest: a.suggest || [] } : t)));
    setBusy(false);
  };

  // A question or a move handed over from the page's strip, once.
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (run) act(run); else if (first) ask(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="cv-scrim" onClick={onClose} />
      <aside className="cv-drawer cv-sous" role="dialog" aria-label={`${special ? me.agent.name : SOUS.name}, your AI teammate`}>
        <div className="hd">
          <div className="cv-sous-id">
            <span className="cv-sous-mark" aria-hidden="true"><Icon name={special ? icon : 'Sparkles'} size={20} /></span>
            <div className="cv-col" style={{ gap: 2, minWidth: 0 }}>
              <span className="cv-sous-name">{special ? me.agent.name : SOUS.name}</span>
              <span className="cv-sous-sub">{special ? `${SOUS.name} on ${pageTitle}${me.agent.id === 'portfolio' ? '' : ` at ${brief.room}`}` : `${SOUS.tagline} at ${brief.room}`}</span>
            </div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close Sous"><Icon name="X" size={18} /></button>
        </div>

        <div className="bd">
          <section className={`cv-sous-hero${move ? ' act' : ''}`} aria-label={move ? 'What to do' : 'On this page'}>
            <span className="cv-sous-over">{move ? `${me.voice} · do this` : special ? 'On this page' : 'Right now'}</span>
            <p className="cv-sous-headline">{move ? move.title : me.lead?.text || brief.headline}</p>
            <Stake move={move} size="lg" />
            {move ? <p className="cv-sous-full">{firstSentence(move.why)}</p> : <p className="cv-sous-full">Nothing needs you here right now. I&apos;ll speak up when that changes.</p>}
            {move && (
              <div className="cv-sous-acts">
                <Button icon={ACT[move.act.kind]?.icon} iconRight={ACT[move.act.kind] ? undefined : 'ArrowRight'} onClick={() => act(move)}>{ctaFor(move)}</Button>
                {moveNoticed && <Button variant="secondary" icon="Check" onClick={() => remember(moveNoticed, 'handled')}>Already handled</Button>}
              </div>
            )}
            {move && (
              <div className="cv-sous-links">
                <button type="button" className="cv-sous-more" onClick={() => setWhy((x) => !x)} aria-expanded={why}>{why ? 'Hide' : 'Show why'}</button>
                {moveNoticed && <button type="button" className="cv-sous-more" onClick={() => remember(moveNoticed, 'dismissed')}>Not for us</button>}
              </div>
            )}
            {move && why && (
              <div className="cv-sous-why">
                <p>{move.why}</p>
                {move.source === 'noticed' || move.source === 'today' ? null : <p>This is a potential gain, not money saved. It counts only after a test verifies it.</p>}
                <Cites cites={[{ go: move.go === 'finding' ? 'plan' : move.go, label: '' }]} onGo={leave} />
              </div>
            )}
            {rec && (rec.wins > 0 || rec.testing > 0) && (
              <div className="cv-sous-record" title="Verified changes are counted at the low end of what a test measured.">
                <Icon name="BadgeCheck" size={15} />
                <span>{rec.wins > 0 ? <><b>{rec.wins} verified {rec.wins === 1 ? 'change' : 'changes'}</b> holding <b>{money(Math.round(rec.week))} a week</b></> : 'No verified changes yet'}{rec.testing > 0 ? ` · ${rec.testing} being tested` : ''}</span>
                {rec.wins > 0 && <Claim k="book" />}
              </div>
            )}
          </section>

          {me.link && (
            <section className="cv-sous-link" aria-label="Across pages">
              <span className="cv-sous-over"><Icon name="Link2" size={13} />Connected across pages</span>
              <p>{open === 'link' ? me.link.text : me.link.short}</p>
              <button type="button" className="cv-sous-more" onClick={() => toggle('link')}>{open === 'link' ? 'Hide' : 'Show the whole picture'}</button>
            </section>
          )}

          {turns.length === 0 && suggest.length > 0 && (
            <div className="cv-sous-chips" aria-label={`Ask ${me.agent.name}`}>
              {suggest.map((q) => <button key={q} type="button" onClick={() => ask(q)}>{q}</button>)}
            </div>
          )}

          {turns.length > 0 && (
            <section className="cv-sous-talk" aria-live="polite" aria-label="Conversation with Sous">
              {turns.map((t, i) => (
                <div key={i} className="cv-sous-turn">
                  <p className="q">{t.q}</p>
                  {t.by && t.by !== SOUS.name && !t.pending && <span className="cv-sous-by"><Icon name="Sparkles" size={12} />{t.by}</span>}
                  {t.pending ? <p className="a pending"><span className="cv-sous-dots" aria-hidden="true"><i /><i /><i /></span>Reading your records…</p>
                    : <Answer t={t} last={i === turns.length - 1} onGo={leave} onAsk={ask} onDo={act} />}
                </div>
              ))}
              <span ref={endRef} />
            </section>
          )}

          <div className="cv-folds">
            {special && me.more.length > 0 && (
              <Fold icon={icon} title={`More from ${me.agent.name}`} n={me.more.length} open={open === 'more'} onToggle={() => toggle('more')}>
                <ul className="cv-sous-lines">
                  {me.more.map((l) => (
                    <li key={l.id}><button type="button" onClick={() => explain(l.label, l.text, l.go, l.claim)}><span className="tx"><b>{l.label}</b>{firstSentence(l.text)}</span><Icon name="ChevronRight" size={15} /></button></li>
                  ))}
                </ul>
              </Fold>
            )}
            <Fold icon="Sparkles" title={`All of ${brief.room}`} open={open === 'brief'} onToggle={() => toggle('brief')}>
              <p className="cv-sous-headline sm">{brief.headline}{remote?.engine === 'ai' && brief === remote.brief ? '' : ''}</p>
              <ul className="cv-sous-lines">
                {brief.lines.map((l) => (
                  <li key={l.id}><button type="button" onClick={() => explain(l.label, local.facts.find((f) => f.id === l.id)?.text || l.text, l.go, l.claim)}><span className="tx"><b>{l.label}</b>{firstSentence(l.text)}</span><Icon name="ChevronRight" size={15} /></button></li>
                ))}
              </ul>
            </Fold>
            {others.length > 0 && (
              <Fold icon="TriangleAlert" title={special ? 'Noticed on other pages' : 'Sous noticed'} n={others.length} open={open === 'noticed'} onToggle={() => toggle('noticed')}>
                <ul className="cv-sous-noticed">
                  {others.map((n) => (
                    <li key={n.id}>
                      <button type="button" className={n.tone} onClick={() => leave(n.go)} title={`Open ${CV_PAGES[n.go]?.title}`}>
                        <span className="ic"><Icon name={CV_PAGES[n.go]?.icon || TONE_ICON[n.tone]} size={16} /></span>
                        <span className="tx">{n.title}</span>
                        <Icon name="ChevronRight" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Fold>
            )}
            {(local.memory.resolved.length > 0 || local.memory.quiet > 0) && (
              <Fold icon="BadgeCheck" title="What you told me" n={local.memory.resolved.length + local.memory.quiet} open={open === 'memory'} onToggle={() => toggle('memory')}>
                {local.memory.resolved.map((r) => <p key={r.id} className="cv-sous-quiet"><Icon name="BadgeCheck" size={16} />Resolved: {r.title.charAt(0).toLowerCase() + r.title.slice(1)} is no longer showing.</p>)}
                {local.memory.quiet > 0 && <p className="cv-sous-fine">{local.memory.quiet} {local.memory.quiet === 1 ? 'thing is' : 'things are'} quiet because you handled or set {local.memory.quiet === 1 ? 'it' : 'them'} aside. <button type="button" className="cv-sous-more" onClick={() => setMem({}, 'Sous: memory cleared')}>Bring everything back</button></p>}
              </Fold>
            )}
            <Fold icon="Users" title="The team: one brain, a specialist on every page" open={open === 'team'} onToggle={() => toggle('team')}>
              <ul className="cv-sous-team">
                {agentTeam(local.facts, local.noticed, local.record).map((a) => (
                  <li key={a.page}>
                    <button type="button" className={a.page === me.agent.id ? 'on' : ''} onClick={() => leave(a.page)} title={a.job}>
                      <span className="ic"><Icon name={CV_PAGES[a.page]?.icon || 'Sparkles'} size={15} /></span>
                      <span className="nm">{a.name}</span>
                      <span className="pg">{a.record?.wins ? `${money(Math.round(a.record.week))}/wk verified` : a.record?.testing ? `${a.record.testing} being tested` : CV_PAGES[a.page]?.title}</span>
                      {a.noticed > 0 && <span className="n" aria-label={`${a.noticed} noticed`}>{a.noticed}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Fold>
          </div>
        </div>

        <div className="cv-sous-foot">
          <form className="cv-sous-form" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
            <input id="cv-sous-q" value={text} onChange={(e) => setText(e.target.value)} placeholder={special ? `Ask ${me.agent.name}` : `Ask Sous about ${brief.room}`} maxLength={500} autoComplete="off" aria-label={special ? `Ask ${me.agent.name}` : `Ask Sous about ${brief.room}`} />
            <button type="submit" className="cv-sous-send" disabled={!text.trim() || busy} aria-label="Send"><Icon name="ArrowUp" size={18} /></button>
          </form>
          <span className="cv-sous-note">Answers come only from {brief.room}&apos;s records. Nothing is changed or sent without you.</span>
          {tools && <span className="cv-sous-note">Engine: {!server ? 'built-in (browser preview)' : remote?.ai ? 'Claude Opus 5.5, checked against the records' : 'built-in (no AI key on the server)'}</span>}
        </div>
      </aside>
    </>
  );
}
