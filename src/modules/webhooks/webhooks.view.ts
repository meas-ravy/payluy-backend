import type { event_deliveries, webhook_endpoints } from '../../generated/prisma/client';

/** The endpoint object of docs/api.md. Never contains the signing secret (hard rule 6). */
export function toWebhookResponse(e: webhook_endpoints) {
  return {
    id: e.id,
    url: e.url,
    events: e.events,
    status: e.status,
    created_at: e.created_at.toISOString(),
    updated_at: e.updated_at.toISOString(),
  };
}

export function toDeliveryResponse(d: event_deliveries & { event: { type: string } }) {
  return {
    delivery_id: d.id,
    event_id: d.event_id,
    event_type: d.event.type,
    status: d.status,
    http_status: d.last_response_status,
    attempt_count: d.attempts,
    last_error: d.last_error,
    created_at: d.created_at.toISOString(),
    updated_at: d.updated_at.toISOString(),
  };
}
