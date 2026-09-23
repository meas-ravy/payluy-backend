import { createHash } from 'node:crypto';
import { Prisma, type accounts, type payments } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { newPaymentId } from '../../lib/ids';
import { formatCents, toCents } from '../../lib/money';
import { PaywayGateway, type HostedCheckout } from '../payway/payway.gateway';
import type { Db } from '../../lib/prisma';
import { StoresService } from '../stores/stores.service';
import type { CreatePaymentDto } from './payments.schema';
import type { ListPaymentsQuery } from './payments.schema';
import { PaymentTransitionsService } from './payment-transitions.service';
import { badGateway, badRequest, conflict, notFound, paymentRequired, unprocessable } from '../../lib/errors';

const MAX_CENTS = 2_147_483_647; // amount_cents is a Postgres int

export type PaymentsService = ReturnType<typeof createPaymentsService>;

export function createPaymentsService(
  prisma: Db,
  stores: StoresService,
  billing: BillingService,
  payway: PaywayGateway,
  transitions: PaymentTransitionsService,
  audit: AuditService,
  ) {
  /** Fields a new payment row takes from the request (create) or from the dead payment (reissue). */
  function newPaymentData(
    store: { id: number },
    link: { id: number; currency: string },
    cents: number,
    checkout: HostedCheckout,
    fields: { reference_id: string | null; metadata: Prisma.JsonValue | null; idempotency_key: string | null; reissued_from_id: number | null },
  ): Prisma.paymentsUncheckedCreateInput {
    return {
      public_id: newPaymentId(),
      store_id: store.id,
      payment_link_id: link.id,
      amount_cents: cents,
      currency: link.currency,
      reference_id: fields.reference_id,
      metadata: (fields.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      idempotency_key: fields.idempotency_key,
      reissued_from_id: fields.reissued_from_id,
      status: 'pending',
      qr_string: checkout.qr_string,
      qr_md5: createHash('md5').update(checkout.qr_string).digest('hex'),
      expires_at: new Date(Date.now() + checkout.expire_in_sec * 1000), // ABA's lifetime, not ours
      // the ABA session detection polls with; purged after 90 days (retention)
      gateway_status_raw: {
        paywayHosted: { clientId: checkout.client_id, token: checkout.token, requestTime: checkout.request_time },
      },
    };
  }

  /** Amount rules against the store's link (docs/api.md § POST /v1/payments). */
  function assertAmount(cents: number, link: { min_amount_cents: number; max_amount_cents: number | null }) {
    if (cents < link.min_amount_cents) throw badRequest('amount_too_low');
    if (cents > (link.max_amount_cents ?? MAX_CENTS)) throw badRequest('amount_too_high');
  }

  /** docs/architecture.md §3. `created: false` = idempotent replay (the API answers 200, not 201). */
  async function create(account: accounts, dto: CreatePaymentDto): Promise<{ payment: payments; created: boolean }> {
    // an offline code is not payable and nothing here can confirm it (docs/bakong-gateway-notes.md)
    if (dto.hosted_qr === false) throw badRequest('offline_qr_requires_a_confirmation_source');

    const store = await stores.resolveTarget(account, dto);
    const link = store.link; // money destination: always the store's active link at create time

    if (dto.idempotency_key) {
      const existing = await findByIdempotencyKey(store.id, dto.idempotency_key);
      if (existing) return { payment: existing, created: false };
    }

    const cents = toCents(dto.amount);
    if (cents === null) throw unprocessable('invalid_amount');
    assertAmount(cents, link);
    await assertQuota(account.id);

    const checkout = await mint(link.raw_link, formatCents(cents)); // network call: outside any transaction
    try {
      const payment = await prisma.payments.create({
        data: newPaymentData(store, link, cents, checkout, {
          reference_id: dto.reference_id ?? null,
          metadata: (dto.metadata ?? null) as Prisma.JsonValue | null,
          idempotency_key: dto.idempotency_key ?? null,
          reissued_from_id: null,
        }),
      });
      // detection picks it up on its next tick (next_check_at defaults to now)
      return { payment, created: true };
    } catch (e) {
      // same idempotency_key raced in from a parallel retry: hand back the winner
      if (dto.idempotency_key && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await findByIdempotencyKey(store.id, dto.idempotency_key);
        if (winner) return { payment: winner, created: false };
      }
      throw e;
    }
  }

  /**
   * linked to the ROOT payment of the sale so markPaid can retire every other code of it.
   * A live successor is returned as-is (`created: false` → 200) instead of minting another ABA session.
   */
  /**
   * `POST /v1/payments/:id/reissue` (docs/api.md): a fresh code for a sale whose code died.
   * Only from `expired` / `failed`. New row: same amount, reference_id, metadata; no idempotency_key;
   * linked to the ROOT payment of the sale so markPaid can retire every other code of it.
   * A live successor is returned as-is (`created: false` → 200) instead of minting another ABA session.
   */
  async function reissue(account: accounts, publicId: string): Promise<{ payment: payments; created: boolean }> {
    const dead = await get(account, publicId);
    if (dead.status === 'paid') throw conflict('payment_already_paid');
    if (dead.status === 'reversed') throw conflict('payment_reversed');
    if (dead.status !== 'expired' && dead.status !== 'failed') throw conflict('payment_not_expired');

    const root = dead.reissued_from_id ?? dead.id;
    const live = await prisma.payments.findFirst({
      where: { reissued_from_id: root, status: { in: ['pending', 'scanned'] }, expires_at: { gt: new Date() } },
      orderBy: { id: 'desc' },
    });
    if (live) return { payment: live, created: false };

    // same rules as create: the store must still be active with an active link, amount within its bounds
    const { public_id: storePublicId } = await prisma.stores.findUniqueOrThrow({ where: { id: dead.store_id } });
    const store = await stores.resolveTarget(account, { store: storePublicId });
    assertAmount(dead.amount_cents, store.link);
    await assertQuota(account.id);

    // ponytail: two reissues racing can both mint; the second successor is superseded when either is paid
    const checkout = await mint(store.link.raw_link, formatCents(dead.amount_cents));
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payments.create({
        data: newPaymentData(store, store.link, dead.amount_cents, checkout, {
          reference_id: dead.reference_id,
          metadata: dead.metadata,
          idempotency_key: null,
          reissued_from_id: root,
        }),
      });
      await audit.record(tx, {
        actorId: account.id,
        action: 'payment.reissued',
        targetType: 'payment',
        targetId: dead.id,
        details: { new_payment: created.public_id },
      });
      return created;
    });
    return { payment, created: true };
  }

  /** `POST /v1/payments/:id/reverse`: record a refund (docs/api.md). No money moves (hard rule 1). */
  async function reverse(account: accounts, publicId: string, reason: string | null): Promise<payments> {
    const p = await get(account, publicId);
    if (p.status === 'reversed') throw conflict('payment_already_reversed');
    if (p.status !== 'paid') throw conflict('payment_not_paid');
    if (!(await transitions.reverse(p.id, account.id, reason))) {
      // lost a race: someone reversed it between our read and the guarded update
      throw conflict('payment_already_reversed');
    }
    return get(account, publicId);
  }

  /** Scoped to the caller's account: another account's payment is a 404. */
  async function get(account: accounts, publicId: string): Promise<payments> {
    const payment = await prisma.payments.findFirst({
      where: { public_id: publicId, store: { account_id: account.id } },
    });
    if (!payment) throw notFound('payment_not_found');
    return payment;
  }

  /** Newest first; whole account, or one store by `store` / `merchant`. */
  async function list(account: accounts, q: ListPaymentsQuery) {
    const where: Prisma.paymentsWhereInput = { store: { account_id: account.id } };
    if (q.merchant !== undefined) {
      const store = await prisma.stores.findFirst({ where: { account_id: account.id, external_id: q.merchant } });
      if (!store) throw notFound('merchant_not_found');
      where.store_id = store.id;
    } else if (q.store !== undefined) {
      where.store_id = (await stores.get(account, q.store)).id;
    }
    if (q.status) where.status = q.status;

    return prisma.payments.findMany({
      where,
      include: { store: { select: { public_id: true } } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: q.limit,
    });
  }

  // ---- rules ----

  /** Quota = paid payments this calendar month, pooled across the account's stores. */
  async function assertQuota(accountId: number) {
    const [plan, used] = await Promise.all([
      billing.currentPlan(accountId),
      billing.paidThisMonth(accountId),
    ]);
    if (used >= plan.payments_included) throw paymentRequired('quota_exceeded');
  }

  /** Never hand out a QR nobody can pay: an unusable mint is a 502, not a payment. */
  async function mint(rawLink: string, amount: string): Promise<HostedCheckout> {
    let checkout: HostedCheckout;
    try {
      checkout = await payway.createHostedCheckout(rawLink, amount);
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unknown';
      throw badGateway(`payway_hosted_error: ${reason}`);
    }
    if (!checkout.qr_string || !checkout.client_id || !checkout.token) {
      throw badGateway('payway_hosted_error: incomplete_response');
    }
    return checkout;
  }

  function findByIdempotencyKey(storeId: number, key: string) {
    return prisma.payments.findUnique({
      where: { store_id_idempotency_key: { store_id: storeId, idempotency_key: key } },
    });
  }

  return { create, reissue, reverse, get, list };
}
