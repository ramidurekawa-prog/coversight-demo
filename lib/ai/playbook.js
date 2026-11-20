/**
 * What makes each page's agent a specialist: its *line check*. A line check is
 * the list of things a seasoned consultant in that area would look at in any
 * restaurant, run against this room's own data. Each check comes back as
 *   found  : there is something to fix, with what it is worth when the data
 *            can price it, and the fix a consultant would reach for
 *   clear  : looked, nothing to fix
 *   needs  : the agent knows to check it but the room has not given it the
 *            data yet, and it says exactly what is missing
 * A check of kind 'law' is a wage-and-hour or similar rule for where the room
 * is. Rules live in the tables below, by state and city, so nothing about the
 * sample's rooms is hardcoded. They are summaries, never legal advice, and
 * no pay rate is typed here: rates change every year, so a check that needs
 * one asks for it.
 *
 * Pure. Every dollar is computed from the derived room and carries a claim.
 */
import { money } from '../data/model.js';

const $ = (n) => money(Math.round(n));
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Who each specialist is, for the person and for the AI. Pages without an entry have no line check yet. */
export const EXPERT = {
  labour: { topic: 'labor', title: 'Labor specialist', covers: 'overtime, scheduling to demand, wage rules', say: 'On this page you are a restaurant labor consultant: scheduling to real demand, overtime, role mix and wage-and-hour rules. Go for the cheapest fix first (moving hours before cutting or adding them). State a legal rule only if it is in the records, name where it applies, and say it is a summary to confirm with payroll, not legal advice.' },
  purchasing: { topic: 'purchasing', title: 'Purchasing specialist', covers: 'supplier prices, credits, price holds', say: 'On this page you are a restaurant purchasing consultant: catching supplier price increases, asking for credits and price holds, and keeping a second quote in hand.' },
  inventory: { topic: 'stock', title: 'Inventory specialist', covers: 'usage against recipes, counts, portioning', say: 'On this page you are an inventory and waste consultant: telling waste from portioning from mis-rings, starting with a spot count.' },
  menu: { topic: 'menu', title: 'Menu specialist', covers: 'pricing, placement, what each plate earns', say: 'On this page you are a menu engineering consultant: price where demand barely moves, reposition what sells but earns little, one change at a time so it can be tested.' },
  controls: { topic: 'comps', title: 'Controls specialist', covers: 'comps, voids, discounts', say: 'On this page you are a restaurant controls consultant: patterns, never accusations. Never name a person.' },
  channels: { topic: 'delivery', title: 'Delivery specialist', covers: 'what each channel really leaves', say: 'On this page you are a delivery and channels consultant: what each order leaves after food, fees, packaging and refunds.' },
  kitchen: { topic: 'kitchen', title: 'Kitchen specialist', covers: 'ticket times, stations, the bottleneck', say: 'On this page you are a kitchen operations consultant: find the one station holding tickets up before adding people.' },
};

/* ------------------------------------------------------------------ rules */

/** Federal wage-and-hour basics, used when a room's state is not known or has no table of its own. */
const FEDERAL = { name: 'Federal', weekly: 40, premium: 0.5, daily: null };
/**
 * State rules. `weekly`/`daily` are the hours after which overtime starts and
 * `premium` is the extra share of the base wage it costs (0.5 = time and a half).
 */
const STATES = {
  CA: {
    name: 'California', weekly: 40, premium: 0.5, daily: 8, doubleAfter: 12, seventhDay: true, tipCredit: false,
    breaks: 'A 30-minute meal break has to start before the end of the fifth hour of work, and there is a paid 10-minute rest break for every four hours. Each day one is missed or late, the employee is owed one extra hour of pay.',
    reporting: 'Someone sent home before half their scheduled shift is owed reporting-time pay: half the shift, at least 2 hours and at most 4.',
    split: 'A shift split by an unpaid gap of more than an hour can owe a split-shift premium of one hour at minimum wage.',
    exempt: 'A salaried manager is only exempt from overtime if they earn at least twice the state minimum wage for full-time work and spend most of their time managing. A chef who mostly works the line usually is not.',
  },
};
/** City rules on top of the state's, keyed by state then city. */
const CITIES = {
  CA: {
    Oakland: { minWage: 'Oakland sets its own minimum wage above the state’s and raises it every January.' },
    Berkeley: { minWage: 'Berkeley sets its own minimum wage above the state’s and raises it every July.', fairWorkweek: 'Berkeley’s Fair Workweek rules can require two weeks’ notice of schedules, with extra pay for late changes. Whether they apply depends on how many people the group employs.' },
  },
};

