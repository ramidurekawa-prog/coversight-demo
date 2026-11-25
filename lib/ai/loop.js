/**
 * The day loop: what a sharp opening manager knows before the doors open,
 * read from the room's own records. Four parts, one for each turn of the loop:
 *
 *   last night  what happened, against what Covercast said would happen
 *   today       what is planned: covers with their range, and the staffing it needs
 *   follow      every decision already made, and whether it actually got done
 *   data        whether the numbers behind all of it can be trusted this morning
 *
 * Each part becomes checks for a specialist (lib/ai/playbook.js): Day Captain
 * on Today, Floor Captain on Service, Data Steward on the data pages. A check
 * says found / clear / needs, with the fix a consultant would reach for, so
 * the same brain feeds Sous's moves, its facts and the AI brief.
 *
 * Pure. Every figure is computed from the room's data or Covercast; nothing
 * is typed. Money that has not happened yet is "potential", never "saved".
 */
import { forecast } from '../data/forecast/engine.js';
import { covercastRoom } from '../data/forecast/index.js';
import { seriesFromSample } from '../data/forecast/series.js';
import { shiftPulseDay } from '../data/forecast/shift-pulse.js';
import { money } from '../data/model.js';
import { cardTrust } from '../data/page/today-brief.js';
import { DEFAULT_TZ, localDay } from '../data/page/today.js';
import { clockLabel, dayOfDate, servicePlan } from '../data/page/service.js';

const $ = (n) => money(Math.round(n));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DAY_MS = 864e5;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const LONG = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const dateLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const hourLabel = (h) => clockLabel(h * 60);
const ageOf = (at, now) => { const t = Date.parse(String(at || '')); return Number.isFinite(t) ? (now - t) / DAY_MS : null; };
const ageWords = (days) => (days < 1 ? 'today' : days < 2 ? 'yesterday' : `${Math.floor(days)} days ago`);

/** How the loop is tuned. Named, so a test can read the same numbers. */
export const LOOP = {
  /** Day-ahead calls scored for Covercast's own track record. */
  recordDays: 7,
  /** Of those, how many must land inside the range to plan on the number itself. */
  recordTrust: 5,
  /** An approved change nobody has made after this long is a broken loop. */
  stuckDays: 1,
  /** A hand-off nobody has opened after this long. */
  unseenDays: 0.5,
  /** How far back the data checkup looks for missing or odd days. */
  dataDays: 28,
  /** A day this many times off its weekday's usual is probably a typo. */
  oddFactor: 2.5,
};

/* ------------------------------------------------------------------ forecast, cached */

// Covercast is the costly part, so each room's read is kept until its data changes.
const CACHE = new Map();
const keyOf = (id, s) => `${id}|${s.days.length}|${s.days.at(-1)?.iso}|${s.days.at(-1)?.covers}|${s.days.at(-1)?.net}`;

function seriesFor(d, ctx) {
  if (ctx.series?.days?.length) return ctx.series;
  if (d.room?.fromToast) return null;
  try { return seriesFromSample(d.room); } catch { return null; }
}

/**
 * Covercast's read of the room for the loop: today's forecast (handed in when
 * the page already has it, else computed) and the day-ahead calls it would
 * have made for each of the last few days, scored against what happened.
 */
function castFor(d, ctx) {
  const s = seriesFor(d, ctx);
  if (!s?.days?.length) return null;
  const key = keyOf(d.id, s);
  const hit = CACHE.get(key);
  if (hit && (!ctx.cc || hit.cc === ctx.cc)) return hit;
  let cc = ctx.cc?.ready ? ctx.cc : null;
  if (!cc) { try { const f = covercastRoom(d.room, { series: s, accuracy: false, days: 2 }); cc = f.ready ? f : null; } catch { cc = null; } }
  const calls = [];
  for (const day of s.days.slice(-LOOP.recordDays)) {
    try {
      const f = forecast(s, 'covers', { today: day.iso, days: 1 });
      const x = f.ready ? f.days?.[0] : null;
      if (x && x.iso === day.iso) calls.push({ iso: day.iso, actual: day.covers, net: day.net, value: x.value, low: x.low, high: x.high, inside: day.covers >= x.low && day.covers <= x.high });
    } catch { /* a day Covercast can't call is left out, never guessed */ }
  }
  const out = { series: s, cc, calls };
  CACHE.set(key, out);
  if (CACHE.size > 24) CACHE.delete(CACHE.keys().next().value);
  return out;
}

