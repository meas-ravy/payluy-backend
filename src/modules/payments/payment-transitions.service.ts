import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Db } from '../../lib/prisma';
import { WebhookOutboxService } from '../webhooks/webhook-outbox.service';
import type { WebhookEventType } from '../webhooks/webhook-events';
import { log } from '../../lib/log';

type Tx = Prisma.TransactionClient;

/** Statuses detection still polls (AGENTS.md: keep polling expired and superseded). */
export const DETECTABLE = ['pending', 'scanned', 'expired', 'superseded'];

/**
 * Every payment status change lives here (docs/detection.md §5).
 * Each one: guarded `updateMany({ where: { id, status: <expected> } })` + `count` check (hard rule 3),
 * and the webhook event written in the SAME transaction (hard rule 4). A second run is a no-op.
 */
export type PaymentTransitionsService = ReturnType<typeof createPaymentTransitionsService>;

export function createPaymentTransitionsService(
  prisma: Db,
  outbox: WebhookOutboxService,
  audit: AuditService,
  ) {
  const logger = log('payments');

  /** pending → scanned (customer is confirming in their bank app). */
  function markScanned(paymentId: number) {
    return transition(paymentId, ['pending'], 'scanned', 'payment.scanned', { scanned_at: new Date() });
  }

  /** pending | scanned → failed: only on a failure the rail confirmed. Detection stops. */
  function markFailed(paymentId: number) {
    const now = new Date();
    return transition(paymentId, ['pending', 'scanned'], 'failed', 'payment.failed', { detection_closed_at: now });
  }

  /** pending | scanned → expired at `expires_at`. NOT terminal: detection keeps polling for 1 h. */
  function expire(paymentId: number) {
    return transition(paymentId, ['pending', 'scanned'], 'expired', 'payment.expired', {});
  }

  /**
   * Any detectable status → paid (docs/architecture.md §3 step 7), in ONE transaction:
   * status + paid_at + bank_ref, usage-ledger row, retire the other codes of the sale, outbox event.
   * `expired → paid` is normal: ABA accepted a payment 9.5 min after its code expired.
   */
  async function markPaid(paymentId: number, bankRef: string | null): Promise<boolean> {
    const paid = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.payments.updateMany({
        where: { id: paymentId, status: { in: DETECTABLE } },
        data: { status: 'paid', paid_at: now, bank_ref: bankRef, detection_closed_at: now },
      });
      if (count !== 1) return null; // already paid / reversed / failed: nothing to do

      const p = await tx.payments.findUniqueOrThrow({ where: { id: paymentId }, include: { store: true } });

      // usage log; the unique (period_month, resource_type, resource_id) makes a retry unable to double-count
      await tx.plan_ledger_entries.create({
        data: {
          account_id: p.store.account_id,
          period_month: now.toISOString().slice(0, 7),
          resource_type: 'payment',
          resource_id: p.public_id,
          amount_cents_delta: p.amount_cents,
        },
      });

      // every other code of this sale must stop being payable (launch-checklist: "No double payable code").
      // A sale = its root payment + all reissues (reissue always links to the root, so one level).
      const root = p.reissued_from_id ?? p.id;
      const others = await tx.payments.findMany({
        where: { OR: [{ id: root }, { reissued_from_id: root }], id: { not: p.id }, status: { in: ['pending', 'scanned', 'expired'] } },
        select: { id: true, status: true },
      });
      for (const o of others) {
        await transitionIn(tx, o.id, [o.status], 'superseded', 'payment.superseded', {});
      }

      await outbox.record(tx, 'payment.completed', p);
      return p;
    });
    if (paid) await alertIfDoubleCharged(paid.id, paid.reissued_from_id ?? paid.id);
    return !!paid;
  }

  /**
   * paid → reversed: RECORDS a refund the merchant made in their bank (hard rule 1: we move no money).
   * `paid_at` stays, `reversed_at` is added; a negative ledger row; `payment.reversed`; audit row.
   * Returns false when the payment was not `paid` at that moment.
   */
  async function reverse(paymentId: number, actorId: number, reason: string | null): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.payments.updateMany({
        where: { id: paymentId, status: 'paid' },
        data: { status: 'reversed', reversed_at: now, reversal_reason: reason },
      });
      if (count !== 1) return false;
      const p = await tx.payments.findUniqueOrThrow({ where: { id: paymentId }, include: { store: true } });
      await tx.plan_ledger_entries.create({
        data: {
          account_id: p.store.account_id,
          period_month: now.toISOString().slice(0, 7),
          resource_type: 'payment_reversal',
          resource_id: p.public_id,
          amount_cents_delta: -p.amount_cents,
        },
      });
      await outbox.record(tx, 'payment.reversed', p);
      await audit.record(tx, {
        actorId,
        action: 'payment.reversed',
        targetType: 'payment',
        targetId: p.id,
        details: { reason },
      });
      return true;
    });
  }

  // ---- internals ----

  function transition(
    paymentId: number,
    from: string[],
    to: string,
    event: WebhookEventType,
    extra: Prisma.paymentsUpdateManyMutationInput,
  ) {
    return prisma.$transaction((tx) => transitionIn(tx, paymentId, from, to, event, extra));
  }

  async function transitionIn(
    tx: Tx,
    paymentId: number,
    from: string[],
    to: string,
    event: WebhookEventType,
    extra: Prisma.paymentsUpdateManyMutationInput,
  ): Promise<boolean> {
    const { count } = await tx.payments.updateMany({
      where: { id: paymentId, status: { in: from } },
      data: { ...extra, status: to },
    });
    if (count !== 1) return false; // someone else moved it first
    const p = await tx.payments.findUniqueOrThrow({ where: { id: paymentId }, include: { store: true } });
    await outbox.record(tx, event, p);
    return true;
  }

  /**
   * Two codes of the same sale BOTH paid = the customer paid twice. We never move money, so we can't
   * fix it; the merchant refunds. Surface it loudly.
   * ponytail: a log line until Telegram operator alerts exist (observability).
   */
  async function alertIfDoubleCharged(paymentId: number, root: number) {
    const related = await prisma.payments.findMany({
      where: { status: 'paid', id: { not: paymentId }, OR: [{ id: root }, { reissued_from_id: root }] },
      select: { public_id: true },
    });
    if (related.length) {
      logger.error(`double_charge: payment ${paymentId} paid alongside ${related.map((r) => r.public_id).join(', ')}`);
    }
  }

  return { markScanned, markFailed, expire, markPaid, reverse };
}