/** The rules for where a room is. `known` is false when the room has no state on file. */
export function rulesFor(profile = {}) {
  const st = STATES[String(profile.state || '').toUpperCase()];
  const city = CITIES[String(profile.state || '').toUpperCase()]?.[profile.city] || {};
  return { known: !!st, where: st ? st.name : FEDERAL.name, city: profile.city || '', ...(st || FEDERAL), ...city };
}

/* ------------------------------------------------------------------ labor */

function laborChecks(d) {
  const out = [];
  const name = d.profile?.short || d.profile?.name || 'this room';
  const staff = (d.room?.staff || []).filter((s) => s.hours > 0 && s.rate > 0);
  const law = rulesFor(d.profile);
  const caveat = `${law.where} rule, summarized. Confirm with your payroll provider before acting.`;
  const put = (c) => out.push({ kind: 'play', go: 'labour', value: null, unit: '', claim: null, how: '', rule: '', needs: '', weight: 0, ...c });
  if (!staff.length) {
    put({ id: 'hours', name: 'Hours and wages', status: 'needs', text: `${name} has no hours or wages on file, so nothing about labor can be checked yet.`, needs: 'Time entries from your POS or scheduling tool', needsGo: 'inputs' });
    return out;
  }
  const first = (s) => String(s.name || 'Someone').split(' ')[0];

  // 1. Overtime that has not happened yet: the only labor cost that can be removed without cutting anyone's week.
  const coming = staff.filter((s) => s.projected > law.weekly);
  // Where the plan already prices this person's overtime, that figure is used, so every screen says the same number.
  const planned = (s) => (d.plan?.sorted || []).find((c) => c.prevent && c.who === s.name && c.value > 0)?.value;
  const comingCost = coming.reduce((a, s) => a + (planned(s) ?? (s.projected - law.weekly) * s.rate * law.premium), 0);
  const room = staff.filter((s) => !s.projected && s.hours < law.weekly - 4 && coming.some((c) => c.role === s.role));
  put(coming.length ? {
    tags: 'overtime heading tracking', id: 'ot-coming', name: 'Overtime about to happen', do: `Move ${plural(Math.round(coming.reduce((a, s) => a + s.projected - law.weekly, 0)), 'hour')} off ${list(coming.map((s) => `${first(s)}’s`))} week before overtime starts`, status: 'found', say: `${list(coming.map(first))} ${coming.length === 1 ? 'is' : 'are'} about to hit overtime. That costs you ${$(comingCost)} this week.`, todo: `Give ${plural(Math.round(coming.reduce((a, s) => a + s.projected - law.weekly, 0)), 'hour')} to someone who is under ${law.weekly}.`, value: $(comingCost), unit: 'overtime premium avoided this week', claim: 'obs', weight: 1000 + comingCost,
    text: `${list(coming.map((s) => `${first(s)} is tracking to ${s.projected} hours`))} this week. Every hour past ${law.weekly} costs time and a half.`,
    how: `Move the extra ${plural(Math.round(coming.reduce((a, s) => a + s.projected - law.weekly, 0)), 'hour')} to someone in the same role who is under ${law.weekly} before the shift is worked. ${room.length ? `${plural(room.length, 'person', 'people')} in the same role at ${name} ${room.length === 1 ? 'has' : 'have'} room.` : ''} This is prevented cost, so it is never counted as saved.`,
    rule: `Overtime starts after ${law.weekly} hours in a week${law.daily ? ` or ${law.daily} in a day` : ''}. ${caveat}`,
  } : { id: 'ot-coming', name: 'Overtime about to happen', status: 'clear', text: `Nobody at ${name} is tracking past ${law.weekly} hours this week.` });

  // 2. Overtime already in the week, and whether the people working it are classified right.
  const over = staff.filter((s) => s.hours > law.weekly);
  const overHours = over.reduce((a, s) => a + s.hours - law.weekly, 0);
  const overCost = over.reduce((a, s) => a + (s.hours - law.weekly) * s.rate * law.premium, 0);
  const roles = [...new Set(over.map((s) => String(s.role).toLowerCase()))];
  put(over.length ? {
    tags: 'overtime salaried exempt classif', id: 'ot-worked', name: 'Hours past 40 last week', do: 'Settle who is working past 40 hours, and how they are paid', status: 'found', say: `${plural(over.length, 'person', 'people')} worked past ${law.weekly} hours last week. If they are hourly, that is overtime.`, todo: 'Check how they are paid, then spread the extra hours.', value: $(overCost), unit: 'overtime premium a week if paid hourly', claim: 'est', weight: 500 + overCost,
    text: `${plural(over.length, 'person', 'people')} worked past ${law.weekly} hours last week (${list(roles)}), ${overHours.toFixed(1)} hours over in total. The wage file shows base pay only, so the premium is estimated.`,
    how: 'Two things to settle. If they are hourly, spread the hours over 40 across the rest of the kitchen. If they are salaried, check that they are classified correctly, because a wrong classification is the most expensive labor mistake a restaurant makes.',
    rule: law.exempt ? `${law.exempt} ${caveat}` : `Overtime starts after ${law.weekly} hours in a week. ${caveat}`,
  } : { id: 'ot-worked', name: 'Hours past 40 last week', status: 'clear', text: `Nobody at ${name} worked past ${law.weekly} hours last week.` });

  // 3 and 4. Hours against the covers that actually came, from the room's own pace.
  const lab = d.room?.labour;
  const servers = staff.filter((s) => s.role === 'Server');
  const serverRate = mean((servers.length ? servers : staff).map((s) => s.rate));
  const services = [lab?.tue, lab?.sat].filter((s) => s?.sched?.length && s.need?.length === s.sched.length);
  const gaps = services.map((s) => ({
    label: s.label,
    spare: s.sched.reduce((a, x, i) => a + Math.max(0, x - s.need[i]), 0), spareAt: s.hours.filter((_, i) => s.sched[i] > s.need[i]),
    short: s.sched.reduce((a, x, i) => a + Math.max(0, s.need[i] - x), 0), shortAt: s.hours.filter((_, i) => s.need[i] > s.sched[i]),
  }));
  const idle = lab?.kpis?.idle;
  const short = lab?.kpis?.short;
  if (Number.isFinite(idle) && Number.isFinite(short)) {
    const spareSvc = [...gaps].sort((a, b) => b.spare - a.spare)[0];
    const shortSvc = [...gaps].sort((a, b) => b.short - a.short)[0];
    put(idle > 0 ? {
      tags: 'overstaffed idle spare send home early cut', id: 'spare', name: 'Paid hours with nobody to serve', do: `Take ${plural(idle, 'spare server-hour')} out of next week’s schedule`, status: 'found', say: `You are paying for ${plural(idle, 'server-hour')} a week with nobody to serve. That is about ${$(idle * serverRate)} a week, estimated.`, todo: 'Start people later on slow nights. Don’t send them home early: that can cost you extra pay.', value: $(idle * serverRate), unit: 'potential a week', claim: 'est', weight: 300 + idle * serverRate,
      text: `${name} schedules ${plural(idle, 'server-hour')} a week more than its covers need.${spareSvc?.spare ? ` ${spareSvc.label} alone carries ${spareSvc.spare} of them, at ${list(spareSvc.spareAt)}.` : ''}`,
      how: 'Stagger the start times and write shorter shifts into the schedule, instead of sending people home on the night.',
      rule: law.reporting ? `${law.reporting} That is why the fix belongs in the schedule, not on the floor. ${caveat}` : '',
    } : { id: 'spare', name: 'Paid hours with nobody to serve', status: 'clear', text: `${name} is not scheduling more server-hours than its covers need.` });
    put(short > 0 ? {
      tags: 'short understaffed peak busy', id: 'short', name: 'Short at the peak', do: 'Move spare hours to the peak before adding any', status: 'found', say: `You are ${plural(short, 'server-hour')} short a week when you are busiest. Slow tables cost you guests.`, todo: idle > 0 ? 'Move your spare hours to the busy nights first.' : 'Add a short shift at the peak.', weight: 250 + short,
      text: `${name} is ${plural(short, 'server-hour')} a week short when it is busiest.${shortSvc?.short ? ` ${shortSvc.label} is ${shortSvc.short} short, at ${list(shortSvc.shortAt)}.` : ''} Being short at the peak slows turns, and that costs covers.`,
      how: idle > 0 ? `Move before you add: ${Math.min(idle, short)} of the ${short} short hours can come from the ${idle} spare ones at no extra cost.` : 'Add the hours at the peak only, as a short shift.',
    } : { id: 'short', name: 'Short at the peak', status: 'clear', text: `${name} has enough servers on at its peak.` });
  } else {
    put({ id: 'spare', name: 'Hours against covers, by hour', status: 'needs', text: 'I check every hour of the schedule against the covers that actually came, and find the paid hours with nobody to serve and the peaks that are short.', needs: 'Clock-ins by hour (time entries) and covers by hour', needsGo: 'inputs' });
  }

  // 5. Labor as a share of sales against the room's own normal.
  const rows = (d.hist?.rows || []).filter((r) => Number.isFinite(r.labourRate));
  const cur = rows[rows.length - 1];
  const prior = rows.slice(-9, -1);
  if (cur && prior.length >= 4) {
    const mu = mean(prior.map((r) => r.labourRate));
    const extra = (cur.labourRate - mu) * cur.net;
    const high = cur.labourRate > mu * 1.03;
    put({
      id: 'rate', name: 'Labor as a share of sales', status: high ? 'found' : 'clear', ...(high ? { value: $(extra), unit: 'above your own normal last week', claim: 'obs', weight: 200 + extra } : {}),
      text: `Labor was ${pct(cur.labourRate)} of sales in the week of ${cur.label}. Over the ${prior.length} weeks before, ${name} averaged ${pct(mu)}.`,
      how: high ? 'When the share rises, look at sales first: the same schedule on a slower week is the usual cause, and the fix is flexing hours to the forecast, not cutting wages.' : '',
    });
  }

  // 6. Where the labor dollar goes.
  const total = staff.reduce((a, s) => a + s.hours * s.rate, 0);
  const foh = new Set(['Server', 'Bartender', 'Host', 'Busser']);
  const front = staff.filter((s) => foh.has(s.role)).reduce((a, s) => a + s.hours * s.rate, 0);
  const hours = staff.reduce((a, s) => a + s.hours, 0);
  if (d.week?.net > 0 && hours > 0) put({ id: 'mix', name: 'Sales per labor hour', status: 'clear', text: `Each labor hour at ${name} brought in ${$(d.week.net / hours)} of sales last week. The kitchen is ${pct((total - front) / total)} of labor cost and the front of house ${pct(front / total)}.` });

  // Rules that need punches, schedules or payroll the room has not shared.
  const law_ = (c) => put({ kind: 'law', status: 'needs', needsGo: 'connect', ...c });
  if (!law.known) {
    law_({ id: 'state', name: 'Your state’s wage rules', text: 'Overtime by the day, meal and rest breaks, split shifts and local minimum wages differ by state and city. I check the rules for where each room is.', needs: 'The state and city this room is in', needsGo: 'team' });
  } else {
    if (law.breaks) law_({ tags: 'meal rest break lunch', id: 'breaks', name: 'Meal and rest breaks', say: 'Give a 30-minute meal break before the fifth hour ends, and a 10-minute rest every four hours. Miss one and you owe an extra hour of pay.', todo: 'Put the break in the schedule. Send me your break punches and I will check every shift.', text: `A missed or late break is the most common wage claim in ${law.where} restaurants, and it adds up a shift at a time: at ${name}’s average wage each one costs ${money(mean(staff.map((s) => s.rate)), { cents: true })}.`, rule: `${law.breaks} ${caveat}`, how: 'Schedule the break into the shift and have the clock prompt for it. A signed waiver covers shifts of six hours or less.', needs: 'Break punches from your time clock' });
    if (law.daily) law_({ tags: 'daily overtime double', id: 'daily-ot', name: 'Overtime by the day', say: `In ${law.where}, overtime starts after ${law.daily} hours in one day, not only after ${law.weekly} in a week.`, todo: 'Send me clock-in times by day and I will find it.', text: `Weekly totals hide daily overtime. A cook on four ten-hour days is under ${law.weekly} for the week and still owed overtime every day.`, rule: `In ${law.where}, overtime starts after ${law.daily} hours in a day, double time after ${law.doubleAfter}${law.seventhDay ? ', and the seventh day worked in a row is overtime from the first hour' : ''}. ${caveat}`, needs: 'Clock-in and clock-out times by day' });
    if (law.split) law_({ tags: 'split double shift', id: 'split', name: 'Split shifts', say: 'A lunch-then-dinner double with a long unpaid gap can cost you an extra hour of pay.', todo: 'Keep the gap under an hour, or use two people.', text: 'Lunch-then-dinner doubles are the usual place this hides.', rule: `${law.split} ${caveat}`, how: 'Keep the gap under an hour, or run two people on short shifts.', needs: 'The schedule with start and end times' });
    if (law.minWage) law_({ tags: 'minimum wage tipped tip credit', id: 'min-wage', name: `${law.city}’s minimum wage`, say: `${law.city} has its own minimum wage. It is higher than the state’s and it goes up every year.`, todo: 'Tell me the current rate and I will check every wage.', text: `${law.minWage}${law.tipCredit === false ? ` ${law.where} allows no tip credit, so tipped staff are paid the full minimum before tips.` : ''} I check every wage against it once the current rate is on file.`, needs: 'The current local rate', rule: 'Local rule, summarized. Confirm with your payroll provider before acting.' });
    if (law.fairWorkweek) law_({ tags: 'schedule notice fair workweek predictab', id: 'fair-week', name: 'Schedule notice', say: `${law.city} can require you to post schedules two weeks ahead.`, todo: 'Post schedules two weeks out as a habit.', text: law.fairWorkweek, how: 'Post schedules two weeks out as a habit. It also cuts last-minute call-outs.', needs: 'How many people the group employs', rule: 'Local rule, summarized. Confirm with your payroll provider before acting.' });
  }
  put({ tags: 'tax credit tips fica', id: 'tip-credit', name: 'Payroll tax credit on tips', say: 'There is a federal tax credit on tips that many restaurants never claim.', todo: 'Ask your accountant if Form 8846 is filed each year.', status: 'needs', text: 'The federal FICA tip credit gives back the employer’s payroll tax on most reported tips. Many independent restaurants never claim it.', how: 'Ask your accountant whether Form 8846 is filed each year. It is a credit, so it comes straight off the tax bill.', needs: 'Reported tips from payroll', needsGo: 'connect' });
  return out;
}