/* ------------------------------------------------------------------ the read */

/**
 * Everything the loop knows about a room this morning.
 * @param {any} d a derived room
 * @param {{ cc?: any, series?: any, today?: string, now?: number, tasks?: any[], assigned?: Record<string, any>, open?: any[], meeting?: any[], fences?: any }} [ctx]
 *   `cc` Covercast for the room (the page's own, when it has one); `series` the room's days (own rooms on the server);
 *   `tasks` the room's approved changes; `assigned` the queue's hand-offs; `open` Today's active cards;
 *   `meeting` the room's open meeting actions; `fences` the room's saved staffing limits.
 */
export function dayLoop(d, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const tz = d.room?.tz || DEFAULT_TZ;
  const cast = castFor(d, ctx);
  const s = cast?.series;
  const lastDay = s?.days?.at(-1) || null;
  const sample = !d.room?.fromToast;
  const today = ctx.today || (sample && lastDay ? addDays(lastDay.iso, 1) : localDay(now, tz));

  // Last night: the latest day on file, against its weekday's recent usual and Covercast's call the day before.
  let night = null;
  if (lastDay) {
    const dow = dayOfDate(lastDay.iso);
    const same = s.days.filter((x) => x.iso < lastDay.iso && dayOfDate(x.iso) === dow).slice(-4);
    const usual = same.length ? { covers: same.reduce((a, x) => a + x.covers, 0) / same.length, net: same.reduce((a, x) => a + x.net, 0) / same.length } : null;
    const call = cast.calls.find((c) => c.iso === lastDay.iso) || null;
    night = {
      iso: lastDay.iso, dow, label: lastDay.iso === addDays(today, -1) ? 'Yesterday' : dateLabel(lastDay.iso),
      covers: lastDay.covers, net: lastDay.net, usual, call,
      vs: call ? (lastDay.covers > call.high ? 'above' : lastDay.covers < call.low ? 'below' : 'inside') : null,
    };
  }
  const record = cast?.calls?.length ? { n: cast.calls.length, inside: cast.calls.filter((c) => c.inside).length, calls: cast.calls } : null;

  // Today: covers with their range, and each service's staffing against the servers usually on.
  let plan = null;
  const cc = cast?.cc;
  const fc = cc?.covers?.days?.find((x) => x.iso === today) || null;
  if (fc) {
    const sp = (() => { try { return shiftPulseDay(cc, today); } catch { return null; } })();
    const dow = dayOfDate(today);
    const meals = {};
    for (const meal of ['lunch', 'dinner']) {
      const p = servicePlan(d.room, dow, ctx.fences ?? null, meal, sp?.[meal] ?? null);
      if (!p?.engine) continue;
      const spare = p.hours.filter((h) => Math.round(h.servers) > h.need && Math.round(h.servers) - 1 >= (h.floor ?? 0));
      const short = p.hours.filter((h) => Math.round(h.servers) < h.need);
      const peak = p.hours.reduce((a, b) => (b.covers > a.covers ? b : a));
      meals[meal] = {
        covers: p.engine.covers, low: p.engine.low, high: p.engine.high, rate: p.rate, wage: p.wage,
        peak: { hour: peak.hour, covers: peak.covers, need: peak.need },
        spare: spare.map((h) => ({ hour: h.hour, on: Math.round(h.servers), need: h.need, extra: Math.round(h.servers) - Math.max(h.need, h.floor ?? 0) })).filter((h) => h.extra > 0),
        short: short.map((h) => ({ hour: h.hour, on: Math.round(h.servers), need: h.need })),
        first: p.hours[0].hour, cutFrom: p.cutFrom, blocked: p.blocked, idleHours: p.idleHours, value: p.value,
      };
    }
    const missing = (fc.drivers?.items || []).filter((x) => x.source === 'none').map((x) => x.key);
    const moved = (fc.drivers?.items || []).filter((x) => x.source !== 'none' && Number.isFinite(x.pct) && x.pct !== 0);
    plan = { iso: today, dow: LONG[dayOfDate(today)], covers: fc.value, low: fc.low, high: fc.high, usual: fc.drivers?.usual ?? null, moved, missing, meals };
  }

  // Follow-through: decisions made, and whether they turned into a change the data can see.
  const tasks = (ctx.tasks || []).filter((t) => !t.roomId || t.roomId === d.id);
  const stuck = tasks.filter((t) => t.status === 'open' && (ageOf(t.createdAt, now) ?? 0) >= LOOP.stuckDays)
    .map((t) => ({ id: t.id, title: t.title, system: t.system || '', age: ageOf(t.createdAt, now), approvalId: t.approvalId }));
  const mismatch = tasks.filter((t) => t.status === 'mismatch').map((t) => ({ id: t.id, title: t.title, system: t.system || '', note: t.note || '' }));
  const verified = tasks.filter((t) => t.status === 'verified').length;
  const unseen = Object.entries(ctx.assigned || {}).filter(([, a]) => a && !a.ack && String(a.to || '').startsWith('user:') && (ageOf(a.at, now) ?? 0) >= LOOP.unseenDays)
    .map(([id, a]) => ({ id, name: a.name || 'A teammate', age: ageOf(a.at, now) }));
  const due = (ctx.meeting || []).filter((a) => (a.status === 'open' || a.status === 'deferred') && String(a.due || '') <= today)
    .map((a) => ({ id: a.id, title: a.title, owner: a.owner || '', due: String(a.due), late: String(a.due) < today }));
  const held = (ctx.open || []).map((c) => ({ c, t: cardTrust(c, d, null) })).filter((x) => x.t.delayed)
    .map(({ c, t }) => ({ id: c.id, title: c.title, feed: t.delayed.name, last: t.delayed.last }));

  return { today, sample, night, record, plan, follow: { stuck, mismatch, verified, unseen, due, held }, series: s };
}

