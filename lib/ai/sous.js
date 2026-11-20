/**
 * Sous, Coversight's AI teammate. This file is the part of Sous that needs no
 * AI provider: it reads a derived room (deriveRoom) into plain-sentence facts,
 * spots what's unusual against the room's own history, writes the brief and
 * answers questions from those facts only. It is pure and runs the same in the
 * browser, on the server and in tests.
 *
 * When an AI provider is switched on (server/ai/sous.ts), Claude writes the
 * brief and the answers from the same facts, and numbersOk() throws out any
 * text that contains a figure the facts don't. So every number a person reads
 * from Sous was computed by lib/data/model.js, never typed and never guessed.
 */
import { money, tmpl } from '../data/model.js';
import { weekBrief } from '../data/weekbrief.js';
import { DEFAULT_TZ, isActive, localDay, queueView, todayCards } from '../data/page/today.js';
import { cardTrust } from '../data/page/today-brief.js';
import { learnedFact, noteFacts, noteWords } from './learn.js';
import { lineCheckFacts } from './playbook.js';

export const SOUS = {
  name: 'Sous',
  tagline: 'Your AI teammate',
  promise: 'Sous reads every number in your restaurant, tells you what changed and what to do next, and answers from your own records.',
};

/** Which parts of the business a floor manager's Sous talks about: tonight, stock and data. No P&L. */
const FLOOR_TOPICS = new Set(['today', 'service', 'stock', 'data', 'kitchen', 'help']);
/** Viewer roles Sous knows. An admin reads like an owner. */
export const sousRole = (role) => (role === 'gm' || role === 'floor' || role === 'accountant' ? role : 'owner');

const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const $ = (n) => money(Math.round(n));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const CLAIM_WORD = { est: 'estimated', mod: 'modeled', cau: 'measured in a test', book: 'verified', obs: 'observed' };

/** How many prior weeks a number is compared with, and how far out counts as unusual. */
export const NOTICE = { weeks: 8, sigma: 2 };

/* ------------------------------------------------------------------ noticed */

const WEEK_METRICS = [
  { k: 'net', label: 'Net sales', f: $, up: 'good', go: 'trends' },
  { k: 'covers', label: 'Covers', f: (x) => Math.round(x).toLocaleString('en-US'), up: 'good', go: 'trends' },
  { k: 'foodRate', label: 'Food cost', f: (x) => `${pct(x)} of sales`, up: 'warn', go: 'purchasing' },
  { k: 'labourRate', label: 'Labor cost', f: (x) => `${pct(x)} of sales`, up: 'warn', go: 'labour' },
  { k: 'check', label: 'Average spend per cover', f: (x) => money(x, { cents: true }), up: 'good', go: 'trends' },
  { k: 'excPct', label: 'Comps, voids and discounts', f: (x) => `${x.toFixed(1)}% of sales`, up: 'warn', go: 'controls' },
];

/**
 * What stands out in a room: weekly numbers outside the room's own normal
 * range, a register pattern past its control limit, stock used past tolerance,
 * a supplier price jump, and data that has gone stale. Every item is computed
 * from the room's data; an empty list means nothing stood out.
 * @param {any} d a derived room
 * @returns {{ id: string, topic: string, tone: 'warn'|'good'|'info', icon: string, title: string, text: string, claim: string, go: string, weight: number }[]}
 */
