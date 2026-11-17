'use client';

/* Data inputs: Google Sheets and Dropbox files kept linked. Each is read again
 * every morning; a tab that passes every check is loaded, one that doesn't is
 * flagged and nothing changes. */

import * as React from 'react';

import { Button, Icon } from '../../kit';
import { CV_DS, Pill, useCv } from '../core';
import { engine } from '../../engine';
import { SCHEMAS } from '../../../lib/data/page/inputs';
import { jfetch } from './inputs-data';
import s from './inputs.module.css';

const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const host = (u) => { try { const x = new URL(u); return x.hostname.includes('dropbox') ? 'Dropbox' : 'Google Sheets'; } catch { return 'Link'; } };

/** Read now and Unlink for a linked sheet, shared by the list and the side panels. */
export function useLinkActions(setLinks) {
  const cv = useCv();
  const [busy, setBusy] = React.useState(null);
  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { cv.toast(e.message); } finally { setBusy(null); } };
  const readNow = (l) => run(`pull:${l.id}`, async () => {
    const j = await jfetch(`/api/inputs/links/${l.id}`, { method: 'POST' });
    setLinks(j.links);
    const r = j.pulled?.results?.[l.id];
    await engine.hydrate();
    cv.toast(r?.failed?.length ? `Read again: ${r.failed.length} tab${r.failed.length === 1 ? '' : 's'} need a fix.` : `Read again: ${r?.committed?.length ?? 0} loaded, ${r?.unchanged?.length ?? 0} unchanged.`);
  });
  const unlink = (l, after) => run(`del:${l.id}`, async () => {
    const j = await jfetch(`/api/inputs/links/${l.id}`, { method: 'DELETE' });
    setLinks(j.links);
    after?.();
    cv.toast('Unlinked. Data already loaded stays.');
  });
  return { busy, readNow, unlink };
}

export function LinkedSheets({ links, setLinks, onSettings }) {
  const { busy, readNow } = useLinkActions(setLinks);
  const [open, setOpen] = React.useState(null);
  if (!links.length) return null;
  return (
    <section className="cv-card" aria-labelledby="inputs-links" data-links="1">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="inputs-links">Linked sheets</span>
          <span className="cv-small cv-muted">Read every morning. Only tabs that pass every check are loaded.</span>
        </div>
        <Pill icon="Link2">{links.length} linked</Pill>
      </div>
      <div className="cv-col" style={{ gap: 0 }}>
        {links.map((l) => {
          const failed = l.lastResult?.failed || [];
          const tone = !l.pulledAt ? 'neutral' : l.lastError ? 'warn' : 'good';
          const on = open === l.id;
          return (
            <div key={l.id} className={s.entryWrap}>
              <div className={s.entry}>
                <span className={`cv-q-ico ${tone === 'warn' ? 'warn' : tone === 'good' ? 'good' : ''}`} style={{ width: 32, height: 32 }}><Icon name={tone === 'warn' ? 'TriangleAlert' : 'Link2'} size={15} /></span>
                <button type="button" className={s.entryBtn} aria-expanded={on} aria-controls={`link-${l.id}`} onClick={() => setOpen(on ? null : l.id)}>
                  <span className={s.entryTitle}>
                    {host(l.url)} · {CV_DS.rooms[l.roomId]?.profile?.short || l.roomId}
                    <Pill tone={tone} icon={tone === 'warn' ? 'TriangleAlert' : tone === 'good' ? 'CircleCheck' : 'CircleDashed'}>{!l.pulledAt ? 'Not read yet' : l.lastError ? 'Needs a fix' : 'Up to date'}</Pill>
                  </span>
                  <span className={s.entryMeta}>{l.pulledAt ? `Last read ${when(l.pulledAt)}` : 'Not read yet'}{failed.length ? ` · ${failed.length} tab${failed.length === 1 ? '' : 's'} flagged` : ''}</span>
                </button>
                <Icon name={on ? 'ChevronUp' : 'ChevronDown'} size={16} className={s.chev} />
                <button type="button" className={s.iconBtn} onClick={() => onSettings(l)} aria-label={`Settings for the ${host(l.url)} link`}><Icon name="Settings" size={17} /></button>
              </div>
              {on && (
                <div className={s.histDetail} id={`link-${l.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <a href={l.url} target="_blank" rel="noreferrer noopener" className={s.ellipsis}>{l.url.replace(/^https:\/\//, '')}</a>
                  <span>{l.picks.map((p) => `${p.source.split(' · ').pop()} → ${SCHEMAS[p.kind]?.title ?? p.kind}`).join(', ')}</span>
                  {l.lastResult && <span>{l.lastResult.committed?.length ?? 0} loaded, {l.lastResult.unchanged?.length ?? 0} unchanged on the last read.</span>}
                  {failed.length > 0 && (
                    <ul className="cv-issues">
                      {failed.slice(0, 4).map((f, i) => <li key={i} className="warn"><Icon name="TriangleAlert" size={14} /><span><b>{f.source.split(' · ').pop()}:</b> {f.why}</span></li>)}
                    </ul>
                  )}
                  <span className="cv-row" style={{ gap: 8 }}>
                    <Button size="sm" variant="secondary" icon="RefreshCw" disabled={!!busy} onClick={() => readNow(l)}>{busy === `pull:${l.id}` ? 'Reading…' : 'Read it now'}</Button>
                    <Button size="sm" variant="ghost" icon="Settings" onClick={() => onSettings(l)}>Settings</Button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
