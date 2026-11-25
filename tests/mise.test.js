import { describe, expect, it } from 'vitest';

import { casebook } from '../lib/ai/casebook.js';
import { afterRead, callBrief, decisionLoop, duringRead, howTo, levelFor, mise, MISE, miseLine, testReads, withMise } from '../lib/ai/mise.js';
import { roomMoves } from '../lib/ai/room-moves.js';
import { numbersOk, sousAnswer, sousFacts, sousSheet } from '../lib/ai/sous.js';
import { LEVELS_OF_UNDERSTANDING, understand, understandingFacts } from '../lib/ai/understanding.js';
import { deriveGroup, deriveRoom } from '../lib/data/model.js';
import { SEED } from '../lib/data/seed.js';

const group = deriveGroup(SEED);
const rooms = Object.fromEntries(group.rows.map((r) => [r.id, r.name]));
const oak = deriveRoom(SEED, 'oakland');
const book = casebook(oak, { rooms });
const moves = roomMoves(oak, {}, { now: Date.parse('2026-10-28T03:00:00Z') });

describe('what Mise understands, level by level', () => {
  const u = understand(oak, { group, book });

  it('covers every level, in order, each with its source', () => {
    expect(u.levels.map((l) => l.id)).toEqual(LEVELS_OF_UNDERSTANDING.map((l) => l.id));
    expect(u.levels.map((l) => l.id)).toEqual(['industry', 'group', 'location', 'management', 'team']);
    for (const l of u.levels) {
      expect(l.known.length, l.id).toBeGreaterThan(0);
      for (const k of l.known) {
        expect(k.source, k.text).toBeTruthy();
        expect(k.text, l.id).not.toMatch(/undefined|NaN|null/);
      }
    }
    expect(u.known).toBe(u.levels.reduce((s, l) => s + l.known.length, 0));
  });

  it('reads each level from the room’s own data', () => {
    const say = (id) => u.levels.find((l) => l.id === id).known.map((k) => k.text).join(' ');
    expect(say('industry')).toMatch(/Wage rules for Oakland, California: overtime after 40 hours a week or 8 a day/);
    expect(say('group')).toMatch(/^3 rooms\./);
    expect(say('group')).toMatch(/\$479 a week verified saved across the group/);
    expect(say('location')).toMatch(/52 weeks of sales on file, from the week of Oct 27, 2025 to the week of Oct 19, 2026/);
    expect(say('location')).toMatch(/1,412 covers and \$41,620 in sales a week/);
    expect(say('management')).toMatch(/Marcus Rivera runs Oakland day to day/);
    expect(say('management')).toMatch(/Maria Reyes has led 3 tests here, 1 held up/);
    expect(say('team')).toMatch(/17 people on the register: 12 servers, 5 bartenders/);
  });

  it('says what it does not know, and never invents a benchmark', () => {
    const industry = u.levels.find((l) => l.id === 'industry');
    expect(industry.gaps[0]).toMatchObject({ need: 'Results from restaurants like yours' });
    expect(industry.gaps[0].fix).toMatch(/0 so far/);
    // No approvals yet: it says so instead of guessing who follows through.
    expect(u.levels.find((l) => l.id === 'management').gaps[0].need).toBe('Approvals made in Coversight');
  });

  it('learns about managers from approvals and the notebook once there are some', () => {
    const tasks = [{ roomId: 'oakland', status: 'done' }, { roomId: 'oakland', status: 'open' }, { roomId: 'berkeley', status: 'done' }];
    const m = understand(oak, { group, book, tasks, notes: [{ id: 'n1', text: 'We close Mondays' }], mem: { x: { how: 'dismissed' } } }).levels.find((l) => l.id === 'management');
    const t = m.known.map((k) => k.text).join(' ');
    expect(t).toMatch(/2 approved changes: 1 made, 1 still open/);
    expect(t).toMatch(/You have told me 1 thing to remember/);
    expect(t).toMatch(/You set aside 1 suggestion/);
    expect(m.gaps).toEqual([]);
  });

  it('ranks the data that would teach it most, stale feeds first', () => {
    expect(u.smarter[0].need).toBe('7shifts, brought up to date');
    expect(u.smarter[0].stale).toBe(true);
    expect(u.smarter.some((g) => /Break punches/.test(g.need))).toBe(true);
  });

  it('becomes records Sous can answer from, each passing the figure check', () => {
    const facts = understandingFacts(u);
    expect(facts.map((f) => f.id)).toEqual(['know:industry', 'know:group', 'know:location', 'know:management', 'know:team', 'know:smarter']);
    const sheet = sousSheet(facts);
    for (const f of facts) expect(numbersOk(`${f.say} ${f.todo || ''}`, sheet), f.id).toBe(true);
    const all = sousFacts(oak, { role: 'owner', group });
    expect(sousAnswer('What would make you smarter?', all).used).toContain('know:smarter');
  });
});

