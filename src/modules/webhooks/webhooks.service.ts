import { Prisma, type accounts, type webhook_endpoints } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { newEventId, newWebhookSecret } from '../../lib/ids';
import type { Db } from '../../lib/prisma';
import type { CreateWebhookDto, UpdateWebhookDto } from './webhooks.schema';
import { postWebhook } from './webhook-http';
import { badRequest, notFound } from '../../lib/errors';

/** `["*"]` and `null` both mean "all events"; stored as SQL NULL (hard rule 7: Prisma.DbNull). */
const toEventsColumn = (events: string[] | null | undefined) =>
  events === undefined ? undefined : events === null || events.includes('*') ? Prisma.DbNull : events;

/** Endpoint management (docs/api.md § Webhook endpoints). Delivery itself is WebhookSenderService. */
export type WebhooksService = ReturnType<typeof createWebhooksService>;

export function createWebhooksService(
  prisma: Db,
  billing: BillingService,
  audit: AuditService,
  ) {
  function list(account: accounts) {
    return prisma.webhook_endpoints.findMany({ where: { account_id: account.id }, orderBy: { id: 'asc' } });
  }

  /** Scoped to the caller's account; a non-numeric or foreign id is a 404. */
  async function get(account: accounts, id: string): Promise<webhook_endpoints> {
    const n = Number(id);
    const endpoint = Number.isSafeInteger(n)
      ? await prisma.webhook_endpoints.findFirst({ where: { id: n, account_id: account.id } })
      : null;
    if (!endpoint) throw notFound('webhook_not_found');
    return endpoint;
  }

  /** Returns the signing secret once; it is never readable again. */
  // ponytail: count-then-insert, like the store limit
  async function create(account: accounts, dto: CreateWebhookDto) {
    const plan = await billing.currentPlan(account.id);
    const count = await prisma.webhook_endpoints.count({ where: { account_id: account.id } });
    if (count >= plan.max_webhooks) throw badRequest('webhook_limit_reached');

    const secret = newWebhookSecret();
    const endpoint = await prisma.$transaction(async (tx) => {
      const e = await tx.webhook_endpoints.create({
        data: { account_id: account.id, url: dto.url, events: toEventsColumn(dto.events), secret_key: secret },
      });
      await audit.record(tx, { actorId: account.id, action: 'webhook.created', targetType: 'webhook', targetId: e.id, details: { url: e.url } });
      return e;
    });
    return { endpoint, secret };
  }

  async function update(account: accounts, id: string, dto: UpdateWebhookDto) {
    const endpoint = await get(account, id);
    return prisma.$transaction(async (tx) => {
      const e = await tx.webhook_endpoints.update({
        where: { id: endpoint.id },
        data: { url: dto.url, events: toEventsColumn(dto.events), status: dto.status },
      });
      const fields = Object.keys(dto).filter((k) => dto[k as keyof UpdateWebhookDto] !== undefined);
      await audit.record(tx, { actorId: account.id, action: 'webhook.updated', targetType: 'webhook', targetId: e.id, details: { fields } });
      return e;
    });
  }

  // ponytail: hard delete takes the endpoint's delivery history with it (FK). Soft-delete if support needs the history.
  async function remove(account: accounts, id: string) {
    const endpoint = await get(account, id);
    await prisma.$transaction(async (tx) => {
      await tx.event_deliveries.deleteMany({ where: { endpoint_id: endpoint.id } });
      await tx.webhook_endpoints.delete({ where: { id: endpoint.id } });
      await audit.record(tx, { actorId: account.id, action: 'webhook.deleted', targetType: 'webhook', targetId: endpoint.id, details: { url: endpoint.url } });
    });
    return endpoint;
  }

  /** The old secret stops working immediately. */
  async function rotateSecret(account: accounts, id: string) {
    const endpoint = await get(account, id);
    const secret = newWebhookSecret();
    await prisma.$transaction(async (tx) => {
      await tx.webhook_endpoints.update({ where: { id: endpoint.id }, data: { secret_key: secret } });
      await audit.record(tx, { actorId: account.id, action: 'webhook.secret_rotated', targetType: 'webhook', targetId: endpoint.id });
    });
    return { id: endpoint.id, signing_secret: secret };
  }

  /**
   * Sends one synthetic, signed event right now (not queued, not stored). Type `webhook.test` with
   * `financial: false`, so a receiver can never book it as money.
   */
  async function sendTest(account: accounts, id: string) {
    const endpoint = await get(account, id);
    const eventId = newEventId();
    const body = JSON.stringify({
      id: eventId,
      type: 'webhook.test',
      created: new Date().toISOString(),
      financial: false,
      data: { test: true, endpoint_id: endpoint.id },
    });
    const r = await postWebhook(endpoint.url, endpoint.secret_key, 'webhook.test', body);
    return {
      http_status: r.status,
      response_body_preview: r.error && r.status === null ? r.error : r.bodyPreview,
      headers_sent: r.headers,
    };
  }

  async function deliveries(account: accounts, id: string, limit: number) {
    const endpoint = await get(account, id);
    return prisma.event_deliveries.findMany({
      where: { endpoint_id: endpoint.id },
      include: { event: { select: { type: true } } },
      orderBy: { id: 'desc' },
      take: limit,
    });
  }

  return { list, get, create, update, remove, rotateSecret, sendTest, deliveries };
}
