import { PaymentTransitionsService } from '../modules/payments/payment-transitions.service';
import type { Db } from '../lib/prisma';
import { DetectionService } from '../modules/detection/detection.service';
import { log } from '../lib/log';

const TICK_MS = 2_000;
const BATCH = 20; // AGENTS.md pinned: batch 20
const RECHECK_SECONDS = 30; // AGENTS.md pinned: each open payment is asked again every 30 s
const EXPIRE_BATCH = 100;

/**
 * The detection loop (no Redis: Postgres is the queue). Every tick:
 * 1. expiry sweeper: pending/scanned past expires_at → expired (+ payment.expired), docs/detection.md §5;
 * 2. claims up to 20 payments whose next_check_at is due, FOR UPDATE SKIP LOCKED, and pushes them
 *    30 s forward in the same statement: each open payment is checked every 30 s, oldest-due first,
 *    and several instances never check the same row at once;
 * 3. checks them in parallel.
 * Runs inside the API process for now (docs/architecture.md §2.2).
 */
export type DetectionSweeper = ReturnType<typeof createDetectionSweeper>;

export function createDetectionSweeper(
  prisma: Db,
  detection: DetectionService,
  transitions: PaymentTransitionsService,
  ) {
  const logger = log('detection-sweeper');
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

  /** One pass. Public so tests can drive it. */
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await expireDue();
      const ids = await claimDue();
      await Promise.all(ids.map((id) => detection.check(id)));
    } catch (e) {
      logger.error(e);
    } finally {
      busy = false;
    }
  }

  /** Server-side expiry: never trust a client to say a code expired (docs/detection.md §5). */
  async function expireDue() {
    const due = await prisma.payments.findMany({
      where: { status: { in: ['pending', 'scanned'] }, expires_at: { lt: new Date() } },
      select: { id: true },
      orderBy: { expires_at: 'asc' },
      take: EXPIRE_BATCH,
    });
    for (const { id } of due) await transitions.expire(id); // guarded: a second instance is a no-op
  }

  async function claimDue(): Promise<number[]> {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      UPDATE payments
         SET next_check_at = now() + make_interval(secs => ${RECHECK_SECONDS})
       WHERE id IN (
             SELECT id FROM payments
              WHERE status IN ('pending', 'scanned', 'expired', 'superseded')
                AND detection_closed_at IS NULL
                AND next_check_at <= now()
              ORDER BY next_check_at, id
              LIMIT ${BATCH}
                FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    return rows.map((r) => r.id);
  }

  return { start, stop, tick };
}
