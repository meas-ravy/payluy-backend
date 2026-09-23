import { Router, type RequestHandler } from 'express';
import { currentAccount } from '../../middleware/auth';
import { body, query } from '../../middleware/validate';
import { createWebhookSchema, deliveriesQuerySchema, updateWebhookSchema } from './webhooks.schema';
import { toDeliveryResponse, toWebhookResponse } from './webhooks.view';
import { WebhooksService } from './webhooks.service';

/** docs/api.md § Webhook endpoints. HTTP only. */
export function webhooksController(webhooks: WebhooksService, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth);

  r.get('/', async (req, res) => {
    res.json((await webhooks.list(currentAccount(req))).map(toWebhookResponse));
  });

  r.post('/', async (req, res) => {
    const { endpoint, secret } = await webhooks.create(currentAccount(req), body(createWebhookSchema, req));
    res.status(201).json({ ...toWebhookResponse(endpoint), signing_secret: secret }); // shown once
  });

  r.patch('/:id', async (req, res) => {
    res.json(toWebhookResponse(await webhooks.update(currentAccount(req), req.params.id, body(updateWebhookSchema, req))));
  });

  r.delete('/:id', async (req, res) => {
    res.json(toWebhookResponse(await webhooks.remove(currentAccount(req), req.params.id)));
  });

  r.post('/:id/rotate-secret', async (req, res) => {
    res.json(await webhooks.rotateSecret(currentAccount(req), req.params.id));
  });

  r.post('/:id/test', async (req, res) => {
    res.json(await webhooks.sendTest(currentAccount(req), req.params.id));
  });

  r.get('/:id/deliveries', async (req, res) => {
    const { limit } = query(deliveriesQuerySchema, req);
    res.json((await webhooks.deliveries(currentAccount(req), req.params.id, limit)).map(toDeliveryResponse));
  });

  return r;
}
