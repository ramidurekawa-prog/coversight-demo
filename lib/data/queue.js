/**
 * Today's work queue for a room on its own data (a Toast export loaded).
 * The sample rooms keep their written queue; a real room's queue is built
 * every day from what its data says: stale data first, then missing costs,
 * then the best-valued findings, then a lever worth testing.
 *
 * Cards have the sample queue's shape, so the Today screen renders both.
 * Pure JS; tested in tests/queue.test.js.
 */

import { leverReport } from './levers.js';

const at = (d) => Date.parse(`${d}T00:00:00Z`);
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * @param {object} d deriveRoom(...) for the room
 * @param {{ today: string, dataEnd: string, testing?: string[], dismissed?: Record<string,string> }} ctx
 *   testing: lever keys already under a running test; dismissed: finding id → until (ISO)
 */
export function buildOwnQueue(d, { today, dataEnd, testing = [], dismissed = {} }) {
  const cards = [];
  const room = d.room;
  const stale = Math.round((at(today) - at(dataEnd)) / 864e5);
  if (stale > 8) {
    cards.push({
      id: `stale:${dataEnd}`, tone: 'warn', icon: 'Upload', claim: 'none', mins: 5, primary: 'Upload', go: 'inputs',
      title: 'Upload this week’s Toast export',
      body: `Your Toast data ends ${dataEnd}, ${stale} days ago. Tests pause and findings go stale until the next week arrives.`,
      value: 'Keeps tests running',
    });
  }
  const est = room.menu.filter((m) => m.costEstimated && m.units > 0);
  if (est.length) {
    cards.push({
      id: `costs:${est.length}`, tone: 'warn', icon: 'Calculator', claim: 'none', mins: Math.min(30, 2 * est.length), primary: 'Enter costs', go: 'inputs', input: 'recipes',
      title: `Enter plate costs for ${est.length} dish${est.length === 1 ? '' : 'es'}`,
      body: `${est.slice(0, 3).map((m) => m.name).join(', ')}${est.length > 3 ? ` and ${est.length - 3} more` : ''} carry an estimated cost. Food cost and every menu move on them are estimates until you do.`,
      value: 'Turns estimates into measurements',
    });
  }
  const now = new Date(at(today)).toISOString();
  d.candidates
    .filter((c) => c.value > 0.5 && !(dismissed[c.id] && dismissed[c.id] > now))
    .sort((a, b) => (b.perHour ?? b.value) - (a.perHour ?? a.value))
    .slice(0, 3)
    .forEach((c) => {
      const approval = c.kind === 'price' && c.item && c.to != null ? `price:${c.item}:${c.to}` : null;
      cards.push({
        id: `find:${c.id}`, tone: 'accent', icon: c.lever === 'Menu' ? 'UtensilsCrossed' : c.lever === 'Labour' ? 'Users' : 'Lightbulb', claim: c.claim || 'est', mins: Math.max(2, Math.round((c.hours ?? 0.25) * 10)),
        title: c.title, body: c.why || 'Found in this week’s data.', value: `${money(c.value)}/wk`, means: 'Extra profit a week, if it works', refuse: true,
        primary: 'Review', ...(approval ? { approval } : { go: 'finding', goId: c.id }),
      });
    });
  const best = leverReport(room, d)
    .filter((l) => !testing.includes(l.key) && l.weekly > 0 && ['A', 'A−', 'A-', 'B'].includes(l.grade))
    .sort((a, b) => b.weekly - a.weekly)[0];
  if (best) {
    cards.push({
      id: `test:${best.key}`, tone: 'good', icon: 'Timer', claim: 'mod', mins: 2, primary: 'Start the test', start: best.key,
      title: `Start a 28-day test: ${best.name}, ${best.scope}`,
      body: `Worth about ${money(best.weekly)} a week if it holds. Starting it freezes the baseline; each new week of Toast data is a checkpoint, and only the cautious end of what it proves is ever booked.`,
      value: `${money(best.weekly)}/wk modelled`, means: 'Extra profit a week, if the test proves it',
    });
  }
  return cards;
}
