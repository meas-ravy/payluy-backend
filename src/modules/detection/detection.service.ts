import type { Prisma } from '../../generated/prisma/client';
import { DETECTABLE, PaymentTransitionsService } from '../payments/payment-transitions.service';
import { PaywayGateway, type HostedSession, type HostedStatus } from '../payway/payway.gateway';
import type { Db } from '../../lib/prisma';
import { log } from '../../lib/log';

export const DETECTION_WINDOW_MS = 3600 * 1000; // AGENTS.md pinned: window 3600 s

/** The ABA session saved at mint (payments.service.ts); gone once retention purges it. */
function sessionOf(raw: Prisma.JsonValue | null): HostedSession | null {
  const s = (raw as { paywayHosted?: Partial<HostedSession> } | null)?.paywayHosted;
  return s?.clientId && s.requestTime && s.token ? (s as HostedSession) : null;
}

/** Asks ABA about one payment and applies the answer (docs/architecture.md §5). */
export type DetectionService = ReturnType<typeof createDetectionService>;

export function createDetectionService(
  prisma: Db,
  payway: PaywayGateway,
  transitions: PaymentTransitionsService,
  ) {
  const logger = log('detection');

  async function check(paymentId: number) {
    const p = await prisma.payments.findUnique({
      where: { id: paymentId },
      select: { id: true, public_id: true, status: true, created_at: true, gateway_status_raw: true, attempt_history: true, detection_closed_at: true },
    });
    if (!p || p.detection_closed_at || !DETECTABLE.includes(p.status)) return;

    // the last check of a payment leaving the 1 h window is its "final" check
    const final = Date.now() >= p.created_at.getTime() + DETECTION_WINDOW_MS;
    const session = sessionOf(p.gateway_status_raw);

    let answer: HostedStatus | null = null;
    let error: string | null = null;
    if (!session) {
      error = 'no_session';
    } else {
      try {
        answer = await payway.fetchHostedStatus(session);
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
      }
    }

    // every poll is recorded; always a NEW array (hard rule 7). Never the token (hard rule 6).
    const history = Array.isArray(p.attempt_history) ? p.attempt_history : [];
    const attempt = { at: new Date().toISOString(), final, action: answer?.action ?? null, error };
    await prisma.payments.update({ where: { id: p.id }, data: { attempt_history: [...history, attempt] } });

    if (answer?.state === 'paid') await transitions.markPaid(p.id, answer.tran_id);
    else if (answer?.state === 'scanned') await transitions.markScanned(p.id);
    else if (answer?.state === 'failed') await transitions.markFailed(p.id);

    if (final) {
      await prisma.payments.updateMany({
        where: { id: p.id, detection_closed_at: null },
        data: { detection_closed_at: new Date() },
      });
      // ponytail: a log line until Telegram operator alerts exist (observability)
      if (error) logger.error(`detection_unknown_outcome: payment ${p.public_id} closed without an answer (${error})`);
    }
  }

  return { check };
}