/* ------------------------------------------------------------------ the other specialists */

function purchasingChecks(d) {
  const jumps = (d.inv?.invoices || []).filter((i) => i.pct >= 10 && i.priceLeg > 0);
  const leg = jumps.reduce((a, i) => a + i.priceLeg, 0);
  if (!(d.inv?.invoices || []).length) return [];
  return [
    jumps.length
      ? { id: 'jumps', name: 'Price increases of 10% or more', do: 'Ask for a credit and a price hold on every increase', status: 'found', value: $(leg), unit: 'added over the invoice period', claim: 'obs', weight: leg, text: `${plural(jumps.length, 'item')} went up 10% or more: ${list(jumps.slice(0, 4).map((i) => `${i.item.toLowerCase()} from ${i.vendor} (${Math.round(i.pct)}%)`))}.`, how: 'Ask for the credit and a 90-day price hold in the same email. Suppliers agree to a hold far more often than a rollback.' }
      : { id: 'jumps', name: 'Price increases of 10% or more', status: 'clear', text: 'No supplier raised a price by 10% or more on the last invoices.' },
    { id: 'quote', name: 'A second quote on your biggest items', status: 'needs', text: 'A current price from a second supplier is the strongest thing to bring to a price conversation, even if you never switch.', needs: 'A second supplier’s price list', needsGo: 'inputs' },
  ];
}

