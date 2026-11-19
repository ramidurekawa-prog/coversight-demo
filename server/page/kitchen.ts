// Kitchen speed: the server's bounds for what the page saves. Figures come
// from lib/data/page/kitchen.js, the same code the browser runs.
import { z } from 'zod';

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hour = z.number().int().min(0).max(23);
const dow = z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

/** One change tried on the line, measured on matched nights. Never changes a kitchen screen by itself. */
const trial = z.object({
  id: z.string().min(1).max(120).regex(/^[\w:.-]+$/),
  title: z.string().trim().min(1).max(200),
  station: z.string().trim().max(60).nullable(),
  days: z.array(dow).min(1).max(7),
  from: hour,
  to: hour,
  start: iso,
  end: iso.optional(),
  status: z.enum(['running', 'stopped', 'kept']),
  at: z.string().max(40),
}).refine((t) => t.to >= t.from, 'the trial’s hours end before they start');

/** Ticket times a chef logged by hand for one night: average minutes by hour, the slowest station, a note. */
const night = z.object({
  hours: z.record(z.string().regex(/^([01]?\d|2[0-3])$/), z.number().min(1).max(120)).refine((h) => Object.keys(h).length >= 1 && Object.keys(h).length <= 24, 'log at least one hour'),
  slow: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
  at: z.string().max(40),
});

export const kitchenSchemas = {
  trials: z.array(trial).max(30),
  log: z.record(iso, night).refine((r) => Object.keys(r).length <= 60, 'keeps at most 60 nights'),
};
