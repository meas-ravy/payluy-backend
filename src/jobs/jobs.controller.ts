import { Router } from 'express';
import type { Request } from 'express';
import { env } from '../lib/env';
import { unauthorized } from '../lib/errors';
import type { DetectionSweeper } from './detection-sweeper';
import type { WebhookSender } from './webhook-sender';

/**
 * One pass of every job, for hosts that can't keep a process alive (Vercel & friends).
 * Mounted only when CRON_SECRET is set; `server.ts` runs the same jobs on a 2 s timer instead.
 * GET because that is what schedulers send; it is not cacheable and not public.
 */
export function jobsController(jobs: (DetectionSweeper | WebhookSender)[]): Router {
  const r = Router();

  r.get('/tick', async (req, res) => {
    if (!authorized(req)) throw unauthorized('unauthorized');
    const started = Date.now();
    for (const job of jobs) await job.tick(); // sequential: one connection, predictable duration
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, jobs: jobs.length, ms: Date.now() - started });
  });

  return r;
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; anything else is a stranger. */
const authorized = (req: Request) => !!env.cronSecret && req.headers.authorization === `Bearer ${env.cronSecret}`;
