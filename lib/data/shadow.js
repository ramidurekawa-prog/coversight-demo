/**
 * Shadow mode's record: how Coversight's logged calls did against what
 * happened, before anyone has to act on them. It is the trust step of a pilot
 * ("it would have called these 14 services; here is how close it came") and
 * the honest answer to "how good is the forecast here?".
 *
 * Every figure is a count or a server-hour from logged services. The idle
 * hours priced at the room's wage are Simulated: what following the call
 * might have saved, never savings (only a Proof test can verify that).
 *
 * Pure JS: the server, the screens and the tests all use it.
 */

const sum = (a) => a.reduce((s, x) => s + x, 0);
const r1 = (x) => Math.round(x * 10) / 10;

/** Graded services needed before the record says anything about it. */
export const SHADOW_MIN = 7;

/**
 * @param {{ date: string, meal: string, state: string, graded?: any, rateCents?: number|null }[]} entries logged calls, any order
 * @param {{ wageCents?: number|null }} [p] the room's hourly wage, to price idle hours (Simulated)
 */
export function shadowReport(entries = [], { wageCents = null } = {}) {
  const logged = entries.filter((e) => e && e.state !== 'blocked');
  const blocked = entries.filter((e) => e?.state === 'blocked');
  const graded = logged.filter((e) => e.graded?.state === 'graded');
  const waiting = logged.filter((e) => e.graded?.state === 'waiting' || !e.graded);
  const g = graded.map((e) => e.graded);
  const inRange = g.filter((x) => x.covers.inRange === true).length;
  const ranged = g.filter((x) => x.covers.inRange != null).length;
  const absErr = g.map((x) => Math.abs(x.covers.error));
  const pctErr = g.filter((x) => x.covers.actual > 0).map((x) => Math.abs(x.covers.error) / x.covers.actual);
  const hours = (k, side) => r1(sum(g.map((x) => x.gap[k]?.[side] ?? 0)));
  const plan = { over: hours('plan', 'over'), short: hours('plan', 'short') };
  const call = { over: hours('call', 'over'), short: hours('call', 'short') };
  const idleFewer = r1(plan.over - call.over);
  const enough = graded.length >= SHADOW_MIN;
  return {
    logged: logged.length, graded: graded.length, waiting: waiting.length, blocked: blocked.length, need: SHADOW_MIN,
    status: enough ? 'ready' : graded.length ? 'early' : 'collecting',
    forecast: {
      inRange, ranged, meanMiss: absErr.length ? Math.round(sum(absErr) / absErr.length) : null,
      meanMissPct: pctErr.length ? Math.round((sum(pctErr) / pctErr.length) * 100) : null,
    },
    staffing: {
      closer: g.filter((x) => x.closer === 'call').length, plan: g.filter((x) => x.closer === 'plan').length, same: g.filter((x) => x.closer === 'same').length,
      planHours: plan, callHours: call, idleFewer, shortMore: r1(call.short - plan.short), shortFewer: r1(plan.short - call.short),
      // What the fewer idle hours would have cost at the room's wage: Simulated, never booked.
      simulatedCents: wageCents && idleFewer > 0 ? Math.round(idleFewer * wageCents) : null,
      followed: g.filter((x) => x.followed).length,
    },
    claim: { counts: 'Observed', simulated: 'Simulated' },
    note: enough
      ? 'Graded on services that already happened, against the guests who came.'
      : `Coversight grades each call once the service is over. The record means something after ${SHADOW_MIN} graded services.`,
  };
}

/** The latest graded services, newest first, for the record's list. */
export function shadowLatest(entries = [], n = 7) {
  return entries.filter((e) => e?.graded?.state === 'graded').sort((a, b) => (a.date === b.date ? (a.meal === 'dinner' ? -1 : 1) : a.date < b.date ? 1 : -1)).slice(0, n);
}
