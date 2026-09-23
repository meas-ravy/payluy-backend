import { Prisma, type accounts } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { newStoreId } from '../../lib/ids';
import type { Db } from '../../lib/prisma';
import { PAYWAY_LINK, PaywayGateway } from '../payway/payway.gateway';
import type { CreateStoreDto, LinkDto, StoreFieldsDto, UpdateStoreDto } from './stores.schema';
import type { StoreWithLink } from './stores.view';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';

type Tx = Prisma.TransactionClient;
type VerifiedLink = Pick<Prisma.payment_linksUncheckedCreateInput, 'raw_link' | 'merchant_account_id' | 'merchant_name' | 'verified_at'>;

const withLink = { link: true } as const;
const BRANDING = ['brand_color', 'logo_image_url', 'whitelabel_css'] as const;

export type StoresService = ReturnType<typeof createStoresService>;

export function createStoresService(
  prisma: Db,
  payway: PaywayGateway,
  billing: BillingService,
  auditLog: AuditService,
  ) {
  async function mapExternalIdTaken<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      // the only unique constraint a caller can hit on stores is (account_id, external_id)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw conflict('external_id_taken');
      }
      throw e;
    }
  }

  function list(account: accounts): Promise<StoreWithLink[]> {
    return prisma.stores.findMany({ where: { account_id: account.id }, include: withLink, orderBy: { id: 'asc' } });
  }

  /** Scoped to the caller's account: another account's store is a 404, not a 403. */
  async function get(account: accounts, publicId: string): Promise<StoreWithLink> {
    const store = await prisma.stores.findFirst({
      where: { public_id: publicId, account_id: account.id },
      include: withLink,
    });
    if (!store) throw notFound('store_not_found');
    return store;
  }

  async function create(account: accounts, dto: CreateStoreDto): Promise<StoreWithLink> {
    const { link, ...fields } = dto;
    assertBranding(account, fields);
    await assertStoreLimit(account.id);
    const verified = link && (await verifyLink(link)); // network call: keep it outside the transaction

    return mapExternalIdTaken(() =>
      prisma.$transaction(async (tx) => {
        const store = await tx.stores.create({
          data: {
            ...fields,
            public_id: newStoreId(),
            account_id: account.id,
            status: verified ? 'active' : 'draft',
            link: verified ? { create: verified } : undefined,
          },
          include: withLink,
        });
        await audit(tx, account.id, 'store.created', store.id, { link: !!verified });
        return store;
      }),
    );
  }

  async function update(account: accounts, publicId: string, dto: UpdateStoreDto): Promise<StoreWithLink> {
    const store = await get(account, publicId);
    const { link, ...fields } = dto;
    assertBranding(account, fields);
    const verified = link && (await verifyLink(link));

    return mapExternalIdTaken(() =>
      prisma.$transaction(async (tx) => {
        await tx.stores.update({ where: { id: store.id }, data: fields });
        if (verified) await attachLink(tx, account.id, store.id, verified);
        await audit(tx, account.id, 'store.updated', store.id, { fields: presentKeys(fields) });
        return tx.stores.findUniqueOrThrow({ where: { id: store.id }, include: withLink });
      }),
    );
  }

  /** `PUT /v1/stores/:id/link`: attach or replace the link; a `draft` store becomes `active`. */
  async function setLink(account: accounts, publicId: string, dto: LinkDto): Promise<StoreWithLink> {
    const store = await get(account, publicId);
    const verified = await verifyLink(dto);
    return prisma.$transaction(async (tx) => {
      await attachLink(tx, account.id, store.id, verified);
      return tx.stores.findUniqueOrThrow({ where: { id: store.id }, include: withLink });
    });
  }

  /** Stops new payments, keeps history. Idempotent. */
  async function disable(account: accounts, publicId: string): Promise<StoreWithLink> {
    const store = await get(account, publicId);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.stores.updateMany({
        where: { id: store.id, status: { in: ['draft', 'active'] } },
        data: { status: 'disabled' },
      });
      if (count) await audit(tx, account.id, 'store.disabled', store.id);
    });
    return get(account, publicId);
  }

  /** Back to `active` if the store has a link, else `draft`. Idempotent. */
  async function enable(account: accounts, publicId: string): Promise<StoreWithLink> {
    const store = await get(account, publicId);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.stores.updateMany({
        where: { id: store.id, status: 'disabled' },
        data: { status: store.link ? 'active' : 'draft' },
      });
      if (count) await audit(tx, account.id, 'store.enabled', store.id);
    });
    return get(account, publicId);
  }

  /**
   * Which store a payment is for (docs/architecture.md §3, docs/pos-provider-integration.md):
   * `merchant` (external_id) → `store` (public id) → the account's single active store.
   * Returns a store that is `active` and has an `active` link.
   */
  async function resolveTarget(account: accounts, target: { store?: string; merchant?: string }) {
    let store: StoreWithLink | null;
    if (target.merchant !== undefined) {
      store = await prisma.stores.findFirst({
        where: { account_id: account.id, external_id: target.merchant },
        include: withLink,
      });
      if (!store) throw notFound('merchant_not_found');
      if (store.status !== 'active') throw badRequest('merchant_store_disabled');
    } else if (target.store !== undefined) {
      store = await get(account, target.store);
      if (store.status === 'disabled') throw badRequest('store_disabled');
    } else {
      const active = await prisma.stores.findMany({
        where: { account_id: account.id, status: 'active' },
        include: withLink,
        take: 2,
      });
      if (active.length !== 1) throw badRequest('store_required_or_merchant_required');
      store = active[0];
    }
    // a draft store has no link yet
    if (!store.link || store.link.status !== 'active') throw badRequest('payment_link_disabled');
    return { ...store, link: store.link };
  }

  // ---- rules ----

  function assertBranding(account: accounts, fields: StoreFieldsDto) {
    // sending null is allowed without the entitlement (docs/api.md)
    if (!account.whitelabel_enabled && BRANDING.some((k) => fields[k] != null)) {
      throw forbidden('whitelabel_not_enabled');
    }
  }

  // ponytail: count-then-insert, two parallel creates can both pass; lock the account row if that matters
  async function assertStoreLimit(accountId: number) {
    const plan = await billing.currentPlan(accountId);
    if (plan.max_stores === null) return; // unlimited
    const count = await prisma.stores.count({ where: { account_id: accountId } });
    if (count >= plan.max_stores) throw badRequest('store_limit_reached');
  }

  /** Hard rule 10: a link is only stored as verified after the gateway found aba_data on its page. */
  async function verifyLink(link: LinkDto): Promise<VerifiedLink> {
    if (!PAYWAY_LINK.test(link.raw_link) || !(await payway.verifyLink(link.raw_link))) {
      throw badRequest('invalid_payment_link');
    }
    return {
      raw_link: link.raw_link,
      merchant_account_id: link.merchant_account_id,
      merchant_name: link.merchant_name ?? null,
      verified_at: new Date(),
    };
  }

  // ponytail: one link row per store (store_id is unique), so a replacement overwrites it in place;
  // old payments keep pointing at the same row. Keep link history if reports ever need the old one.
  async function attachLink(tx: Tx, actorId: number, storeId: number, link: VerifiedLink) {
    await tx.payment_links.upsert({
      where: { store_id: storeId },
      create: { ...link, store_id: storeId },
      update: { ...link, status: 'active' },
    });
    // guarded: only draft is promoted; a disabled store stays disabled until enabled
    await tx.stores.updateMany({ where: { id: storeId, status: 'draft' }, data: { status: 'active' } });
    await audit(tx, actorId, 'store.link_set', storeId, { merchant_account_id: link.merchant_account_id });
  }

  function audit(tx: Tx, actorId: number, action: string, storeId: number, details?: Prisma.InputJsonObject) {
    return auditLog.record(tx, { actorId, action, targetType: 'store', targetId: storeId, details });
  }

  return { list, get, create, update, setLink, disable, enable, resolveTarget };
}

const presentKeys = (o: object) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
