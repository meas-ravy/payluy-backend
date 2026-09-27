import { Router, type RequestHandler } from 'express';
import { body } from '../../middleware/validate';
import { googleIdentitySchema } from './auth.schema';
import { AuthService } from './auth.service';
import { SESSION_TTL_SEC, SessionService } from './session.service';

/**
 * `POST /internal/auth/google` (docs/api.md § Auth): called only by the dashboard's Next.js server
 * (NextAuth sign-in), behind `internalAuth`. Returns the backend session token the dashboard then
 * sends as the `session` cookie on every call it forwards. HTTP only.
 */
export function authController(auth: AuthService, sessions: SessionService, internal: RequestHandler): Router {
  const r = Router();
  r.use(internal);

  r.post('/google', async (req, res) => {
    const account = await auth.signInWithGoogle(body(googleIdentitySchema, req));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ account_id: account.id, session_token: sessions.sign(account.id), expires_in: SESSION_TTL_SEC });
  });

  return r;
}
