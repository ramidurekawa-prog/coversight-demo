'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { CV_NAV, CV_PAGES, CV_ROLES, GROUP_PAGES, pageFromPath, pathFor } from '../lib/pages';
import { Button, Icon } from './kit';
import { ApprovalModal, Claim, cvApproval, CV_CLAIM, CV_D, CV_LOCS, CV_NOW, CvCtx, DerivDrawer, Pill } from './screens/core';
import { engine, useEngine } from './engine';
import { CV_PAGE_DEPS, CvAsk } from './screens/extra';
import { useTodayCounts } from './screens/pages/today.badge';
import './shell.css';

/* The app chrome around every screen: the sidebar grouped by how often each
 * screen is used, and a top bar with the page, Ask, one data-health notice
 * (only when something needs updating), the room switcher and quiet
 * utilities. Demo tools (finished product / build plan, view-as roles,
 * build gaps) sit in a strip that's hidden unless turned on with ?tools=1
 * (remembered in this browser; ?tools=0 hides it again) and always on the
 * build plan. Drawers, the approval modal and toasts live here so any
 * screen can open them through CvCtx. */

/** Demo tools on or off: ?tools=1 / ?tools=0, remembered per browser. Off by default. */
function useDemoTools() {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    let v = null;
    try {
      const q = new URLSearchParams(window.location.search).get('tools');
      if (q === '1' || q === '0') localStorage.setItem('cv-tools', q);
      v = localStorage.getItem('cv-tools');
    } catch {}
    setOn(v === '1');
  }, []);
  return on;
}

/** Today's badge: decisions left to make today, by the Today page's own rules. */
function TodayCount() {
  const c = useTodayCounts();
  if (!c.ready) return null;
  return <span className="count" title={`${c.ready} to decide today`} aria-label={`${c.ready} to decide today`}>{c.ready}</span>;
}

