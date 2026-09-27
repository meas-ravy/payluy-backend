import type { accounts } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Db } from '../../lib/prisma';
import { forbidden, unauthorized } from '../../lib/errors';
import type { GoogleIdentityDto } from './auth.schema';

/**
 * Dashboard sign-in (docs/api.md § Auth). Google OAuth itself runs in the dashboard (NextAuth);
 * this is the account side: find, link or create the account for a verified Google identity.
 */
export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(
  prisma: Db,
  audit: AuditService,
  ) {
  /** Finds or creates the account (created on first sign-in). Only an `active` account signs in. */
  async function signInWithGoogle(dto: GoogleIdentityDto): Promise<accounts> {
    const email = dto.email.toLowerCase();
    const name = (dto.name?.trim() || email.split('@')[0]).slice(0, 120);

    const account = await prisma.$transaction(async (tx) => {
      const bySub = await tx.accounts.findUnique({ where: { google_sub: dto.sub } });
      if (bySub) return bySub;

      const byEmail = await tx.accounts.findUnique({ where: { email } });
      if (byEmail) {
        // same verified email, but already tied to another Google identity: don't take it over
        if (byEmail.google_sub) throw unauthorized('unauthorized');
        const linked = await tx.accounts.update({ where: { id: byEmail.id }, data: { google_sub: dto.sub } });
        await audit.record(tx, { actorId: linked.id, action: 'account.google_linked', targetType: 'account', targetId: linked.id });
        return linked;
      }

      const created = await tx.accounts.create({ data: { email, name, google_sub: dto.sub } });
      await audit.record(tx, { actorId: created.id, action: 'account.created', targetType: 'account', targetId: created.id, details: { auth_method: 'google' } });
      return created;
    });

    // same rule as the API guard (middleware/auth.ts): suspended → 403, closed → 401
    if (account.status === 'suspended') throw forbidden('account_suspended');
    if (account.status !== 'active') throw unauthorized('unauthorized');
    return account;
  }

  return { signInWithGoogle };
}
