import type { accounts } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Db } from '../../lib/prisma';
import { unauthorized, unavailable } from '../../lib/errors';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

type GoogleIdentity = { sub: string; email: string; name: string };

/** Google OAuth (authorization-code flow) for the dashboard (docs/api.md § Auth). */
export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(
  prisma: Db,
  audit: AuditService,
  ) {
  function googleLoginUrl(state: string): string {
    const { clientId } = config();
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `${GOOGLE_AUTH}?${q}`;
  }

  /** Exchanges the code, then finds or creates the account (created on first sign-in). */
  async function signInWithGoogle(code: string): Promise<accounts> {
    const who = await exchange(code);

    return prisma.$transaction(async (tx) => {
      const bySub = await tx.accounts.findUnique({ where: { google_sub: who.sub } });
      if (bySub) return bySub;

      const byEmail = await tx.accounts.findUnique({ where: { email: who.email } });
      if (byEmail) {
        // same verified email, but already tied to another Google identity: don't take it over
        if (byEmail.google_sub) throw unauthorized('unauthorized');
        const linked = await tx.accounts.update({ where: { id: byEmail.id }, data: { google_sub: who.sub } });
        await audit.record(tx, { actorId: linked.id, action: 'account.google_linked', targetType: 'account', targetId: linked.id });
        return linked;
      }

      const created = await tx.accounts.create({ data: { email: who.email, name: who.name, google_sub: who.sub } });
      await audit.record(tx, { actorId: created.id, action: 'account.created', targetType: 'account', targetId: created.id, details: { auth_method: 'google' } });
      return created;
    });
  }

  /**
   * The id_token comes straight from Google's token endpoint over TLS, authenticated by our client
   * secret, so its signature needs no separate check; the claims are still validated.
   */
  async function exchange(code: string): Promise<GoogleIdentity> {
    const { clientId, clientSecret } = config();
    let res: Response;
    try {
      res = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw unavailable('google_unavailable');
    }
    const body = (await res.json().catch(() => ({}))) as { id_token?: string };
    if (!res.ok || !body.id_token) throw unauthorized('unauthorized');

    let c: Record<string, unknown>;
    try {
      c = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
    } catch {
      throw unauthorized('unauthorized');
    }
    const ok =
      GOOGLE_ISSUERS.includes(c.iss as string) &&
      c.aud === clientId &&
      typeof c.exp === 'number' && c.exp * 1000 > Date.now() &&
      typeof c.sub === 'string' &&
      typeof c.email === 'string' && c.email_verified === true;
    if (!ok) throw unauthorized('unauthorized');

    const email = (c.email as string).toLowerCase();
    const name = (typeof c.name === 'string' && c.name.trim() ? c.name.trim() : email.split('@')[0]).slice(0, 120);
    return { sub: c.sub as string, email, name };
  }

  return { googleLoginUrl, signInWithGoogle };
}

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw unavailable('google_oauth_not_configured');
  return { clientId, clientSecret };
}

const redirectUri = () => `${(process.env.PUBLIC_ORIGIN ?? 'http://localhost:3001').replace(/\/+$/, '')}/auth/google/callback`;
