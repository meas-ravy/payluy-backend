import express, { type Express } from 'express';
import { env } from './lib/env';
import type { Container } from './container';
import { accountAuth, sessionAuth } from './middleware/auth';
import { cors } from './middleware/cors';
import { errorHandler, notFoundHandler } from './middleware/error';
import { jobsController } from './jobs/jobs.controller';
import { accountsController } from './modules/accounts/accounts.controller';
import { authController } from './modules/auth/auth.controller';
import { billingController } from './modules/billing/billing.controller';
import { checkoutController } from './modules/checkout/checkout.controller';
import { keysController } from './modules/keys/keys.controller';
import { khqrController } from './modules/khqr/khqr.controller';
import { paymentsController } from './modules/payments/payments.controller';
import { reportsController } from './modules/reports/reports.controller';
import { storesController } from './modules/stores/stores.controller';
import { webhooksController } from './modules/webhooks/webhooks.controller';

/** The HTTP app: middleware, routes, error handler. It never listens, so tests can import it. */
export function buildApp(c: Container): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(cors(env.frontendUrl));

  // Bearer key or session cookie; /v1/me is cookie-only (docs/api.md § Management API)
  const auth = accountAuth(c.db, c.sessions);
  const sessionOnly = sessionAuth(c.sessions);

  app.use('/auth', authController(c.auth, c.sessions));
  app.use('/pay', checkoutController(c.checkout)); // public hosted checkout
  app.use('/v1/khqr', khqrController(c.khqr)); // public renderer
  app.use('/v1/billing', billingController(c.billing)); // plans are public
  app.use('/v1/me', accountsController(c.accounts, sessionOnly));
  app.use('/v1/stores', storesController(c.stores, auth));
  app.use('/v1/payments', paymentsController(c.payments, auth));
  app.use('/v1/keys', keysController(c.keys, auth));
  app.use('/v1/webhooks', webhooksController(c.webhooks, auth));
  app.use('/v1/reports', reportsController(c.reports, auth));

  // serverless hosts can't run the 2 s loops: let a scheduler drive them instead (CRON_SECRET)
  if (env.cronSecret) app.use('/internal', jobsController(c.jobs));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
