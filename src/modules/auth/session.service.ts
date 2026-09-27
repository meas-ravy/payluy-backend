import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { accounts } from '../../generated/prisma/client';
import type { Db } from '../../lib/prisma';

export const SESSION_COOKIE = 'session';
/** ponytail: stateless 30-day JWT; sign-out only drops it on the dashboard side, add a revocation table if needed. */
export const SESSION_TTL_SEC = 30 * 24 * 3600;
const HEADER = b64({ alg: 'HS256', typ: 'JWT' });

/**
 * Dashboard session: a signed JWT (HS256, `SESSION_SECRET`), issued to the dashboard's Next.js server
 * at sign-in (POST /internal/auth/google) and sent back by it as the `session` cookie on every call
 * it forwards (docs/api.md § Auth). The browser never sees it.
 */
export type SessionService = ReturnType<typeof createSessionService>;

export function createSessionService(prisma: Db) {
  // docs/architecture.md: refuse to boot on an empty or default session secret
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32 || /change|example|placeholder|secret/i.test(secret)) {
    throw new Error('SESSION_SECRET must be a random string of 32+ chars (e.g. openssl rand -base64 48)');
  }

  function sign(accountId: number): string {
    const now = Math.floor(Date.now() / 1000);
    const body = `${HEADER}.${b64({ sub: String(accountId), iat: now, exp: now + SESSION_TTL_SEC })}`;
    return `${body}.${hmac(body)}`;
  }

  /** The account id inside a valid, unexpired token; otherwise null. */
  function verify(token: string): number | null {
    const [header, payload, sig] = token.split('.');
    if (header !== HEADER || !payload || !sig) return null;
    const expected = Buffer.from(hmac(`${header}.${payload}`));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: unknown; exp?: unknown };
      const id = Number(claims.sub);
      if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now() || !Number.isSafeInteger(id)) return null;
      return id;
    } catch {
      return null;
    }
  }

  /** The account behind the request's session cookie, or null. Status checks are the guard's job. */
  async function account(req: Request): Promise<accounts | null> {
    const token = readCookie(req, SESSION_COOKIE);
    const id = token ? verify(token) : null;
    return id === null ? null : prisma.accounts.findUnique({ where: { id } });
  }

  function hmac(data: string) {
    return createHmac('sha256', secret).update(data).digest('base64url');
  }

  return { sign, verify, account };
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function b64(obj: object) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
