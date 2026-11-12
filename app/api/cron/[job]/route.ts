// Vercel Cron entry point: GET /api/cron/<job> with "Authorization: Bearer <CRON_SECRET>".
import { getDb, hasDatabase } from '../../../../server/db/client';
import { JOBS, runJob, type JobName } from '../../../../server/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const { job } = await ctx.params;
  const secret = process.env.CRON_SECRET;
  if (!secret || !hasDatabase()) return Response.json({ error: 'Scheduled jobs are not configured (CRON_SECRET and DATABASE_URL).' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(job in JOBS)) return Response.json({ error: `unknown job '${job}'` }, { status: 404 });
  const results = await runJob(getDb(), job as JobName);
  const failed = results.filter((r) => !r.ok).length;
  return Response.json({ job, orgs: results.length, failed }, { status: failed ? 207 : 200 });
}
