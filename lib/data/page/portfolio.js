// All rooms: one view of every room the viewer can see, and a ranked list of
// what needs attention this week. Pure, so the browser and any server caller
// compute the same thing from the same dataset.
//
// Two sources of truth:
//  - the sample group (a demo visitor, or "try the sample"): the model's own
//    figures, alarms and feeds for each room;
//  - a real group: banked and tests come only from its own test windows, and
//    earned and sales only from rooms with their own Toast data. Rooms still
//    on sample numbers never count toward a real group's totals.
import { money, tmpl } from '../model.js';

/** Days without a new week of Toast data before a room counts as stale. */
export const STALE_AFTER_DAYS = 8;
/** How long a reversal stays on the attention list. */
export const REVERSAL_DAYS = 28;
/** The saved decision key for items an operator marked handled. */
export const HANDLED_KEY = 'portfolio.handled';
/** Most handled items kept per room; the server refuses more. */
export const HANDLED_MAX = 50;

const TONE_RANK = { bad: 0, warn: 1, info: 2 };
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const DAY = 864e5;
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Whole days from the end of a data day (YYYY-MM-DD) to `now`. */
export function daysSince(end, now) {
  const t = Date.parse(`${end}T23:59:59Z`);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / DAY)) : null;
}

/** Item ids for a room's open state, so a handled item comes back when the state changes. */
function item(roomId, kind, key, rest) {
  return { id: `${roomId}:${kind}:${key}`.slice(0, 120), roomId, kind, ...rest };
}

/* ------------------------------------------------------------------ sample group */
function sampleRoom(r) {
  const d = r.d;
  const stale = d.feeds.filter((f) => f.state === 'stale');
  return {
    id: r.id, name: d.profile.name, short: d.profile.short,
    banked: r.banked, paused: r.paused, earned: r.earned, net: r.net,
    counted: true, own: false, sample: true,
    tests: r.tests, alarms: r.alarms, reversed: 0, waiting: 0,
    stale: stale.length, feeds: stale.length ? 'stale' : 'healthy', dataEnd: null, dataAge: null,
    note: r.note,
  };
}

