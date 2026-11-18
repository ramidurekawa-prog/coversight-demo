'use client';

import * as React from 'react';

import { agentAnswer, agentFor, agentRead, agentTeam } from '../lib/ai/agents';
import { agentRecord, noticedSig, sousBoard, sousMoves, sousRemember } from '../lib/ai/moves';
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
  // Which ticket is open (the page's own, when Sous is called from a page), which lane a phone shows, and which answer is up.
  const [open, setOpen] = React.useState('');
  const [lane, setLane] = React.useState('now');
  const [shown, setShown] = React.useState(-1);
  const [team, setTeam] = React.useState(false);
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

  React.useEffect(() => { setShown(-1); }, [turns.length]);

  const brief = remote?.roomId === roomId && remote.engine === 'ai' ? remote.brief : local.brief;
  const me = local.agent;
  const { move } = me;
  const special = me.agent.id !== 'sous';
  const suggest = special && me.ask.length ? me.ask : local.suggest;
  const leave = (p, params) => { onClose(); go(p, params); };
  const push = (t) => setTurns((xs) => [...xs, { by: me.agent.name, ...t }]);
  const board = sousBoard(CV_D, { moves: local.moves, memory: local.memory, mem: eng.actions?.[CV_D.id]?.sous || {}, page: me.agent.id });
  const opened = open || (move && board.now[0]?.id === move.id && special ? move.id : '');
  const turn = turns.length ? turns[shown < 0 ? turns.length - 1 : shown] : null;
  const lanes = [['now', 'Do now', board.now.length], ['watching', 'Watching', board.watching.length], ['proven', 'Proven', board.proven.length]];
  const forget = (id) => setMem((m) => Object.fromEntries(Object.entries(m || {}).filter(([k]) => k !== id)), 'Sous: brought back');


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
      <div className="cv-pass-scrim" onClick={onClose} />
      <div className="cv-pass" role="dialog" aria-modal="true" aria-label={`The Pass: ${SOUS.name}, your AI teammate`}>
        <header className="cv-pass-top">
          <span className="cv-sous-mark" aria-hidden="true"><Icon name="Sparkles" size={20} /></span>
          <form className="cv-pass-ask" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
            <input id="cv-sous-q" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={special ? `Ask ${me.agent.name}, or anything about ${brief.room}` : `Ask ${SOUS.name} anything about ${brief.room}`} maxLength={500} autoComplete="off" aria-label={`Ask ${SOUS.name} about ${brief.room}`} />
            <button type="submit" className="cv-sous-send" disabled={!text.trim() || busy} aria-label="Ask"><Icon name="ArrowUp" size={18} /></button>
          </form>
          <button className="iconbtn" onClick={onClose} aria-label="Close the Pass"><Icon name="X" size={18} /></button>
        </header>

        <div className="cv-pass-bd">
          {!turn && suggest.length > 0 && (
            <div className="cv-sous-chips" aria-label="Things to ask">
              {suggest.map((q) => <button key={q} type="button" onClick={() => ask(q)}>{q}</button>)}
            </div>
          )}

          {turn && (
            <section className="cv-ticket answer" aria-live="polite" aria-label="Sous's answer">
              <div className="cv-ticket-h">
                <span className="who"><Icon name="Sparkles" size={13} />{turn.by || SOUS.name}</span>
                <span className="q">{turn.q}</span>
                <button type="button" className="cv-sous-more" onClick={() => setTurns([])}>Clear</button>
              </div>
              {turn.pending ? <p className="cv-pass-wait"><span className="cv-sous-dots" aria-hidden="true"><i /><i /><i /></span>Reading your records…</p>
                : <Answer key={`${turns.length}:${shown}`} t={turn} last onGo={leave} onAsk={ask} onDo={act} />}
              {turns.length > 1 && (
                <div className="cv-pass-earlier">
                  <span>Earlier</span>
                  {turns.map((t, i) => (t === turn ? null : <button key={i} type="button" onClick={() => setShown(i)}>{t.q}</button>))}
                </div>
              )}
            </section>
          )}

          <div className="cv-pass-tabs" role="tablist" aria-label="The Pass">
            {lanes.map(([k, label, n]) => <button key={k} type="button" role="tab" aria-selected={lane === k} className={lane === k ? 'on' : ''} onClick={() => setLane(k)}>{label}<i>{n}</i></button>)}
          </div>

          <div className="cv-pass-lanes" data-lane={lane}>
            <section className="cv-lane now" aria-label="Do now">
              <h2><Icon name="Flame" size={15} />Do now<i>{board.now.length}</i></h2>
              {board.now.length === 0 && <p className="cv-lane-empty">Nothing needs you right now. I&apos;ll put it here when something does.</p>}
              {board.now.map((m, i) => {
                const a = agentFor(m.go === 'finding' ? 'plan' : m.go);
                const isOpen = opened === m.id;
                const n = m.noticedId ? local.noticed.find((x) => x.id === m.noticedId) : null;
                const link = local.facts.find((f) => f.topic === 'link' && f.also?.includes(m.topic));
                return (
                  <article key={m.id} className={`cv-ticket${isOpen ? ' open' : ''}${m.source === 'noticed' ? ' warn' : ''}`}>
                    <button type="button" className="cv-ticket-h" onClick={() => setOpen(isOpen ? '-' : m.id)} aria-expanded={isOpen}>
                      <span className="who"><Icon name={CV_PAGES[a.id]?.icon || 'Sparkles'} size={13} />{a.name}</span>
                      {m.go === me.agent.id && special && <span className="here">This page</span>}
                      <Icon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size={15} />
                    </button>
                    <p className="t">{m.title}</p>
                    <Stake move={m} />
                    {isOpen && (
                      <div className="cv-ticket-why">
                        <p>{m.why}</p>
                        {link && <p className="link"><Icon name="Link2" size={14} />{link.short}</p>}
                        {m.source === 'plan' && <p>This is a potential gain, not money saved. It counts only after a test verifies it.</p>}
                      </div>
                    )}
                    <div className="cv-ticket-acts">
                      <Button variant={i === 0 ? 'primary' : 'secondary'} icon={ACT[m.act.kind]?.icon} iconRight={ACT[m.act.kind] ? undefined : 'ArrowRight'} onClick={() => act(m)}>{ctaFor(m)}</Button>
                      {isOpen && n && <button type="button" className="cv-sous-more" onClick={() => remember(n, 'handled')}>Already handled</button>}
                      {isOpen && n && <button type="button" className="cv-sous-more" onClick={() => remember(n, 'dismissed')}>Not for us</button>}
                    </div>
                  </article>
                );
              })}
              {board.more > 0 && <button type="button" className="cv-sous-more" onClick={() => leave('plan')}>{board.more} more on the plan</button>}
            </section>

            <section className="cv-lane watching" aria-label="Keeping an eye on">
              <h2><Icon name="Eye" size={15} />Keeping an eye on<i>{board.watching.length}</i></h2>
              {board.watching.length === 0 && <p className="cv-lane-empty">No tests running and nothing set aside.</p>}
              {board.watching.map((w) => (
                <article key={w.id} className="cv-ticket quiet">
                  <div className="cv-ticket-h"><span className="who"><Icon name={w.kind === 'test' ? CV_PAGES[w.page]?.icon || 'Eye' : 'Check'} size={13} />{w.kind === 'test' ? 'Being tested' : w.kind === 'handled' ? 'Handled' : 'Set aside'}</span></div>
                  <p className="t">{w.title}</p>
                  {w.progress != null && <span className="cv-ticket-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, Math.min(100, w.progress))}%` }} /></span>}
                  <p className="note">{w.note}</p>
                  <div className="cv-ticket-acts">
                    {w.kind === 'test' ? <button type="button" className="cv-sous-more" onClick={() => leave(w.go, { id: w.goId })}>See the test</button>
                      : <button type="button" className="cv-sous-more" onClick={() => forget(w.memId)}>Bring it back</button>}
                  </div>
                </article>
              ))}
            </section>

            <section className="cv-lane proven" aria-label="Proven">
              <h2><Icon name="BadgeCheck" size={15} />Proven<i>{board.proven.length}</i></h2>
              {board.proven.length === 0 && <p className="cv-lane-empty">Nothing verified yet. A change lands here once a test proves it.</p>}
              {board.proven.map((w) => (
                <article key={w.id} className="cv-ticket good">
                  <div className="cv-ticket-h"><span className="who"><Icon name={CV_PAGES[w.page]?.icon || 'BadgeCheck'} size={13} />{w.kind === 'win' ? agentFor(w.page).name : 'Resolved'}</span></div>
                  <p className="t">{w.title}</p>
                  {w.value && <span className="cv-stake"><b>{w.value}</b>{w.claim && <Claim k={w.claim} />}</span>}
                  <p className="note">{w.note}</p>
                  {w.go && <div className="cv-ticket-acts"><button type="button" className="cv-sous-more" onClick={() => leave(w.go, { id: w.goId })}>See the proof</button></div>}
                </article>
              ))}
            </section>
          </div>

          <section className="cv-pass-room">
            <p><b>{brief.room} right now.</b> {brief.headline}</p>
            <button type="button" className="cv-sous-more" onClick={() => setTeam((x) => !x)} aria-expanded={team}>{team ? 'Hide the team' : 'Who is on the team'}</button>
            {team && (
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
            )}
          </section>
        </div>

        <footer className="cv-pass-foot">
          <span>The Pass · every ticket comes from {brief.room}&apos;s own records. Nothing is changed or sent without you.</span>
          {tools && <span>Engine: {!server ? 'built-in (browser preview)' : remote?.ai ? 'Claude Opus 5.5, checked against the records' : 'built-in (no AI key on the server)'}</span>}
        </footer>
      </div>
    </>
  );
}
