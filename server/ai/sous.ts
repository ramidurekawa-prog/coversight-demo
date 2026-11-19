// Sous on the server: the brief, the answers and the nightly watch, for the
// group and rooms the viewer can see. The facts come from lib/ai/sous.js (the
// same pure code the browser preview runs); Claude, when the AI engine is on,
// writes from those facts and every figure it writes is checked against them.
// With the engine off, busy or over its daily allowance, the built-in brief
// and answers are returned instead, so Sous always answers.
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { numbersOk, sousBrief, sousCites, sousFacts, sousHash, sousNoticed, sousRole, sousSheet, sousSuggest, sousToday } from '../../lib/ai/sous.js';
import { agentAnswer, agentBrief, agentFor, agentRead } from '../../lib/ai/agents.js';
import { agentRecord, sousMoves, sousRemember } from '../../lib/ai/moves.js';
import { deriveGroup, deriveRoom } from '../../lib/data/model.js';
import { CV_PAGES } from '../../lib/pages.js';
import { loadActions } from '../actions';
import { loadDataset } from '../dataset';
import type { Db } from '../db/client';
import { auditLog, meetingActions, snapshots, testWindows } from '../db/schema';
import { notify } from '../notify';
import { InputError } from '../org';
import type { Viewer } from '../session';
import { listTasks } from '../tasks';
import { loadSeries } from '../forecast';
import { covercastFor } from '../page/service';
import { aiAllowance, aiConfigured, askClaude } from './claude';

type V = Pick<Viewer, 'orgId' | 'role' | 'rooms'> & { userId: string | null };
type Fact = { id: string; topic: string; text: string; claim?: string; go?: string; label: string };
type Line = { id: string; icon: string; label: string; text: string; claim: string | null; go?: string };
type Brief = { room: string; role: string; headline: string; lines: Line[]; action: { title: string; why: string; value: string | null; claim: string | null; go: string; cta: string } | null; noticed: { id: string; topic: string; tone: string; icon: string; title: string; text: string; claim: string; go: string }[] };

const ROLE_WORD: Record<string, string> = { owner: 'the owner', gm: 'the general manager', floor: 'a floor manager', accountant: 'the accountant' };

/** What Sous is, said once, for every call. Stable text, so it caches. */
const WHO = `You are Sous, the AI teammate inside Coversight, the platform a restaurant's owner and managers use to run it. You work alongside them: you have read every record for their restaurant and your job is to tell them what it means and what to do next.

Sous works as a team of specialists, one for each page of the platform (Price Watch on Purchasing, Roster Coach on Labor, and so on). They are all you, reading the same records. When a message says which specialist you are, answer from that job's point of view first, then connect it to the rest of the restaurant when the records show a link.

The people you talk to run restaurants. They are busy, often on a phone between tasks, and they do not want to read. Talk to them the way you would across the pass: say it out loud in your head first. Use everyday words a twelve-year-old knows, sentences under fifteen words, and "you" and "your". Say the answer first, then the one thing to do. Never use a business or data word when a kitchen word will do (say "used up too fast", not "variance"; "proven", not "validated"). No jargon, no lists, no markdown, US spelling (labor, modeled).

Everything you know about this restaurant is in the records in the user's message. Each line is one record with its id in square brackets. Work only from those records.

Figures matter more than anything else here, because people act on them. Every figure you write is checked against the records, and your whole reply is thrown away if one of them is not there. So copy figures exactly as the records write them, and do not add, subtract, average, round or annualize them yourself. When you quote a dollar figure, keep the word that says how sure it is (estimated, modeled, verified, observed): an estimate must never read like money already saved, and "potential" is the right word for anything not yet verified.

If the records do not answer something, say so plainly. A confident guess can cost a restaurant real money; "I don't have that yet" never does.`;

const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'answered', 'used', 'follow_up'],
  properties: {
    answer: { type: 'string', description: 'The reply: one or two short sentences. The first sentence is the answer or the thing to do; the second, only if needed, is the reason with its figure. The person can open the records for more, so do not list them.' },
    answered: { type: 'boolean', description: 'False when the records do not answer the question.' },
    used: { type: 'array', items: { type: 'string' }, description: 'The ids of the records the answer draws on.' },
    follow_up: { type: 'string', description: 'One short question the person would naturally ask next that the records can answer, or an empty string.' },
  },
};

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'lines'],
  properties: {
    headline: { type: 'string', description: 'One sentence, at most 22 words: the single most important thing about this restaurant right now.' },
    lines: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'text'],
        properties: { id: { type: 'string', description: 'The id of the line being rewritten.' }, text: { type: 'string', description: 'The line, at most 28 words, with the reason it matters when another record explains it.' } },
      },
    },
  },
};

