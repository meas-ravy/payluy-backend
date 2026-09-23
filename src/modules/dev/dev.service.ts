import type { accounts } from '../../generated/prisma/client';
import { PaymentsService } from '../payments/payments.service';
import { FakePaywayGateway } from '../payway/fake-payway.gateway';
import { PaywayGateway } from '../payway/payway.gateway';
import type { Db } from '../../lib/prisma';
import { notFound } from '../../lib/errors';

export const DEV_ACTIONS = { scan: 'scanned', pay: 'paid', fail: 'failed' } as const;
export type DevAction = keyof typeof DEV_ACTIONS;

/** Dev rail: pretend to be the customer's bank app. Only mounted when ENABLE_DEV_GATEWAY=true. */
export type DevService = ReturnType<typeof createDevService>;

export function createDevService(
  prisma: Db,
  payments: PaymentsService,
  payway: PaywayGateway,
  ) {

  /**
   * Tells the fake ABA what to answer for this payment, then makes it due now, so detection
   * applies it on its next tick (~2 s) through the normal path: markPaid, ledger, webhook.
   */
  async function simulate(account: accounts, paymentId: string, action: DevAction) {
    if (!(payway instanceof FakePaywayGateway)) throw notFound('not_found');
    const payment = await payments.get(account, paymentId);
    const clientId = (payment.gateway_status_raw as { paywayHosted?: { clientId?: string } } | null)?.paywayHosted?.clientId;
    if (!clientId) throw notFound('payment_not_found');

    payway.simulate(clientId, DEV_ACTIONS[action]);
    await prisma.payments.update({ where: { id: payment.id }, data: { next_check_at: new Date() } });
    return { id: payment.public_id, simulated: DEV_ACTIONS[action], note: 'detection applies it within ~2 s' };
  }

  return { simulate };
}
