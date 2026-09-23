import type { Prisma, accounts } from '../../generated/prisma/client';
import { BillingService } from '../billing/billing.service';
import type { Db } from '../../lib/prisma';
import type { ReportQueryDto } from './reports.schema';
import type { ReportPayment } from './reports.view';
import { badRequest, forbidden, notFound } from '../../lib/errors';

const CSV_BATCH = 500;
const withStore = { store: { select: { public_id: true, name: true, external_id: true } } } as const;

/** `YYYY-MM-DD` → UTC midnight, or 400 invalid_date. Rejects impossible dates like 2026-02-30. */
function parseDay(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw badRequest('invalid_date');
  }
  return d;
}

/** docs/api.md § Reports. Every query is scoped to the caller's account. */
export type ReportsService = ReturnType<typeof createReportsService>;

export function createReportsService(
  prisma: Db,
  billing: BillingService,
  ) {
  async function page(account: accounts, q: ReportQueryDto) {
    const where = await buildWhere(account, q);
    const [total, rows] = await Promise.all([
      prisma.payments.count({ where }),
      prisma.payments.findMany({
        where,
        include: withStore,
        orderBy: { id: 'desc' },
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
      }),
    ]);
    return { rows: rows as ReportPayment[], total };
  }

  /** CSV is plan-gated (`csv_export_enabled`). Checks everything BEFORE the response starts streaming. */
  async function prepareCsv(account: accounts, q: ReportQueryDto): Promise<Prisma.paymentsWhereInput> {
    const plan = await billing.currentPlan(account.id);
    if (!plan.csv_export_enabled) throw forbidden('csv_export_not_available');
    return buildWhere(account, q);
  }

  /** Every matching payment, newest first, fetched in batches (keyset on id) so memory stays flat. */
  async function* csvBatches(where: Prisma.paymentsWhereInput): AsyncGenerator<ReportPayment[]> {
    let before: number | undefined;
    for (;;) {
      const batch = await prisma.payments.findMany({
        where: before ? { AND: [where, { id: { lt: before } }] } : where,
        include: withStore,
        orderBy: { id: 'desc' },
        take: CSV_BATCH,
      });
      if (batch.length === 0) return;
      yield batch as ReportPayment[];
      before = batch[batch.length - 1].id;
    }
  }

  async function buildWhere(account: accounts, q: ReportQueryDto): Promise<Prisma.paymentsWhereInput> {
    const where: Prisma.paymentsWhereInput = { store: { account_id: account.id } };

    const from = q.from ? parseDay(q.from) : undefined;
    const to = q.to ? parseDay(q.to) : undefined;
    if (from && to && from > to) throw badRequest('invalid_date');
    if (from || to) {
      // `to` is inclusive: everything before the next UTC midnight
      where.created_at = { gte: from, lt: to ? new Date(to.getTime() + 86_400_000) : undefined };
    }

    if (q.merchant !== undefined) {
      const store = await prisma.stores.findFirst({ where: { account_id: account.id, external_id: q.merchant } });
      if (!store) throw notFound('merchant_not_found');
      where.store_id = store.id;
    } else if (q.store_id !== undefined) {
      const store = await prisma.stores.findFirst({ where: { account_id: account.id, public_id: q.store_id } });
      if (!store) throw notFound('store_not_found');
      where.store_id = store.id;
    }

    if (q.statuses?.length) where.status = { in: q.statuses };
    return where;
  }

  return { page, prepareCsv, csvBatches };
}
