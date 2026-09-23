import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { badRequest } from '../../lib/errors';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, SessionService, readCookie } from './session.service';

const STATE_COOKIE = 'oauth_state';
const STATE_PATH = '/auth/google';
const dashboardUrl = () => `${(process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}/dashboard`;

/** docs/api.md § Auth (browser). HTTP only. */
export function authController(auth: AuthService, sessions: SessionService): Router {
  const r = Router();

  r.get('/google/login', (_req, res) => {
    // CSRF protection for the callback: a one-time state echoed back by Google
    const state = randomBytes(24).toString('base64url');
    const url = auth.googleLoginUrl(state);
    res.cookie(STATE_COOKIE, state, { ...sessions.cookieOptions(10 * 60_000), path: STATE_PATH });
    res.redirect(302, url);
  });

  r.get('/google/callback', async (req, res) => {
    const { code, state } = req.query;
    const expected = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
    if (typeof code !== 'string' || typeof state !== 'string' || !expected || !sameString(state, expected)) {
      throw badRequest('invalid_oauth_state');
    }
    const account = await auth.signInWithGoogle(code);
    res.cookie(SESSION_COOKIE, sessions.sign(account.id), sessions.cookieOptions());
    res.redirect(302, dashboardUrl());
  });

  r.post('/logout', (_req, res) => {
    const { maxAge: _, ...opts } = sessions.cookieOptions();
    res.clearCookie(SESSION_COOKIE, opts);
    res.status(204).end();
  });

  return r;
}

function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
