import type { Prisma, payments, stores } from '../../generated/prisma/client';
import { newEventId } from '../../lib/ids';
import { buildEventPayload, isSubscribed, type WebhookEventType } from './webhook-events';

/**
 * Outbox writer (AGENTS.md hard rule 4). Call it INSIDE the same `prisma.$transaction` as the payment
 * state change: the event and its deliveries commit or roll back together with it.
 * The sender picks the deliveries up from Postgres. Nothing else to notify: no Redis.
 */
export type WebhookOutboxService = ReturnType<typeof createWebhookOutboxService>;

export function createWebhookOutboxService() {
  async function record(tx: Prisma.TransactionClient, type: WebhookEventType, payment: payments & { store: stores }) {
    const id = newEventId(); // stable across retries: receivers dedupe on it
    await tx.events.create({
      data: {
        id,
        account_id: payment.store.account_id,
        store_id: payment.store_id,
        payment_id: payment.id,
        type,
        payload: buildEventPayload(id, type, payment),
      },
    });

    const endpoints = await tx.webhook_endpoints.findMany({
      where: { account_id: payment.store.account_id, status: 'active' },
      select: { id: true, events: true },
    });
    const targets = endpoints.filter((e) => isSubscribed(e.events, type));
    if (targets.length === 0) return;
    await tx.event_deliveries.createMany({
      data: targets.map((e) => ({ event_id: id, endpoint_id: e.id, status: 'pending', next_attempt_at: new Date() })),
    });
  }

  return { record };
}
