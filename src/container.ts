import { createDb, type Db } from './lib/prisma';
import { createAccountsService } from './modules/accounts/accounts.service';
import { createAuditService } from './modules/audit/audit.service';
import { createAuthService } from './modules/auth/auth.service';
import { createSessionService } from './modules/auth/session.service';
import { createBillingService } from './modules/billing/billing.service';
import { createCheckoutService } from './modules/checkout/checkout.service';
import { createDetectionService } from './modules/detection/detection.service';
import { createKeysService } from './modules/keys/keys.service';
import { createKhqrService } from './modules/khqr/khqr.service';
import { createPaymentTransitionsService } from './modules/payments/payment-transitions.service';
import { createPaymentsService } from './modules/payments/payments.service';
import { PaywayHttpGateway } from './modules/payway/payway-http.gateway';
import type { PaywayGateway } from './modules/payway/payway.gateway';
import { createReportsService } from './modules/reports/reports.service';
import { createStoresService } from './modules/stores/stores.service';
import { createWebhookOutboxService } from './modules/webhooks/webhook-outbox.service';
import { createWebhooksService } from './modules/webhooks/webhooks.service';
import { createDetectionSweeper } from './jobs/detection-sweeper';
import { createWebhookSender } from './jobs/webhook-sender';

export type Container = ReturnType<typeof buildContainer>;

/** The whole object graph, built once, in dependency order. Nothing else calls a `create*` factory. */
export function buildContainer(db: Db = createDb()) {
  const audit = createAuditService();
  const billing = createBillingService(db);
  const sessions = createSessionService(db);
  const auth = createAuthService(db, audit);
  const accounts = createAccountsService(db, audit);

  const payway: PaywayGateway = new PaywayHttpGateway(); // the real ABA calls (hard rule 2)

  const khqr = createKhqrService();
  const outbox = createWebhookOutboxService();
  const transitions = createPaymentTransitionsService(db, outbox, audit);
  const stores = createStoresService(db, payway, billing, audit);
  const payments = createPaymentsService(db, stores, billing, payway, transitions, audit);
  const checkout = createCheckoutService(db, khqr);
  const keys = createKeysService(db, billing, audit);
  const webhooks = createWebhooksService(db, billing, audit);
  const reports = createReportsService(db, billing);
  const detection = createDetectionService(db, payway, transitions);

  // background loops (no Redis: Postgres is the queue). server.ts starts and stops them.
  const jobs = [createWebhookSender(db), createDetectionSweeper(db, detection, transitions)];

  return { db, sessions, auth, accounts, billing, stores, payments, checkout, keys, webhooks, reports, khqr, jobs };
}
