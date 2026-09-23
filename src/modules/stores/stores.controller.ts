import { Router, type RequestHandler } from 'express';
import { currentAccount } from '../../middleware/auth';
import { body } from '../../middleware/validate';
import { createStoreSchema, linkSchema, updateStoreSchema } from './stores.schema';
import { toStoreResponse } from './stores.view';
import { StoresService } from './stores.service';

/** docs/api.md § Stores. HTTP only: validate, call the service, shape the response. */
export function storesController(stores: StoresService, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth);

  r.post('/', async (req, res) => {
    res.status(201).json(toStoreResponse(await stores.create(currentAccount(req), body(createStoreSchema, req))));
  });

  r.get('/', async (req, res) => {
    res.json({ data: (await stores.list(currentAccount(req))).map(toStoreResponse) });
  });

  r.get('/:id', async (req, res) => {
    res.json(toStoreResponse(await stores.get(currentAccount(req), req.params.id)));
  });

  r.patch('/:id', async (req, res) => {
    res.json(toStoreResponse(await stores.update(currentAccount(req), req.params.id, body(updateStoreSchema, req))));
  });

  r.put('/:id/link', async (req, res) => {
    res.json(toStoreResponse(await stores.setLink(currentAccount(req), req.params.id, body(linkSchema, req))));
  });

  r.post('/:id/disable', async (req, res) => {
    res.json(toStoreResponse(await stores.disable(currentAccount(req), req.params.id)));
  });

  r.post('/:id/enable', async (req, res) => {
    res.json(toStoreResponse(await stores.enable(currentAccount(req), req.params.id)));
  });

  return r;
}