/* ------------------------------------------------------------------ the specialists' checks */

const rangeWords = (lo, hi) => `${lo} to ${hi}`;

/** Day Captain on Today: the opening check. Last night, today, and every loop still open. */
export function openingChecks(d, ctx = {}) {
  const L = dayLoop(d, ctx);
  const out = [];
  const put = (c) => out.push({ kind: 'play', go: 'today', value: null, unit: '', claim: null, how: '', rule: '', needs: '', weight: 0, ...c });
  if (!L.night) {
    put({ tags: 'last night yesterday happened forecast', id: 'last-night', stage: 'spot', name: 'Last night against the forecast', status: 'needs', text: 'There are no daily sales on file, so there is no last night to look at.', needs: 'A day’s sales and covers, from your POS or typed in', needsGo: 'inputs' });
  } else {
    const n = L.night;
    const call = n.call;
    const usualPct = n.usual?.covers ? Math.round((n.covers / n.usual.covers - 1) * 100) : null;
    const usualBit = usualPct == null ? '' : ` That is ${Math.abs(usualPct)}% ${usualPct >= 0 ? 'above' : 'below'} a usual ${LONG[n.dow]}.`;
    if (call && n.vs !== 'inside') {
      const busier = n.vs === 'above';
      put({
        tags: 'last night yesterday happened forecast', id: 'last-night', stage: 'spot', name: 'Last night against the forecast', status: 'found', claim: 'obs', weight: 400 + Math.abs(n.covers - call.value),
        do: busier ? `Ask the closing manager what drove ${n.label.toLowerCase() === 'yesterday' ? 'yesterday' : n.label}` : `Find out why ${n.label.toLowerCase() === 'yesterday' ? 'yesterday' : n.label} was quiet`,
        say: `${n.label} was ${busier ? 'busier' : 'quieter'} than I expected: ${n.covers} covers, when I said ${call.value}.`,
        todo: busier ? 'Find out why, so I can see it coming next time.' : 'Check if something kept guests away.',
        text: `${n.label} (${dateLabel(n.iso)}) did ${n.covers} covers. Covercast’s call the day before was ${call.value}, likely ${rangeWords(call.low, call.high)}, so it landed ${busier ? 'above' : 'below'} the range.${usualBit}`,
        how: busier
          ? 'A night above the range usually has a reason: an event nearby, a big party, good weather. If it will happen again, add it as an event or a booking count so the next forecast and the schedule see it coming. Then check that the floor was not short.'
          : 'A night below the range usually has a reason: weather, a closure nearby, a slow kitchen. If you know it, add it so Covercast learns it. If staffing was set for the usual night, that was spare hours.',
      });
    } else {
      put({
        tags: 'last night yesterday happened forecast', id: 'last-night', stage: 'spot', name: 'Last night against the forecast', status: 'clear', claim: 'obs',
        say: `${n.label} went as planned: ${n.covers} covers${call ? `, and I said ${call.value}` : ''}.`,
        text: `${n.label} (${dateLabel(n.iso)}) did ${n.covers} covers.${call ? ` Covercast’s call the day before was ${call.value}, likely ${rangeWords(call.low, call.high)}, and it landed inside.` : ''}${usualBit}`,
      });
    }
  }
  if (L.record) {
    const r = L.record;
    const misses = r.calls.filter((c) => !c.inside);
    put(r.inside >= LOOP.recordTrust ? {
      tags: 'forecast trust accurate range', id: 'forecast-record', stage: 'spot', name: 'Is the forecast earning its trust', status: 'clear', claim: 'obs',
      say: `My covers forecast landed inside its range on ${r.inside} of the last ${r.n} days. You can plan on it.`,
      text: `Covercast’s day-ahead covers call landed inside its range on ${r.inside} of the last ${r.n} days${misses.length ? ` (missed ${misses.map((c) => dateLabel(c.iso)).join(', ')})` : ''}.`,
    } : {
      tags: 'forecast trust accurate range', id: 'forecast-record', stage: 'spot', name: 'Is the forecast earning its trust', status: 'found', claim: 'obs', weight: 300,
      do: 'Staff to the top of the range until the forecast settles',
      say: `My forecast missed its range on ${misses.length} of the last ${r.n} days. Lean on the range, not the single number.`,
      todo: 'Add this week’s bookings and events so I can see what changed.',
      text: `Covercast’s day-ahead covers call landed inside its range on only ${r.inside} of the last ${r.n} days (missed ${misses.map((c) => `${dateLabel(c.iso)}: ${c.actual} against ${c.value}`).join('; ')}).`,
      how: 'When the forecast misses several days running, something changed that it cannot see yet: a new event, a menu change, a season turning. Staff to the top of the range for the rush hours until it settles, and add what you know as bookings or events.',
    });
  }
  if (!L.plan) {
    put({ tags: 'today expect covers forecast', id: 'today-plan', stage: 'plan', name: 'Today’s covers forecast', status: 'needs', text: 'Covercast needs more days of sales before it can forecast today.', needs: 'More daily sales history, from your POS or typed in', needsGo: 'inputs' });
  } else {
    const p = L.plan;
    const top = p.moved[0];
    put({
      tags: 'today expect covers forecast', id: 'today-plan', stage: 'plan', name: 'Today’s covers forecast', status: 'clear', claim: 'mod',
      say: `Today I expect about ${p.covers} covers, likely ${rangeWords(p.low, p.high)}.`,
      text: `Covercast expects ${p.covers} covers today (${p.dow}), likely ${rangeWords(p.low, p.high)}${p.usual ? `, against ${p.usual} on a usual ${p.dow}` : ''}.${top ? ` The biggest reason: ${top.label.charAt(0).toLowerCase()}${top.label.slice(1)}.` : ''}`,
    });
    if (p.missing.includes('reservations')) {
      put({
        tags: 'bookings reservations forecast', id: 'bookings', stage: 'plan', name: 'Today’s bookings in the forecast', status: 'needs',
        say: 'I don’t know today’s bookings yet, so the forecast runs on history alone.',
        text: 'No booking count is on file for today, so the forecast cannot see a big party or a full book coming.',
        needs: 'Today’s booking count, from your reservation book or typed in on Service', needsGo: 'service',
      });
    }
  }
  const f = L.follow;
  for (const t of f.stuck) {
    put({
      tags: 'approved never done made stuck follow', id: `stuck:${t.id}`, stage: 'check', name: 'Approved, but nobody made the change', status: 'found', weight: 800 + Math.min(30, t.age || 0),
      do: `Make it${t.system ? ` in ${t.system}` : ''} or hand it off: ${t.title}`,
      say: `You approved “${t.title}” ${ageWords(t.age)}, but nobody has made the change yet.`,
      todo: `Make it${t.system ? ` in ${t.system}` : ''} today, or hand it to someone.`,
      text: `“${t.title}” was approved ${ageWords(t.age)} and is still waiting to be made${t.system ? ` in ${t.system}` : ''}. Nothing changes, and nothing can be measured, until someone makes it.`,
      how: 'An approval that never gets made is the most common place a good decision dies. Make it before service, or assign it to the person who will, so it shows as theirs on Today.',
    });
  }
  for (const t of f.mismatch) {
    put({
      tags: 'made done data follow', id: `mismatch:${t.id}`, stage: 'check', name: 'Marked made, but the data does not show it', status: 'found', weight: 850,
      do: `Check it went live: ${t.title}`,
      say: `Someone marked “${t.title}” as made, but your sales data still shows the old way.`,
      todo: `Open ${t.system || 'the system'} and check it was saved and published.`,
      text: `“${t.title}” was marked made, but the data does not show the change.${t.note ? ` ${t.note}` : ''}`,
      how: 'Usually the change was saved but never published, or made at one location and not another. Check it in the system itself, then mark it made again.',
    });
  }
  for (const a of f.unseen) {
    put({
      tags: 'handed assigned follow', id: `unseen:${a.id}`, stage: 'check', name: 'Handed off, not opened yet', status: 'found', weight: 600,
      do: `Check ${a.name} saw what you handed them`,
      say: `${a.name} hasn’t opened what you handed them ${ageWords(a.age || 0)}.`,
      todo: 'Give them a quick call or a text before service.',
      text: `A card handed to ${a.name} ${ageWords(a.age || 0)} has not been opened yet.`,
      how: 'A hand-off is only done when the other person has it. A short message before service closes it.',
    });
  }
  for (const a of f.due) {
    put({
      tags: 'meeting due follow', id: `meeting:${a.id}`, stage: 'check', name: 'Due from the weekly meeting', status: 'found', weight: a.late ? 720 : 700,
      do: `${a.title}${a.owner ? ` (${a.owner})` : ''}`,
      say: `From the meeting: “${a.title}” is ${a.late ? 'overdue' : 'due today'}${a.owner ? `. It’s ${a.owner}’s` : ''}.`,
      todo: a.late ? 'Get it done, or move the date on purpose.' : 'Get it done before close.',
      text: `The weekly meeting agreed “${a.title}”${a.owner ? `, owned by ${a.owner}` : ''}, due ${dateLabel(a.due)}.${a.late ? ' It is past due.' : ''}`,
      how: 'Decisions from the meeting are only worth the ones that get done. Finish it, or defer it with a reason so the next meeting sees why.',
    });
  }
  for (const h of f.held) {
    put({
      tags: 'wait hold data', id: `held:${h.id}`, stage: 'decide', name: `Wait on ${h.feed}: ${h.title.replace(/^Approve:\s*/i, '').replace(/^./, (x) => x.toLowerCase())}`, status: 'found', weight: 900,
      do: `Bring ${h.feed} up to date before deciding`,
      say: `Wait on “${h.title.replace(/^Approve:\s*/i, '')}”. ${h.feed} last updated ${h.last}, so I can’t trust it yet.`,
      todo: `Reconnect ${h.feed}, or check who is on the floor yourself.`,
      text: `“${h.title}” rests on ${h.feed}, which last updated ${h.last}. Acting on it now risks a decision built on yesterday’s schedule.`,
      how: `Reconnect ${h.feed} first. If it can’t be fixed before service, look at who is actually on the floor and decide from that.`,
    });
  }
  if (!f.stuck.length && !f.mismatch.length && !f.unseen.length && !f.due.length) {
    put({ tags: 'approved done made follow', id: 'follow', stage: 'check', name: 'Decisions that got done', status: 'clear', say: 'Every change you approved has been made.', text: `Nothing approved is stuck waiting to be made${f.verified ? `, and ${plural(f.verified, 'change')} ${f.verified === 1 ? 'is' : 'are'} confirmed by the data` : ''}.` });
  }
  return out;
}