function sampleItems(rows) {
  const out = [];
  for (const r of rows) {
    const d = r.d;
    for (const a of d.alarms) {
      out.push(item(r.id, 'alarm', slug(a.title), {
        tone: 'bad', icon: 'Siren', title: a.title, body: tmpl(a.body, d.tokens), go: a.go || 'controls', cta: 'See why',
      }));
    }
    for (const f of d.feeds.filter((x) => x.state === 'stale')) {
      out.push(item(r.id, 'feed', `${slug(f.name)}-${slug(f.last)}`, {
        tone: 'warn', icon: 'Clock', title: `${f.name} feed is stale`, body: `Last update ${f.last}. ${f.note || ''}`.trim(), go: 'sources', cta: f.fix || 'Open sources',
      }));
    }
  }
  /* The room that earns least and has least banked: its best use of an hour this week.
     Queue items that only fix a stale feed are already on the list above. */
  if (rows.length > 1) {
    const weakest = [...rows].sort((a, b) => a.banked - b.banked || a.earned - b.earned)[0];
    const q = weakest.d.queue.find((x) => x.go !== 'sources' && !String(x.when || '').startsWith('stale:') && !x.input);
    if (q) {
      out.push(item(weakest.id, 'focus', slug(q.id), {
        tone: 'info', icon: 'Lightbulb', title: tmpl(q.title, weakest.d.tokens),
        body: `${weakest.d.profile.short} earns the least and has ${weakest.banked ? `only ${money(weakest.banked)}` : 'nothing'} banked this week. ${tmpl(q.body, weakest.d.tokens)}`,
        go: q.go || 'today', cta: 'Open', claim: q.claim, value: tmpl(q.value, weakest.d.tokens),
      }));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ real group */
function realRoom(r, windows, now) {
  const d = r.d;
  const ws = windows.filter((w) => w.roomId === r.id);
  const t = d.room.fromToast;
  const own = !!t;
  const age = own ? daysSince(t.end, now) : null;
  const stale = own && age > STALE_AFTER_DAYS ? 1 : 0;
  const verified = ws.filter((w) => w.status === 'verified');
  const running = ws.filter((w) => w.status === 'running' || w.status === 'waiting');
  const reversed = ws.filter((w) => w.status === 'reversed' && recent(w.reversedAt, now));
  const waiting = ws.filter((w) => w.status === 'waiting');
  const banked = verified.reduce((s, w) => s + (w.bookedCents || 0), 0) / 100;
  const note = !own ? 'Sample numbers until its own Toast data is in'
    : reversed[0] ? `${reversed[0].title} reversed`
      : waiting[0] ? `${waiting[0].title} is waiting for data`
        : running[0] ? `${running[0].title}: day ${running[0].day} of 28`
          : verified.length ? `${verified.length} verified test${verified.length === 1 ? '' : 's'} holding`
            : 'No tests yet';
  return {
    id: r.id, name: d.profile.name, short: d.profile.short,
    banked: Math.round(banked), paused: 0,
    earned: own ? r.earned : null, net: own ? r.net : null,
    counted: own, own, sample: !own,
    tests: running.length, alarms: reversed.length, reversed: reversed.length, waiting: waiting.length,
    stale, feeds: !own ? 'sample' : stale ? 'stale' : 'healthy', dataEnd: own ? t.end : null, dataAge: age,
    note,
  };
}

function recent(at, now) {
  if (!at) return true;
  const t = typeof at === 'string' ? Date.parse(at) : at instanceof Date ? at.getTime() : NaN;
  return !Number.isFinite(t) || now - t <= REVERSAL_DAYS * DAY;
}

function realItems(rows, rooms, windows, now) {
  const out = [];
  for (const room of rooms) {
    const ws = windows.filter((w) => w.roomId === room.id);
    for (const w of ws.filter((x) => x.status === 'reversed' && recent(x.reversedAt, now))) {
      out.push(item(room.id, 'reversed', w.id, {
        tone: 'bad', icon: 'Undo2', title: `${w.title} reversed`,
        body: 'A guardrail broke after this test verified, so it no longer books and nothing more is billed for it. The window shows which guardrail and when.',
        go: 'windows', cta: 'See the window',
      }));
    }
    for (const w of ws.filter((x) => x.status === 'waiting')) {
      out.push(item(room.id, 'waiting', `${w.id}-${room.dataEnd || 'none'}`, {
        tone: 'warn', icon: 'CirclePause', title: `${w.title} is waiting for data`,
        body: `No new week of data${room.dataAge != null ? ` for ${room.dataAge} days` : ''}, so the test waits rather than fails. It picks up as soon as a fresh week lands.`,
        go: 'connect', cta: 'Check the feed',
      }));
    }
    if (room.stale) {
      out.push(item(room.id, 'stale', room.dataEnd, {
        tone: 'warn', icon: 'Clock', title: `${room.short}'s Toast data is ${room.dataAge} days old`,
        body: `It runs to ${dayLabel(room.dataEnd)}. Figures and tests wait for a fresh week: check the connection, or upload the latest export.`,
        go: 'connect', cta: 'Check the feed',
      }));
    }
    if (!room.own) {
      out.push(item(room.id, 'sample', 'toast', {
        tone: 'info', icon: 'PlugZap', title: `Connect ${room.short}'s Toast`,
        body: 'This room still shows sample numbers, so nothing from it counts toward your totals until its own data is in.',
        go: 'connect', cta: 'Connect Toast',
      }));
    }
  }
  /* Among rooms on their own data: the one earning least, and its top-ranked move. */
  const own = rows.filter((r) => r.d.room.fromToast);
  if (own.length > 1) {
    const banked = (r) => rooms.find((x) => x.id === r.id)?.banked || 0;
    const weakest = [...own].sort((a, b) => banked(a) - banked(b) || a.earned - b.earned)[0];
    const c = weakest.d.plan.sorted.find((x) => x.value > 0.5 && !x.prevent);
    if (c) {
      out.push(item(weakest.id, 'focus', slug(c.id), {
        tone: 'info', icon: 'Lightbulb', title: c.title,
        body: `${weakest.d.profile.short} earns the least of your rooms on their own data. This is its top-ranked move: ${Math.round(c.p * 100)}% chance it verifies.`,
        go: 'finding', params: { id: c.id }, cta: 'Open the finding', claim: c.claim, value: `about ${money(Math.round(c.value))}/wk`,
      }));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ the view */
/**
 * @param {{ rows: any[] }} group  deriveGroup(ds)
 * @param {{ real?: boolean, windows?: any[], now?: number, handled?: Record<string, Record<string, string>> }} opts
 *   handled: { [roomId]: { [itemId]: isoDate } }, the saved `portfolio.handled` per room
 */
export function portfolioView(group, { real = false, windows = [], now = Date.now(), handled = {} } = {}) {
  const rooms = group.rows.map((r) => (real ? realRoom(r, windows, now) : sampleRoom(r)));
  const items = (real ? realItems(group.rows, rooms, windows, now) : sampleItems(group.rows))
    .map((x) => ({ ...x, room: rooms.find((r) => r.id === x.roomId)?.short || x.roomId, handledAt: handled[x.roomId]?.[x.id] || null }))
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || rooms.findIndex((r) => r.id === a.roomId) - rooms.findIndex((r) => r.id === b.roomId));
  const open = items.filter((x) => !x.handledAt);
  const done = items.filter((x) => x.handledAt).sort((a, b) => String(b.handledAt).localeCompare(String(a.handledAt)));
  const counted = rooms.filter((r) => r.counted);
  const sum = (k) => counted.reduce((s, r) => s + (r[k] || 0), 0);
  const totals = {
    rooms: rooms.length,
    counted: counted.length,
    banked: rooms.reduce((s, r) => s + r.banked, 0),
    paused: rooms.reduce((s, r) => s + r.paused, 0),
    earned: counted.length ? sum('earned') : null,
    net: counted.length ? sum('net') : null,
    tests: rooms.reduce((s, r) => s + r.tests, 0),
    stale: rooms.filter((r) => r.stale).length,
    dataEnd: rooms.map((r) => r.dataEnd).filter(Boolean).sort().at(-1) || null,
  };
  for (const r of rooms) {
    r.open = open.filter((x) => x.roomId === r.id).length;
    r.share = totals.earned && r.counted ? r.earned / totals.earned : null;
    r.status = !r.counted ? 'sample' : open.some((x) => x.roomId === r.id && x.tone !== 'info') ? 'attention' : 'quiet';
  }
  return { rooms, totals, open, handled: done };
}

/**
 * The next saved value for one room after marking an item handled (or undoing it).
 * Keeps only ids that are still on the list, newest first, so the record stays small.
 */
export function nextHandled(saved, roomId, itemId, on, liveIds, at = new Date().toISOString()) {
  const cur = { ...(saved || {}) };
  if (on) cur[itemId] = at; else delete cur[itemId];
  const live = new Set(liveIds);
  return Object.fromEntries(Object.entries(cur)
    .filter(([id]) => id.startsWith(`${roomId}:`) && live.has(id))
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
    .slice(0, HANDLED_MAX));
}