export function sousNoticed(d) {
  const out = [];
  const rows = (d.hist?.rows || []).filter((r) => Number.isFinite(r.net));
  const cur = rows[rows.length - 1];
  const prior = rows.slice(-(NOTICE.weeks + 1), -1);
  if (cur && prior.length >= 4) {
    for (const m of WEEK_METRICS) {
      const xs = prior.map((r) => r[m.k]).filter(Number.isFinite);
      if (xs.length < 4 || !Number.isFinite(cur[m.k])) continue;
      const mu = mean(xs);
      const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1));
      if (!(sd > 0)) continue;
      const z = (cur[m.k] - mu) / sd;
      if (Math.abs(z) < NOTICE.sigma) continue;
      const high = z > 0;
      const tone = (high ? m.up : m.up === 'good' ? 'warn' : 'good');
      out.push({
        id: `week:${m.k}`, topic: 'noticed', tone, icon: high ? 'TrendingUp' : 'TrendingDown', claim: 'obs', go: m.go, weight: Math.abs(z) * 100,
        title: `${m.label} ran ${high ? 'high' : 'low'} last week`,
        text: `${m.label} was ${m.f(cur[m.k])} in the week of ${cur.label}. Over the ${xs.length} weeks before, it usually sat between ${m.f(mu - sd)} and ${m.f(mu + sd)}.`,
      });
    }
  }
  for (const [k, word] of [['postVoid', 'voids after payment'], ['comps', 'comps'], ['disc', 'discounts']]) {
    const t = d.staff?.types?.[k];
    for (const s of t?.signals || []) {
      out.push({
        id: `register:${k}:${out.length}`, topic: 'comps', tone: 'warn', icon: 'ShieldCheck', claim: 'obs', go: 'controls', weight: 150 + (t.excess || 0) / 10,
        title: `One ${String(s.role || 'person').toLowerCase()}'s ${word} are above the normal range`,
        text: `One ${String(s.role || 'person').toLowerCase()}'s ${word} ran ${pct(s[`${k}Rate`])} of their sales. For their volume, anything up to ${pct(s[`${k}Ucl`])} is normal. It is a pattern to look into, not proof of anything.`,
      });
    }
  }
  const flagged = d.usage?.flagged || [];
  if (flagged.length) {
    const top = [...flagged].sort((a, b) => b.dollars - a.dollars)[0];
    out.push({
      id: 'stock:usage', topic: 'stock', tone: 'warn', icon: 'Package', claim: 'est', go: 'inventory', weight: 120 + top.dollars / 10,
      title: `${top.label} is being used faster than the recipes explain`,
      text: `${plural(flagged.length, 'item')} used more than recipes and sales explain. The biggest is ${top.label.toLowerCase()}: ${pct(top.pct)} over, about ${$(top.dollars)} since the last count (estimated). A spot count tells waste from portioning.`,
    });
  }
  const jump = [...(d.inv?.invoices || [])].filter((i) => i.pct >= 10 && i.priceLeg > 0).sort((a, b) => b.priceLeg - a.priceLeg)[0];
  if (jump) {
    out.push({
      id: 'vendor:price', topic: 'purchasing', tone: 'warn', icon: 'Truck', claim: 'obs', go: 'purchasing', weight: 110 + jump.priceLeg / 10,
      title: `${jump.vendor} raised ${jump.item.toLowerCase()} by ${Math.round(jump.pct)}%`,
      text: `${jump.vendor} raised ${jump.item.toLowerCase()} from ${money(jump.p0, { cents: true })} to ${money(jump.p1, { cents: true })} a ${jump.unit}, up ${Math.round(jump.pct)}%. At what you buy, that price change alone costs ${$(jump.priceLeg)} over the invoice period.`,
    });
  }
  const stale = (d.feeds || []).filter((f) => f.state === 'stale');
  if (stale.length) {
    const worst = [...stale].sort((a, b) => (b.risk || 0) - (a.risk || 0))[0];
    out.push({
      id: 'data:stale', topic: 'data', tone: 'warn', icon: 'Cable', claim: 'obs', go: 'sources', weight: 100 + (worst.risk || 0) / 10,
      title: `${stale.map((f) => f.name).join(' and ')} ${stale.length === 1 ? 'is' : 'are'} out of date`,
      text: `${stale.map((f) => `${f.name} was last updated ${f.last}`).join('; ')}.${worst.note ? ` ${worst.note}` : ''}`,
    });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/* ------------------------------------------------------------------ today */

/**
 * The card Sous leads with: the first one still open on Today, by the Today
 * page's own rules, so Sous never sends someone to a decision already made.
 * @param {any} d a derived room
 * @param {{ stored?: any, dismissed?: any, windows?: any[], tasks?: any[], now?: number }} [ctx] the room's saved queue and findings decisions, its tests and tasks
 * @returns {{ card: any | null, open: any[], view: any, today: string }}
 */
export function sousToday(d, { stored = null, dismissed = {}, windows = [], tasks = [], now = Date.now() } = {}) {
  const tz = d.room?.tz || DEFAULT_TZ;
  const today = localDay(now, tz);
  const testing = windows.filter((w) => w.roomId === d.id && (w.status === 'running' || w.status === 'waiting')).map((w) => w.lever);
  const cards = todayCards(d, { today, testing, dismissed: dismissed || {}, tasks: tasks.filter((t) => t.roomId === d.id) });
  const view = queueView(stored, { today, own: !!d.room?.fromToast, now, tz, cards });
  const open = cards.filter((c) => isActive(c, view));
  return { card: open[0] || null, open, view, today };
}

/* ------------------------------------------------------------------ links */

/**
 * One ingredient seen from several pages at once: its supplier's price, how
 * fast it is being used, the dish it goes into and what the plan says to do.
 * This is what no single page shows. Each figure keeps its own claim: they
 * are never added together, because an observed cost and an estimate are not
 * the same kind of money.
 * @returns {{ id: string, topic: 'link', also: string[], label: string, go: string, text: string }[]}
 */
export function sousLinks(d) {
  const name = d.profile?.short || d.profile?.name || 'this room';
  const fill = (s) => tmpl(String(s ?? ''), d.tokens || {});
  const out = [];
  const jumps = (d.inv?.invoices || []).filter((i) => i.pct >= 10 && i.priceLeg > 0);
  const items = new Set([...jumps.map((i) => i.item), ...(d.usage?.flagged || []).map((f) => f.item)]);
  for (const item of items) {
    const inv = jumps.find((i) => i.item === item);
    const use = (d.usage?.flagged || []).find((f) => f.item === item);
    // The dish is the one the count's own note names ("142 grilled salmon a week").
    const dish = (d.menu?.menu || []).find((m) => (use?.why || '').toLowerCase().includes(m.name.toLowerCase()));
    const plan = dish && (d.plan?.sorted || []).find((c) => c.kind === 'price' && c.item === dish.key);
    const parts = [], also = [];
    if (inv) { parts.push(`${inv.vendor} raised its price ${Math.round(inv.pct)}%, which added ${$(inv.priceLeg)} over the invoice period (observed)`); also.push('purchasing'); }
    if (use) { parts.push(`it is being used ${pct(use.pct)} faster than recipes and sales explain, about ${$(use.dollars)} since the last count (estimated)`); also.push('stock'); }
    if (dish) { parts.push(`it goes into ${dish.name}, which sold ${dish.units} last week at ${$(dish.price)}`); also.push('menu'); }
    if (parts.length < 2) continue;
    if (plan) also.push('plan');
    out.push({
      weight: parts.length * 1e6 + (inv?.priceLeg || 0) + (use?.dollars || 0),
      id: `link:${item.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, topic: 'link', also, label: 'Across pages', go: inv ? 'purchasing' : 'inventory',
      short: `${item} connects ${[inv && 'Purchasing', use && 'Inventory', dish && 'Menu'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1')}: one ingredient, ${parts.length === 2 ? 'two' : 'three'} places it is costing you.`,
      text: `${item} shows up in ${parts.length === 2 ? 'two' : 'three'} places at ${name}: ${parts.join('; ')}.${plan ? ` The plan's answer on the menu side: ${fill(plan.title).charAt(0).toLowerCase()}${fill(plan.title).slice(1)}.` : ''} Each figure has its own certainty, so they are not added together.`,
    });
  }
  // The two strongest connections: more would be a list, not an insight.
  return out.sort((a, b) => b.weight - a.weight).slice(0, 2).map(({ weight, ...l }) => l);
}

/* ------------------------------------------------------------------ facts */

/**
 * Everything Sous knows about a room, as plain sentences. Each fact carries
 * the screen it comes from and how sure its dollars are.
 * @param {any} d a derived room
 * @param {{ role?: string, windows?: any[], card?: any, open?: any[], noticed?: any[], group?: any, notes?: any[], learned?: any, day?: any }} [ctx] `day` is the day loop's context (lib/ai/loop.js); `notes` is the room's notebook and `learned` is sousLearned(); `card` and `open` come from sousToday() (the Today page's own pick); `windows` are live test windows; `group` is deriveGroup() for people who see every room
 * @returns {{ id: string, topic: string, text: string, claim?: string, go?: string, label: string }[]}
 */
export function sousFacts(d, ctx = {}) {
  const role = sousRole(ctx.role);
  const name = d.profile?.short || d.profile?.name || 'This room';
  const fill = (s) => tmpl(String(s ?? ''), d.tokens || {});
  const facts = [];
  const add = (id, topic, label, go, text, claim) => facts.push({ id, topic, label, go, text: text.replace(/\s+/g, ' ').trim(), ...(claim ? { claim } : {}) });

  const wb = weekBrief(d.hist?.rows || []);
  if (wb) {
    const wk = wb.week;
    add('kept', 'week', 'This week', 'week', `${name} kept ${$(wk.earned)} after food and labor in the week of ${wk.label}.`, 'obs');
    add('week', 'week', 'This week', 'week', `${name} took ${$(wk.net)} in net sales in the week of ${wk.label} from ${wk.covers.toLocaleString('en-US')} covers, and kept ${$(wk.earned)} after food and labor.`, 'obs');
    const dir = (n) => (n >= 0 ? 'more' : 'less');
    add('week-change', 'week', 'This week', 'week', `That is ${$(Math.abs(wb.vsLast.earned))} ${dir(wb.vsLast.earned)} kept than the week before, and ${$(Math.abs(wb.vsAvg4.earned))} ${dir(wb.vsAvg4.earned)} than the average of the four weeks before. The biggest reason against the week before was ${wb.driver.label.toLowerCase()}, which ${wb.driver.amount >= 0 ? 'added' : 'took away'} ${$(Math.abs(wb.driver.amount))}.`, 'obs');
    const row = (d.hist?.rows || []).find((r) => r.label === wk.label);
    if (row?.labour > 0) add('labor-cost', 'labor', 'Labor', 'labour', `Hourly labor at ${name} was ${$(row.labour)} in the week of ${wk.label}, ${pct(wk.labourRate)} of sales.`, 'obs');
    add('rates', 'costs', 'Trends', 'trends', `Food cost was ${pct(wk.foodRate)} of sales and labor was ${pct(wk.labourRate)} of sales in the week of ${wk.label}.`, 'obs');
  } else if (d.week) {
    add('week', 'week', 'This week', 'week', `${name} took ${$(d.week.net)} in net sales last week from ${d.week.covers.toLocaleString('en-US')} covers, and kept ${$(d.week.earned)} after food and labor.`, 'obs');
  }

  const live = d.banked?.live || [];
  if (d.banked?.week > 0) {
    add('saved', 'saved', 'Proof', 'proof', `${name} has ${plural(live.length, 'verified change')} saving ${$(d.banked.week)} a week, counted at the low end of what was measured: ${live.map((p) => p.title).join('; ')}. Verified savings to date are ${$(d.banked.toDate)}.`, 'book');
  } else {
    add('saved', 'saved', 'Proof', 'proof', `Nothing at ${name} is verified yet, so nothing is counted as saved. Findings stay estimates until a 28-day test measures them.`);
  }
  const testing = (d.proofs || []).filter((p) => p.outcome === 'testing');
  if (testing.length) add('tests', 'tests', 'Proof', 'proof', `${plural(testing.length, 'change')} ${testing.length === 1 ? 'is' : 'are'} being tested now: ${testing.map((p) => p.title).join('; ')}. Nothing from a test counts as saved until it finishes.`);
  const wins = (ctx.windows || []).filter((w) => w.roomId === d.id);
  if (wins.length) {
    const open = wins.filter((w) => w.status === 'running' || w.status === 'waiting');
    add('windows', 'tests', 'Test windows', 'windows', `${plural(wins.length, 'test')} started here, ${open.length} still open: ${wins.slice(0, 6).map((w) => `${w.title} (${w.status === 'waiting' ? 'waiting for the next week of data' : w.status})`).join('; ')}.`);
  }
  const reversed = d.banked?.reversed || [];
  if (reversed.length) add('reversed', 'saved', 'Proof', 'proof', `${plural(reversed.length, 'saving')} ${reversed.length === 1 ? 'was' : 'were'} reversed after a guardrail slipped: ${reversed.map((p) => p.title).join('; ')}. Reversed savings are removed from the total.`);

  const chosen = (d.plan?.sorted || []).filter((c) => d.plan.chosen?.has?.(c.id));
  if (chosen.length) {
    add('plan', 'plan', 'The plan', 'plan', `This week's plan at ${name}, best return on a manager's hour first: ${chosen.map((c) => `${c.title} (about ${$(c.value)} a week, ${CLAIM_WORD[c.claim] || 'estimated'}${c.needs ? `, waiting on ${c.needs}` : ''})`).join('; ')}. These are potential, not saved, until tested.`, chosen[0].claim);
    add('top', 'plan', 'The plan', 'plan', `The best next move at ${name} is: ${chosen[0].title}. It is worth about ${$(chosen[0].value)} a week (${CLAIM_WORD[chosen[0].claim] || 'estimated'}; likely between ${$(chosen[0].lo)} and ${$(chosen[0].hi)}). ${chosen[0].why || ''}`, chosen[0].claim);
  }

  const queue = ctx.open || d.queue || [];
  const card = ctx.card === undefined ? queue[0] : ctx.card;
  if (queue.length) add('today', 'today', 'Today', 'today', `${plural(queue.length, 'thing')} on Today at ${name}: ${queue.map((c) => fill(c.title)).join('; ')}.`);
  else if (ctx.open) add('today', 'today', 'Today', 'today', `Nothing is waiting on you on Today at ${name} right now.`);
  // Advice resting on a feed that is behind is held back, the way Today holds it back.
  const late = card ? cardTrust(card, d, null).delayed : null;
  if (card) add('today-first', 'today', 'Today', 'today', `${late ? `First on Today, check before you act: ${fill(card.title)}. ${late.name} was last updated ${late.last}, so confirm who is on first.` : `First on Today: ${fill(card.title)}.`} ${fill(card.body)}${card.value && card.claim && card.claim !== 'none' ? ` Worth ${fill(card.value)} (${CLAIM_WORD[card.claim] || 'estimated'}).` : ''}`, card.claim && card.claim !== 'none' ? card.claim : undefined);

  const feeds = d.feeds || [];
  const stale = feeds.filter((f) => f.state === 'stale');
  if (feeds.length) add('data', 'data', 'Sources', 'sources', stale.length
    ? `${plural(stale.length, 'data source')} at ${name} ${stale.length === 1 ? 'is' : 'are'} out of date: ${stale.map((f) => `${f.name} (last updated ${f.last})`).join('; ')}. ${stale.map((f) => f.note).filter(Boolean).join(' ')}`
    : `Every connected data source at ${name} is up to date.`);
  const off = feeds.filter((f) => f.state === 'off');
  if (off.length) add('data-off', 'data', 'Sources', 'sources', `Not connected yet: ${off.map((f) => `${f.name}${f.note ? ` (${f.note})` : ''}`).join('; ')}`);

  if (d.chan?.deliverySales > 0) add('delivery', 'delivery', 'Delivery & channels', 'channels', `Delivery was ${$(d.chan.deliverySales)} last week, ${pct(d.chan.deliveryShare)} of sales, with ${$(d.chan.deliveryRefunds)} refunded. ${(d.chan.delivery || []).map((c) => `${c.name} leaves about ${$(c.per100)} of every $100 after food, fees and packaging`).join('; ')}; dine-in leaves about ${$(d.chan.channels?.[0]?.per100 ?? 0)}.`, 'obs');

  if (d.staff?.weekTotal > 0) add('comps', 'comps', 'Controls', 'controls', `Comps, voids and discounts ran ${$(d.staff.weekTotal)} a week at ${name}. ${d.staff.signalCount ? `${plural(d.staff.signalCount, 'pattern')} sat above the normal range for that person's volume.` : 'Nobody is outside the normal range for their volume.'}`, 'obs');

  const flagged = d.usage?.flagged || [];
  if (flagged.length) add('stock', 'stock', 'Inventory & waste', 'inventory', `${plural(flagged.length, 'item')} at ${name} used more than recipes and sales explain: ${flagged.map((f) => `${f.label} (${pct(f.pct)} over, about ${$(f.dollars)})`).join('; ')}. Together that runs about ${$(d.usage.week)} a week (estimated). A spot count separates waste from portioning.`, 'est');

  const inv = d.inv;
  if (inv?.byVendor?.length && inv.priceLeg > 0) add('purchasing', 'purchasing', 'Purchasing', 'purchasing', `Supplier price changes added ${$(inv.priceLeg)} to ${name}'s invoices this period. Most of it: ${inv.byVendor.filter((v) => v.leg > 0).slice(0, 3).map((v) => `${v.vendor} ${$(v.leg)}`).join('; ')}.`, 'obs');

  const menu = d.menu?.menu || [];
  if (menu.length) {
    const byProfit = [...menu].sort((a, b) => b.cm * b.units - a.cm * a.units);
    add('menu', 'menu', 'Menu', 'menu', `${name}'s menu earns ${money(d.menu.cmWeighted, { cents: true })} a dish after food cost, on average. The biggest earners last week: ${byProfit.slice(0, 3).map((m) => `${m.name} (${m.units} sold at ${$(m.price)}, ${money(m.cm, { cents: true })} each after food cost)`).join('; ')}.`, 'obs');
  }
  const t = d.room?.tickets;
  if (t?.bottleneck) add('kitchen', 'kitchen', 'Kitchen', 'kitchen', `${t.manager || `The ${t.bottleneck} station is the bottleneck.`} ${t.fix ? `What would help: ${t.fix}` : ''}`, 'obs');
  if (d.room?.labour?.note) add('labor', 'labor', 'Labor', 'labour', d.room.labour.note, 'obs');
  if (d.room?.throughput?.fullNote) add('seats', 'seats', 'Throughput', 'throughput', d.room.throughput.fullNote, 'obs');

  // The rest of the group, for people who run all of it: this is what lets one page's agent compare rooms.
  const others = role === 'gm' || role === 'floor' ? [] : (ctx.group?.rows || []).filter((r) => r.id !== d.id);
  if (others.length) {
    const all = ctx.group.rows;
    add('group', 'group', 'All rooms', 'portfolio', `Across the group's ${all.length} rooms last week: ${all.map((r) => `${r.name} kept ${$(r.earned)} on ${$(r.net)} of sales${r.banked > 0 ? `, with ${$(r.banked)} a week verified saved` : ''}`).join('; ')}. Verified savings across the group are ${$(ctx.group.banked)} a week.`, 'obs');
    const needy = [...all].sort((a, b) => (b.alarms + b.stale) - (a.alarms + a.stale))[0];
    if (needy && needy.alarms + needy.stale > 0) add('group-needs', 'group', 'All rooms', 'portfolio', `The room that needs the most attention is ${needy.name}: ${needy.note}${needy.stale ? `, and ${plural(needy.stale, 'data source')} there ${needy.stale === 1 ? 'is' : 'are'} out of date` : ''}.`);
  }

  for (const l of sousLinks(d)) facts.push(l);

  const noticed = ctx.noticed || sousNoticed(d);
  noticed.forEach((n) => add(`noticed:${n.id}`, n.topic === 'noticed' ? 'noticed' : n.topic, 'Sous noticed', n.go, n.text, n.claim));
  if (!noticed.length) add('noticed:none', 'noticed', 'Sous noticed', 'trends', `Nothing unusual at ${name} last week: sales, covers, food cost and labor all sat inside their normal range.`);

  // The spoken version of each record: one or two short sentences the way a person would say it across the pass,
  // and the one thing to do. This is what an answer shows first; the full record waits behind "Show why".
  const more = (n) => (n >= 0 ? 'more' : 'less');
  const chans = d.chan?.delivery || [];
  const worstChan = [...chans].sort((x, y) => x.per100 - y.per100)[0];
  const best = [...menu].sort((x, y) => y.cm * y.units - x.cm * x.units)[0];
  const SAY = {
    week: wb && [`You kept ${$(wb.week.earned)} last week, after food and labor.`],
    'week-change': wb && [`You kept ${$(Math.abs(wb.vsLast.earned))} ${more(wb.vsLast.earned)} than the week before. The main reason was ${wb.driver.label.toLowerCase()}.`],
    'labor-cost': wb && [`Labor took ${pct(wb.week.labourRate)} of your sales last week.`, 'Open Labor to see where the hours went.'],
    rates: wb && [`Food took ${pct(wb.week.foodRate)} of sales last week. Labor took ${pct(wb.week.labourRate)}.`],
    saved: d.banked?.week > 0 ? [`You are saving ${$(d.banked.week)} a week. That is proven, not a guess.`] : ['Nothing is proven yet, so I count nothing as saved.', 'Start one test. A test is how a saving gets proven.'],
    tests: [`${plural(testing.length, 'change')} ${testing.length === 1 ? 'is' : 'are'} being tested right now. I will tell you when ${testing.length === 1 ? 'it finishes' : 'they finish'}.`],
    top: chosen[0] && [`Your best next move is worth about ${$(chosen[0].value)} a week. It is not saved until we test it.`, `${chosen[0].title}.`],
    plan: chosen[0] && [`You have ${plural(chosen.length, 'move')} on this week's plan. The first is the best use of an hour.`, `${chosen[0].title}.`],
    today: [queue.length ? `${plural(queue.length, 'thing')} ${queue.length === 1 ? 'needs' : 'need'} you today.` : 'Nothing needs you today.'],
    'today-first': card && [late ? `Check who is working before you do this. ${late.name} is out of date.` : 'Do this first today.', `${fill(card.title).replace(/^Approve:\s*/i, '').replace(/^./, (c) => c.toUpperCase())}.`],
    data: [stale.length ? `${stale.map((f) => f.name).join(' and ')} ${stale.length === 1 ? 'is' : 'are'} out of date. I can't fully trust numbers that depend on ${stale.length === 1 ? 'it' : 'them'}.` : 'All your data is up to date.', stale.length ? 'Open Sources and reconnect.' : ''],
    'data-off': [`${plural(off.length, 'data source')} ${off.length === 1 ? 'is' : 'are'} not connected yet.`, 'Connect one, or type the numbers in by hand.'],
    delivery: worstChan && [`${worstChan.name} leaves you about ${$(worstChan.per100)} of every $100. Dine-in leaves about ${$(d.chan.channels?.[0]?.per100 ?? 0)}.`],
    comps: d.staff && [d.staff.signalCount ? `Comps, voids and discounts ran ${$(d.staff.weekTotal)} a week. ${plural(d.staff.signalCount, 'pattern')} ${d.staff.signalCount === 1 ? 'looks' : 'look'} unusual.` : `Comps, voids and discounts ran ${$(d.staff.weekTotal)} a week. Nothing looks unusual.`, d.staff.signalCount ? 'Look at the pattern before you talk to anyone.' : ''],
    stock: flagged.length && [`${plural(flagged.length, 'item')} ${flagged.length === 1 ? 'is' : 'are'} being used up too fast. That is about ${$(d.usage.week)} a week, estimated.`, 'Count them this week.'],
    purchasing: inv?.priceLeg > 0 && [`Suppliers raised prices. It added ${$(inv.priceLeg)} to your invoices.`, 'Ask for the old price back. I can draft the email.'],
    menu: best && [`Your biggest earner is ${best.name}.`],
    kitchen: t?.bottleneck && [`${t.bottleneck} is what slows your kitchen down.`, t.fix || ''],
    'noticed:none': ['Nothing unusual last week. Everything was in its normal range.'],
  };
  for (const f of facts) {
    const sp = SAY[f.id] || (f.id.startsWith('noticed:') ? [`${noticed.find((n) => `noticed:${n.id}` === f.id)?.title || firstSentence(f.text).replace(/\.$/, '')}.`] : null);
    if (sp?.[0]) { f.say = sp[0]; if (sp[1]) f.todo = sp[1]; }
  }

  // What the room has taught Sous: its notebook, and which kinds of change have worked here.
  for (const n of noteFacts(ctx.notes)) facts.push(n);
  const taught = ctx.learned ? learnedFact(d, ctx.learned) : null;
  if (taught) facts.push(taught);

  // What each specialist's line check found, could not check yet, and the rules it works to.
  for (const c of lineCheckFacts(d, ctx.day || {})) facts.push(c);

  return role === 'floor' ? facts.filter((f) => FLOOR_TOPICS.has(f.topic) || f.topic === 'notes') : facts;
}

/* ------------------------------------------------------------------ brief */

/**
 * The brief Sous opens with: one headline, up to three short lines, and the
 * one thing to do. Ordered for the person reading it.
 * @param {any} d a derived room
 * @param {{ role?: string, facts?: any[], noticed?: any[], card?: any, open?: any[], windows?: any[] }} [ctx]
 */
export function sousBrief(d, ctx = {}) {
  const role = sousRole(ctx.role);
  const noticed = (ctx.noticed || sousNoticed(d)).filter((n) => role !== 'floor' || FLOOR_TOPICS.has(n.topic));
  const facts = ctx.facts || sousFacts(d, { ...ctx, noticed });
  const by = Object.fromEntries(facts.map((f) => [f.id, f]));
  const name = d.profile?.short || 'This room';
  const line = (f, icon, label) => (f ? { id: f.id, icon, label, text: f.text, claim: f.claim || null, go: f.go } : null);
  const top = noticed[0] && by[`noticed:${noticed[0].id}`];
  const pool = {
    week: line(by['week-change'] || by.week, 'CalendarRange', 'What changed'),
    saved: line(by.saved, 'BadgeCheck', 'Verified so far'),
    plan: line(by.top, 'Route', 'Biggest opportunity'),
    noticed: top ? line(top, noticed[0].icon, 'Sous noticed') : line(by['noticed:none'], 'Sparkles', 'Sous noticed'),
    data: by.data && /out of date/.test(by.data.text) ? line(by.data, 'Cable', 'Needs updating') : null,
    today: line(by.today, 'ListChecks', 'On Today'),
    tests: line(by.tests || by.windows, 'Timer', 'In test'),
  };
  const order = { owner: ['week', 'noticed', 'plan', 'saved'], gm: ['today', 'noticed', 'week', 'data'], floor: ['today', 'noticed', 'data'], accountant: ['saved', 'tests', 'data', 'week'] }[role];
  const lines = order.map((k) => pool[k]).filter(Boolean).slice(0, 3);
  const wk = by.week;
  const openCount = (ctx.open || d.queue || []).length;
  const headline = role === 'floor' || !wk
    ? (by['today-first'] ? `${plural(openCount, 'thing')} to handle at ${name} today.` : `Nothing is waiting on you at ${name} today.`)
    : role === 'accountant' ? (by.saved?.text.split(':')[0] ?? wk.text).replace(/, counted.*$/, '.') : (by.kept || wk).text;
  const card = ctx.card === undefined ? (d.queue || [])[0] : ctx.card;
  const fill = (s) => tmpl(String(s ?? ''), d.tokens || {});
  const late = card ? cardTrust(card, d, null).delayed : null;
  const action = card && role !== 'accountant'
    ? {
      title: late ? fill(card.title).replace(/^Approve:\s*/i, 'Check first: ') : fill(card.title),
      why: late ? `${late.name} was last updated ${late.last}. Confirm who is on before acting on this.` : fill(card.body),
      value: card.claim && card.claim !== 'none' ? fill(card.value) : null, claim: card.claim && card.claim !== 'none' ? card.claim : null, go: 'today', cta: 'Open it on Today',
    }
    : by.saved ? { title: 'Check what is verified and what is still in test', why: by.tests?.text || by.saved.text, value: null, claim: null, go: 'proof', cta: 'Open Proof' } : null;
  return { room: name, role, headline, lines, action, noticed: noticed.map(({ weight, ...n }) => n) };
}

/** Questions worth asking, picked from what this room's facts can answer. */
export function sousSuggest(facts, role = 'owner') {
  const has = (t) => facts.some((f) => f.topic === t);
  const all = [
    ['week', 'How did last week go?'], ['plan', 'What should we do first?'], ['saved', 'What have we actually saved?'],
    ['today', 'What needs me today?'], ['costs', 'Why is food cost where it is?'], ['delivery', 'Is delivery worth it?'],
    ['stock', 'Where are we losing product?'], ['data', 'Is my data up to date?'], ['kitchen', 'What is slowing the kitchen down?'],
  ];
  const first = { owner: ['week', 'plan', 'saved', 'delivery'], gm: ['today', 'week', 'stock', 'plan'], floor: ['today', 'stock', 'kitchen', 'data'], accountant: ['saved', 'data', 'week', 'costs'] }[sousRole(role)];
  const ranked = [...all].sort((a, b) => (first.indexOf(a[0]) + 1 || 99) - (first.indexOf(b[0]) + 1 || 99));
  return ranked.filter(([t]) => has(t)).slice(0, 4).map(([, q]) => q);
}

/* ------------------------------------------------------------------ answers */

const TOPIC_WORDS = {
  week: ['week', 'sales', 'revenue', 'kept', 'profit', 'margin', 'go\\b', 'going', 'doing', 'perform', 'covers', 'busy', 'slow', 'changed', 'down\\b', 'up\\b', 'earn'],
  costs: ['food cost', 'labor cost', 'labour', 'cost', 'prime', 'percent', 'rate'],
  saved: ['saved', 'saving', 'verified', 'bank', 'proof', 'proven', 'paid', 'roi', 'return', 'works', 'worked', 'learn', 'taught'],
  tests: ['test', 'tested', 'window', 'measur', 'trial', 'stuck', 'waiting'],
  plan: ['plan', 'decide', 'first', 'next', 'priorit', 'should', 'opportunit', 'recommend', 'biggest', 'best', 'focus', 'improve', 'price', 'raise'],
  today: ['today', 'tonight', 'tomorrow', 'now', 'needs me', 'to do', 'decide', 'approve', 'urgent', 'last night', 'yesterday', 'happened', 'before we open', 'never got done', 'got done', 'follow', 'forecast'],
  service: ['tonight', 'floor', 'servers?\\b', 'staffed', 'staffing', 'send.?home', 'rush', 'lunch', 'dinner', 'short\\b', 'covers', 'busy'],
  data: ['data', 'typo', 'missing', 'gap', 'measuring', 'fresh', 'stale', 'sync', 'toast', 'upload', 'up to date', 'connected', '7shifts', 'source', 'trust'],
  delivery: ['deliver', 'doordash', 'uber', 'channel', 'takeout', 'online'],
  comps: ['comp', 'void', 'discount', 'normal', 'theft', 'register', 'server'],
  stock: ['stock', 'inventory', 'waste', 'usage', 'count', 'losing', 'shrink', 'portion', 'product'],
  purchasing: ['vendor', 'supplier', 'invoice', 'purchas', 'buy', 'price increase', 'food cost'],
  menu: ['menu', 'dish', 'dishes', 'earn', 'item', 'seller', 'sell', 'margin', 'price'],
  kitchen: ['kitchen', 'ticket', 'slow', 'bottleneck', 'station', 'grill', 'wait'],
  labor: ['labor', 'labour', 'staff', 'schedul', 'server', 'hours', 'overtime', 'shift', 'roster', 'break', 'wage', 'law', 'rule', 'legal', 'complian', 'tip', 'payroll', 'overstaff', 'short\\b'],
  group: ['room', 'rooms', 'group', 'location', 'compare', 'other', 'which'],
  seats: ['seat', 'turn', 'table', 'full', 'capacity', 'throughput'],
  noticed: ['unusual', 'notice', 'anomal', 'wrong', 'strange', 'odd', 'alert', 'watch', 'worry', 'concern', 'problem', 'issue'],
};

/** The facts that bear on a question, best first. Empty when none do. */
export function sousRelevant(question, facts, max = 3, focus = null) {
  const q = String(question || '').toLowerCase();
  // "What should I do here?" on a page means that page's area.
  if (focus && /\b(here|this (page|screen)|looking at|on this)\b/.test(q)) {
    const mine = facts.filter((f) => (focus.includes(f.topic) || f.also?.some((t) => focus.includes(t))) && f.id !== 'kept').sort((a, b) => (focus.indexOf(a.topic) + 99) % 99 - (focus.indexOf(b.topic) + 99) % 99);
    if (mine.length) return mine.slice(0, max);
  }
  const qWords = new Set(noteWords(q));
  const score = (f) => {
    let s = 0;
    // Something the person told Sous answers a question that shares a real word with it, or one about what Sous knows.
    if (f.topic === 'notes') return noteWords(f.text).filter((w) => qWords.has(w)).length * 2 + (/\b(told you|remember|notebook|know about (us|me)|what do you know)\b/.test(q) ? 3 : 0);
    for (const w of TOPIC_WORDS[f.topic] || []) if (new RegExp(`\\b${w}`, 'i').test(q)) s += 2;
    // A link between areas answers "why" questions about any of them.
    if (f.also && /\b(why|connect|related|link|cause|because|behind|explain|whole picture)\b/.test(q) && f.also.some((t) => (TOPIC_WORDS[t] || []).some((w) => new RegExp(`\\b${w}`, 'i').test(q)))) s += 10;
    // A noticed fact about another area also answers a question about that area.
    if (f.id.startsWith('noticed:') && f.topic !== 'noticed') for (const w of TOPIC_WORDS.noticed) if (new RegExp(`\\b${w}`, 'i').test(q)) s += 2;
    // Words shared with the record itself only break ties: on their own they prove nothing ("Saturday").
    // A page's agent leans toward its own area when a question could go either way.
    if (s > 0 && (focus?.includes(f.topic) || f.also?.some((t) => focus?.includes(t)))) s += 1;
    // A specialist's check has to be about the question itself, not only its area, to come before the area's own record.
    if (s > 0 && f.id.startsWith('check:')) {
      s += Math.min(6, String(f.tags || '').split(' ').filter((w) => w && q.includes(w)).length * 2);
      // "Which rules should I watch?" is answered by the rules themselves.
      if (f.kind === 'law' && /\b(rules?|laws?|legal|complian\w*|regulat\w*)\b/.test(q)) s += 5;
    }
    if (s > 0 && f.id.startsWith('check:')) s += Math.min(4.5, new Set((f.text.toLowerCase().match(/[a-z]{5,}/g) || []).filter((w) => q.includes(w))).size * 1.5) - 1;
    else if (s > 0) s += Math.min(1.5, (f.text.toLowerCase().match(/[a-z]{5,}/g) || []).filter((w) => q.includes(w)).length * 0.5);
    return s;
  };
  // 'kept' is the headline's short form of 'week'; the plan and its top item say the same thing at two lengths.
  const wantsOne = /\b(first|next|best|biggest|top|should)\b/i.test(q);
  const pool = facts.filter((f) => f.id !== 'kept' && f.id !== (wantsOne ? 'plan' : 'top'));
  return pool.map((f) => ({ f, s: score(f) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.f);
}

/** Screens the answer drew on, one per screen. */
export function sousCites(used) {
  const seen = new Set();
  return used.filter((f) => f.go && !seen.has(f.go) && seen.add(f.go)).map((f) => ({ label: f.label, go: f.go }));
}

/** The first sentence of a record. */
export const firstSentence = (text) => `${String(text).split(/(?<=[a-z)%\d])\.\s+(?=[A-Z])/)[0].replace(/\.$/, '')}.`;

/**
 * Answer a question from the facts alone. When no fact bears on it, say so
 * and offer what Sous can answer, instead of guessing.
 * @returns {{ text: string, used: string[], cites: { label: string, go: string }[], claim: string | null, grounded: boolean, suggest: string[] }}
 */
export function sousAnswer(question, facts, { room = 'this restaurant', role = 'owner', focus = null } = {}) {
  const used = sousRelevant(question, facts, 3, focus);
  if (!used.length) {
    return { text: `I don't have that in ${room}'s records yet, and I won't guess. Here is what I can answer from your data right now.`, used: [], cites: [], claim: null, grounded: false, suggest: sousSuggest(facts, role) };
  }
  // The answer is the first sentence of the best record; the rest waits behind "Show why".
  // What the person reads first is the spoken version; then the one thing to do.
  const short = used[0].say || used[0].short || firstSentence(used[0].text);
  return { text: used.map((f) => f.text).join('\n\n'), short, todo: used[0].todo || null, used: used.map((f) => f.id), cites: sousCites(used), claim: used.find((f) => f.claim)?.claim ?? null, grounded: true, suggest: [] };
}

/* ------------------------------------------------------------------ the guard */

const numbersIn = (s) => (String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/,/g, '').replace(/\.0+$/, ''));

/**
 * True when every figure in `text` appears in `corpus` (the facts) or in the
 * question itself. AI-written text that fails this is thrown away: Sous never
 * shows a number the model computed or made up.
 */
export function numbersOk(text, corpus, question = '') {
  const known = new Set([...numbersIn(corpus), ...numbersIn(question)]);
  return numbersIn(text).every((n) => known.has(n));
}

/** The facts as the numbered record sheet the AI answers from. */
export function sousSheet(facts) {
  return facts.map((f) => `[${f.id}] (${f.label}${f.claim ? `; ${CLAIM_WORD[f.claim]}` : ''}) ${f.text}`).join('\n');
}

/** A short stable fingerprint of the facts, so a written brief is reused until the data changes. */
export function sousHash(facts) {
  let h = 2166136261;
  for (const ch of sousSheet(facts)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
