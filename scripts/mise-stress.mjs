// Mise stress test: generates thousands of varied restaurant datasets from the
// sample (different states and cities, staff, feeds, test histories, outcomes,
// estimates, autonomy, notes) and checks Mise's invariants on every one.
// Also simulates consultants with a known true accuracy to check the learning
// converges. Usage: node scripts/mise-stress.mjs [datasets=3000] [seed=1] [out.json]
import { writeFileSync } from 'node:fs';
import { CONSULTANTS, MIN_RATE_N, BREACH_DAYS, LEVELS, adjustEstimate, casebook, casebookFacts, earnedLevel, endingOf, recordOf } from '../lib/ai/casebook.js';
import { decisionLoop, levelFor, miseLine, testReads, withMise } from '../lib/ai/mise.js';
import { roomMoves } from '../lib/ai/room-moves.js';
import { numbersOk, sousAnswer, sousFacts, sousSheet } from '../lib/ai/sous.js';
import { understand, understandingFacts } from '../lib/ai/understanding.js';
import { deriveGroup, deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';

const N = Number(process.argv[2] || 3000);
const SEED_N = Number(process.argv[3] || 1);
const OUT = process.argv[4] || null;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PLACES = [['CA', 'Oakland'], ['CA', 'Berkeley'], ['CA', 'Walnut Creek'], ['CA', 'San Francisco'], ['CA', 'Los Angeles'], ['NY', 'New York'], ['TX', 'Austin'], ['WA', 'Seattle'], ['IL', 'Chicago'], ['FL', 'Miami'], ['OR', 'Portland'], ['CO', 'Denver'], ['ZZ', 'Nowhere'], ['', '']];
const LEVERS = ['Labour', 'Menu', 'Purchasing', 'Inventory', 'Controls', 'Throughput', 'Kitchen', 'Channels', 'Mystery'];
const OUTCOMES = ['verified', 'limited', 'testing', 'data', 'directional', 'inconclusive', 'reversed'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TODAY = SEED.now.iso;
const dayLabel = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const daysAgo = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/** One varied dataset, and the context a page would hand Mise. */
function generate(i) {
  const r = rng(SEED_N * 1_000_003 + i);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const ds = structuredClone(SEED);
  const ids = Object.keys(ds.rooms);
  const roomId = pick(ids);
  for (const id of ids) {
    const room = ds.rooms[id];
    const [state, city] = pick(PLACES);
    room.profile = { ...room.profile, state, city };
    if (r() < 0.2) delete room.profile.gm;
    // Staff: anywhere from none to everyone, roles shuffled.
    const keep = r();
    room.staff = (room.staff || []).filter(() => r() < keep).map((p) => ({ ...p, role: r() < 0.2 ? pick(['Server', 'Bartender', 'Host', 'Busser', 'Cook']) : p.role }));
    // Feeds: each fresh or stale, some removed.
    for (const k of Object.keys(room.feeds || {})) {
      const u = r();
      if (u < 0.15) delete room.feeds[k];
      else if (u < 0.55) room.feeds[k] = ['fresh', 'an hour ago', room.feeds[k][2], ''];
    }
    // Sales: scaled, and sometimes only a few weeks on file.
    const scale = 0.2 + r() * 4;
    // (The figures model needs the full year the sample is shaped on; a short history is checked separately.)
    room.history = room.history.map((w) => ({ ...w, net: w.net * scale, covers: Math.round(w.covers * scale), food: w.food * scale, labour: w.labour * scale, earned: w.earned * scale }));
    room.autonomy = Object.fromEntries(['Labour', 'Menu', 'Purchasing', 'Controls', 'Throughput'].map((k) => [k, [Math.floor(r() * 5), Math.floor(r() * 5)]]));
  }
  // A test history: none, the sample's, or a fresh one of up to 40 tests.
  const u = r();
  if (u < 0.1) ds.proof = [];
  else if (u > 0.3) {
    const n = Math.floor(r() * 40);
    ds.proof = Array.from({ length: n }, (_, j) => {
      const outcome = pick(OUTCOMES);
      const est = r() < 0.1 ? (r() < 0.5 ? null : 0) : Math.round(20 + r() * 900);
      const truth = 0.3 + r() * 1.6;
      const point = est ? Math.round(est * truth * (0.8 + r() * 0.4)) - (r() < 0.1 ? Math.round(r() * 300) : 0) : Math.round(r() * 300);
      const startAgo = 10 + Math.floor(r() * 300);
      const endAgo = Math.floor(r() * startAgo);
      const lo = Math.round(point - r() * 300); const hi = Math.round(point + r() * 300);
      const p = { id: `g${i}-${j}`, loc: pick(ids), lever: pick(LEVERS), title: `Change ${j} ${pick(['Tuesday', 'brunch', 'close', 'pours', 'pars', 'comps'])}`, est, outcome, bookable: 0, point, since: dayLabel(daysAgo(startAgo)), owner: pick(['Maria Reyes', 'Marcus Rivera', 'Priya Shah', '']), method: 'Matched control services' };
      if (outcome === 'verified' || outcome === 'limited') Object.assign(p, { bookable: Math.max(0, lo), lo, hi, held: `${Math.floor(endAgo / 7)} weeks` });
      if (outcome === 'reversed') Object.assign(p, { held: `Reversed ${dayLabel(daysAgo(endAgo))}`, reason: 'Table turns breached the guardrail.', removed: Math.round(r() * 600) });
      if (outcome === 'directional' || outcome === 'inconclusive') Object.assign(p, { held: `Closed ${dayLabel(daysAgo(endAgo))}`, reason: r() < 0.5 ? 'The interval crosses zero. No claim.' : '' });
      if (outcome === 'testing') Object.assign(p, { lo, hi, held: 'Window closes soon', checkpoint: r() < 0.5 ? 'Checkpoint 1 of 2 passed' : '', progress: r() < 0.8 ? Math.floor(r() * 100) : undefined });
      if (outcome === 'data') Object.assign(p, { point: null, held: 'Quarantined', reason: r() < 0.7 ? 'Recipe costs are 18 days old. More.' : '' });
      return p;
    });
  }
  const saved = { autonomy: r() < 0.5 ? Object.fromEntries(CONSULTANTS.map((k) => [k.lever, Math.floor(r() * 6) - 1])) : undefined };
  const tasks = Array.from({ length: Math.floor(r() * 6) }, (_, j) => ({ id: `t${j}`, roomId: pick(ids), status: pick(['done', 'open', 'approved']) }));
  const notes = r() < 0.4 ? [{ id: 'n1', text: pick(['We close Mondays', 'Never email suppliers', 'Brunch is our busiest service']) }] : [];
  const mem = r() < 0.3 ? { x: { how: 'dismissed' }, y: { how: 'handled' } } : {};
  return { ds, roomId, saved, tasks, notes, mem, full: r() < 0.1 };
}

const BAD = /undefined|NaN|\bnull\b|\[object|Infinity/;
const BRAG = /better than (a |any )?(human|person|consultant)|beats? (a |any )?(human|person|rules)/i;
const failures = new Map();
let checks = 0;
const fail = (rule, i, detail) => { const f = failures.get(rule) || { n: 0, examples: [] }; f.n++; if (f.examples.length < 3) f.examples.push({ dataset: i, detail: String(detail).slice(0, 300) }); failures.set(rule, f); };
const check = (rule, ok, i, detail) => { checks++; if (!ok) fail(rule, i, detail); };
const texts = (x, out = []) => { if (typeof x === 'string') out.push(x); else if (Array.isArray(x)) x.forEach((y) => texts(y, out)); else if (x && typeof x === 'object') Object.values(x).forEach((y) => texts(y, out)); return out; };

function run(i) {
  const g = generate(i);
  let d, group;
  try { d = deriveRoom(g.ds, g.roomId); group = deriveGroup(g.ds); } catch (e) { fail('dataset rejected by the model (not Mise)', i, e.message); return 'skipped'; }
  const rooms = Object.fromEntries(group.rows.map((x) => [x.id, x.name]));
  const go = () => {
    const book = casebook(d, { rooms, today: TODAY, levels: g.saved.autonomy });
    const moves = roomMoves(d, g.saved, { tasks: g.tasks, now: Date.parse('2026-10-28T03:00:00Z') });
    const u = understand(d, { group, book, tasks: g.tasks, notes: g.notes, mem: g.mem });
    const loop = decisionLoop(d, book, moves);
    const minded = withMise(d, moves, book);
    const reads = testReads(d, book);
    const facts = [...understandingFacts(u), ...casebookFacts(book, d.profile?.short || g.roomId)];
    return { book, moves, u, loop, minded, reads, facts };
  };
  let m;
  try { m = go(); } catch (e) { fail('Mise threw', i, e.stack?.split('\n').slice(0, 3).join(' | ')); return 'crash'; }
  const { book, u, loop, minded, reads, facts } = m;

  // 1. Determinism: the same data gives the same Mise.
  check('same data, same answer', JSON.stringify(go().loop) === JSON.stringify(loop) && JSON.stringify(go().u) === JSON.stringify(u), i, 'loop or understanding differed between runs');
  // 2. Clean words: nothing a person reads says undefined, NaN, null or [object.
  for (const t of texts([u.levels, u.smarter, loop, facts.map((f) => [f.say, f.todo, f.text]), minded.map((x) => x.mise)])) check('no broken words', !BAD.test(t), i, t);
  // 3. Grounded: every fact's spoken line passes the same figure check the AI must pass.
  const sheet = sousSheet(facts);
  for (const f of facts) check('every figure in its records', numbersOk(`${f.say || ''} ${f.todo || ''}`, sheet), i, `${f.id}: ${f.say} ${f.todo || ''}`);
  // 4. Honest: never claims to beat a person or rules.
  for (const t of texts([facts, loop, u])) check('never claims to beat a person', !BRAG.test(t), i, t);
  // 5. Five levels, in order, each known thing with a source.
  check('five levels', u.levels.map((l) => l.id).join() === 'industry,group,location,management,team', i, u.levels.map((l) => l.id).join());
  for (const l of u.levels) for (const k of l.known) check('every known thing has a source', !!k.source, i, `${l.id}: ${k.text}`);
  check('count matches', u.known === u.levels.reduce((s, l) => s + l.known.length, 0), i, u.known);
  // 6. Wage rules only for places with a table.
  const place = `${d.profile?.city}, ${d.profile?.state}`;
  const ind = u.levels[0].known.map((k) => k.text).join(' ');
  if (!['CA', 'NY', 'WA', 'IL', 'OR', 'CO', 'TX', 'FL'].includes(d.profile?.state)) check('no wage rule without a table', !/overtime after|minimum wage is/i.test(ind), i, `${place}: ${ind}`);
  // 7. The casebook adds up.
  for (const k of book.consultants) {
    const r = k.record;
    check('record adds up', r.held + r.reversed <= r.reads && r.reads <= r.results && r.results + r.open <= r.calls + r.open && [r.calls, r.open, r.results, r.reads, r.held, r.reversed].every((x) => Number.isInteger(x) && x >= 0), i, `${k.name}: ${JSON.stringify(r)}`);
    check('no rate before enough results', r.reads >= MIN_RATE_N || r.heldRate == null, i, `${k.name}: ${r.reads} reads, rate ${r.heldRate}`);
    check('level within the ladder', k.earned.level >= 0 && k.earned.level < LEVELS.length && k.working >= 0 && k.working <= k.earned.level, i, `${k.name}: earned ${k.earned.level}, working ${k.working}`);
    const breach = k.cases.find((c) => c.room === d.id && c.outcome === 'reversed' && c.ended && daysBetween(c.ended, TODAY) < BREACH_DAYS);
    if (breach) check('a recent breach drops it to Recommends', k.earned.level <= 1, i, `${k.name}: level ${k.earned.level} after ${breach.ended}`);
    const ok = recordOf(k.cases);
    check('record is reproducible', JSON.stringify(ok) === JSON.stringify(r), i, k.name);
  }
  // 8. Before: at most six, one per area, each with steps and a person at the end.
  check('at most six decisions, one per area', loop.before.length <= 6 && new Set(loop.before.map((b) => b.topic)).size === loop.before.length, i, loop.before.map((b) => b.topic).join());
  for (const b of loop.before) {
    check('every decision says how', b.how.length >= 1, i, b.what);
    check('a person decides', /you|You|task/.test(b.level.does), i, b.level.does);
    const k = book.consultants.find((x) => x.topic === b.topic);
    check('works at the granted level', b.level.n === (k ? k.working : 1), i, `${b.what}: ${b.level.n} vs ${k?.working}`);
    check('only a lever change is measured as a saving', !!k === !!b.measure, i, b.what);
    if (b.aim?.text?.startsWith('My estimates in ')) check('a corrected estimate needs enough history', (k?.record.aim.n || 0) >= MIN_RATE_N, i, b.aim.text);
  }
  // 9. During and after read the room's own tests, and read them right.
  for (const c of loop.during) {
    check('during is this room only', c.room === d.id && endingOf(c.outcome).open, i, c.id);
    if (Number.isFinite(c.lo) && Number.isFinite(c.hi) && c.outcome !== 'data') check('during tone matches the interval', (c.lo > 0) === (c.read.tone === 'good') && (c.hi < 0) === (c.read.tone === 'bad'), i, `${c.lo}..${c.hi} ${c.read.tone}`);
  }
  for (const c of loop.after) {
    check('after is this room only', c.room === d.id && endingOf(c.outcome).result, i, c.id);
    const m2 = c.read.text.match(/\((\d+)% of the estimate\)/);
    if (m2) check('after percentage is right', Number(m2[1]) === Math.round((c.point / c.est) * 100), i, c.read.text);
  }
  // 10. Mise on every move, and its one line comes from its brief.
  check('every move carries Mise', minded.length === m.moves.length && minded.every((x) => x.mise && x.mise.how.length), i, minded.length);
  for (const x of minded) { const l = miseLine(x.mise); if (l) check('the line is from the brief', l.text === (x.mise.risks[0] || x.mise.aim?.text), i, l.text); }
  check('test reads are this room only', Object.keys(reads).every((id) => book.cases.find((c) => c.id === id)?.room === d.id), i, Object.keys(reads).join());
  // 11. On some datasets, the whole of Sous: Mise's knowledge reaches the answer.
  if (g.full) {
    try {
      const all = sousFacts(d, { role: 'owner', group, notes: g.notes });
      const a = sousAnswer('What would make you smarter?', all);
      check('Sous answers from Mise', a.used.includes('know:smarter'), i, a.used.join());
    } catch (e) { fail('Sous threw', i, e.message); }
  }
  return 'ok';
}

/** Learning: consultants with a known true accuracy, given more and more results. */
function learning() {
  const r = rng(SEED_N * 7919);
  const out = { rawError: 0, correctedError: 0, consultants: 0, converged: 0, corrected: 0, worse: 0, monotonic: 0, breachDrops: 0, notMonotonic: [], examples: [] };
  for (let i = 0; i < 1000; i++) {
    const truth = 0.4 + r() * 1.2; // what really happens, as a share of the estimate
    const cases = [];
    let lastLevel = -1; let mono = true;
    for (let n = 1; n <= 20; n++) {
      const est = Math.round(50 + r() * 500);
      const point = Math.round(est * truth * (0.85 + r() * 0.3));
      cases.push({ id: `c${n}`, room: 'oakland', lever: 'Labour', title: 'x', outcome: 'verified', est, point, lo: point * 0.8, hi: point * 1.2, bookable: point * 0.8, heldWeeks: n, since: daysAgo(200 - n), ended: daysAgo(150 - n), paused: false });
      const lvl = earnedLevel(cases, 'oakland', TODAY).level;
      if (lvl < lastLevel) mono = false;
      lastLevel = lvl;
    }
    out.consultants++;
    if (mono) out.monotonic++; else if (out.notMonotonic.length < 3) out.notMonotonic.push(truth);
    const rec = recordOf(cases);
    if (Math.abs(rec.aim.ratio - truth) <= 0.1) out.converged++;
    const est = 400;
    const adj = adjustEstimate(est, rec.aim);
    const before = Math.abs(est - est * truth); const after = adj ? Math.abs(adj.value - est * truth) : before;
    out.rawError += before / (est * truth) / 1000; out.correctedError += after / (est * truth) / 1000;
    if (after <= before + 1e-6) out.corrected++; else out.worse++;
    if (out.examples.length < 3) out.examples.push({ truth: +truth.toFixed(2), learned: +rec.aim.ratio.toFixed(2), raw: est, corrected: adj?.value, real: Math.round(est * truth) });
    // A breach in the room drops it, whatever the record.
    const withBreach = [...cases, { id: 'b', room: 'oakland', lever: 'Labour', title: 'b', outcome: 'reversed', est: 100, point: 50, heldWeeks: 0, since: daysAgo(40), ended: daysAgo(10) }];
    if (earnedLevel(withBreach, 'oakland', TODAY).level <= 1) out.breachDrops++;
  }
  out.rawError = +(out.rawError * 100).toFixed(1); out.correctedError = +(out.correctedError * 100).toFixed(1);
  return out;
}

const t0 = Date.now();
const tally = { ok: 0, crash: 0, skipped: 0 };
for (let i = 0; i < N; i++) {
  tally[run(i)]++;
  if ((i + 1) % 250 === 0) console.error(`${i + 1}/${N} datasets, ${((Date.now() - t0) / 1000).toFixed(0)}s, ${[...failures.values()].reduce((s, f) => s + f.n, 0)} failures`);
}
const learn = learning();
const report = { datasets: N, seed: SEED_N, seconds: Math.round((Date.now() - t0) / 1000), ...tally, checks, failures: Object.fromEntries([...failures].sort((a, b) => b[1].n - a[1].n)), learning: learn };
console.log(JSON.stringify(report, null, 2));
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
