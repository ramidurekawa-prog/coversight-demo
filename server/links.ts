// Lane 2, by link: a Google Sheet or a Dropbox file the restaurant already
// keeps. Fetch it once to review, or keep it linked so it's re-read every
// morning. Only Google and Dropbox hosts are ever fetched (no open proxy),
// redirects are followed by hand and re-checked, and size and time are capped.
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { validate, mapColumns, parseRows, gridToTable, KINDS, SCHEMAS } from '../lib/data/ingest.js';
import { route } from '../lib/data/sniff.js';
import type { Db } from './db/client';
import { auditLog, inputs, linkedSources, rooms } from './db/schema';
import { loadDataset } from './dataset';
import { notify } from './notify';
import { InputError } from './org';
import { AuthError, type Viewer } from './session';

/** Key-order-independent JSON (jsonb stores keys sorted, so a plain stringify never matches). */
export const stable = (v: unknown): string => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v ?? null));

const MAX = 20 * 1024 * 1024;
/** Linked sheets per group. */
export const MAX_LINKS = 25;
const ALLOWED = /^(docs\.google\.com|[a-z0-9-]+\.googleusercontent\.com|www\.dropbox\.com|dl\.dropboxusercontent\.com|[a-z0-9-]+\.dl\.dropboxusercontent\.com)$/;

/** A share link → the URL that returns the file itself. Throws in plain words for anything else. */
export function directUrl(raw: string) {
  let u: URL;
  try { u = new URL(String(raw).trim()); } catch { throw new InputError('That isn’t a link. Copy it from the Share button in Google Sheets or Dropbox.'); }
  if (u.protocol !== 'https:') throw new InputError('Use the https:// link.');
  if (u.hostname === 'docs.google.com') {
    const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)/);
    if (pub) return { url: `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=xlsx`, name: 'Google Sheet.xlsx', kind: 'google' as const };
    const id = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];
    if (!id) throw new InputError('Only Google Sheets links work here (docs.google.com/spreadsheets/…).');
    // The whole workbook, every tab, so each tab is recognised on its own.
    return { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, name: 'Google Sheet.xlsx', kind: 'google' as const };
  }
  if (u.hostname === 'www.dropbox.com' || u.hostname === 'dropbox.com') {
    u.hostname = 'www.dropbox.com';
    u.searchParams.set('dl', '1');
    const name = decodeURIComponent(u.pathname.split('/').pop() || 'Dropbox file');
    return { url: u.toString(), name, kind: 'dropbox' as const };
  }
  throw new InputError('Paste a Google Sheets or Dropbox link. Other sites can’t be fetched from here; download the file and drop it instead.');
}

/** Fetch the file behind a share link. */
export async function fetchLink(raw: string, fetchImpl: typeof fetch = fetch) {
  const d = directUrl(raw);
  let url = d.url;
  for (let hop = 0; hop < 5; hop++) {
    const host = new URL(url).hostname;
    if (!ALLOWED.test(host)) throw new InputError('The link redirected somewhere Coversight doesn’t fetch from.');
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Coversight/1.0 (+data import)' } });
    } catch {
      throw new InputError('Couldn’t reach that link. Try again in a minute.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (res.status === 401 || res.status === 403 || res.status === 404 || /text\/html/.test(type)) {
      throw new InputError(d.kind === 'google'
        ? 'Google wouldn’t share that sheet. In Google Sheets: Share → General access → “Anyone with the link” (Viewer), then paste the link again.'
        : 'Dropbox wouldn’t share that file. Use Share → Copy link, and make sure the link isn’t restricted.');
    }
    if (!res.ok) throw new InputError(`The link answered ${res.status}.`);
    const len = Number(res.headers.get('content-length'));
    if (len > MAX) throw new InputError('That file is over 20 MB.');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX) throw new InputError('That file is over 20 MB.');
    const disp = res.headers.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
    return { name: disp ? decodeURIComponent(disp) : d.name, bytes, type };
  }
  throw new InputError('That link redirected too many times.');
}

