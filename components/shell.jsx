'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { CV_NAV, CV_PAGES, CV_ROLES, GROUP_PAGES, pageFromPath, pathFor } from '../lib/pages';
import { Button, Icon } from './kit';
import { ApprovalModal, Claim, cvApproval, CV_CLAIM, CV_D, CV_LOCS, CV_NOW, CvCtx, DerivDrawer, Pill } from './screens/core';
import { engine, useEngine } from './engine';
import { CV_PAGE_DEPS, CvAsk } from './screens/extra';

/* The app chrome around every screen: a strip that switches between the
 * finished product and the build plan, the sidebar grouped by how often each
 * screen is used, and a top bar with claim-strength legend, feed health,
 * room switcher and role switcher. Drawers, the approval modal and toasts
 * live here so any screen can open them through CvCtx. */

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
            <img src="/brand-mark.png" alt="" width="20" height="28" />
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
                  {id === 'today' && <span className="count">{CV_D.room.queue.length}</span>}
                  {p.isNew && <span className="cv-new">New</span>}
                  {p.dot && <span className="cv-dot" title="2 feeds stale" />}
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
        <span className="cv-over">Every dollar carries one strength</span>
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

function TopBar({ page, loc, onLoc, role, onRole, go, onMenu, onAsk }) {
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
        <span className="sub">{CV_NOW.label}</span>
      </div>
      <div className="spacer" />
      {deps && (
        <Link className="cv-health cv-hide-sm" href={`/build#${page}`} title="What has to be built behind this screen">
          <Icon name="Wrench" size={15} />
          Needs {deps.length} platform gap{deps.length === 1 ? '' : 's'}
        </Link>
      )}
      <button className="cv-health" onClick={onAsk} aria-label="Ask">
        <Icon name="MessageCircle" size={15} />
        <span className="cv-hide-sm">Ask</span>
      </button>
      <div className="cv-pop-wrap cv-hide-sm">
        <button className="cv-health" onClick={() => setPop(pop === 'legend' ? null : 'legend')} aria-expanded={pop === 'legend'}>
          <Icon name="Scale" size={15} />
          Claim strength
        </button>
        {pop === 'legend' && <LegendPop onClose={() => setPop(null)} />}
      </div>
      {CV_D.staleCount > 0 ? (
        <button className="cv-health cv-hide-sm" onClick={() => go('sources')} title={`${CV_D.staleCount} feeds stale`}>
          <i />{CV_D.staleCount} feed{CV_D.staleCount === 1 ? '' : 's'} stale
        </button>
      ) : (
        <button className="cv-health cv-hide-sm" onClick={() => go('sources')} title="All feeds fresh">
          <Icon name="CircleCheck" size={15} color="var(--success-600)" />Feeds fresh
        </button>
      )}
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
      <div className="cv-role" role="tablist" aria-label="View as">
        {Object.entries(CV_ROLES).map(([k, r]) => (
          <button key={k} role="tab" aria-selected={role === k} className={role === k ? 'on' : ''} onClick={() => onRole(k)}>
            {r.label}
          </button>
        ))}
      </div>
    </header>
  );
}

function ModeStrip({ build }) {
  return (
    <div className="cv-strip">
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
      <span className="cv-strip-pill">
        <Pill icon="FlaskConical">Demo · sample restaurant group</Pill>
      </span>
    </div>
  );
}

export function Shell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { page } = pageFromPath(pathname);
  const eng = useEngine();
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

  // Restore a viewer's room and inputs once, after the first render.
  React.useEffect(() => { engine.hydrate(); }, []);

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
        <div className="cv-host"><React.Fragment key={`${eng.room}-${eng.version}`}>{children}</React.Fragment></div>
      </CvCtx.Provider>
    );
  }

  return (
    <CvCtx.Provider value={ctx}>
      <ModeStrip build={false} />
      <div className="cv-host">
        <div className={`app cv-app ${navOpen ? 'nav-open' : ''}`}>
          <Sidebar page={page} role={role} onNavigate={() => setNavOpen(false)} />
          {navOpen && <div className="cv-scrim" style={{ zIndex: 'calc(var(--z-drawer) - 1)' }} onClick={() => setNavOpen(false)} />}
          <div className="content">
            <TopBar page={page} loc={loc} onLoc={chooseLoc} role={role} onRole={chooseRole} go={go} onMenu={() => setNavOpen(true)} onAsk={() => setAsk(true)} />
            <main className="scroll" ref={scrollRef}>
              <React.Fragment key={`${eng.room}-${eng.version}`}>{children}</React.Fragment>
            </main>
          </div>
        </div>
      </div>
      {ask && <CvAsk onClose={() => setAsk(false)} go={go} />}
      {deriv && <DerivDrawer id={deriv} onClose={() => setDeriv(null)} />}
      {approval && (
        <ApprovalModal
          id={approval.id}
          onClose={() => setApproval(null)}
          onConfirm={(id) => {
            approval.onOk && approval.onOk();
            showToast(`${cvApproval(id).title}: approved and written back.`);
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
