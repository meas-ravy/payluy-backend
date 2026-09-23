import type { Db } from '../lib/prisma';
import { postWebhook } from '../modules/webhooks/webhook-http';
import { log } from '../lib/log';

const TICK_MS = 2_000;
const BATCH = 20;
const LEASE_SECONDS = 60; // > the 10 s HTTP timeout: a claimed row is not re-claimed while it is being sent
const MAX_ATTEMPTS = 8; // AGENTS.md pinned
const backoffSeconds = (attempt: number) => Math.min(2 ** attempt, 3600); // AGENTS.md pinned

/**
 * Delivers `event_deliveries` rows. Postgres is the queue (no Redis): each tick claims due rows with
 * FOR UPDATE SKIP LOCKED, so several API/worker instances never send the same row at the same time.
 * At-least-once: a crash mid-send means a resend after the lease; receivers dedupe on the event id.
 * Runs inside the API process for now (docs/architecture.md §2.2); move it to worker.ts when needed.
 */
export type WebhookSender = ReturnType<typeof createWebhookSender>;

export function createWebhookSender(prisma: Db) {
  const logger = log('webhook-sender');
  let timer: NodeJS.Timeout | undefined;
  let busy = false;

  /** Start the loop (server.ts on boot). */
  function start() {
    timer = setInterval(() => void tick(), TICK_MS);
  }

  /** Stop the loop (server.ts on shutdown). */
  function stop() {
    clearInterval(timer);
  }

  /** One pass: claim due deliveries, send them in parallel. Public so tests can drive it. */
  async function tick() {
    if (busy) return; // previous tick still sending
    busy = true;
    try {
      const ids = await claimDue();
      await Promise.all(ids.map((id) => deliver(id)));
    } catch (e) {
      logger.error(e);
    } finally {
      busy = false;
    }
  }

  /** Claim = push next_attempt_at forward by the lease, atomically, skipping rows another instance holds. */
  async function claimDue(): Promise<number[]> {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      UPDATE event_deliveries
         SET next_attempt_at = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
       WHERE id IN (
             SELECT id FROM event_deliveries
              WHERE status IN ('pending', 'retrying') AND next_attempt_at <= now()
              ORDER BY next_attempt_at, id
              LIMIT ${BATCH}
                FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    return rows.map((r) => r.id);
  }

  async function deliver(id: number) {
    const d = await prisma.event_deliveries.findUnique({ where: { id }, include: { event: true, endpoint: true } });
    if (!d || (d.status !== 'pending' && d.status !== 'retrying')) return;

    const attempts = d.attempts + 1;
    const guard = { id, status: d.status, attempts: d.attempts }; // hard rule 3: guarded update

    // "Delivery targets status = active endpoints only" (docs/api.md)
    if (d.endpoint.status !== 'active') {
      await prisma.event_deliveries.updateMany({
        where: guard,
        data: { status: 'failed', next_attempt_at: null, last_error: 'endpoint_disabled' },
      });
      return;
    }

    const body = JSON.stringify(d.event.payload); // sign and send the exact same string
    const r = await postWebhook(d.endpoint.url, d.endpoint.secret_key, d.event.type, body);

    const next =
      r.error === null
        ? { status: 'success', next_attempt_at: null }
        : attempts >= MAX_ATTEMPTS
          ? { status: 'failed', next_attempt_at: null }
          : { status: 'retrying', next_attempt_at: new Date(Date.now() + backoffSeconds(attempts) * 1000) };

    await prisma.event_deliveries.updateMany({
      where: guard,
      data: { ...next, attempts, last_response_status: r.status, last_error: r.error },
    });
  }

  return { start, stop, tick };
}
