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

export function LinkedSheets({ links, setLinks }) {
  const cv = useCv();
  const [busy, setBusy] = React.useState(null);
  const [confirm, setConfirm] = React.useState(null);
  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { cv.toast(e.message); } finally { setBusy(null); } };
  if (!links.length) return null;
  return (
    <section className="cv-card" aria-labelledby="inputs-links" data-links="1">
      <div className="cv-card-head">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-h4" id="inputs-links">Linked sheets</span>
          <span className="cv-small cv-muted">Read again every morning at 1:30 am Pacific. A tab that passes every check is loaded; one that doesn&apos;t is flagged here and nothing changes.</span>
        </div>
        <Pill icon="Link2">{links.length} linked</Pill>
      </div>
      <div className="cv-col" style={{ gap: 0 }}>
        {links.map((l) => {
          const failed = l.lastResult?.failed || [];
          const tone = !l.pulledAt ? 'neutral' : l.lastError ? 'warn' : 'good';
          return (
            <div key={l.id} className={s.entry}>
              <span className={`cv-q-ico ${tone === 'warn' ? 'warn' : tone === 'good' ? 'good' : ''}`} style={{ width: 32, height: 32 }}><Icon name={tone === 'warn' ? 'TriangleAlert' : 'Link2'} size={15} /></span>
              <div className="cv-col" style={{ gap: 3, minWidth: 0 }}>
                <span className={s.entryTitle}>
                  <a href={l.url} target="_blank" rel="noreferrer noopener" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host(l.url)} · {l.url.replace(/^https:\/\//, '')}</a>
                  <Pill tone={tone} icon={tone === 'warn' ? 'TriangleAlert' : tone === 'good' ? 'CircleCheck' : 'CircleDashed'}>{!l.pulledAt ? 'Not read yet' : l.lastError ? 'Needs a fix' : 'Up to date'}</Pill>
                </span>
                <span className={s.entryMeta}>{CV_DS.rooms[l.roomId]?.profile?.short || l.roomId} · {l.picks.map((p) => `${p.source.split(' · ').pop()} → ${SCHEMAS[p.kind]?.title ?? p.kind}`).join(', ')}</span>
                <span className={s.entryMeta}>{l.pulledAt ? `Last read ${when(l.pulledAt)}` : 'Not read yet'}{l.lastResult ? ` · ${l.lastResult.committed?.length ?? 0} loaded, ${l.lastResult.unchanged?.length ?? 0} unchanged` : ''}</span>
                {failed.length > 0 && (
                  <ul className="cv-issues" style={{ marginTop: 4 }}>
                    {failed.slice(0, 4).map((f, i) => <li key={i} className="warn"><Icon name="TriangleAlert" size={14} /><span><b>{f.source.split(' · ').pop()}:</b> {f.why}</span></li>)}
                  </ul>
                )}
              </div>
              <span className="cv-row nowrap" style={{ gap: 4 }}>
                {confirm === l.id ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep</Button>
                    <Button size="sm" variant="secondary" icon="Unlink" disabled={!!busy} onClick={() => run(`del:${l.id}`, async () => { const j = await jfetch(`/api/inputs/links/${l.id}`, { method: 'DELETE' }); setLinks(j.links); setConfirm(null); cv.toast('Unlinked. Data already loaded stays.'); })}>Unlink</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" icon="RefreshCw" disabled={!!busy} onClick={() => run(`pull:${l.id}`, async () => { const j = await jfetch(`/api/inputs/links/${l.id}`, { method: 'POST' }); setLinks(j.links); const r = j.pulled?.results?.[l.id]; await engine.hydrate(); cv.toast(r?.failed?.length ? `Read again: ${r.failed.length} tab${r.failed.length === 1 ? '' : 's'} need a fix.` : `Read again: ${r?.committed?.length ?? 0} loaded, ${r?.unchanged?.length ?? 0} unchanged.`); })}>{busy === `pull:${l.id}` ? 'Reading…' : 'Read now'}</Button>
                    <Button size="sm" variant="ghost" icon="Unlink" disabled={!!busy} onClick={() => setConfirm(l.id)} aria-label={`Unlink ${host(l.url)}`}>Unlink</Button>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
