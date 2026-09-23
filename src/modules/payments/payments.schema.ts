import { z } from 'zod';
import { intQuery } from '../../lib/zod';

/** Body of `POST /v1/payments` (docs/api.md, docs/pos-provider-integration.md §3). */
export const createPaymentSchema = z.strictObject({
  amount: z
    .number({ error: 'invalid_amount' })
    .refine((n) => Number.isFinite(n), 'invalid_amount')
    .refine((n) => Math.round(n * 100) === Number((n * 100).toFixed(0)), 'invalid_amount')
    .refine((n) => n >= 0.01, 'amount_too_low'),

  reference_id: z.string().max(255).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(), // shape not validated (docs/api.md § Quota)
  idempotency_key: z.string().max(255).nullish(),

  // target: merchant (external_id) → store (public id) → the single active store
  merchant: z.string().optional(),
  store: z.string().optional(),

  hosted_qr: z.boolean().optional(), // default true
});

export type CreatePaymentDto = z.infer<typeof createPaymentSchema>;

export const PAYMENT_STATUSES = ['pending', 'scanned', 'paid', 'expired', 'superseded', 'reversed', 'failed'] as const;

/** Query of `GET /v1/payments`: `?store=` or `?merchant=`, `?status=`, `?limit=` (default 20, max 100). */
export const listPaymentsSchema = z.object({
  merchant: z.string().optional(),
  store: z.string().optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  limit: intQuery(1, 100).default(20),
});

export type ListPaymentsQuery = z.infer<typeof listPaymentsSchema>;

/** Body of `POST /v1/payments/:id/reverse`. `reason` is optional, and worth supplying (docs/api.md). */
export const reversePaymentSchema = z.strictObject({ reason: z.string().max(255).nullish() });

export type ReversePaymentDto = z.infer<typeof reversePaymentSchema>;
