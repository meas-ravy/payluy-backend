import { Router } from 'express';
import type { plans } from '../../generated/prisma/client';
import { BillingService } from './billing.service';

/** The plan object of docs/api.md § Billing. */
const toPlanResponse = (p: plans) => ({
  code: p.code,
  name: p.name,
  monthly_fee_cents: p.monthly_fee_cents,
  payments_included: p.payments_included,
  max_stores: p.max_stores,
  max_keys: p.max_keys,
  max_webhooks: p.max_webhooks,
  csv_export_enabled: p.csv_export_enabled,
});

/**
 * Only `GET /v1/billing/plans` for now: public (the pricing page calls it unauthenticated).
 * The other /v1/billing/* routes are session-only and wait for the billing feature.
 */
export function billingController(billing: BillingService): Router {
  const r = Router();
  r.get('/plans', async (_req, res) => {
    res.json((await billing.activePlans()).map(toPlanResponse));
  });
  return r;
}