/* ---------------------------------------------------------------- linked sources */
const linkInput = z.object({
  url: z.string().trim().min(10).max(2000),
  roomId: z.string().min(1).max(60),
  picks: z.array(z.object({ source: z.string().min(1).max(300), kind: z.string().min(1).max(30) })).min(1).max(20),
});

export async function addLink(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'role' | 'rooms'>, raw: unknown) {
  const p = linkInput.safeParse(raw);
  if (!p.success) throw new InputError(p.error.issues[0]?.message ?? 'invalid link');
  if (v.rooms && !v.rooms.includes(p.data.roomId)) throw new AuthError(403, 'That room is not one of yours.');
  if (p.data.picks.some((x) => x.kind === 'toast')) throw new InputError('Toast exports come in through Connect, not a linked sheet.');
  const bad = p.data.picks.find((x) => !(KINDS as string[]).includes(x.kind));
  if (bad) throw new InputError(`unknown kind '${bad.kind}'`);
  // Two tabs feeding one kind would overwrite each other every morning.
  const twice = p.data.picks.find((x, i) => p.data.picks.findIndex((y) => y.kind === x.kind) !== i);
  if (twice) throw new InputError(`Two tabs are set as ${SCHEMAS[twice.kind as keyof typeof SCHEMAS]?.title.toLowerCase() ?? twice.kind}. Pick one tab per kind of data.`);
  directUrl(p.data.url); // refuse anything we'd never fetch
  const [room] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.orgId, v.orgId), eq(rooms.id, p.data.roomId)));
  if (!room) throw new InputError(`no room '${p.data.roomId}' in this group`);
  const existing = await db.select().from(linkedSources).where(eq(linkedSources.orgId, v.orgId));
  // The same sheet linked to the same room again: update which tabs it feeds, don't add a second copy.
  const same = existing.find((l) => l.roomId === p.data.roomId && directUrl(l.url).url === directUrl(p.data.url).url);
  if (same) {
    const [row] = await db.update(linkedSources).set({ url: p.data.url, picks: p.data.picks }).where(eq(linkedSources.id, same.id)).returning();
    await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'link.updated', detail: { roomId: p.data.roomId, kinds: p.data.picks.map((x) => x.kind) } });
    return row!;
  }
  if (existing.length >= MAX_LINKS) throw new InputError(`A group can keep ${MAX_LINKS} sheets linked. Unlink one first.`);
  // One kind in one room is fed by one linked sheet, or two sheets would take turns replacing it.
  const clash = existing.find((l) => l.roomId === p.data.roomId && l.picks.some((x) => p.data.picks.some((y) => y.kind === x.kind)));
  if (clash) {
    const k = clash.picks.find((x) => p.data.picks.some((y) => y.kind === x.kind))!.kind;
    throw new InputError(`Another linked sheet already feeds ${SCHEMAS[k as keyof typeof SCHEMAS]?.title.toLowerCase() ?? k} for this room. Unlink it first.`);
  }
  const [row] = await db.insert(linkedSources).values({ orgId: v.orgId, roomId: p.data.roomId, url: p.data.url, picks: p.data.picks, createdBy: v.userId }).returning();
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'link.added', detail: { roomId: p.data.roomId, kinds: p.data.picks.map((x) => x.kind) } });
  return row!;
}

export async function listLinks(db: Db, orgId: string, roomScope: string[] | null = null) {
  const rows = await db.select().from(linkedSources).where(eq(linkedSources.orgId, orgId)).orderBy(desc(linkedSources.createdAt));
  return rows.filter((r) => !roomScope || roomScope.includes(r.roomId)).map((r) => ({ id: r.id, roomId: r.roomId, url: r.url, picks: r.picks, pulledAt: r.pulledAt, lastError: r.lastError, lastResult: r.lastResult, createdAt: r.createdAt }));
}

export async function removeLink(db: Db, v: Pick<Viewer, 'orgId' | 'userId' | 'rooms'>, id: string) {
  const [row] = await db.select().from(linkedSources).where(and(eq(linkedSources.orgId, v.orgId), eq(linkedSources.id, id)));
  if (!row) throw new InputError('no such link');
  if (v.rooms && !v.rooms.includes(row.roomId)) throw new AuthError(403, 'That room is not one of yours.');
  await db.delete(linkedSources).where(eq(linkedSources.id, id));
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'link.removed', detail: { roomId: row.roomId } });
}

