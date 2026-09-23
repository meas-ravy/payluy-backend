import { Prisma, type accounts } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Db } from '../../lib/prisma';
import { UpdateMeDto } from './accounts.schema';
import { TERMS_VERSION } from './accounts.view';
import { badRequest, conflict } from '../../lib/errors';

export type AccountsService = ReturnType<typeof createAccountsService>;

export function createAccountsService(
  prisma: Db,
  audit: AuditService,
  ) {
  async function update(account: accounts, dto: UpdateMeDto): Promise<accounts> {
    const data = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.email !== undefined && { email: dto.email.toLowerCase() }),
    };
    if (!Object.keys(data).length) return account;
    try {
      return await prisma.$transaction(async (tx) => {
        const updated = await tx.accounts.update({ where: { id: account.id }, data });
        await audit.record(tx, { actorId: account.id, action: 'account.updated', targetType: 'account', targetId: account.id, details: { fields: Object.keys(data) } });
        return updated;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw badRequest('email_already_taken');
      throw e;
    }
  }

  /** Only the current version can be accepted; accepting it again is a no-op. */
  async function acceptTerms(account: accounts, version: string): Promise<accounts> {
    if (version !== TERMS_VERSION) throw conflict('terms_version_superseded');
    if (account.terms_accepted_version === version) return account;
    return prisma.$transaction(async (tx) => {
      const updated = await tx.accounts.update({
        where: { id: account.id },
        data: { terms_accepted_version: version, terms_accepted_at: new Date() },
      });
      await audit.record(tx, { actorId: account.id, action: 'account.terms_accepted', targetType: 'account', targetId: account.id, details: { version } });
      return updated;
    });
  }

  return { update, acceptTerms };
}
