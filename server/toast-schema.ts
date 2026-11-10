// The Toast export summary the browser sends (lib/data/toast.js summarizeToast).
// Raw exports never reach the server; this bounds every figure the summary can
// carry so a hand-crafted request can't push nonsense into the model.
import { z } from 'zod';

const n = (max: number) => z.number().finite().min(0).max(max);
const name = z.string().trim().min(1).max(80);
const DAY = z.enum(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const CHANNEL = z.enum(['Dine-in', 'Takeout', 'DoorDash', 'Uber Eats']);

export const toastSummary = z.object({
  ok: z.literal(true),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weeksCovered: z.number().int().min(1).max(52),
  files: z.array(z.enum(['items', 'orders', 'time', 'payments', 'kitchen'])).max(5),
  notes: z.array(z.string().max(300)).max(10).optional(),
  counted: z.record(z.string(), z.number()).optional(),
  unknown: z.array(z.string().max(200)).max(50).optional(),
  rows: z.object({
    recipes: z.array(z.object({ dish: name, price: n(500), units: n(20_000), category: z.enum(['Food', 'Drink']).optional() })).max(300).optional(),
    exceptions: z.array(z.object({
      employee: name, role: z.string().max(60), sales: n(5_000_000), post_send_voids: n(500_000), comps: n(500_000), discounts: n(500_000),
      hours: n(168).optional(), rate: n(300).optional(),
    })).max(400).optional(),
    channels: z.array(z.object({ channel: CHANNEL, sales: n(2_000_000), orders: z.number().int().min(1).max(200_000), refunds: n(500_000) })).max(4).optional(),
  }),
  toast: z.object({
    wage: n(300).optional(),
    covers: z.number().int().min(0).max(200_000).optional(),
    ot: z.object({ boh: z.array(n(100_000)).length(4), foh: z.array(n(100_000)).length(4), bar: z.array(n(100_000)).length(4) }).optional(),
    serviceHours: z.array(z.object({ week: z.number().int().min(0).max(3), day: DAY, hour: z.number().int().min(0).max(23), covers: n(5_000), parties: n(2_000), servers: n(200) })).max(2000).optional(),
    voidWeeks: z.array(z.object({ week: z.number().int().min(0).max(11), server: name, checks: n(100_000), sales: n(5_000_000), exceptions: n(1_000_000) })).max(5000).optional(),
    priceHistory: z.record(name, z.array(z.object({ price: n(500), units: n(100_000) })).min(4).max(8)).optional(),
    turns: z.array(z.object({ fri: z.boolean(), min: n(360) })).max(400).optional(),
    reseatGaps: z.array(n(120).nullable()).max(300).optional(),
    history: z.array(z.object({ ago: z.number().int().min(0).max(51), net: n(20_000_000), covers: n(1_000_000), labour: n(10_000_000).nullable() })).max(52).optional(),
    tickets: z.object({
      stations: z.array(z.tuple([z.string().max(60), n(100)])).max(8),
      fri: z.array(n(120).nullable()).length(6), sat: z.array(n(120).nullable()).length(6),
    }).optional(),
  }),
});

export type ToastSummary = z.infer<typeof toastSummary>;