/** The room in view and everything Sous reads about it, scoped to what this viewer may see. */
async function context(db: Db, v: V, roomRaw: unknown, now: Date) {
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  if (!loaded) throw new InputError('Organization not found.');
  const ids = Object.keys(loaded.ds.rooms);
  const roomId = typeof roomRaw === 'string' && roomRaw ? roomRaw : ids[0];
  if (!roomId || !ids.includes(roomId)) throw new InputError('That room is not one of yours.');
  const d = deriveRoom(loaded.ds, roomId);
  const raw = loaded.ds.rooms[roomId] as { fromToast?: unknown; tz?: string };
  const [acts, wins, tasks, meeting, series] = await Promise.all([
    loadActions(db, v.orgId, v.rooms, v.userId),
    db.select({ roomId: testWindows.roomId, lever: testWindows.lever, title: testWindows.title, status: testWindows.status }).from(testWindows).where(and(eq(testWindows.orgId, v.orgId), eq(testWindows.roomId, roomId))),
    listTasks(db, v.orgId, v.rooms),
    db.select({ id: meetingActions.id, title: meetingActions.title, owner: meetingActions.owner, due: meetingActions.due, status: meetingActions.status }).from(meetingActions)
      .where(and(eq(meetingActions.orgId, v.orgId), eq(meetingActions.roomId, roomId), inArray(meetingActions.status, ['open', 'deferred']))).limit(50),
    raw?.fromToast ? loadSeries(db, v.orgId, roomId, raw, now).catch(() => null) : Promise.resolve(null),
  ]);
  const saved = (acts[roomId] ?? {}) as { queue?: unknown; findings?: unknown; fences?: unknown; sous?: Record<string, { at: string; how: 'handled' | 'dismissed'; sig: string; title?: string }> };
  const role = sousRole(v.role);
  const today = sousToday(d, { stored: saved.queue ?? null, dismissed: saved.findings ?? {}, windows: wins, tasks, now: now.getTime() });
  // What the room already answered stays quiet until it is due again or its numbers change.
  const memory = sousRemember(sousNoticed(d), saved.sous ?? {}, now.getTime());
  const noticed = memory.active;
  // The day loop: last night against the forecast, today's plan, and every decision still open.
  // An own room reads its Toast days and the same cached Covercast as Service; a sample room computes both from its data.
  const cc = raw?.fromToast && series ? await covercastFor(db, { ...v, userId: v.userId ?? '' }, roomId, today.today, now, fetch).catch(() => null) : null;
  const day = { tasks: tasks.filter((t) => t.roomId === roomId), assigned: today.view?.assigned ?? {}, open: today.open, meeting, fences: saved.fences ?? null, series, cc, now: now.getTime(), ...(raw?.fromToast ? { today: today.today } : {}) };
  // The group is the viewer's own rooms only (the dataset is already scoped), so a manager never reads another room.
  const facts = sousFacts(d, { role, windows: wins, card: today.card, open: today.open, noticed, group: deriveGroup(loaded.ds), day }) as Fact[];
  const brief = sousBrief(d, { role, facts, noticed, card: today.card, open: today.open }) as Brief;
  const moves = sousMoves(d, { noticed, card: today.card, role, quietIds: memory.quietIds, day });
  return { org: loaded.org as { sample?: boolean }, roomId, d, role, noticed, facts, brief, moves, memory };
}

const records = (facts: Fact[]) => `Records for this restaurant:\n${sousSheet(facts)}`;

