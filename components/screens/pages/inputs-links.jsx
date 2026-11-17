'use client';

/* Data inputs: actions on a linked Google Sheet or Dropbox file. Each is read
 * again every morning; a tab that passes every check is loaded, one that
 * doesn't is flagged and nothing changes. They show as connections on the page. */

import * as React from 'react';

import { useCv } from '../core';
import { engine } from '../../engine';
import { jfetch } from './inputs-data';

export const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const host = (u) => { try { const x = new URL(u); return x.hostname.includes('dropbox') ? 'Dropbox' : 'Google Sheets'; } catch { return 'Link'; } };

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
