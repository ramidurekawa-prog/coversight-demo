// Mise, the restaurant's brain, on the server. lib/ai/mise.js computes what
// Mise knows, has learned and is deciding, the same in the browser and here.
// This adds Mise's own read: the brain model (BRAIN_MODEL) reads every record
// and says, per level, what it means for the restaurant and, per consultant,
// what it has learned and will do differently. Every figure it writes must be
// in the records (numbersOk) or that line is dropped and the built-in words
// stay. With no key, or the provider down, the built-in words are the read.
import { and, eq } from 'drizzle-orm';

import { casebook, casebookFacts, endingOf } from '../../lib/ai/casebook.js';
import { mise } from '../../lib/ai/mise.js';
import { roomMoves } from '../../lib/ai/room-moves.js';
import { numbersOk, sousHash, sousSheet } from '../../lib/ai/sous.js';
import { understandingFacts } from '../../lib/ai/understanding.js';
import { deriveGroup, deriveRoom, money } from '../../lib/data/model.js';
import { loadActions } from '../actions';
import { loadDataset } from '../dataset';
import type { Db } from '../db/client';
import { auditLog, snapshots, testWindows } from '../db/schema';
import { InputError } from '../org';
import type { Viewer } from '../session';
import { listTasks } from '../tasks';
import { BRAIN_MODEL, aiAllowance, aiConfigured, askClaude } from './claude';

type Fact = { id: string; topic: string; label: string; text: string; claim?: string };
type V = Pick<Viewer, 'orgId' | 'role' | 'rooms'> & { userId: string | null };

const WHO = `You are Mise, the brain of a restaurant inside Coversight. Mise en place is how a kitchen gets everything in its place before service; you do that for the whole business. You have read every record about this restaurant: what is known about the industry rules it works under, its group, this location, its managers and its team, and the casebook of every change its consultants suggested and how each one turned out.

Your job here is to say what it all means, the way the best consultant the owner ever hired would say it across the pass: plain words a twelve-year-old knows, sentences under fifteen words, "you" and "your", no jargon, no lists, no markdown, US spelling.

Work only from the records. Every figure you write is checked against them and your line is thrown away if one is not there, so copy figures exactly and never add, round or annualize them. Keep the word that says how sure a figure is: an estimate is never money saved. Never say a consultant beats a person or plain rules; the records do not show that yet. If the records do not say something, do not guess.`;

const READ_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['levels', 'consultants'],
  properties: {
    levels: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'read'], properties: { id: { type: 'string', description: 'The level id: industry, group, location, management or team.' }, read: { type: 'string', description: 'At most two sentences, 30 words: what this level means for the restaurant right now, and the one thing that would teach you more about it.' } } } },
    consultants: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['page', 'read'], properties: { page: { type: 'string', description: 'The consultant’s page id from its record id (track:<page>).' }, read: { type: 'string', description: 'At most two sentences, 30 words, in the consultant’s own voice: what its results taught it and what it now does differently.' } } } },
  },
};

/** The records Mise reads: its understanding, the casebook and every case, one line each. */
function records(m: ReturnType<typeof mise>, book: ReturnType<typeof casebook>, room: string): Fact[] {
  const cases = book.cases.map((c: { id: string; title: string; roomName: string; outcome: string; est: number | null; point: number | null; lesson: string }) => ({
    id: `case:${c.id}`, topic: 'track', label: 'Case',
    text: `${c.title} at ${c.roomName}: ${endingOf(c.outcome).label.toLowerCase()}.${c.est ? ` Estimated ${money(c.est)} a week (estimated).` : ''}${c.point != null && endingOf(c.outcome).result ? ` Measured ${money(c.point)} a week.` : ''} ${c.lesson}`,
  }));
  return [...(understandingFacts(m.understanding) as Fact[]), ...(casebookFacts(book, room) as Fact[]), ...cases];
}

/**
 * Mise for one room: the engine, the model and Mise's read per level and per
 * consultant. Kept per room until the records change, so opening Mise
 * doesn't spend a call each time.
 */
