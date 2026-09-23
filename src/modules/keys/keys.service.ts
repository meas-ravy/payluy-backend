import type { Prisma, accounts, api_keys } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { keyPrefix, newApiKey, sha256 } from '../../lib/ids';
import type { Db } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/errors';

type Minted = { key: api_keys; raw: string };

/** API key management (docs/api.md § API keys). Only the sha256 is stored; the raw key is returned once. */
export type KeysService = ReturnType<typeof createKeysService>;

export function createKeysService(
  prisma: Db,
  billing: BillingService,
  audit: AuditService,
  ) {
  function list(account: accounts) {
    return prisma.api_keys.findMany({ where: { account_id: account.id }, orderBy: { id: 'desc' } });
  }

  /** Scoped to the caller's account; non-numeric or foreign id → 404. */
  async function get(account: accounts, id: string): Promise<api_keys> {
    const n = Number(id);
    const key = Number.isSafeInteger(n)
      ? await prisma.api_keys.findFirst({ where: { id: n, account_id: account.id } })
      : null;
    if (!key) throw notFound('key_not_found');
    return key;
  }

  // ponytail: count-then-insert, like the store/webhook limits
  async function create(account: accounts, name: string): Promise<Minted> {
    await assertKeyLimit(account.id);
    return prisma.$transaction(async (tx) => {
      const minted = await mint(tx, account.id, name);
      await audit.record(tx, { actorId: account.id, action: 'key.created', targetType: 'api_key', targetId: minted.key.id, details: { key_prefix: minted.key.key_prefix } });
      return minted;
    });
  }

  /** Idempotent: revoking a revoked key returns it unchanged. A revoked key answers 401 from then on. */
  async function revoke(account: accounts, id: string): Promise<api_keys> {
    const key = await get(account, id);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.api_keys.updateMany({
        where: { id: key.id, status: 'active' },
        data: { status: 'revoked', revoked_at: new Date() },
      });
      if (count) await audit.record(tx, { actorId: account.id, action: 'key.revoked', targetType: 'api_key', targetId: key.id });
    });
    return get(account, id);
  }

  /** New key with the same name; the old one is revoked in the same transaction. */
  async function rotate(account: accounts, id: string): Promise<Minted> {
    const old = await get(account, id);
    if (old.status !== 'active') await assertKeyLimit(account.id); // rotating a revoked key adds an active one
    return prisma.$transaction(async (tx) => {
      await tx.api_keys.updateMany({ where: { id: old.id, status: 'active' }, data: { status: 'revoked', revoked_at: new Date() } });
      const minted = await mint(tx, account.id, old.name ?? 'rotated');
      await audit.record(tx, { actorId: account.id, action: 'key.rotated', targetType: 'api_key', targetId: old.id, details: { new_key_id: minted.key.id } });
      return minted;
    });
  }

  async function mint(tx: Prisma.TransactionClient, accountId: number, name: string): Promise<Minted> {
    const raw = newApiKey();
    const key = await tx.api_keys.create({
      data: { account_id: accountId, name, key_prefix: keyPrefix(raw), key_hash: sha256(raw) },
    });
    return { key, raw };
  }

  /** Keys per plan: Free 1, Starter 3, Pro 10. Counts active keys only. */
  async function assertKeyLimit(accountId: number) {
    const plan = await billing.currentPlan(accountId);
    const active = await prisma.api_keys.count({ where: { account_id: accountId, status: 'active' } });
    if (active >= plan.max_keys) throw badRequest('key_limit_reached');
  }

  return { list, get, create, revoke, rotate };
}