describe('every decision, before, during and after', () => {
  const loop = decisionLoop(oak, book, moves);

  it('before: what to do, how, why, what it should be worth, and who does it', () => {
    expect(loop.before.length).toBeGreaterThan(2);
    const vendor = loop.before.find((b) => b.topic === 'purchasing');
    expect(vendor).toMatchObject({ who: 'Price Watch', level: { n: 1, name: 'Recommends' } });
    expect(vendor.how[2]).toMatch(/I never send it for you/);
    expect(vendor.risks[0]).toMatch(/^Last time: “Switch romaine to a second supplier” at Walnut Creek\./);
    expect(vendor.measure).toMatch(/Nothing counts as saved until that test verifies it/);
    const labor = loop.before.find((b) => b.topic === 'labor');
    expect(labor.who).toBe('Roster Coach');
    expect(labor.how[0]).toMatch(/^Move the extra/); // the consultant's own fix, not a generic step
    // A feed to fix is not a lever change: no test, no saving.
    expect(loop.before.find((b) => b.topic === 'data')?.measure).toBe('');
    for (const b of loop.before) for (const t of [b.what, b.why, ...b.how]) expect(t).not.toMatch(/undefined|NaN/);
  });

  it('corrects an estimate against the consultant’s record only with enough history', () => {
    const k = book.consultants.find((x) => x.topic === 'labor');
    const brief = callBrief({ id: 'm', topic: 'labor', go: 'labour', title: 'Trim a shift', why: '', value: '$200', unit: 'potential a week', claim: 'est', act: { kind: 'go' } }, oak, k);
    expect(brief.aim.text).toMatch(/^I estimate high/); // 3 measured: words, no corrected figure
    const seasoned = { ...k, record: { ...k.record, aim: { n: 6, ratio: 0.8, onTarget: 4 } } };
    expect(callBrief({ id: 'm', topic: 'labor', go: 'labour', title: 'x', why: '', value: '$200', act: {} }, oak, seasoned).aim).toEqual({ text: 'My estimates in labor have come in at 80% of what I said, so expect nearer $160.', claim: 'est' });
  });

  it('during: says whether a running test points the way it should', () => {
    expect(loop.during.map((c) => c.id).sort()).toEqual(['oak-pars', 'salmon-plate', 'tue-dinner']);
    expect(duringRead({ outcome: 'testing', lo: 12, hi: 80 }).tone).toBe('good');
    expect(duringRead({ outcome: 'testing', lo: -40, hi: 610 }).text).toMatch(/^Not clear yet: so far between −\$40 and \$610/);
    expect(duringRead({ outcome: 'testing', lo: -90, hi: -10 }).tone).toBe('bad');
    expect(duringRead({ outcome: 'data', reason: 'Recipe costs are 18 days old. More.' }).text).toBe('Stopped: Recipe costs are 18 days old.');
  });

  it('after: how each closed test came out against its estimate, and the lesson', () => {
    const thu = loop.after.find((c) => c.id === 'thu-prep');
    expect(thu.read.text).toBe('Held up. Estimated $130 a week; measured $112 (86% of the estimate).');
    expect(thu.read.lesson).toMatch(/^Held up at Oakland for 18 weeks/);
    expect(afterRead({ outcome: 'inconclusive', est: 80, point: 35, lesson: 'x' }).text).toBe('Test too small to tell.');
  });

  it('never acts: every level ends with a person', () => {
    expect(levelFor({ working: 3 }, {}).does).toMatch(/comes to you as a task/);
    expect(levelFor({ working: 2 }, { act: { kind: 'email' } }).does).toBe('Has drafted it for you. You approve and send.');
    expect(howTo({ act: { kind: 'approve' } }, oak)[1]).toMatch(/becomes a task/);
  });
});

describe('Mise', () => {
  it('brings it all together under its own name', () => {
    const m = mise(oak, { book, moves, group });
    expect(MISE.name).toBe('Mise');
    expect(m.understanding.levels).toHaveLength(5);
    expect(m.learning.map((k) => k.name)).toContain('Roster Coach');
    expect(m.record.calls).toBe(16);
  });
});

describe('Mise inside the platform', () => {
  it('travels with every move the platform shows', () => {
    const minded = withMise(oak, moves, book);
    expect(minded).toHaveLength(moves.length);
    for (const m of minded) expect(m.mise.how.length, m.id).toBeGreaterThan(0);
    const vendor = minded.find((m) => m.topic === 'purchasing');
    expect(miseLine(vendor.mise)).toMatchObject({ tone: 'warn' });
    expect(miseLine(vendor.mise).text).toMatch(/^Last time: “Switch romaine/);
    expect(withMise(oak, minded, book)[0]).toBe(minded[0]); // already minded: left alone
    expect(miseLine(null)).toBeNull();
  });

  it('reads every test of the room for the Pass', () => {
    const r = testReads(oak, book);
    expect(r['tue-dinner'].text).toMatch(/^Not clear yet/);
    expect(r['thu-prep']).toMatchObject({ tone: 'good' });
    expect(r['thu-prep'].lesson).toMatch(/^Held up at Oakland/);
    expect(r['wc-romaine']).toBeUndefined(); // another room's test
  });

  it('has no page of its own', async () => {
    const { CV_PAGES, CV_NAV } = await import('../lib/pages.js');
    expect(CV_PAGES.mise).toBeUndefined();
    expect(CV_NAV.flatMap((g) => g.items)).not.toContain('mise');
  });
});

describe('How We Work', () => {
  it('is the one page that explains Mise, last in the Proof group, and Proof itself carries none of it', async () => {
    const { CV_PAGES, CV_NAV, CV_TABS } = await import('../lib/pages.js');
    expect(CV_PAGES.how.title).toBe('How We Work');
    expect(CV_NAV.find((g) => g.label === 'Proof').items.at(-1)).toBe('how');
    expect(CV_TABS.proof.map(([id]) => id)).not.toContain('consultants');
    expect(CV_TABS.team.map(([id]) => id)).toContain('consultants');
  });
});
