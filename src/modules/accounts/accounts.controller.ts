import { Router, type RequestHandler } from 'express';
import { currentAccount } from '../../middleware/auth';
import { body } from '../../middleware/validate';
import { AccountsService } from './accounts.service';
import { acceptTermsSchema } from './accounts.schema';
import { updateMeSchema } from './accounts.schema';
import { toProfile } from './accounts.view';

/** docs/api.md § Account (session only). HTTP only. */
export function accountsController(accounts: AccountsService, sessionOnly: RequestHandler): Router {
  const r = Router();
  r.use(sessionOnly);

  r.get('/', (req, res) => {
    res.json(toProfile(currentAccount(req)));
  });

  r.patch('/', async (req, res) => {
    res.json(toProfile(await accounts.update(currentAccount(req), body(updateMeSchema, req))));
  });

  r.post('/terms', async (req, res) => {
    res.json(toProfile(await accounts.acceptTerms(currentAccount(req), body(acceptTermsSchema, req).version)));
  });

  return r;
}
