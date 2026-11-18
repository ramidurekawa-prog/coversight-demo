/**
 * Covercast calendar: dates, weekdays and the days that change restaurant
 * demand. Calendar facts only: a holiday's effect on a room is learned from
 * that room's own past years (see engine.js), never assumed.
 */

export const DAY_MS = 864e5;
export const at = (iso) => Date.parse(`${iso}T12:00:00Z`);
export const addDays = (iso, n) => new Date(at(iso) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((at(b) - at(a)) / DAY_MS);
/** 0 = Sunday … 6 = Saturday. */
export const wdOf = (iso) => new Date(at(iso)).getUTCDay();
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The n-th (1-based; -1 = last) weekday `dow` of month `m` (0-based) in year `y`, as a UTC ms. */
function nthDow(y, m, dow, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    return Date.UTC(y, m, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m + 1, 0));
  return Date.UTC(y, m, lastDay.getUTCDate() - ((lastDay.getUTCDay() - dow + 7) % 7));
}

/** US public holidays and the days that move restaurant demand most, for one year. */
export function holidaysOfYear(y) {
  const d = (ms, key, name) => ({ iso: new Date(ms).toISOString().slice(0, 10), key, name });
  const easter = (() => { // Anonymous Gregorian algorithm
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(y, month - 1, day);
  })();
  const thanksgiving = nthDow(y, 10, 4, 4);
  return [
    d(Date.UTC(y, 0, 1), 'new-year', 'New Year’s Day'),
    d(nthDow(y, 0, 1, 3), 'mlk', 'Martin Luther King Jr. Day'),
    d(nthDow(y, 1, 0, 2), 'super-bowl', 'Super Bowl Sunday'),
    d(Date.UTC(y, 1, 14), 'valentines', 'Valentine’s Day'),
    d(nthDow(y, 1, 1, 3), 'presidents', 'Presidents’ Day'),
    d(Date.UTC(y, 2, 17), 'st-patricks', 'St. Patrick’s Day'),
    d(easter, 'easter', 'Easter Sunday'),
    d(Date.UTC(y, 4, 5), 'cinco', 'Cinco de Mayo'),
    d(nthDow(y, 4, 0, 2), 'mothers', 'Mother’s Day'),
    d(nthDow(y, 4, 1, -1), 'memorial', 'Memorial Day'),
    d(nthDow(y, 5, 0, 3), 'fathers', 'Father’s Day'),
    d(Date.UTC(y, 6, 4), 'july-4', 'Independence Day'),
    d(nthDow(y, 8, 1, 1), 'labor', 'Labor Day'),
    d(Date.UTC(y, 9, 31), 'halloween', 'Halloween'),
    d(thanksgiving - DAY_MS, 'thanksgiving-eve', 'Thanksgiving Eve'),
    d(thanksgiving, 'thanksgiving', 'Thanksgiving'),
    d(thanksgiving + DAY_MS, 'black-friday', 'Black Friday'),
    d(Date.UTC(y, 11, 24), 'christmas-eve', 'Christmas Eve'),
    d(Date.UTC(y, 11, 25), 'christmas', 'Christmas Day'),
    d(Date.UTC(y, 11, 31), 'new-years-eve', 'New Year’s Eve'),
  ];
}

const HOLI = new Map();
/** The holiday on a date, or null. */
export function holidayOn(iso) {
  const y = +iso.slice(0, 4);
  if (!HOLI.has(y)) HOLI.set(y, new Map(holidaysOfYear(y).map((h) => [h.iso, h])));
  return HOLI.get(y).get(iso) ?? null;
}