/** Ask Claude to write the brief from the facts. Returns null when the engine is off or the text fails the figure check. */
async function writeBrief(c: Awaited<ReturnType<typeof context>>, fetchImpl?: typeof fetch): Promise<Pick<Brief, 'headline' | 'lines'> | null> {
  const r = await askClaude<{ headline: string; lines: { id: string; text: string }[] }>({
    system: WHO,
    schema: BRIEF_SCHEMA,
    maxTokens: 3000,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: records(c.facts), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Write this morning's brief for ${ROLE_WORD[c.role]} of ${c.brief.room}. Rewrite the headline and each line below so it reads as one colleague telling another what matters, connecting it to the reason when another record explains it. Keep each line about the same record it is about now, and return the same line ids.\n\nHeadline now: ${c.brief.headline}\n${c.brief.lines.map((l) => `Line ${l.id} (${l.label}): ${l.text}`).join('\n')}` },
      ],
    }],
  }, fetchImpl);
  if (!r.ok) return null;
  const sheet = sousSheet(c.facts);
  const lines = c.brief.lines.map((l) => {
    const text = r.data.lines?.find((x) => x.id === l.id)?.text?.trim();
    // A line that fails the check keeps its built-in wording; the rest still read as written.
    return text && text.length <= 400 && numbersOk(text, sheet) ? { ...l, text } : l;
  });
  const headline = String(r.data.headline ?? '').trim();
  return { headline: headline && headline.length <= 300 && numbersOk(headline, sheet) ? headline : c.brief.headline, lines };
}

/**
 * Sous for one room: the brief, what it noticed and what to ask. A brief
 * Claude wrote is kept per room and role and reused until the room's facts
 * change, so opening Sous doesn't spend a call each time.
 */
export async function loadSous(db: Db, v: V, roomRaw: unknown, { fetchImpl, now = new Date(), page }: { fetchImpl?: typeof fetch; now?: Date; page?: string | null } = {}) {
  const c = await context(db, v, roomRaw, now);
  const kind = `sous:${c.role}`;
  const hash = sousHash([...c.facts, { id: 'brief', topic: '', label: '', text: JSON.stringify([c.brief.headline, c.brief.lines.map((l) => l.id)]) }]);
  let brief: Brief = c.brief, engine: 'ai' | 'builtin' = 'builtin';
  if (aiConfigured()) {
    const [snap] = await db.select().from(snapshots).where(and(eq(snapshots.orgId, v.orgId), eq(snapshots.roomId, c.roomId), eq(snapshots.kind, kind)));
    const kept = snap?.data as { hash: string; headline: string; lines: Brief['lines'] } | undefined;
    if (kept?.hash === hash) {
      brief = { ...c.brief, headline: kept.headline, lines: kept.lines }; engine = 'ai';
    } else if (await aiAllowance(db, v.orgId, 'brief')) {
      const written = await writeBrief(c, fetchImpl);
      if (written) {
        brief = { ...c.brief, ...written }; engine = 'ai';
        const data = { hash, headline: written.headline, lines: written.lines };
        await db.insert(snapshots).values({ orgId: v.orgId, roomId: c.roomId, kind, data }).onConflictDoUpdate({ target: [snapshots.orgId, snapshots.roomId, snapshots.kind], set: { data, at: now } });
      }
      await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'sous.brief', detail: { roomId: c.roomId, role: c.role, engine: written ? 'ai' : 'builtin' } });
    }
  }
  return { roomId: c.roomId, role: c.role, engine, ai: aiConfigured(), brief, suggest: sousSuggest(c.facts, c.role) as string[], agent: agentRead(pageId(page), c.facts, c.noticed, { role: c.role, moves: c.moves }), record: agentRecord(c.d), resolved: c.memory.resolved };
}

/** A page id the app really has; anything else is Sous with no specialty. */
const pageId = (page: unknown) => (typeof page === 'string' && Object.hasOwn(CV_PAGES, page) ? page : '');

const askBody = z.object({
  /** The page the person is on: its agent answers. */
  page: z.string().max(40).optional(),
  roomId: z.string().min(1).max(60).optional(),
  question: z.string().trim().min(1).max(500),
  /** The last few turns, so "and the week before?" makes sense. Never trusted for figures. */
  history: z.array(z.object({ q: z.string().max(500), a: z.string().max(2000) })).max(6).optional(),
});

