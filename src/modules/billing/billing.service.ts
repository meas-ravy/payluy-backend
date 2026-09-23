import type { plans } from '../../generated/prisma/client';
import type { Db } from '../../lib/prisma';

const MAX = Number.MAX_SAFE_INTEGER;
const UNLIMITED: plans = {
  id: 0,
  code: 'unlimited',
  name: 'Unlimited',
  monthly_fee_cents: 0,
  payments_included: MAX,
  max_stores: null, // null = unlimited
  max_keys: MAX,
  max_webhooks: MAX,
  csv_export_enabled: true,
  is_active: true,
};

export type BillingService = ReturnType<typeof createBillingService>;

export function createBillingService(prisma: Db) {

  /**
   * The account's current plan. Plans are parked (AGENTS.md "Pending"): every account is unlimited,
   * so no store/key/webhook limit, payment quota or CSV gate applies.
   * To enforce again: the latest trial/active plan_subscriptions row's plan, else the `free` plan.
   */
  function currentPlan(_accountId: number): Promise<plans> {
    return Promise.resolve(UNLIMITED);
  }

  /** Active plans, cheapest first (`GET /v1/billing/plans`). */
  function activePlans(): Promise<plans[]> {
    return prisma.plans.findMany({ where: { is_active: true }, orderBy: [{ monthly_fee_cents: 'asc' }, { id: 'asc' }] });
  }

  /** Quota usage: `paid` payments whose paid_at falls in the current UTC calendar month, all stores pooled. */
  function paidThisMonth(accountId: number): Promise<number> {
    const now = new Date();
    return prisma.payments.count({
      where: {
        status: 'paid',
        paid_at: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) },
        store: { account_id: accountId },
      },
    });
  }

  return { currentPlan, activePlans, paidThisMonth };
}
