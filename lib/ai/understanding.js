/**
 * What Coversight understands about a restaurant, level by level: the
 * industry rules it works to, the group, this location, the people who run
 * it and the team on the floor. Every line says what it was learned from and
 * how much there is behind it; every level also says what it does not know
 * yet and what would teach it.
 *
 * This is what the consultants, Sous and the AI engine read (as facts), so a
 * better understanding makes every answer and every call better. "What would
 * make it smarter" ranks the missing data by how many checks it would unlock:
 * the platform asks for the input that improves the output most.
 *
 * Pure. Every line is computed from the derived room, its group, the
 * casebook and the room's saved decisions. Nothing is typed in; a level with
 * nothing behind it says so instead of guessing.
 */
import { money } from '../data/model.js';
import { LINE_CHECK_PAGES, lineCheck, rulesFor } from './playbook.js';

const $ = (n) => money(Math.round(n));
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const LEVELS_OF_UNDERSTANDING = [
  { id: 'industry', name: 'The industry', icon: 'Landmark', what: 'The rules and the playbook a good consultant brings to any restaurant.' },
  { id: 'group', name: 'Your group', icon: 'Building2', what: 'What holds across your rooms, and what each one teaches the others.' },
  { id: 'location', name: 'This location', icon: 'Store', what: 'How this room sells, spends and runs, week by week.' },
  { id: 'management', name: 'Your managers', icon: 'UserCheck', what: 'Who decides, what they carry out and what they set aside.' },
  { id: 'team', name: 'Your team', icon: 'Users', what: 'Who is on the floor and in the kitchen, and how each one works.' },
];

/** One known line: the sentence, where it came from, how many observations stand behind it and how sure it is. */
const know = (text, source, n, claim) => ({ text, source, ...(Number.isFinite(n) ? { n } : {}), ...(claim ? { claim } : {}) });

/**
 * @param {any} d a derived room
 * @param {{ group?: any, book?: any, tasks?: any[], notes?: any[], mem?: Record<string, any>, day?: any }} [ctx]
 *   `group` deriveGroup(); `book` casebook(); `tasks` the room's approvals; `notes` its notebook; `mem` its saved 'sous' decisions
 */