export async function loadMise(db: Db, v: V, roomRaw: unknown, { fetchImpl, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  if (!loaded) throw new InputError('Organization not found.');
  const ids = Object.keys(loaded.ds.rooms);
  const roomId = typeof roomRaw === 'string' && roomRaw ? roomRaw : ids[0];
  if (!roomId || !ids.includes(roomId)) throw new InputError('That room is not one of yours.');
  const d = deriveRoom(loaded.ds, roomId);
  const group = deriveGroup(loaded.ds);
  const sample = !!(loaded.org as { sample?: boolean } | undefined)?.sample;
  const [acts, wins, tasks] = await Promise.all([
    loadActions(db, v.orgId, v.rooms, v.userId),
    sample ? Promise.resolve([]) : db.select().from(testWindows).where(eq(testWindows.orgId, v.orgId)),
    listTasks(db, v.orgId, v.rooms),
  ]);
  const saved = (acts[roomId] ?? {}) as Record<string, unknown>;
  const rooms = Object.fromEntries(group.rows.map((r: { id: string; name: string }) => [r.id, r.name]));
  const book = casebook(d, { ...(sample ? { today: loaded.ds.now?.iso } : { windows: wins }), rooms, levels: saved.autonomy as Record<string, number> | undefined });
  const mine = tasks.filter((t) => t.roomId === roomId);
  const m = mise(d, { book, group, tasks: mine, notes: saved['sous.notes'] as unknown[], mem: saved.sous as Record<string, unknown>, moves: roomMoves(d, saved, { windows: wins, tasks: mine, now: now.getTime() }) });
  const facts = records(m, book, d.profile?.short ?? roomId);
  const base = { roomId, model: BRAIN_MODEL, ai: aiConfigured(), engine: 'builtin' as 'ai' | 'builtin', reads: { levels: {} as Record<string, string>, consultants: {} as Record<string, string> } };
  if (!aiConfigured()) return base;

  const hash = sousHash(facts);
  const [snap] = await db.select().from(snapshots).where(and(eq(snapshots.orgId, v.orgId), eq(snapshots.roomId, roomId), eq(snapshots.kind, 'mise')));
  const kept = snap?.data as { hash: string; reads: typeof base.reads } | undefined;
  if (kept?.hash === hash) return { ...base, engine: 'ai' as const, reads: kept.reads };
  if (!(await aiAllowance(db, v.orgId, 'mise'))) return base;

  const sheet = sousSheet(facts);
  const r = await askClaude<{ levels: { id: string; read: string }[]; consultants: { page: string; read: string }[] }>({
    model: BRAIN_MODEL, system: WHO, schema: READ_SCHEMA, maxTokens: 3000, effort: 'medium',
    messages: [{ role: 'user', content: [
      { type: 'text', text: `Records for ${d.profile?.name ?? roomId}:\n${sheet}`, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `Write your read for each level that has a record (${m.understanding.levels.filter((l: { known: unknown[] }) => l.known.length).map((l: { id: string }) => l.id).join(', ')}) and for each consultant that has a track record (${m.learning.map((k: { page: string }) => k.page).join(', ')}).` },
    ] }],
  }, fetchImpl);
  const reads = { levels: {} as Record<string, string>, consultants: {} as Record<string, string> };
  if (r.ok) {
    const ok = (t: unknown) => { const s = String(t ?? '').trim(); return s && s.length <= 400 && numbersOk(s, sheet) ? s : null; };
    for (const l of r.data.levels ?? []) { const s = ok(l.read); if (s && m.understanding.levels.some((x: { id: string }) => x.id === l.id)) reads.levels[l.id] = s; }
    for (const c of r.data.consultants ?? []) { const s = ok(c.read); if (s && m.learning.some((x: { page: string }) => x.page === c.page)) reads.consultants[c.page] = s; }
  }
  const engine = Object.keys(reads.levels).length + Object.keys(reads.consultants).length > 0 ? 'ai' as const : 'builtin' as const;
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'mise.read', detail: { roomId, engine, model: BRAIN_MODEL, kept: Object.keys(reads.levels).length + Object.keys(reads.consultants).length } });
  if (engine === 'ai') {
    const data = { hash, reads };
    await db.insert(snapshots).values({ orgId: v.orgId, roomId, kind: 'mise', data }).onConflictDoUpdate({ target: [snapshots.orgId, snapshots.roomId, snapshots.kind], set: { data, at: now } });
  }
  return { ...base, engine, reads };
}
