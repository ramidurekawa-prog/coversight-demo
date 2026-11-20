// Covercast accuracy report: Covercast against the method the pages use
// today ("usual night": the average of up to 8 recent same weekdays), on the
// sample group and on a synthetic room with known growth, a step change and
// holiday effects. Every figure is a backtest: each forecast is made from the
// days before its origin only. Run: node scripts/covercast-report.mjs
import { applyInputs } from '../lib/data/apply.js';
import { backtestDays, backtestHours } from '../lib/data/forecast/engine.js';
import { seriesFromSample } from '../lib/data/forecast/series.js';
import { serverRate } from '../lib/data/forecast/index.js';
import { backtestShiftPulse } from '../lib/data/forecast/shift-pulse.js';
import { pickModels } from '../lib/data/forecast/select.js';
import { METHODS } from '../lib/data/forecast/methods.js';
import { SEED } from '../lib/data/seed.js';
import { stressRoom } from '../tests/helpers/forecast-fixture.js';

const ds = applyInputs(SEED, {});
const sets = [
  ...Object.entries(ds.rooms).map(([id, room]) => ({ name: `Sample: ${room.profile?.short ?? id}`, s: seriesFromSample(room), evalDays: 182 })),
  { name: 'Stress room (synthetic: growth, step change, holidays)', s: stressRoom(), evalDays: 365 },
];
const pct = (x) => (x == null ? 'n/a' : `${x.toFixed(1)}%`);
const gain = (a, b) => (a && b ? `${Math.round((1 - a.wape / b.wape) * 100)}%` : 'n/a');
const out = [];
out.push('| Room | Figure | Level | Usual night (now) | Covercast | Error cut |', '|---|---|---|---|---|---|');
const extra = [];
for (const { name, s, evalDays } of sets) {
  for (const m of ['covers', 'net']) {
    const b = backtestDays(s.days, m, { evalDays });
    const h = backtestHours(s.days, s.hours, m);
    const label = m === 'covers' ? 'Covers' : 'Sales';
    const row = (lvl, cc, cur) => out.push(`| ${name} | ${label} | ${lvl} | ${pct(cur?.wape)} | ${pct(cc?.wape)} | ${gain(cc, cur)} |`);
    row('Day, 1 day ahead', b.horizons[1].covercast, b.horizons[1].current);
    row('Day, 7 days ahead', b.horizons[7].covercast, b.horizons[7].current);
    row('Week total', b.week.covercast, b.week.current);
    if (h) {
      row('Service (lunch/dinner)', h.shift.covercast, h.shift.current);
      row('Hour', h.hour.covercast, h.hour.current);
      for (const cut of [12, 15, 18]) row(`Rest of day, at ${cut > 12 ? cut - 12 : cut} ${cut >= 12 ? 'pm' : 'am'}`, h.intraday[cut].covercast, h.intraday[cut].current);
    }
    row('Holidays only (day ahead)', b.horizons[1].specialDays.covercast, b.horizons[1].specialDays.current);
    extra.push({ name, label, coverage: b.horizons[1].coverage, width: b.horizons[1].rangeWidth, methods: b.horizons[1].methods, from: b.from, through: b.through });
  }
}
console.log(`Error is WAPE: total absolute miss ÷ total actual, over every day (or hour, or service) in the window. Lower is better.\n`);
console.log(out.join('\n'));
console.log('\n| Room | Figure | Days scored | 80% range held on | Range width (avg) |\n|---|---|---|---|---|');
for (const e of extra) console.log(`| ${e.name} | ${e.label} | ${e.from} to ${e.through} | ${pct(e.coverage)} of days | ±${(e.width / 2).toFixed(1)}% |`);
console.log('\nEach method alone (day ahead, normal days, covers):\n');
console.log(`| Room | ${Object.values(METHODS).map((x) => x.label).join(' | ')} |\n|---|${Object.keys(METHODS).map(() => '---').join('|')}|`);
for (const e of extra.filter((x) => x.label === 'Covers')) console.log(`| ${e.name} | ${Object.keys(METHODS).map((k) => pct(e.methods[k]?.wape)).join(' | ')} |`);

// The Service page: Covercast against the page's old rules (mean of 4 same
// weekdays, raw pace, servers sized to the busiest of 4 weeks), per service, sample rooms.
console.log('\nService page, covers, sample rooms (old rules → Covercast):\n');
console.log('| Room | Service | Hour, day ahead | Rest of service (by cut) | Short hours | Idle server-hours |\n|---|---|---|---|---|---|');
for (const id of Object.keys(ds.rooms)) {
  const room = ds.rooms[id];
  const r = backtestShiftPulse(seriesFromSample(room), { rate: serverRate(room) });
  if (!r) continue;
  for (const sv of ['lunch', 'dinner']) {
    const live = Object.entries(r.liveScore[sv]).map(([c, x]) => `${c > 12 ? c - 12 : 12} pm ${pct(x.old?.wape)} → ${pct(x.covercast?.wape)}`).join(', ');
    const st = r.staffing[sv];
    console.log(`| ${room.profile?.short ?? id} | ${sv} | ${pct(r.plan[sv].old.wape)} → ${pct(r.plan[sv].covercast.wape)} | ${live} | ${st.old.shortHours} → ${st.covercast.shortHours} | ${st.old.spareServerHours} → ${st.covercast.spareServerHours} |`);
  }
}

// The model by task (lib/data/forecast/select.js): each candidate's error on the first half
// (where the pick is made) and the second half (which checks it), and what each task uses.
console.log('\nModel by task (error on first half / second half; "use" = what runs):\n');
for (const { name, s } of sets) {
  const p = pickModels(s);
  if (!p.ready) continue;
  console.log(`**${name}** (scored ${p.from} to ${p.through}, split at ${p.splitAt})\n`);
  console.log('| Task | Use | Candidates |\n|---|---|---|');
  for (const [k, t] of Object.entries(p.tasks)) {
    if (!t?.candidates) continue;
    const c = Object.entries(t.candidates).map(([key, x]) => `${key} ${pct(x.pick?.wape)} / ${pct(x.check?.wape)}`).join(', ');
    console.log(`| ${k} (${t.unit}) | ${t.use}${t.use !== t.pick ? ` (picked ${t.pick}, didn't hold up)` : ''} | ${c} |`);
  }
  const n = p.tasks.nights.v1;
  console.log(`\nNights (V1, day ahead): busy ${pct(n.busy.wape)} (old ${pct(n.busy.oldWape)}, above range ${n.busy.aboveRange}%, n ${n.busy.n}) · special ${pct(n.special.wape)} (old ${pct(n.special.oldWape)}, n ${n.special.n}) · ordinary ${pct(n.ordinary.wape)} (old ${pct(n.ordinary.oldWape)}, n ${n.ordinary.n})\n`);
}