function inventoryChecks(d) {
  const flagged = d.usage?.flagged || [];
  if (!d.usage) return [];
  return [
    flagged.length
      ? { id: 'over-use', name: 'Used faster than recipes explain', do: 'Count what is running over before the next order', status: 'found', value: $(d.usage.week), unit: 'unexplained a week', claim: 'est', weight: d.usage.week, text: `${plural(flagged.length, 'item')}: ${list(flagged.map((f) => `${f.label.toLowerCase()} (${pct(f.pct)} over)`))}.`, how: 'Count first, then decide. If the count matches, it is portioning, and a scale on the station fixes it. If it does not, it is waste or product leaving, and a waste sheet tells which.' }
      : { id: 'over-use', name: 'Used faster than recipes explain', status: 'clear', text: 'Everything counted is being used at the rate recipes and sales explain.' },
    { id: 'waste-log', name: 'A waste sheet on the line', status: 'needs', text: 'A week of written waste separates spoilage, mistakes and over-prep, which each have a different fix.', needs: 'A waste log', needsGo: 'inputs' },
  ];
}

function menuChecks(d) {
  const menu = d.menu?.menu || [];
  if (!menu.length) return [];
  const prices = (d.plan?.sorted || []).filter((c) => c.kind === 'price' && c.value > 0);
  const avg = d.menu.cmWeighted;
  const horse = [...menu].filter((m) => m.cm < avg && m.cat !== 'Bar' && !m.balancing).sort((a, b) => b.units - a.units)[0];
  return [
    prices.length
      ? { id: 'price-room', name: 'Dishes with room on price', do: 'Raise one price where demand barely moves', status: 'found', value: $(prices[0].value), unit: 'potential a week, the first one', claim: prices[0].claim || 'mod', weight: prices[0].value, text: `${plural(prices.length, 'dish', 'dishes')} where demand has barely moved with price here.`, how: 'Raise one at a time, in a small step, so a test can read each. Start where demand moves least.' }
      : { id: 'price-room', name: 'Dishes with room on price', status: 'clear', text: 'No dish has enough price history to show room on price yet.' },
    horse
      ? { id: 'workhorse', name: 'Sells a lot, earns little', status: 'found', claim: 'obs', weight: 1, text: `${horse.name} sold ${horse.units} last week and earns ${money(horse.cm, { cents: true })} a plate after food cost, under the menu’s average of ${money(avg, { cents: true })}.`, how: 'Before touching its price, look at the plate: the portion, the costliest ingredient and the side. Then give its menu spot to a better earner.' }
      : null,
  ].filter(Boolean);
}

