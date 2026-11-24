'use client';

import * as React from 'react';

import { CV_NAV, CV_PAGES, CV_SETTINGS, CV_TABS, pathFor } from '../lib/pages';
import { useDialogFocus } from './dialog';
import { Icon } from './kit';
import { CV_LOCS } from './screens/core';

/**
 * Search or jump to (⌘K / Ctrl+K): every page, every tab and every location,
 * filtered as you type, picked with the arrow keys. It only moves you around;
 * it never changes anything.
 */
function entries() {
  const out = [];
  for (const g of CV_NAV) {
    for (const id of g.items) {
      const p = CV_PAGES[id];
      out.push({ key: `page:${id}`, kind: 'page', id, label: p.navTitle || p.title, hint: g.label, icon: p.icon });
      for (const [tab, label] of CV_TABS[id] || []) {
        if (tab !== id) out.push({ key: `page:${tab}`, kind: 'page', id: tab, label: `${p.navTitle || p.title}: ${label}`, hint: g.label, icon: CV_PAGES[tab]?.icon || p.icon });
      }
    }
  }
  out.push({ key: `page:${CV_SETTINGS}`, kind: 'page', id: CV_SETTINGS, label: 'Settings', hint: 'Account', icon: 'Settings' });
  for (const l of CV_LOCS) out.push({ key: `loc:${l.id}`, kind: 'loc', id: l.id, label: `Switch to ${l.short || l.name}`, hint: 'Location', icon: 'MapPin' });
  return out;
}

export function CommandPalette({ onClose, onGo, onLoc }) {
  const ref = React.useRef(null);
  useDialogFocus(ref, onClose);
  const [q, setQ] = React.useState('');
  const [at, setAt] = React.useState(0);
  const all = React.useMemo(entries, []);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = all.filter((e) => words.every((w) => `${e.label} ${e.hint}`.toLowerCase().includes(w))).slice(0, 12);
  const pick = (e) => {
    onClose();
    if (e.kind === 'loc') onLoc(e.id);
    else onGo(e.id);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(list.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && list[at]) { e.preventDefault(); pick(list[at]); }
  };
  return (
    <div className="cv-cmd-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="cv-cmd" role="dialog" aria-modal="true" aria-label="Search or jump to">
        <div className="cv-cmd-field">
          <Icon name="Search" size={16} />
          <input data-autofocus value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} onKeyDown={onKey}
            placeholder="Search pages and locations" aria-label="Search pages and locations"
            role="combobox" aria-expanded="true" aria-controls="cv-cmd-list" aria-activedescendant={list[at] ? `cmd-${list[at].key}` : undefined} />
          <kbd>Esc</kbd>
        </div>
        <ul id="cv-cmd-list" role="listbox" className="cv-cmd-list">
          {list.map((e, i) => (
            <li key={e.key} id={`cmd-${e.key}`} role="option" aria-selected={i === at} className={i === at ? 'on' : undefined}
              onMouseEnter={() => setAt(i)} onClick={() => pick(e)}>
              <Icon name={e.icon} size={16} />
              <span className="l">{e.label}</span>
              <span className="h">{e.hint}</span>
            </li>
          ))}
          {!list.length && <li className="cv-cmd-none" role="presentation">Nothing matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}

/** The sidebar button that opens it, with the shortcut shown. */
export function SearchButton({ onClick }) {
  const [mac, setMac] = React.useState(true);
  React.useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)); }, []);
  return (
    <button type="button" className="cv-search" onClick={onClick}>
      <Icon name="Search" size={15} />
      <span>Search or jump to</span>
      <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}

export { pathFor };
