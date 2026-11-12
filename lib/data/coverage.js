// The coverage map, computed. Each operating area reaches a step of the loop
// (detect → understand → act → verify) only when this room's feeds, findings,
// test metrics and verification history actually support it. A step that
// can't be reached says why: a missing feed is "unavailable", which is not
// the same as "looked, found nothing".
import { findingBlocked } from './findings.js';

/**
 * needs: feeds that must be on to detect anything; acting needs them complete
 * (not partial). helps: feeds that sharpen it. lever: the plan's lever name.
 * tests: lever keys (readers.js LEVER_METRIC) that can verify a change here.
 */
export const AREA_RULES = {
  labour: { needs: ['Toast'], helps: ['7shifts'], lever: 'Labour', tests: ['labour', 'overtime'] },
  demand: { needs: ['Toast'], helps: ['7shifts'], lever: 'Labour', tests: [], measuredBy: 'Labour & scheduling' },
  menu: { needs: ['Toast', 'Recipe costs'], helps: [], lever: 'Menu', tests: ['menu_margin', 'mix'] },
  purchasing: { needs: ['Invoices'], helps: [], lever: 'Purchasing', tests: [] },
  inventory: { needs: ['Toast', 'Invoices', 'Inventory counts'], helps: ['Waste log'], lever: 'Inventory', tests: [] },
  bar: { needs: ['Toast', 'Inventory counts'], helps: [], lever: 'Bar', tests: [] },
  kitchen: { needs: ['Kitchen display'], helps: ['Toast'], lever: 'Kitchen', tests: [] },
  foh: { needs: ['Toast'], helps: ['Waitlist'], lever: 'Throughput', tests: ['turns'] },
  controls: { needs: ['Toast'], helps: [], lever: 'Controls', tests: ['void_comp'] },
  channels: { needs: ['Toast', 'Delivery statements'], helps: [], lever: 'Channels', tests: [] },
};

/** Lever keys of test windows → the plan's lever names. */
export const TEST_LEVER = { labour: 'Labour', overtime: 'Labour', menu_margin: 'Menu', mix: 'Menu', void_comp: 'Controls', turns: 'Throughput' };

const STEPS = ['detect', 'understand', 'act', 'verify'];

/**
 * @param {{ areas: any[], feeds: { name: string, state: string }[], candidates: any[], room: any }} d a derived room
 * @param {{ verified?: string[], testing?: string[] }} evidence plan lever names with a verified / running test in this room
 */
export function coverageOf(d, { verified = [], testing = [] } = {}) {
  const feed = Object.fromEntries((d.feeds || []).map((f) => [f.name, f.state]));
  const on = (n) => feed[n] && feed[n] !== 'off';
  const complete = (n) => feed[n] && feed[n] !== 'off' && feed[n] !== 'partial';
  return d.areas.map((a) => {
    const r = AREA_RULES[a.id];
    if (!r) return { ...a, reached: 'none', steps: {}, kind: a.fig === 'Out of scope' ? 'out' : 'unbuilt', missing: [], why: a.note, next: null };
    const missing = r.needs.filter((n) => !on(n));
    const partial = r.needs.filter((n) => on(n) && !complete(n));
    const cands = d.candidates.filter((c) => c.lever === r.lever);
    const doable = cands.filter((c) => c.value > 0 && !c.prevent && !findingBlocked(c, d.room));
    const steps = {};
    steps.detect = missing.length ? { ok: false, why: `Needs ${missing.join(' and ')}` } : { ok: true, why: `Reads ${r.needs.join(', ')}` };
    steps.understand = !steps.detect.ok ? { ok: false, why: 'Nothing to explain without the data' }
      : cands.length ? { ok: true, why: `${cands.length} finding${cands.length === 1 ? '' : 's'} sized from this room’s data` }
      : a.claim && a.claim !== 'none' ? { ok: true, why: 'Sized by its detector' }
      : { ok: false, why: 'Looked, found nothing worth a change', nothing: true };
    steps.act = !steps.understand.ok ? { ok: false, why: steps.understand.nothing ? 'Nothing to act on' : 'Waits on the step before' }
      : partial.length ? { ok: false, why: `${partial.join(' and ')} only partly in; flagged, not acted on` }
      : doable.length ? { ok: true, why: `${doable.length} change${doable.length === 1 ? '' : 's'} ready, within the fences` }
      : { ok: false, why: cands.some((c) => findingBlocked(c, d.room)) ? 'Blocked until recipe costs are current' : 'No change here is worth money yet' };
    steps.verify = r.measuredBy ? { ok: false, why: `Measured under ${r.measuredBy}: one lever key, so a dollar is counted once` }
      : !r.tests.length ? { ok: false, why: 'No weekly metric for this lever yet: changes here can’t be verified or billed' }
      : verified.includes(r.lever) ? { ok: true, why: 'A change here has verified' }
      : testing.includes(r.lever) ? { ok: false, why: 'A test is running' }
      : { ok: false, why: 'Testable, nothing verified yet' };
    // A verified past change counts even if today's data has nothing new to act on.
    const reached = steps.verify.ok ? 'verify' : [...STEPS].reverse().find((s) => s !== 'verify' && steps[s].ok) || 'none';
    const firstGap = STEPS.find((s) => !steps[s].ok);
    const kind = missing.length ? 'unavailable' : steps.understand.nothing ? 'clear' : 'covered';
    const next = missing.length ? { label: `Connect ${missing[0]}`, go: missing[0] === 'Toast' ? 'connect' : 'sources' }
      : partial.length ? { label: `Complete ${partial[0]}`, go: 'inputs' }
      : steps.act.ok && !steps.verify.ok && r.tests.length && !testing.includes(r.lever) ? { label: 'Start a test', go: a.screen }
      : steps.act.ok ? { label: 'Review the change', go: a.screen }
      : null;
    return { ...a, reached, steps, kind, missing, partial, gap: firstGap ? steps[firstGap].why : null, next, helps: r.helps.filter((n) => !on(n)) };
  });
}