function Sidebar({ page, role, onNavigate }) {
  const base = CV_ROLES[role];
  const gm = CV_D.profile.gm;
  const r = role === 'gm' ? { ...base, person: gm, sub: `GM · ${CV_D.profile.short}`, initials: gm.split(' ').map((w) => w[0]).join('') } : base;
  const groups = CV_NAV.filter((g) => !r.nav || r.nav.includes(g.label));
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sb-head">
        <div className="cv-brand">
          <span className="glyph">
            <picture><source srcSet="/brand-mark.webp" type="image/webp" /><img src="/brand-mark-96.png" alt="" width="30" height="30" /></picture>
          </span>
          <span className="wm">Coversight</span>
        </div>
        <div className="divider" style={{ margin: '8px 4px' }} />
      </div>
      <div className="sb-scroll">
        {groups.map((g) => (
          <nav key={g.label} className="navsec" style={{ marginTop: 6 }} aria-label={g.label}>
            <div className="cv-navgroup">
              <span>{g.label}</span>
            </div>
            {g.items.map((id) => {
              const p = CV_PAGES[id];
              const active = page === id || (id === 'proof' && page === 'packet') || (id === 'plan' && page === 'finding');
              return (
                <Link
                  key={id}
                  href={pathFor(id)}
                  className={`navitem ${active ? 'active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  <span className="ico">
                    <Icon name={p.icon} size={18} />
                  </span>
                  {p.title}
                  {id === 'today' && <TodayCount />}
                </Link>
              );
            })}
          </nav>
        ))}
      </div>
      <div className="foot navsec">
        <div className="userchip">
          <span className="avatar">{r.initials}</span>
          <div className="col" style={{ lineHeight: 1.3 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{r.person}</span>
            <span className="faint" style={{ fontSize: 11 }}>
              {r.sub}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function LegendPop({ onClose }) {
  return (
    <div className="cv-pop" style={{ width: 320, padding: 14 }} role="dialog" aria-label="Claim strength">
      <div className="cv-col" style={{ gap: 10 }}>
        <span className="cv-over">How sure each dollar figure is</span>
        {['est', 'mod', 'cau', 'book', 'obs'].map((k) => (
          <div key={k} className="cv-col" style={{ gap: 4 }}>
            <Claim k={k} />
            <span className="cv-xs cv-muted" style={{ lineHeight: 1.45 }}>
              {CV_CLAIM[k].tip}
            </span>
          </div>
        ))}
        <span className="cv-xs cv-faint">Tap any dotted-underlined figure to see how it&apos;s calculated.</span>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function TopBar({ page, loc, onLoc, role, onRole, go, onMenu, onAsk, tools }) {
  const [pop, setPop] = React.useState(null);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setPop(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const l = CV_LOCS.find((x) => x.id === loc);
  const deps = CV_PAGE_DEPS[page];
  return (
    <header className="topbar cv-top" ref={ref}>
      <button className="iconbtn cv-menu-btn" onClick={onMenu} aria-label="Open navigation">
        <Icon name="Menu" size={18} />
      </button>
      <div className="col" style={{ lineHeight: 1.25, minWidth: 0 }}>
        <h1>{CV_PAGES[page].title}</h1>
        <span className="sub">{CV_NOW.label}<SampleTag /></span>
      </div>
      <div className="spacer" />
      {tools && deps && (
        <Link className="cv-health cv-hide-sm" href={`/build#${page}`} title="What has to be built behind this screen">
          <Icon name="Wrench" size={15} />
          Needs {deps.length} platform gap{deps.length === 1 ? '' : 's'}
        </Link>
      )}
      {CV_D.staleCount > 0 && (
        <button className="cv-health cv-warnchip" onClick={() => go('sources')} aria-label={`${CV_D.staleCount} source${CV_D.staleCount === 1 ? ' needs' : 's need'} updating`} title="Some figures use data that is out of date. Open Sources to update it.">
          <i /><span className="cv-wl">{CV_D.staleCount} source{CV_D.staleCount === 1 ? ' needs' : 's need'} updating</span><span className="cv-ws" aria-hidden="true">{CV_D.staleCount}</span>
        </button>
      )}
      <button className="cv-health" onClick={onAsk} aria-label="Ask">
        <Icon name="MessageCircle" size={15} />
        <span className="cv-hide-sm">Ask</span>
      </button>
      <div className="cv-pop-wrap">
        <button className="locpick" onClick={() => setPop(pop === 'loc' ? null : 'loc')} aria-expanded={pop === 'loc'}>
          <Icon name="MapPin" size={15} color="var(--accent)" />
          {l.short}
          <Icon name="ChevronDown" size={15} color="var(--fg-3)" />
        </button>
        {pop === 'loc' && (
          <div className="cv-pop" role="menu">
            {CV_LOCS.map((x) => (
              <button
                key={x.id}
                role="menuitem"
                className={`opt ${x.id === loc ? 'on' : ''}`}
                onClick={() => {
                  onLoc(x.id);
                  setPop(null);
                }}
              >
                <Icon name={x.id === 'all' ? 'Building2' : 'Store'} size={16} />
                <span>
                  {x.name}
                  <small>{x.id === 'all' ? 'Oakland, Berkeley and Walnut Creek together' : `${x.addr} · ${x.seats} seats · GM ${x.gm}`}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="cv-pop-wrap cv-hide-sm">
        <button className="iconbtn cv-quiet" data-tip="What Observed, Estimated and Modeled mean" onClick={() => setPop(pop === 'legend' ? null : 'legend')} aria-expanded={pop === 'legend'} aria-label="What the money labels mean">
          <Icon name="CircleHelp" size={17} />
        </button>
        {pop === 'legend' && <LegendPop onClose={() => setPop(null)} />}
      </div>
      {!tools && <ThemeButton />}
      <AccountControls />
      {tools && <div className="cv-role" role="tablist" aria-label="View as">
        {Object.entries(CV_ROLES).map(([k, r]) => (
          <button key={k} role="tab" aria-selected={role === k} className={role === k ? 'on' : ''} onClick={() => onRole(k)}>
            {r.label}
          </button>
        ))}
      </div>}
    </header>
  );
}

/** Signed in: which org, whether it's the sample, and sign out. No backend: the old demo label. */
function Bell() {
  const eng = useEngine();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const { items, unread } = eng.notes;
  const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <span style={{ position: 'relative' }}>
      <Button size="sm" variant="ghost" icon="Bell" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>{unread ? String(unread) : ''}</Button>
      {open && (
        <div className="cv-card" role="dialog" aria-label="Notifications" style={{ position: 'absolute', right: 0, top: '110%', width: 360, maxHeight: 460, overflowY: 'auto', zIndex: 'var(--z-modal)', padding: 12, gap: 0, boxShadow: 'var(--shadow-lg)' }}>
          <div className="cv-row" style={{ justifyContent: 'space-between', paddingBottom: 8 }}>
            <span className="cv-h4">Notifications</span>
            <Button size="sm" variant="ghost" disabled={!unread} onClick={() => engine.markRead('all')}>Mark all read</Button>
          </div>
          {items.length === 0 ? <span className="cv-small cv-muted">Nothing yet. Test results, reversed savings and changes that don&apos;t show up in your Toast data land here.</span> : items.map((n) => (
            <button key={n.id} type="button" className="cv-col" onClick={() => { engine.markRead([n.id]); setOpen(false); if (n.link) router.push(n.link); }}
              style={{ gap: 2, padding: '10px 0', borderTop: '1px solid var(--border)', textAlign: 'left', background: 'none', border: 0, borderTopStyle: 'solid', cursor: 'pointer', opacity: n.read ? 0.6 : 1, width: '100%' }}>
              <span className="cv-small" style={{ fontWeight: n.read ? 400 : 700 }}><Icon name={n.severity === 'good' ? 'BadgeCheck' : n.severity === 'warn' ? 'MessageSquareWarning' : 'Info'} size={14} /> {n.title}</span>
              {n.body && <span className="cv-xs cv-muted">{n.body}</span>}
              <span className="cv-xs cv-faint">{when(n.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function AccountPill() {
  const eng = useEngine();
  if (eng.mode === 'pending') return null;
  if (eng.mode !== 'server') {
    return (
      <span className="cv-strip-pill">
        <Pill icon="FlaskConical">Demo · sample restaurant group</Pill>
      </span>
    );
  }
  return (
    <span className="cv-strip-pill cv-row" style={{ gap: 8 }}>
      <Pill icon={eng.org?.sample ? 'FlaskConical' : 'Building2'}>{eng.org?.sample ? 'Sample group' : eng.org?.name}{eng.viewer?.anonymous ? ' · guest' : ''}</Pill>
    </span>
  );
}

/** Signed in: notifications and sign out, in the top bar. The sample demo has neither. */
function AccountControls() {
  const eng = useEngine();
  if (eng.mode !== 'server') return null;
  return (
    <span className="cv-row nowrap" style={{ gap: 4 }}>
      {eng.saving && <span className="cv-xs cv-faint cv-hide-sm">Saving…</span>}
      <Bell />
      <Button size="sm" variant="ghost" icon="LogOut" onClick={() => engine.signOut()} aria-label="Sign out" title="Sign out" />
    </span>
  );
}

/** "Sample data" beside the date when the group in view is the sample. */
function SampleTag() {
  const eng = useEngine();
  if (eng.mode === 'pending') return null;
  const sample = eng.mode !== 'server' || eng.org?.sample;
  if (!sample) return null;
  return <span className="cv-sampletag">{eng.viewer?.anonymous ? 'Sample data · guest' : 'Sample data'}</span>;
}

const THEMES = [['auto', 'Monitor', 'Match this device'], ['light', 'Sun', 'Light'], ['dark', 'Moon', 'Dark']];
function applyTheme(v) {
  try { v === 'auto' ? localStorage.removeItem('cv-theme') : localStorage.setItem('cv-theme', v); } catch {}
  if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
}
/** One quiet button that steps Auto → Light → Dark. */
function ThemeButton() {
  const [t, setT] = React.useState('auto');
  React.useEffect(() => { try { setT(localStorage.getItem('cv-theme') || 'auto'); } catch {} }, []);
  const i = Math.max(0, THEMES.findIndex(([v]) => v === t));
  const nextT = THEMES[(i + 1) % THEMES.length];
  const label = `Appearance: ${THEMES[i][2]}. Switch to ${nextT[2].toLowerCase()}`;
  return (
    <button type="button" className="iconbtn cv-quiet cv-hide-sm" aria-label={label} data-tip={`Theme: ${THEMES[i][2].toLowerCase()}`} onClick={() => { setT(nextT[0]); applyTheme(nextT[0]); }}>
      <Icon name={THEMES[i][1]} size={17} />
    </button>
  );
}

/** Auto (follow the device), Light or Dark. Kept per browser; the page renders fine without storage. */
function ThemeSwitch() {
  const [t, setT] = React.useState('auto');
  React.useEffect(() => { try { setT(localStorage.getItem('cv-theme') || 'auto'); } catch {} }, []);
  const pick = (v) => { setT(v); applyTheme(v); };
  return (
    <span className="cv-theme" role="radiogroup" aria-label="Appearance">
      {[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={t === v} className={t === v ? 'on' : ''} onClick={() => pick(v)}>{l}</button>
      ))}
    </span>
  );
}

function ModeStrip({ build }) {
  return (
    <nav className="cv-strip" aria-label="Demo view">
      <div className="seg" role="tablist" aria-label="View">
        <Link role="tab" aria-selected={!build} className={`cv-seg-link${!build ? ' on' : ''}`} href="/">
          Finished product
        </Link>
        <Link role="tab" aria-selected={build} className={`cv-seg-link${build ? ' on' : ''}`} href="/build">
          Build plan
        </Link>
      </div>
      <span className="note">
        {build ? (
          <>
            <b>Build plan:</b> what has to be built behind the finished screens, graded, in build order.
          </>
        ) : (
          <>
            <b>Finished product:</b> the product as designed, on a sample three-room restaurant group. Every figure is computed, labelled and clickable.
          </>
        )}
      </span>
      <span className="spacer" />
      <ThemeSwitch />
      <AccountPill />
    </nav>
  );
}

/** The sign-in screen renders on its own; everything else inside the app shell. */
export function Shell({ children }) {
  const pathname = usePathname();
  if (/^\/(login|reset-password|join)(\/|$)/.test(pathname || '')) return children;
  return <AppShell>{children}</AppShell>;
}

function AppShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { page } = pageFromPath(pathname);
  const eng = useEngine();
  const tools = useDemoTools();
  const [allMode, setAllMode] = React.useState(false);
  const loc = allMode ? 'all' : eng.room;
  const [role, setRole] = React.useState('owner');
  const [deriv, setDeriv] = React.useState(null);
  const [approval, setApproval] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [navOpen, setNavOpen] = React.useState(false);
  const [ask, setAsk] = React.useState(false);
  const scrollRef = React.useRef(null);
  const toastTimer = React.useRef(null);

  // Restore a viewer's room and inputs before first paint; the inline head
  // script hides the sample room until this has run, so nothing flashes.
  React.useLayoutEffect(() => {
    engine.hydrate().finally(() => document.documentElement.classList.remove('cv-pending'));
  }, []);

  // Each screen opens at the top, like a new page.
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setNavOpen(false);
  }, [pathname]);

  const go = React.useCallback((p, params) => router.push(pathFor(p, params)), [router]);
  const pickRoom = React.useCallback((id) => { setAllMode(false); engine.setRoom(id); }, []);
  const showToast = React.useCallback((m) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);
  // A saved state that couldn't be loaded resets itself and says so once.
  React.useEffect(() => {
    if (eng.notice) { showToast(eng.notice); engine.dismissNotice(); }
  }, [eng.notice, showToast]);

  const ctx = React.useMemo(
    () => ({
      go,
      loc,
      room: eng.room,
      version: eng.version,
      pickRoom,
      role,
      openDeriv: (id) => setDeriv(id),
      approve: (id, onOk) => setApproval({ id, onOk }),
      toast: showToast,
    }),
    [go, loc, eng.room, eng.version, pickRoom, role, showToast],
  );

  const chooseRole = (r) => {
    setRole(r);
    go(CV_ROLES[r].home);
  };
  // Room screens walk through Oakland; group screens read every room.
  const chooseLoc = (id) => {
    if (id === 'all') {
      setAllMode(true);
      if (!GROUP_PAGES.includes(page)) go('portfolio');
      return;
    }
    pickRoom(id);
    if (page === 'portfolio') go('week');
  };

  if (page === 'build') {
    return (
      <CvCtx.Provider value={ctx}>
        <ModeStrip build />
        <main className="cv-host">
          <h1 className="sr-only">Build plan</h1>
          <React.Fragment key={`${eng.room}-${eng.version}`}>{children}</React.Fragment>
        </main>
      </CvCtx.Provider>
    );
  }

  return (
    <CvCtx.Provider value={ctx}>
      <div className={tools ? 'cv-shellwrap' : 'cv-shellwrap cv-notools'}>
      {tools && <ModeStrip build={false} />}
      <div className="cv-host">
        <div className={`app cv-app ${navOpen ? 'nav-open' : ''}`}>
          <Sidebar page={page} role={role} onNavigate={() => setNavOpen(false)} />
          {navOpen && <div className="cv-scrim" style={{ zIndex: 'calc(var(--z-drawer) - 1)' }} onClick={() => setNavOpen(false)} />}
          <div className="content">
            <TopBar page={page} loc={loc} onLoc={chooseLoc} role={role} onRole={chooseRole} go={go} onMenu={() => setNavOpen(true)} onAsk={() => setAsk(true)} tools={tools} />
            <main className="scroll" ref={scrollRef} tabIndex={0} aria-label="Screen">
              <React.Fragment key={`${eng.room}-${eng.version}`}>{children}</React.Fragment>
            </main>
          </div>
        </div>
      </div>
      </div>
      {ask && <CvAsk onClose={() => setAsk(false)} go={go} />}
      {deriv && <DerivDrawer id={deriv} onClose={() => setDeriv(null)} />}
      {approval && (
        <ApprovalModal
          id={approval.id}
          eng={eng}
          onClose={() => setApproval(null)}
          onConfirm={(id) => {
            engine.act('approvals', { ...(engine.saved('approvals') || {}), [id]: { at: new Date().toISOString() } }, { summary: `${cvApproval(id).title}: approved` });
            approval.onOk && approval.onOk();
            void engine.createTask(id, cvApproval(id));
            showToast(`${cvApproval(id).title}: approved. The steps are on Today under "Changes to make".`);
          }}
        />
      )}
      {toast && (
        <div className="cv-toast" role="status">
          <span className="tdot" />
          <span className="cv-small" style={{ flex: 1, lineHeight: 1.45 }}>
            {toast}
          </span>
          <button className="iconbtn" style={{ width: 26, height: 26 }} onClick={() => setToast(null)} aria-label="Dismiss">
            <Icon name="X" size={14} />
          </button>
        </div>
      )}
    </CvCtx.Provider>
  );
}