export function understand(d, ctx = {}) {
  const name = d.profile?.short || d.profile?.name || 'This room';
  const rows = d.hist?.rows || [];
  const last = rows.at(-1);
  const checks = LINE_CHECK_PAGES.flatMap((p) => lineCheck(p, d, ctx.day || {})?.checks || []);
  const levels = Object.fromEntries(LEVELS_OF_UNDERSTANDING.map((L) => [L.id, { ...L, known: [], gaps: [] }]));

  /* ---- the industry: rules tables and the consultants' playbook */
  const rules = rulesFor(d.profile || {});
  const I = levels.industry;
  if (rules?.known) I.known.push(know(`Wage rules for ${rules.city && rules.city !== rules.name ? `${rules.city}, ${rules.name}` : rules.name}: overtime after ${rules.weekly} hours a week${rules.daily ? ` or ${rules.daily} a day` : ''}${rules.tipCredit ? '' : ', no tip credit'}. A summary to confirm with payroll.`, 'Wage rule tables', null));
  else I.gaps.push({ need: `Wage rules for ${d.profile?.state || 'this state'}`, unlocks: ['Overtime, breaks and pay rules'], fix: 'Not in our rule tables yet, so no rule is stated for it.' });
  I.known.push(know(`${plural(checks.length, 'check')} a consultant would run, across ${plural(LINE_CHECK_PAGES.length, 'area')}, run on this room every time it is read.`, 'The consultants’ playbook', checks.length));
  const book = ctx.book;
  I.gaps.push({ need: 'Results from restaurants like yours', unlocks: ['Benchmarks you can trust', 'Which changes work for rooms like this one'], fix: book ? `Needs ${book.network.need.locations} comparable restaurants from ${book.network.need.groups} groups. ${book.network.locations} so far.` : 'Needs comparable restaurants from several groups.' });

  /* ---- the group */
  const G = levels.group;
  const grows = ctx.group?.rows || [];
  if (grows.length > 1) {
    const best = [...grows].sort((a, b) => b.earned / (b.net || 1) - a.earned / (a.net || 1))[0];
    G.known.push(know(`${plural(grows.length, 'room')}. ${best.name} keeps the most of each sales dollar after food and labor: ${pct(best.earned / best.net)} last week.`, 'Every room’s week', grows.length, 'obs'));
    if (ctx.group.banked > 0) G.known.push(know(`${$(ctx.group.banked)} a week verified saved across the group.`, 'Proof', null, 'book'));
  } else G.gaps.push({ need: 'A second location', unlocks: ['Comparing rooms', 'Learning that carries from one room to another'], fix: 'Only one room so far.' });
  if (book?.record?.calls) {
    const r = book.record;
    G.known.push(know(`${plural(r.calls, 'change')} tested across the group: ${r.held} held up, ${r.reversed} broke a guardrail. Each one taught the consultant for its area.`, 'The casebook', r.calls));
    const strong = book.consultants.filter((k) => k.record.held > 0).map((k) => k.area);
    if (strong.length) G.known.push(know(`Changes that have held up here: ${strong.join(', ')}.`, 'The casebook', null));
  }

  /* ---- this location */
  const L = levels.location;
  if (rows.length) {
    const day = (r) => new Date(Date.parse(`${r.iso}T00:00:00Z`)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    L.known.push(know(`${plural(rows.length, 'week')} of sales on file, from the week of ${day(rows[0])} to the week of ${day(last)}.`, 'Sales history', rows.length, 'obs'));
    L.known.push(know(`About ${last.covers.toLocaleString('en-US')} covers and ${$(last.net)} in sales a week, at ${$(last.check)} a cover.`, 'Last week', null, 'obs'));
    const prior = rows.slice(-9, -1);
    if (prior.length >= 4) {
      const avg = prior.reduce((s, r) => s + r.prime, 0) / prior.length;
      L.known.push(know(`Food and labor took ${pct(last.prime)} of sales last week, against ${pct(avg)} over the ${prior.length} weeks before.`, 'Sales history', prior.length + 1, 'obs'));
    }
    const best = [...rows].sort((a, b) => b.earned - a.earned)[0];
    L.known.push(know(`Its best week kept ${$(best.earned)}, the week of ${best.label}.`, 'Sales history', rows.length, 'obs'));
  } else L.gaps.push({ need: 'Sales history', unlocks: ['Every weekly figure'], fix: 'Connect Toast or drop in a sales export.' });
  const dishes = d.menu?.menu || [];
  if (dishes.length) {
    const top = [...dishes].sort((a, b) => (b.price - b.cost) * b.units - (a.price - a.cost) * a.units)[0];
    L.known.push(know(`${plural(dishes.length, 'dish', 'dishes')} on the menu. ${top.name} earns the most after food cost.`, 'Menu and recipes', dishes.length, 'obs'));
  }
  const vendors = new Set((d.inv?.invoices || []).map((i) => i.vendor));
  if (vendors.size) L.known.push(know(`${plural(vendors.size, 'supplier')} on the invoices.`, 'Invoices', vendors.size, 'obs'));

  /* ---- the managers */
  const M = levels.management;
  if (d.profile?.gm) M.known.push(know(`${d.profile.gm} runs ${name} day to day.`, 'Your team settings', null));
  const here = (book?.cases || []).filter((c) => c.room === d.id && c.owner);
  const owners = [...new Set(here.map((c) => c.owner))];
  for (const o of owners) {
    const mine = here.filter((c) => c.owner === o);
    const held = mine.filter((c) => c.outcome === 'verified' || c.outcome === 'limited').length;
    M.known.push(know(`${o} has led ${plural(mine.length, 'test')} here${held ? `, ${held} held up` : ''}.`, 'The casebook', mine.length));
  }
  const tasks = (ctx.tasks || []).filter((t) => !t.roomId || t.roomId === d.id);
  if (tasks.length) {
    const done = tasks.filter((t) => ['done', 'verified'].includes(t.status)).length;
    const open = tasks.filter((t) => t.status === 'open').length;
    M.known.push(know(`${plural(tasks.length, 'approved change')}: ${done} made, ${open} still open.`, 'Approvals', tasks.length));
  } else M.gaps.push({ need: 'Approvals made in Coversight', unlocks: ['Whether decisions get carried out', 'Who follows through'], fix: 'Approve a change on Today; it is tracked from there.' });
  const notes = Array.isArray(ctx.notes) ? ctx.notes : [];
  if (notes.length) M.known.push(know(`You have told me ${plural(notes.length, 'thing')} to remember about how ${name} runs.`, 'Your notebook', notes.length));
  const aside = Object.values(ctx.mem || {}).filter((r) => r?.how === 'dismissed').length;
  if (aside) M.known.push(know(`You set aside ${plural(aside, 'suggestion')}. Those kinds come later now.`, 'What you set aside', aside));

  /* ---- the team */
  const T = levels.team;
  const people = d.staff?.people || [];
  if (people.length) {
    const roles = Object.entries(people.reduce((m, p) => ({ ...m, [p.role]: (m[p.role] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
    T.known.push(know(`${plural(people.length, 'person', 'people')} on the register: ${roles.map(([r, n]) => `${n} ${r.toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')}.`, 'Toast', people.length, 'obs'));
    const hours = people.reduce((s, p) => s + (p.hours > 0 ? p.hours : 0), 0);
    if (hours > 0) T.known.push(know(`${Math.round(hours).toLocaleString('en-US')} hours worked last week.`, 'Time clock', null, 'obs'));
    const flagged = people.filter((p) => p.postVoidSignal || p.compsSignal || p.discSignal).length;
    T.known.push(know(flagged ? `${plural(flagged, 'person')} with a register pattern above their normal range. A pattern, not proof.` : 'Nobody’s comps, voids or discounts are outside their normal range.', 'Register', people.length, 'obs'));
  } else T.gaps.push({ need: 'Who works here', unlocks: ['Staff page', 'Overtime and break checks'], fix: 'Connect Toast or 7shifts, or add the team on Data.' });

  /* ---- what would make it smarter: the missing data, ranked by what it unlocks */
  const needs = new Map();
  for (const c of checks.filter((x) => x.status === 'needs' && x.needs)) {
    const k = c.needs.trim();
    const e = needs.get(k) || { need: k, unlocks: [], pages: new Set() };
    e.unlocks.push(c.name); e.pages.add(c.page);
    needs.set(k, e);
  }
  const stale = (d.feeds || []).filter((f) => f.state === 'stale').map((f) => ({ need: `${f.name}, brought up to date`, unlocks: [f.note ? f.note.split(/(?<=\.)\s/)[0] : `Everything that reads ${f.name}`], pages: [], fix: f.fix || 'Reconnect', stale: true, risk: f.risk || 0 }));
  const smarter = [...stale.sort((a, b) => b.risk - a.risk), ...[...needs.values()].map((e) => ({ need: e.need, unlocks: e.unlocks, pages: [...e.pages] })).sort((a, b) => b.unlocks.length - a.unlocks.length)];
  for (const s of smarter) {
    const level = s.pages.some((p) => p === 'labour' || p === 'staff') ? 'team' : 'location';
    if (!levels[level].gaps.some((g) => g.need === s.need)) levels[level].gaps.push({ need: s.need, unlocks: s.unlocks, fix: s.fix || '' });
  }

  const list = LEVELS_OF_UNDERSTANDING.map((L) => levels[L.id]);
  return { room: name, levels: list, known: list.reduce((s, l) => s + l.known.length, 0), gaps: list.reduce((s, l) => s + l.gaps.length, 0), smarter };
}

/** The map as records Sous and the AI engine answer from: one per level, plus what would make it smarter. */
export function understandingFacts(u) {
  const out = u.levels.filter((l) => l.known.length).map((l) => ({
    id: `know:${l.id}`, topic: 'know', label: `What I know: ${l.name.toLowerCase()}`, go: 'consultants',
    text: `What Coversight knows about ${l.name.toLowerCase()}: ${l.known.map((k) => k.text).join(' ')}${l.gaps.length ? ` Not known yet: ${l.gaps.map((g) => g.need.toLowerCase()).join('; ')}.` : ''}`.replace(/\s+/g, ' ').trim(),
    say: l.known[0].text,
    ...(l.gaps[0] ? { todo: `To learn more: ${l.gaps[0].need.charAt(0).toLowerCase()}${l.gaps[0].need.slice(1)}.` } : {}),
  }));
  const top = u.smarter.slice(0, 3);
  if (top.length) out.push({
    id: 'know:smarter', topic: 'know', label: 'What would make me smarter', go: 'consultants',
    text: `What would teach Coversight the most about ${u.room}, in order: ${top.map((s) => `${s.need} (unlocks ${s.unlocks.length === 1 ? s.unlocks[0].charAt(0).toLowerCase() + s.unlocks[0].slice(1).replace(/\.$/, '') : `${s.unlocks.length} checks`})`).join('; ')}.`,
    say: `The one thing that would teach me most: ${top[0].need.charAt(0).toLowerCase()}${top[0].need.slice(1)}.`,
    todo: top[0].fix ? `${top[0].fix.replace(/\.$/, '')}.` : '',
  });
  return out;
}
