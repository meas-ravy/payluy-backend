import { Router, type RequestHandler } from 'express';
import { currentAccount } from '../../middleware/auth';
import { body } from '../../middleware/validate';
import { createKeySchema } from './keys.schema';
import { toKeyResponse } from './keys.view';
import { KeysService } from './keys.service';

/** docs/api.md § API keys. HTTP only. */
export function keysController(keys: KeysService, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth);

  r.get('/', async (req, res) => {
    res.json((await keys.list(currentAccount(req))).map((k) => toKeyResponse(k)));
  });

  r.post('/', async (req, res) => {
    const { key, raw } = await keys.create(currentAccount(req), body(createKeySchema, req).name);
    res.status(201).json(toKeyResponse(key, raw));
  });

  r.post('/:id/revoke', async (req, res) => {
    res.json(toKeyResponse(await keys.revoke(currentAccount(req), req.params.id)));
  });

  r.post('/:id/rotate', async (req, res) => {
    const { key, raw } = await keys.rotate(currentAccount(req), req.params.id);
    res.json(toKeyResponse(key, raw));
  });

  return r;
}
