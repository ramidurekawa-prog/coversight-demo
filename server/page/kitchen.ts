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

export const kitchenSchemas = {
  trials: z.array(trial).max(30),
};