function controlsChecks(d) {
  if (!d.staff) return [];
  const n = d.staff.signalCount || 0;
  return [n
    ? { id: 'patterns', name: 'Patterns above the normal range', do: 'Look at the register pattern by shift before talking to anyone', status: 'found', claim: 'obs', weight: n, text: `${plural(n, 'pattern')} in comps, voids or discounts sat above what is normal for that person’s volume. A pattern, not proof.`, how: 'Look at it by shift and by who approved it before talking to anyone. A manager code on voids after payment closes the most common gap.' }
    : { id: 'patterns', name: 'Patterns above the normal range', status: 'clear', text: 'Nobody’s comps, voids or discounts are outside the normal range for their volume.' }];
}

function channelsChecks(d) {
  const del = d.chan?.delivery || [];
  const dine = d.chan?.channels?.[0]?.per100;
  if (!del.length || !Number.isFinite(dine)) return [];
  const worst = [...del].sort((a, b) => a.per100 - b.per100)[0];
  return [{ id: 'gap', name: 'What delivery leaves against dine-in', do: 'Test a delivery menu priced to cover its fee', status: worst.per100 < dine ? 'found' : 'clear', claim: 'obs', weight: dine - worst.per100, text: `${worst.name} leaves about ${$(worst.per100)} of every $100 after food, fees and packaging. Dine-in leaves about ${$(dine)}.`, how: worst.per100 < dine ? 'Price the delivery menu above dine-in so the guest who chooses delivery covers its fee, and test it before rolling it out.' : '' }];
}

