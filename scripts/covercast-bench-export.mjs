import fs from 'node:fs';
import { applyInputs } from '../lib/data/apply.js';
import { SEED } from '../lib/data/seed.js';
import { seriesFromSample } from '../lib/data/forecast/series.js';
import { stressRoom } from '../tests/helpers/forecast-fixture.js';
import { buildDays, walk } from '../lib/data/forecast/engine.js';
const ds = applyInputs(SEED, {});
const sets = [...Object.entries(ds.rooms).map(([id, r]) => [id, seriesFromSample(r)]), ['stress', stressRoom({ hours: false })]];
const out = {};
for (const [id, s] of sets) {
  const { D, last } = buildDays(s.days, 'covers');
  const evalFrom = last - 181;
  const res = {};
  for (const h of [1, 7]) res[h] = Object.fromEntries(walk(D, h, evalFrom - 120, last).filter(r => r.t >= evalFrom).map(r => [r.iso, { cc: r.final, cur: r.f.current, a: r.actual }]));
  out[id] = { days: D.map(d => ({ iso: d.iso, v: d.v })), evalFrom: D[evalFrom].iso, res };
}
fs.writeFileSync('scripts/.covercast-bench.json', JSON.stringify(out));
