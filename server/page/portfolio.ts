// All rooms on the server: the same view the page computes (lib/data/page/portfolio.js
// over the viewer's own rooms), and the daily portfolio job that routes urgent
// issues to the people running each room, escalates to the group only when an
// issue stays open, and sends the owner one weekly summary.
import { and, eq } from 'drizzle-orm';

import { deriveGroup } from '../../lib/data/model.js';
import { HANDLED_KEY, portfolioView, weeklySummary } from '../../lib/data/page/portfolio.js';
import { loadActions } from '../actions';
import type { Db } from '../db/client';
import { snapshots } from '../db/schema';
import { loadDataset } from '../dataset';
import { notify } from '../notify';
import { listWindows } from '../proof';

/** An urgent item open this long, and not acknowledged or snoozed, is raised to the whole group. */
export const ESCALATE_AFTER_DAYS = 2;
const DAY = 864e5;

type Opts = { period?: 'week' | '4w'; comparison?: 'own' | 'ly' | 'budget'; now?: number };

/** The view for one viewer: only their group's rooms, and only the rooms they can see. */
export async function portfolioFor(db: Db, v: { orgId: string; rooms: string[] | null }, { period = 'week', comparison = 'own', now = Date.now() }: Opts = {}) {
  const loaded = await loadDataset(db, v.orgId, v.rooms);
  if (!loaded) return null;
  const [windows, acts] = await Promise.all([listWindows(db, v.orgId, v.rooms), loadActions(db, v.orgId, v.rooms)]);
  const handled = Object.fromEntries(Object.entries(acts).map(([room, keys]) => [room, (keys as Record<string, unknown>)[HANDLED_KEY] ?? {}]));
  const real = !loaded.org.sample;
  const view = portfolioView(deriveGroup(loaded.ds), { real, windows: windows.map((w) => ({ ...w, closedAt: w.closedAt?.toISOString() ?? null, reversedAt: w.reversedAt?.toISOString() ?? null })), now, handled: handled as Record<string, Record<string, unknown>>, period, comparison });
  return { org: { id: loaded.org.id, name: loaded.org.name, sample: loaded.org.sample }, view };
}

/** Monday of the week `now` falls in, as YYYY-MM-DD (UTC). */
const mondayOf = (now: number) => {
  const d = new Date(now);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(now - back * DAY).toISOString().slice(0, 10);
};

/** The daily portfolio job for one group. Sample groups are skipped: nobody runs one. */
export async function runPortfolio(db: Db, orgId: string, now = new Date()) {
  const got = await portfolioFor(db, { orgId, rooms: null }, { now: now.getTime() });
  if (!got) return { skipped: 'no group' };
  if (got.org.sample) return { skipped: 'sample' };
  const { view, org } = got;
  const [snap] = await db.select({ data: snapshots.data }).from(snapshots).where(and(eq(snapshots.orgId, orgId), eq(snapshots.roomId, ''), eq(snapshots.kind, 'portfolio')));
  const before = ((snap?.data as { firstSeen?: Record<string, string> } | undefined)?.firstSeen) ?? {};
  const urgent = view.open.filter((x) => x.tone === 'bad');
  const firstSeen: Record<string, string> = {};
  let routed = 0, escalated = 0, summary = 0;
  for (const x of urgent) {
    firstSeen[x.id] = before[x.id] ?? now.toISOString();
    /* Site-level: everyone who can see that room (its GMs and the owners) hears about it once. */
    if (await notify(db, { orgId, roomId: x.roomId, kind: 'portfolio.issue', severity: 'warn', title: `${x.room}: ${x.title}`, body: x.body, link: '/portfolio', dedupe: `portfolio:item:${x.id}` })) routed++;
    const open = now.getTime() - Date.parse(firstSeen[x.id]!);
    if (open >= ESCALATE_AFTER_DAYS * DAY) {
      const days = Math.floor(open / DAY);
      if (await notify(db, { orgId, roomId: null, kind: 'portfolio.escalation', severity: 'warn', title: `Still open after ${days} days at ${x.room}: ${x.title}`, body: `${x.body}\n\nNobody has acknowledged or snoozed it on All rooms yet.`, link: '/portfolio', dedupe: `portfolio:escalate:${x.id}` })) escalated++;
    }
  }
  /* One summary a week, on the first run on or after Monday. */
  const s = weeklySummary(view, org.name);
  if (await notify(db, { orgId, roomId: null, kind: 'portfolio.weekly', severity: 'info', title: s.title, body: s.body, link: '/portfolio', dedupe: `portfolio:week:${mondayOf(now.getTime())}` })) summary++;
  const data = { firstSeen, at: now.toISOString(), // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ranked: view.ranked.map((r: any) => ({ id: r.id, rank: r.rank, tier: r.priority.tier, score: r.priority.score })) };
  await db.insert(snapshots).values({ orgId, roomId: '', kind: 'portfolio', data })
    .onConflictDoUpdate({ target: [snapshots.orgId, snapshots.roomId, snapshots.kind], set: { data, at: now } });
  return { urgent: urgent.length, routed, escalated, summary, ranked: data.ranked };
}
