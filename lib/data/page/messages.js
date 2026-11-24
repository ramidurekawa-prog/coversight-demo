/**
 * What Coversight sends, written from the room's own records: the GM's
 * morning text, the "it worked" note, the chef's prep list and order guide,
 * and the first-week report. The owner's Monday email is portfolio.js
 * weeklySummary(); the room's week in review is week.js weekDigest().
 *
 * Nothing here computes a figure of its own: every number comes from the
 * day loop (lib/ai/loop.js), Covercast, the invoice checks or a Proof
 * packet, and keeps that source's claim. Only a verified Proof is savings.
 *
 * Pure JS: the server, the screens and the tests use it.
 */

import { foodCostChecks } from './purchasing.js';

const money = (x) => `$${Math.round(x).toLocaleString('en-US')}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const hourWord = (h) => `${((h + 11) % 12) + 1}${h < 12 ? ' am' : ' pm'}`;
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || '';
const joinAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** A text message's soft limit: two SMS segments. */
export const TEXT_MAX = 320;

/** The short line for one service's staffing, from the day loop's plan. */
function mealLine(label, m) {
  if (!m) return null;
  if (m.short?.length) {
    const worst = m.short.reduce((a, b) => (b.need - b.on > a.need - a.on ? b : a));
    return `${label} looks short at ${joinAnd(m.short.map((h) => hourWord(h.hour)))}: ${worst.on} on, ${worst.need} needed.`;
  }
  if (m.spare?.length) return `${label} has ${plural(m.spare.reduce((t, h) => t + h.extra, 0), 'spare server-hour')} from ${hourWord(m.spare[0].hour)}.`;
  return `${label} staffing looks right.`;
}

/**
 * The GM's morning text: last night against the call, today's guests, each
 * service's staffing and the one ask worth making before service. Short
 * enough for a text; the app has the rest.
 * @param {any} d a derived room
 * @param {any} L dayLoop(d, ctx)
 */
export function morningText(d, L, { checks = foodCostChecks(d.room), link = 'coversight' } = {}) {
  const lines = [];
  const name = firstName(d.profile?.gm);
  lines.push(`Morning${name ? ` ${name}` : ''}.`);
  const n = L?.night;
  if (n) {
    const vs = n.call ? (n.vs === 'inside' ? `we called ${n.call.low} to ${n.call.high}` : `${n.vs} our ${n.call.low} to ${n.call.high} call`) : null;
    lines.push(`${n.label}: ${n.covers} guests${vs ? `, ${vs}` : ''}.`);
  }
  const p = L?.plan;
  if (p) {
    lines.push(`Today: about ${p.covers} guests (${p.low} to ${p.high}).`);
    const meals = [mealLine('Lunch', p.meals?.lunch), mealLine('Dinner', p.meals?.dinner)].filter(Boolean);
    // Short services first: those are the ones to act on before opening.
    meals.sort((a, b) => Number(/short/.test(b)) - Number(/short/.test(a)));
    lines.push(...meals);
  }
  const ask = checks.find((c) => c.approvalId);
  if (ask) lines.push(`Before service: ask ${ask.vendor} about ${ask.item.toLowerCase()} (${money(ask.cents / 100)} over 28 days).`);
  const tail = `More: ${link}`;
  // Keep it a text: drop from the end (never the greeting) until it fits.
  while (lines.length > 2 && [...lines, tail].join(' ').length > TEXT_MAX) lines.splice(lines.length - (ask ? 2 : 1), 1);
  return { text: [...lines, tail].join(' '), parts: lines.length, sources: { night: !!n, plan: !!p, ask: ask?.id ?? null } };
}

/**
 * The "it worked" note for a verified Proof packet. Only a verified packet
 * gets one: the dollars are its bookable rate, never the point estimate.
 * @param {any} proof a Proof packet (d.proofs[i]) with outcome 'verified'
 */
export function itWorked(proof, { room = '' } = {}) {
  if (proof?.outcome !== 'verified' || !(proof.bookable > 0)) return null;
  return {
    subject: `It worked: ${proof.title}`,
    body: [
      `${proof.title}${room ? ` at ${room}` : ''} is verified.`,
      `It keeps ${money(proof.bookable)} a week, the low end of what we measured (${money(proof.lo)} to ${money(proof.hi)}).`,
      `How we know: ${String(proof.method).replace(/^difference-in-differences vs\.? /i, 'compared with ')}. It has held for ${proof.held}.`,
      proof.persist && proof.persist !== '—' ? `${proof.persist}: we keep checking it every week and tell you if it slips.` : 'We keep checking it every week and tell you if it slips.',
    ].join('\n'),
    cents: Math.round(proof.bookable * 100), claim: 'book',
  };
}

/**
 * The chef's prep list for the next day Covercast calls: its own prep plan,
 * biggest first. Modeled from the guest forecast; the chef has the last word.
 * @param {any} cc covercastRoom()
 */
export function prepList(cc, { max = 12 } = {}) {
  if (!cc?.ready || !cc.prep?.length) return { ready: false, why: cc?.ready ? 'No dish sales by day or week on file to split the guests into dishes.' : (cc?.why ?? 'No forecast yet.'), rows: [] };
  const day = cc.covers.days[0];
  return {
    ready: true, iso: day.iso, guests: day.value, low: day.low, high: day.high, claim: 'mod',
    rows: cc.prep.slice(0, max).map((x) => ({ item: x.item, expect: x.forecast, prep: x.prep, extra: x.prep - x.forecast, sizedBy: x.sizedBy })),
  };
}

/**
 * The order guide: what the next `days` of forecast guests use, from each
 * dish's prep share and its recipe, less what the last count had on hand.
 * Ingredient quantities are in the invoice's unit. Modeled; the last count
 * and recipes are the room's own (or the sample's, said so).
 * @param {any} room
 * @param {Record<string, [string, number][]>} recipes menu key → [[ingredient, qty per dish]]
 * @param {any} cc covercastRoom()
 */
export function orderGuide(room, recipes, cc, { days = 3 } = {}) {
  if (!cc?.ready || !cc.prep?.length) return { ready: false, why: 'Needs a forecast and dish sales first.', rows: [] };
  const window = cc.covers.days.slice(0, days);
  const day0 = window[0]?.value || 0;
  const guests = window.reduce((t, x) => t + (x.value || 0), 0);
  const scale = day0 > 0 ? guests / day0 : 0;
  const keyOf = new Map((room?.menu || []).map((m) => [m.name, m.key]));
  const need = new Map();
  for (const p of cc.prep) for (const [ing, q] of recipes?.[keyOf.get(p.item)] || []) need.set(ing, (need.get(ing) ?? 0) + p.forecast * scale * q);
  const inv = new Map((room?.invoices || []).map((r) => [r.item, r]));
  const onHand = new Map((room?.counts || []).map((c) => [c.item, c.close]));
  const asks = new Map(foodCostChecks(room).filter((c) => c.approvalId).map((c) => [c.item, c]));
  const rows = [...need].map(([item, q]) => {
    const r = inv.get(item);
    const have = onHand.get(item) ?? null;
    const order = Math.max(0, Math.ceil(q - (have ?? 0)));
    return {
      item, unit: r?.unit ?? '', vendor: r?.vendor ?? null, need: Math.round(q * 10) / 10, have, order,
      price: r?.p1 ?? null, cents: r?.p1 != null ? Math.round(order * r.p1 * 100) : null,
      ask: asks.get(item) ? `Ask about the price first: ${asks.get(item).title}.` : null,
    };
  }).filter((x) => x.need > 0).sort((a, b) => (b.cents ?? 0) - (a.cents ?? 0));
  const byVendor = {};
  for (const x of rows.filter((x) => x.order > 0)) (byVendor[x.vendor ?? 'No vendor on file'] ??= []).push(x);
  return {
    ready: true, from: window[0]?.iso, to: window.at(-1)?.iso, days: window.length, guests, claim: 'mod',
    counted: (room?.counts || []).length > 0, own: !!room?.fromToast,
    rows, byVendor, cents: rows.reduce((t, x) => t + (x.cents ?? 0), 0),
  };
}

/**
 * The first-week report: what Coversight found, what it is watching and
 * what it still needs, from the room's own records. It never claims savings:
 * found money is Observed (invoices) or Modeled (staffing), and only a
 * verified Proof is counted.
 * @param {any} d a derived room
 * @param {any} L dayLoop(d, ctx)
 */
export function firstWeek(d, L, { checks = foodCostChecks(d.room) } = {}) {
  const leaks = checks.filter((c) => c.cents);
  const leakCents = leaks.reduce((t, c) => t + c.cents, 0);
  const short = Object.entries(L?.plan?.meals || {}).flatMap(([meal, m]) => (m.short || []).map((h) => ({ meal, ...h })));
  const spare = Object.values(L?.plan?.meals || {}).reduce((t, m) => t + (m.spare || []).reduce((s, h) => s + h.extra, 0), 0);
  const testing = (d.proofs || []).filter((p) => p.outcome === 'testing');
  const verified = (d.proofs || []).filter((p) => p.outcome === 'verified' && p.bookable > 0);
  const rec = L?.record;
  const found = [];
  if (leaks.length) found.push({ key: 'invoices', claim: 'obs', cents: leakCents, text: `${money(leakCents / 100)} paid over earlier prices on ${plural(leaks.length, 'invoice line')} in the last 28 days. Biggest: ${leaks[0].item.toLowerCase()} from ${leaks[0].vendor.replace(/\.$/, '')}.` });
  if (short.length) found.push({ key: 'staffing', claim: 'mod', cents: null, text: `Today's schedule is short ${plural(short.length, 'hour')} against the guests we expect (${joinAnd([...new Set(short.map((h) => h.meal))])}).` });
  else if (spare) found.push({ key: 'staffing', claim: 'mod', cents: null, text: `Today's schedule has ${plural(spare, 'spare server-hour')} against the guests we expect.` });
  if (rec) found.push({ key: 'forecast', claim: 'obs', cents: null, text: `Our guest forecast landed inside its range on ${rec.inside} of the last ${plural(rec.n, 'night')}.` });
  const needs = [...(L?.plan?.missing || []).map((k) => ({ event: 'Local events', weather: 'Weather', reservations: 'Reservations' }[k] || k)), ...(d.staleCount ? [`${plural(d.staleCount, 'feed')} behind`] : [])];
  return {
    room: d.profile?.name ?? '',
    headline: leaks.length ? `Week one: ${money(leakCents / 100)} leaking on invoices, ${plural(found.length, 'thing')} found in all.` : `Week one: ${plural(found.length, 'thing')} found.`,
    found,
    testing: testing.map((p) => ({ title: p.title, closes: p.closes ?? null, claim: 'mod' })),
    verified: verified.map((p) => ({ title: p.title, weekly: p.bookable, claim: 'book' })),
    verifiedWeekly: verified.reduce((t, p) => t + p.bookable, 0),
    needs,
    next: leaks[0] ? `Send the ${leaks[0].vendor} email from Supplier prices.` : short.length ? 'Fix today’s staffing on Service.' : 'Start a first test from Proof.',
  };
}
