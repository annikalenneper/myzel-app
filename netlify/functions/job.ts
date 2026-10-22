// Netlify Function: Joblauf alle 15 Minuten (E-07), aufgerufen von cron-job.org mit geheimem Schlüssel im Header
// „Authorization: Bearer <CRON_SECRET>“. Antwortet mit einer kurzen Zusammenfassung für das Protokoll dort.
import '../../server/core/berlin';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from '@netlify/functions';
import { bearerToken } from '../../server/api/http';
import { database } from '../../server/db/connection';
import { runJob } from '../../server/p2/notify';
import { liveSenders } from '../../server/p2/senders';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? '';
  const given = bearerToken(req) ?? '';
  if (secret.length < 16 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export default async (req: Request): Promise<Response> => {
  if (!authorized(req)) return new Response('Nicht berechtigt.', { status: 401 });
  const run = await runJob(database(), new Date(), liveSenders());
  return new Response(`${run.result}: ${run.summary}`, {
    status: run.result === 'ok' ? 200 : 500,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};

export const config: Config = { path: '/jobs/run' };
