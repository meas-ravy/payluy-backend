import { z } from 'zod';
import { httpsUrl, intQuery } from '../../lib/zod';
import { WEBHOOK_EVENT_TYPES } from './webhook-events';

const events = z.array(z.enum([...WEBHOOK_EVENT_TYPES, '*'])).nonempty().nullish();

/** `POST /v1/webhooks`: `{ url, events? }`, no other fields (docs/api.md § Webhook endpoints). */
export const createWebhookSchema = z.strictObject({ url: httpsUrl(), events });

/** `PATCH /v1/webhooks/:id`. */
export const updateWebhookSchema = z.strictObject({
  url: httpsUrl().optional(),
  events,
  status: z.enum(['active', 'disabled']).optional(),
});

/** `GET /v1/webhooks/:id/deliveries?limit=` (≤ 100). */
export const deliveriesQuerySchema = z.object({ limit: intQuery(1, 100).default(20) });

export type CreateWebhookDto = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookDto = z.infer<typeof updateWebhookSchema>;
