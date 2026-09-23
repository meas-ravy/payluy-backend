import { Router, type RequestHandler } from 'express';
import { currentAccount } from '../../middleware/auth';
import { notFound } from '../../lib/errors';
import { DEV_ACTIONS, DevService, type DevAction } from './dev.service';

/**
 * `/_dev/*`: not part of the public API (docs/api.md). Mounted only when ENABLE_DEV_GATEWAY=true,
 * and must also be 404'd at nginx in production (docs/launch-checklist.md).
 * POST /_dev/payments/:id/scan | pay | fail
 */
export function devController(dev: DevService, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth);

  r.post('/payments/:id/:action', async (req, res) => {
    const { id, action } = req.params;
    if (!(action in DEV_ACTIONS)) throw notFound('not_found');
    res.json(await dev.simulate(currentAccount(req), id, action as DevAction));
  });

  return r;
}