/** Floor Captain on Service: covers against the floor for each service today. */
export function serviceChecks(d, ctx = {}) {
  const L = dayLoop(d, ctx);
  const out = [];
  const put = (c) => out.push({ kind: 'play', go: 'service', value: null, unit: '', claim: null, how: '', rule: '', needs: '', weight: 0, ...c });
  const meals = L.plan?.meals || {};
  if (!L.plan || !Object.keys(meals).length) {
    put({ id: 'staffing', stage: 'plan', name: 'Today’s floor against today’s covers', status: 'needs', text: 'There is no hourly history with servers on the floor, so staffing cannot be checked against covers yet.', needs: 'Hourly sales and clock-ins, from your POS and scheduling tool', needsGo: 'inputs' });
    return out;
  }
  // Trust first: while the schedule feed is behind, staffing advice is held back the way Today holds it back.
  const late = (d.feeds || []).find((f) => f.name === '7shifts' && f.state === 'stale');
  const base = put;
  const hold = (c) => (late && c.status === 'found'
    ? base({ ...c, held: true, weight: Math.min(c.weight, 300), do: `Check who is on, then: ${c.do.charAt(0).toLowerCase()}${c.do.slice(1)}`, say: `${c.say} ${late.name} last updated ${late.last}, so check who is actually on first.`, how: `${late.name} last updated ${late.last}, so the usual floor may not be today’s. Check the schedule yourself first. ${c.how}` })
    : base(c));
  for (const [meal, m] of Object.entries(meals)) {
    const put = hold;
    const name = meal === 'lunch' ? 'Lunch' : 'Dinner';
    if (m.short.length) {
      const first = m.short[0];
      put({
        tags: 'staff staffed servers short rush', id: `short-${meal}`, stage: 'plan', name: `${name}: short at the rush`, status: 'found', claim: 'mod', weight: 650 + m.short.length,
        do: `Add a server at ${hourLabel(first.hour)} for ${name.toLowerCase()}`,
        say: `${name} looks short at ${hourLabel(first.hour)}: usually ${first.on} on, and I think you need ${first.need}.`,
        todo: 'Add one server for the rush, or move a break out of it.',
        text: `${name} today: Covercast expects ${m.covers} covers, likely ${m.low} to ${m.high}. ${m.short.map((h) => `${hourLabel(h.hour)} usually has ${h.on} ${h.on === 1 ? 'server' : 'servers'} and needs ${h.need}`).join('; ')}.`,
        how: 'Fix it before service, not during. Add one person for the rush hours only, or move a break out of them. A short floor costs more in slow tables and lost turns than the hour costs.',
      });
    }
    // The send-home is Service's own call (the same plan, the same fences, the same dollars), made at pre-shift instead of at 8 pm.
    const early = m.spare.filter((h) => m.cutFrom == null || h.hour < m.cutFrom);
    const spareHours = m.spare.reduce((a, h) => a + h.extra, 0);
    if (m.cutFrom != null && m.cutFrom <= m.first) {
      put({
        tags: 'staff staffed servers schedule overstaff', id: `spare-${meal}`, stage: 'plan', name: `${name}: one server more than the night needs`, status: 'found', claim: 'mod', weight: 500 + (m.value || m.idleHours),
        do: `Schedule one fewer server for ${name.toLowerCase()} today`,
        say: `${name} is scheduled one server heavy for the ${m.covers} covers I expect, all service long.`,
        todo: 'Take one server off today’s schedule, or offer someone the night off.',
        ...(m.value ? { value: $(m.value), unit: 'potential today, at your wage' } : {}),
        text: `${name} today: Covercast expects ${m.covers} covers, likely ${m.low} to ${m.high}. Every hour of the usual floor has a server more than even the top of the range needs, and your minimum on the floor still holds.`,
        how: 'Make it a schedule change this morning, not a send-home tonight: offer the night off first. Service still checks it live against the covers that come in.',
      });
    } else if (m.cutFrom != null) {
      put({
        tags: 'staff staffed servers send home overstaff', id: `spare-${meal}`, stage: 'plan', name: `${name}: one server too many late`, status: 'found', claim: 'mod', weight: 500 + (m.value || m.idleHours),
        do: `Pick ${name.toLowerCase()}’s first one home now: from ${hourLabel(m.cutFrom)}`,
        say: `${name} has a server more than it needs from ${hourLabel(m.cutFrom)}. Pick who goes home now, at pre-shift, not at the last minute.`,
        todo: `Tell them at pre-shift they leave at ${hourLabel(m.cutFrom)} if covers stay in range.`,
        ...(m.value ? { value: $(m.value), unit: 'potential today, at your wage' } : {}),
        text: `${name} today: Covercast expects ${m.covers} covers, likely ${m.low} to ${m.high}. From ${hourLabel(m.cutFrom)} to close, the usual floor has a server more than even the top of the range needs, and your minimum on the floor still holds.`,
        how: 'Decide it before service and say it at pre-shift, so nobody is surprised. Service confirms it live against the covers that actually come in, so it is never a cut you cannot take back.',
      });
    }
    if (early.length) {
      const ex = early.reduce((a, h) => a + h.extra, 0);
      put({
        tags: 'staff staffed servers start later overstaff', id: `early-${meal}`, stage: 'plan', name: `${name}: more servers than guests before the rush`, status: 'found', claim: 'mod', weight: 450 + ex,
        do: `Start one ${name.toLowerCase()} server later, at ${hourLabel((early.at(-1).hour) + 1)}`,
        say: `${name} usually has more servers than guests at ${early.map((h) => hourLabel(h.hour)).join(' and ')}.`,
        todo: `Start one server at ${hourLabel(early.at(-1).hour + 1)} instead.`,
        text: `${name} today: ${early.map((h) => `${hourLabel(h.hour)} usually has ${h.on} servers and needs ${Math.max(h.need, 1)}`).join('; ')}. That is ${plural(ex, 'server-hour')} before the rush that the covers don’t need.`,
        how: 'Move a start time, not a whole shift: the person still works the rush. It is the cheapest labor fix there is, and it is made on the schedule, not on the floor.',
      });
    }
    if (!m.short.length && !spareHours) {
      put({ tags: 'staff staffed servers rush', id: `fit-${meal}`, stage: 'plan', name: `${name}: floor matches the covers`, status: 'clear', claim: 'mod', say: `${name} is staffed right for the ${m.covers} covers I expect.`, text: `${name} today: Covercast expects ${m.covers} covers, likely ${m.low} to ${m.high}. The usual floor fits every hour. The rush is ${hourLabel(m.peak.hour)}, about ${m.peak.covers} covers needing ${m.peak.need} servers.` });
    }
  }
  // Last night's send-home: was it actually made?
  const cuts = (ctx.tasks || []).filter((t) => (!t.roomId || t.roomId === d.id) && String(t.approvalId || '').startsWith('cut:') && L.night && String(t.approvalId).startsWith(`cut:${L.night.iso}:`));
  for (const t of cuts) {
    put(t.status === 'open' ? {
      tags: 'send home cut last night', id: `cut-${t.id}`, stage: 'check', name: 'Last night’s send-home', status: 'found', weight: 700,
      do: 'Mark whether last night’s send-home happened',
      say: 'Last night’s send-home was approved, but nobody marked it done.', todo: 'Mark it done, or say it didn’t happen.',
      text: `“${t.title}” was approved for ${dateLabel(L.night.iso)} and is still open. Until it is marked, the hours can’t be checked against the clock-ins.`,
      how: 'Mark it done if it happened. If it did not, take it back, so the record shows the hours were worked.',
    } : { tags: 'send home cut last night', id: `cut-${t.id}`, stage: 'check', name: 'Last night’s send-home', status: 'clear', say: 'Last night’s send-home was made.', text: `“${t.title}” was made on ${dateLabel(L.night.iso)}.` });
  }
  return out;
}

