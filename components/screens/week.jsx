'use client';

/* Shared by more than one page (see components/screens/pages/). Page threads
   don't edit this file: ask for a shared change so it lands once. */

import { measuredServiceRate } from '../../lib/data/levers';

/**
 * Tonight's staffing plan from the room's own Toast data: for today's weekday,
 * the typical covers and servers on the floor each hour over the last four
 * same weekdays, against the room's measured covers per server-hour.
 */
function tonightPlan(room, dayName) {
  const L = room.levers || {};
  const rate = measuredServiceRate(L.serviceHours || [])?.coversPerServerHour;
  const rows = (L.serviceHours || []).filter((h) => h.day === dayName && h.servers != null);
  if (!rate || !rows.length) return null;
  const hours = [...new Set(rows.map((h) => h.hour))].sort((a, b) => a - b).map((hour) => {
    const hs = rows.filter((h) => h.hour === hour);
    const covers = hs.reduce((t, h) => t + h.covers, 0) / hs.length;
    const servers = hs.reduce((t, h) => t + h.servers, 0) / hs.length;
    const need = Math.max(1, Math.ceil(covers / rate));
    return { hour, covers: Math.round(covers), servers: Math.round(servers * 10) / 10, need, idle: Math.max(0, Math.round(servers) - need), weeks: hs.length };
  });
  // The first hour from which every later hour has a spare server: cut one from there to close.
  let cutFrom = null;
  for (let i = hours.length - 1; i >= 0 && hours[i].idle >= 1; i--) cutFrom = hours[i].hour;
  const idleHours = cutFrom == null ? 0 : hours.filter((h) => h.hour >= cutFrom).length;
  return { rate, hours, cutFrom, idleHours, wage: L.wage ?? 18 };
}

export { tonightPlan };