function kitchenChecks(d) {
  const t = d.room?.tickets;
  if (!t?.bottleneck) return [];
  const top = (t.stations || []).find((s) => s[0] === t.bottleneck);
  return [{ id: 'bottleneck', name: 'The station holding tickets up', do: `Take load off ${String(t.bottleneck).toLowerCase()} at the peak`, status: 'found', claim: 'obs', weight: top?.[1] || 1, text: `${t.bottleneck} is the bottleneck${top ? `: ${top[1]}% of late tickets wait there` : ''}.`, how: t.fix || 'Move one dish off that station at the peak before adding a cook.' }];
}

const CHECKS = { labour: laborChecks, purchasing: purchasingChecks, inventory: inventoryChecks, menu: menuChecks, controls: controlsChecks, channels: channelsChecks, kitchen: kitchenChecks };
const ORDER = { found: 0, needs: 1, clear: 2 };

/**
 * A specialist's line check for a room: every check, things to fix first.
 * @param {string} page the agent's own page id
 * @param {any} d a derived room
 * @returns {{ page: string, title: string, covers: string, checks: any[], found: number, clear: number, needs: number } | null}
 */
export function lineCheck(page, d) {
  const run = CHECKS[page];
  if (!run || !d) return null;
  const checks = run(d).map((c) => ({ kind: 'play', go: page, value: null, unit: '', claim: null, how: '', rule: '', needs: '', weight: 0, ...c, id: `${page}:${c.id}`, page }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.weight - a.weight);
  if (!checks.length) return null;
  const n = (s) => checks.filter((c) => c.status === s).length;
  return { page, title: EXPERT[page].title, covers: EXPERT[page].covers, checks, found: n('found'), clear: n('clear'), needs: n('needs') };
}

/** Pages whose agent has a line check. */
export const LINE_CHECK_PAGES = Object.keys(CHECKS);

/** Every specialist's checks as facts, so any agent can answer from them and the AI reads them like every other record. */
export function lineCheckFacts(d) {
  return LINE_CHECK_PAGES.flatMap((page) => (lineCheck(page, d)?.checks || []).map((c) => ({
    id: `check:${c.id}`, topic: EXPERT[page].topic, kind: c.kind, tags: c.tags || '', label: EXPERT[page].title, go: c.go, ...(c.claim ? { claim: c.claim } : {}),
    say: c.say || `${c.text.split(/(?<=[a-z)%\d])\.\s+(?=[A-Z])/)[0].replace(/\.$/, '')}.`, todo: c.todo || (c.how ? `${c.how.split(/(?<=[a-z)%\d])\.\s+(?=[A-Z])/)[0].replace(/\.$/, '')}.` : c.status === 'needs' ? `To check this I need: ${c.needs.charAt(0).toLowerCase()}${c.needs.slice(1)}.` : ''),
    short: c.text.split(/(?<=[a-z)%\d])\.\s+(?=[A-Z])/)[0].replace(/\.$/, '.').replace(/([^.])$/, '$1.'),
    text: [`${c.name}: ${c.text}`, c.value ? `Worth ${c.value} (${c.unit}).` : '', c.how ? `The fix: ${c.how}` : '', c.rule ? `The rule: ${c.rule}` : '', c.status === 'needs' ? `Not checked yet. It needs: ${c.needs}.` : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
  })));
}