/** Data Steward: whether this morning's numbers can be trusted, and what to fix first. */
export function dataChecks(d, ctx = {}) {
  const L = dayLoop(d, ctx);
  const out = [];
  const put = (c) => out.push({ kind: 'play', go: 'inputs', value: null, unit: '', claim: null, how: '', rule: '', needs: '', weight: 0, ...c });
  const feeds = d.feeds || [];
  for (const f of feeds.filter((x) => x.state === 'stale')) {
    put({
      tags: 'stale data date', id: `stale-${String(f.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, stage: 'data', name: `${f.name} is out of date`, status: 'found', weight: 600 + (f.risk || 0), go: f.input ? 'inputs' : 'sources',
      do: f.fix === 'Reconnect' ? `Reconnect ${f.name}` : `Bring ${f.name} up to date`,
      say: `${f.name} last updated ${f.last}. Anything built on it is on hold until it catches up.`,
      todo: f.fix === 'Reconnect' ? `Reconnect ${f.name}.` : f.input ? `Upload the latest ${String(f.name).toLowerCase()}, or type them in.` : `Bring ${f.name} up to date.`,
      text: `${f.name} (${f.what}) last updated ${f.last}.${f.note ? ` ${f.note}` : ''}`,
      how: f.input ? `Upload it on Add & Manage Data. If the connection is down, type it in or drop a file there; every number checks the same way.` : `Reconnect it on Sources. Until then, decisions that rest on it stay on hold.`,
    });
  }
  const s = L.series;
  if (s?.days?.length) {
    const end = s.days.at(-1).iso;
    const from = addDays(end, -(LOOP.dataDays - 1));
    const have = new Set(s.days.map((x) => x.iso));
    const missing = [];
    for (let i = 0; i < LOOP.dataDays; i++) { const iso = addDays(from, i); if (!have.has(iso)) missing.push(iso); }
    put(missing.length ? {
      tags: 'missing gap days', id: 'gaps', stage: 'data', name: 'Missing days in the last four weeks', status: 'found', weight: 450 + missing.length,
      do: `Fill in ${plural(missing.length, 'missing day')}`,
      say: `${plural(missing.length, 'day')} in the last four weeks ${missing.length === 1 ? 'has' : 'have'} no sales on file.`,
      todo: 'Type them in, or mark them closed.',
      text: `No sales are on file for ${missing.slice(0, 5).map(dateLabel).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}.`,
      how: 'A missing day teaches the forecast the wrong thing. If you were open, type the day in on Add & Manage Data; if you were closed, mark it closed so it is left out.',
    } : { tags: 'missing gap days', id: 'gaps', stage: 'data', name: 'Missing days in the last four weeks', status: 'clear', say: 'Every day in the last four weeks is on file.', text: `Every day from ${dateLabel(from)} to ${dateLabel(end)} has sales on file.` });

    // A day far off its weekday's usual is often a typo: an extra zero, or a day keyed twice.
    const recent = s.days.filter((x) => x.iso >= from);
    const odd = [];
    for (const x of recent) {
      const dow = dayOfDate(x.iso);
      const peers = s.days.filter((y) => y.iso < x.iso && dayOfDate(y.iso) === dow).slice(-6).map((y) => y.net).sort((a, b) => a - b);
      if (peers.length < 3 || !(x.net > 0)) continue;
      const mid = peers[Math.floor(peers.length / 2)];
      const ratio = x.net / mid;
      if (ratio >= LOOP.oddFactor || ratio <= 1 / LOOP.oddFactor) odd.push({ iso: x.iso, net: x.net, mid, ratio });
    }
    put(odd.length ? {
      tags: 'typo wrong odd', id: 'odd-days', stage: 'data', name: 'Days that look like a typo', status: 'found', weight: 550,
      do: `Check ${dateLabel(odd[0].iso)}’s sales against the register`,
      say: `${dateLabel(odd[0].iso)} shows ${$(odd[0].net)}. A usual ${LONG[dayOfDate(odd[0].iso)]} is about ${$(odd[0].mid)}. Is that a typo?`,
      todo: 'Check it against the day’s register report.',
      text: odd.map((o) => `${dateLabel(o.iso)} shows ${$(o.net)} in sales, about ${o.ratio >= 1 ? `${o.ratio.toFixed(1)} times` : `a ${Math.round((1 - o.ratio) * 100)}% drop from`} a usual ${LONG[dayOfDate(o.iso)]} (${$(o.mid)})`).join('; ') + '.',
      how: 'Check it against the register’s end-of-day report. If it is wrong, fix it on Add & Manage Data; if it is right, add the reason as an event so the forecast does not learn it as normal.',
    } : { tags: 'typo wrong odd', id: 'odd-days', stage: 'data', name: 'Days that look like a typo', status: 'clear', say: 'No day in the last four weeks looks like a typo.', text: 'Every day in the last four weeks is in a normal range for its weekday.' });
  } else {
    put({ tags: 'missing gap days', id: 'gaps', stage: 'data', name: 'Daily sales on file', status: 'needs', text: 'There are no daily sales on file yet.', needs: 'Daily sales and covers, from your POS or typed in', needsGo: 'inputs' });
  }
  for (const f of feeds.filter((x) => x.state === 'off' && x.note)) {
    put({ id: `off-${String(f.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, stage: 'data', name: `${f.name}`, status: 'needs', go: f.input ? 'inputs' : 'connect', text: f.note, needs: `${f.what}${f.input ? ', uploaded or typed in' : ''}`, needsGo: f.input ? 'inputs' : 'connect' });
  }
  return out;
}