/** Ask Sous. Answers from the room's facts; says so when they don't cover the question. */
export async function askSous(db: Db, v: V, raw: unknown, { fetchImpl, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  const p = askBody.safeParse(raw);
  if (!p.success) throw new InputError('Ask Sous a question (up to 500 characters).');
  const c = await context(db, v, p.data.roomId, now);
  const page = pageId(p.data.page);
  const agent = agentFor(page) as { id: string; name: string };
  const move = agentRead(page, c.facts, c.noticed, { role: c.role, moves: c.moves }).move;
  const local = agentAnswer(page, p.data.question, c.facts, { room: c.brief.room, role: c.role, move }) as { text: string; short?: string; move?: unknown; used: string[]; cites: { label: string; go: string }[]; claim: string | null; grounded: boolean; suggest: string[] };
  let out = { ...local, engine: 'builtin' as 'ai' | 'builtin' };
  if (aiConfigured() && (await aiAllowance(db, v.orgId, 'ask'))) {
    const turns = (p.data.history ?? []).flatMap((t) => [{ role: 'user' as const, content: t.q }, { role: 'assistant' as const, content: t.a }]);
    const r = await askClaude<{ answer: string; answered: boolean; used: string[]; follow_up: string }>({
      system: WHO,
      schema: ANSWER_SCHEMA,
      messages: [
        { role: 'user', content: [{ type: 'text', text: `${records(c.facts)}\n\nYou are talking with ${ROLE_WORD[c.role]} of ${c.brief.room}.`, cache_control: { type: 'ephemeral' } }] },
        { role: 'assistant', content: 'I have read the records. What would you like to know?' },
        ...turns,
        // Which specialist is answering goes with the question, after the cached records, so every page shares one cache.
        { role: 'user', content: [agentBrief(page, (CV_PAGES as Record<string, { title: string }>)[page]?.title, c.role), p.data.question].filter(Boolean).join('\n\n') },
      ],
    }, fetchImpl);
    const sheet = sousSheet(c.facts);
    const text = r.ok ? String(r.data.answer ?? '').trim() : '';
    // Earlier answers were checked when they were written, so their figures may be repeated.
    if (r.ok && text && text.length <= 2000 && numbersOk(text, `${sheet}\n${turns.map((t) => t.content).join('\n')}`, p.data.question)) {
      const used = c.facts.filter((f) => (r.data.used ?? []).includes(f.id));
      const grounded = r.data.answered !== false && used.length > 0;
      const follow = String(r.data.follow_up ?? '').trim().slice(0, 120);
      out = { text, short: text, move: local.move, used: used.map((f) => f.id), cites: grounded ? sousCites(used) : [], claim: grounded ? (used.find((f) => f.claim)?.claim ?? null) : null, grounded, suggest: grounded ? (follow ? [follow] : []) : (sousSuggest(c.facts, c.role) as string[]), engine: 'ai' };
    }
  }
  // The question itself is not kept: only that one was asked, how it was answered and what it drew on.
  await db.insert(auditLog).values({ orgId: v.orgId, userId: v.userId, action: 'sous.ask', detail: { roomId: c.roomId, role: c.role, agent: agent.id, engine: out.engine, grounded: out.grounded, used: out.used.slice(0, 6) } });
  return { roomId: c.roomId, agent: agent.name, ...out };
}

/**
 * The nightly watch for one group: tell each room's people what Sous noticed
 * (once per finding per week of data), and write the morning briefs ahead of
 * time when the AI engine is on.
 */
export async function runSous(db: Db, orgId: string, { fetchImpl, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  const loaded = await loadDataset(db, orgId);
  if (!loaded) return { rooms: 0 };
  const byRoom: Record<string, { noticed: number; told: number; briefs: number }> = {};
  for (const roomId of Object.keys(loaded.ds.rooms)) {
    const d = deriveRoom(loaded.ds, roomId);
    const week = d.hist?.rows?.at(-1)?.iso ?? 'now';
    const noticed = sousNoticed(d).filter((n: { tone: string }) => n.tone === 'warn');
    let told = 0;
    for (const n of noticed.slice(0, 2)) {
      const row = await notify(db, { orgId, roomId, kind: 'sous.noticed', severity: 'warn', title: `Sous noticed: ${n.title}`, body: n.text, link: `/${n.go}`, dedupe: `sous:${roomId}:${n.id}:${week}` });
      if (row) told += 1;
    }
    let briefs = 0;
    if (aiConfigured()) {
      for (const role of ['owner', 'gm'] as const) {
        const r = await loadSous(db, { orgId, userId: null, role, rooms: null }, roomId, { ...(fetchImpl ? { fetchImpl } : {}), now });
        if (r.engine === 'ai') briefs += 1;
      }
    }
    byRoom[roomId] = { noticed: noticed.length, told, briefs };
  }
  return { rooms: Object.keys(byRoom).length, byRoom };
}
