import { Router, type RequestHandler } from 'express';
import { currentAccount } from '../../middleware/auth';
import { body, query } from '../../middleware/validate';
import { createPaymentSchema } from './payments.schema';
import { listPaymentsSchema } from './payments.schema';
import { reversePaymentSchema } from './payments.schema';
import { toCreatedPayment, toPaymentDetail, toPaymentRow, toPaymentWithCheckout } from './payments.view';
import { PaymentsService } from './payments.service';

/** docs/api.md § POST /v1/payments, § GET /v1/payments(/:id), reissue, reverse. HTTP only. */
export function paymentsController(payments: PaymentsService, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth);

  /** 201 on create, 200 on an idempotent replay. */
  r.post('/', async (req, res) => {
    const { payment, created } = await payments.create(currentAccount(req), body(createPaymentSchema, req));
    res.status(created ? 201 : 200).json(toCreatedPayment(payment));
  });

  r.get('/', async (req, res) => {
    const rows = await payments.list(currentAccount(req), query(listPaymentsSchema, req));
    res.json({ data: rows.map(toPaymentRow) });
  });

  /** 201 with a new code, or 200 with the live successor that already exists. */
  r.post('/:id/reissue', async (req, res) => {
    const { payment, created } = await payments.reissue(currentAccount(req), req.params.id);
    res.status(created ? 201 : 200).json(toPaymentWithCheckout(payment));
  });

  r.post('/:id/reverse', async (req, res) => {
    const { reason } = body(reversePaymentSchema, req);
    res.json(toPaymentWithCheckout(await payments.reverse(currentAccount(req), req.params.id, reason ?? null)));
  });

  r.get('/:id', async (req, res) => {
    res.json(toPaymentDetail(await payments.get(currentAccount(req), req.params.id)));
  });

  return r;
}
