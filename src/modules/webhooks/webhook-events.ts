import type { payments, stores } from '../../generated/prisma/client';
import { formatCents } from '../../lib/money';

export const WEBHOOK_EVENT_TYPES = [
  'payment.completed',
  'payment.scanned',
  'payment.expired',
  'payment.failed',
  'payment.superseded',
  'payment.reversed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Only the two money-moving events may be booked (docs/api.md § Reporting contract). */
const FINANCIAL = new Set<WebhookEventType>(['payment.completed', 'payment.reversed']);

/** `events: null` (or `["*"]`, stored as null) = every event. */
export const isSubscribed = (events: unknown, type: string) =>
  events === null || (Array.isArray(events) && events.includes(type));

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * The event body, stored in `events.payload` and signed as sent (docs/api.md § Webhooks).
 * `store` + `merchant` come from docs/pos-provider-integration.md §5 (POS routes on merchant.external_id).
 */
export function buildEventPayload(id: string, type: WebhookEventType, p: payments & { store: stores }) {
  return {
    id,
    type,
    created: new Date().toISOString(),
    financial: FINANCIAL.has(type),
    data: {
      payment: {
        id: p.public_id,
        status: p.status,
        amount: formatCents(p.amount_cents),
        currency: p.currency,
        reference_id: p.reference_id,
        metadata: p.metadata,
        approved_at: iso(p.paid_at),
        created_at: p.created_at.toISOString(),
        expires_at: p.expires_at.toISOString(),
        paid_at: iso(p.paid_at),
        reversed_at: iso(p.reversed_at),
        settled_late: !!p.paid_at && p.paid_at > p.expires_at,
      },
      store: {
        id: p.store.public_id,
        name: p.store.name,
        redirect_success_url: p.store.redirect_success_url,
      },
      merchant: { external_id: p.store.external_id },
    },
  };
}