/**
 * Re-read every linked sheet of a group. Each picked tab is validated exactly
 * as the Data inputs screen validates it; a tab with any error is not
 * committed (the owner is told why), and an unchanged tab isn't re-committed.
 */
export async function pullLinks(db: Db, orgId: string, { fetchImpl = fetch, only }: { fetchImpl?: typeof fetch; only?: string } = {}) {
  const links = (await db.select().from(linkedSources).where(eq(linkedSources.orgId, orgId))).filter((l) => !only || l.id === only);
  if (!links.length) return { links: 0 };
  const loaded = await loadDataset(db, orgId);
  const results: Record<string, { committed: string[]; unchanged: string[]; failed: { source: string; why: string }[] }> = {};
  for (const l of links) {
    const res = { committed: [] as string[], unchanged: [] as string[], failed: [] as { source: string; why: string }[] };
    try {
      const f = await fetchLink(l.url, fetchImpl);
      const r = route([{ name: f.name, bytes: f.bytes, type: f.type }]);
      for (const pick of l.picks) {
        // Match by tab: the source name minus the file name, which a re-download may change.
        const tab = (s: string) => s.split(' · ').slice(1).join(' · ') || s;
        const table = r.manual.find((m) => tab(m.source) === tab(pick.source)) ?? r.unknown.find((u) => tab(u.source) === tab(pick.source));
        if (!table) { res.failed.push({ source: pick.source, why: 'That tab is gone or renamed.' }); continue; }
        const t = 'csv' in table ? gridToTable(parseRows(table.csv)) : gridToTable(table.grid, table.headerRow);
        const mi = mapColumns(t.headers, pick.kind);
        if (mi.missing.length) { res.failed.push({ source: pick.source, why: `Missing column${mi.missing.length === 1 ? '' : 's'}: ${mi.missing.join(', ')}` }); continue; }
        const room = loaded?.ds.rooms[l.roomId];
        const v = validate(pick.kind, t.rows, room, mi.map);
        if (v.errors) { res.failed.push({ source: pick.source, why: `${v.errors} row${v.errors === 1 ? ' has an error' : 's have errors'}, e.g. row ${v.issues.find((i: { level: string }) => i.level === 'error')?.row}: ${v.issues.find((i: { level: string }) => i.level === 'error')?.msg}` }); continue; }
        const [last] = await db.select().from(inputs).where(and(eq(inputs.orgId, orgId), eq(inputs.roomId, l.roomId), eq(inputs.kind, pick.kind), eq(inputs.undone, false))).orderBy(desc(inputs.createdAt)).limit(1);
        if (last && stable(last.rows) === stable(v.rows)) { res.unchanged.push(pick.source); continue; }
        await db.insert(inputs).values({ orgId, roomId: l.roomId, kind: pick.kind, rows: v.rows, summary: `Linked sheet · ${tab(pick.source)} · ${v.rows.length} rows`, userId: null });
        res.committed.push(pick.source);
      }
      await db.update(linkedSources).set({ pulledAt: new Date(), lastError: res.failed.length ? res.failed.map((x) => `${x.source}: ${x.why}`).join(' · ').slice(0, 500) : null, lastResult: res }).where(eq(linkedSources.id, l.id));
    } catch (e) {
      const why = e instanceof InputError ? e.message : 'Couldn’t read the link.';
      res.failed.push({ source: l.url, why });
      await db.update(linkedSources).set({ pulledAt: new Date(), lastError: why, lastResult: res }).where(eq(linkedSources.id, l.id));
    }
    if (res.failed.length) {
      await notify(db, { orgId, roomId: l.roomId, kind: 'link.failed', severity: 'warn', title: 'A linked sheet couldn’t be read', body: res.failed.map((x) => `${x.source}: ${x.why}`).join('\n'), link: '/inputs', dedupe: `link-failed:${l.id}:${new Date().toISOString().slice(0, 10)}` }).catch(() => null);
    }
    results[l.id] = res;
  }
  return { links: links.length, results };
}
