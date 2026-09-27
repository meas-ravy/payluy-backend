import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { accounts } from '../generated/prisma/client';
import { env } from '../lib/env';
import { forbidden, unauthorized } from '../lib/errors';
import { sha256 } from '../lib/ids';
import type { Db } from '../lib/prisma';
import { SessionService } from '../modules/auth/session.service';

export type AuthedRequest = Request & { account?: accounts };

const BEARER = /^Bearer (ck_live_[A-Za-z0-9_-]{32})$/;
const LAST_USED_EVERY_MS = 60_000;

/** The account a route runs for; only call it behind one of the middlewares below. */
export const currentAccount = (req: Request): accounts => (req as AuthedRequest).account!;

/**
 * Management API auth: `Authorization: Bearer ck_live_…` **or** the dashboard session cookie
 * (docs/api.md § Management API). A request that sends a Bearer header is judged on the key only.
 */
export function accountAuth(prisma: Db, sessions: SessionService): RequestHandler {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    try {
      const account = req.headers.authorization
        ? await byKey(prisma, req.headers.authorization)
        : await sessions.account(req);
      req.account = checkStatus(account, 'unauthorized');
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Session-only routes (`/v1/account`, `/v1/billing/*`): an API key is not accepted there. */
export function sessionAuth(sessions: SessionService): RequestHandler {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    try {
      req.account = checkStatus(await sessions.account(req), 'invalid_session');
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * `/internal/*`: only the dashboard's Next.js server, with `Authorization: Bearer <INTERNAL_API_SECRET>`.
 * Refuses to boot on a missing, short or placeholder secret (same rule as SESSION_SECRET).
 */
export function internalAuth(): RequestHandler {
  const secret = env.internalApiSecret;
  if (secret.length < 32 || /change|example|placeholder|secret/i.test(secret)) {
    throw new Error('INTERNAL_API_SECRET must be a random string of 32+ chars (e.g. openssl rand -base64 48)');
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  return (req: Request, _res: Response, next: NextFunction) => {
    const given = Buffer.from(req.headers.authorization ?? '');
    const ok = given.length === expected.length && timingSafeEqual(given, expected);
    next(ok ? undefined : unauthorized('unauthorized'));
  };
}

async function byKey(prisma: Db, header: string): Promise<accounts | null> {
  const raw = BEARER.exec(header)?.[1];
  if (!raw) return null;
  const key = await prisma.api_keys.findUnique({ where: { key_hash: sha256(raw) }, include: { account: true } });
  if (!key || key.status !== 'active') return null;
  if (!key.last_used_at || Date.now() - key.last_used_at.getTime() > LAST_USED_EVERY_MS) {
    await prisma.api_keys.update({ where: { id: key.id }, data: { last_used_at: new Date() } });
  }
  return key.account;
}

/** Missing → 401 `<code>`; suspended → 403 `account_suspended`; closed → 401 `<code>`. */
function checkStatus(account: accounts | null, code: string): accounts {
  if (account?.status === 'suspended') throw forbidden('account_suspended');
  if (!account || account.status !== 'active') throw unauthorized(code);
  return account;
}
