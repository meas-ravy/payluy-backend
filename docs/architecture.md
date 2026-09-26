# Architecture (Express)

A KHQR payment platform built on Express 5 + TypeScript (switched from NestJS 2026-09-23).

## 1. Goal

A KHQR payment **technical layer** — software, not a bank:

- Account = one hosting platform (e.g. a POS provider). One account-scoped API key; it can
  **auto-provision stores (sub-merchants) via API**.
- Each store owns **its own ABA PayWay payment link**, entered once.
- `POST /v1/payments` (targeting one store) → returns `qr_string` + hosted `checkout_url`.
  Money lands **directly in that store's own bank account**.
- Status is reported in real time via **signed webhooks to one account-level endpoint**, each
  event tagged with the store so the POS can route it.

Money flow is **direct-to-merchant** (never pooled, never held). We confirm credits, we never move them.

## 2. High-level components

```
   POS / merchant server          OUR PLATFORM (Express)
        │  HTTPS /*     ┌──────────────────────────────────────────┐
        ├────────────────► │  Controllers ─► Services ─► Prisma ─► Postgres
        │  API key         │      │                        (source of truth)
        ◄──── checkout_url │      │ outbox rows                ▲
        │                  │      ▼                            │
        │  webhooks        │  Workers (poll Postgres, SKIP LOCKED) ─┘
        ◄───────────────── │   • payment-detection (poll ABA)
        │  HMAC-signed     │   • webhook-sender
                           │   • expiry-sweeper
                           │   • retention-sweeper
                           │      │
                           │      ▼  PaywayGateway (adapter)
                           └──────┼───────────────────────────────────┘
                                  ▼
                         ABA PayWay (hosted checkout)
   Customer pays with their own banking app → money lands in the MERCHANT's account
```

### 2.1 Feature folders

Each one is `<feature>.service.ts` (logic) + `<feature>.controller.ts` (HTTP), wired in `container.ts` and `app.ts`.

| Folder | Responsibility |
| --- | --- |
| `auth/` | API-key + session middleware (`Bearer ck_live_…` or the session cookie), Google OAuth (hand-rolled, no passport) |
| `accounts/` | Account profile, plan, terms acceptance, suspension |
| `stores/` | `POST /v1/stores`, link attach/replace, enable/disable |
| `payments/` | Create / read / list / reissue / reverse payments, quota check |
| `payway/` | `PaywayGateway`: mint hosted checkout, fetch hosted status (ABA HTTP calls) |
| `detection/` | 30 s sweep worker (Postgres, SKIP LOCKED) that polls ABA and calls `markPaid` |
| `webhooks/` | Endpoint CRUD, outbox writer, sender processor, HMAC signing |
| `checkout/` | Public `/pay/:id`, `/pay/:id/qr.svg`, `/pay/:id/status` |
| `khqr/` | KHQR card SVG for `/pay/:id/qr.svg` (service only, no routes) |
| `billing/` | Plans, subscriptions, usage ledger |
| `admin/` | Platform-operator routes (`/v1/admin/*`) |
| `observability/` | Structured logs with trace id, `prom-client` `/metrics`, Telegram alerts |

### 2.2 Processes (one codebase)

| Process | Entry | Responsibility |
| --- | --- | --- |
| `api` | `main.ts` | HTTP: REST + checkout + dashboard endpoints |
| `worker` | `worker.ts` (no HTTP) | Postgres-polling workers + scheduled sweeps |

Both share one Postgres (no Redis: the tables are the queue). Start with the workers inside `api`; split out
`worker` when throughput needs it.

### 2.3 Tech stack

| Concern | Choice |
| --- | --- |
| Framework | Express 5 + TypeScript (strict); zod for request validation |
| Validation | DTOs + `class-validator` / `class-transformer` (global `ValidationPipe`) |
| ORM / migrations | Prisma + `prisma migrate` (app refuses to boot if DB is behind) |
| Queue | Postgres outbox tables polled with `SELECT … FOR UPDATE SKIP LOCKED` (safe with many replicas); no Redis |
| Schedules | `setInterval` loops in the worker; each tick claims rows with `SKIP LOCKED` |
| HTTP client | `fetch` / `@nestjs/axios` |
| Crypto | Node `crypto` (`createHash('sha512')`, `createHmac('sha256')`, `timingSafeEqual`) |
| Rate limiting | `@nestjs/throttler` (storage to decide: in-memory per instance, or Postgres; no Redis) |
| Metrics | `prom-client` |
| Tests | Jest + Supertest, Postgres in CI |
| Lint | ESLint + Prettier |

## 3. Request lifecycle

1. POS calls `POST /v1/payments {amount, reference_id, merchant | store, idempotency_key}`.
2. `ApiKeyGuard` resolves the key → account. `resolveTarget()` picks the store:
   `merchant` (external_id) → `store` (public id) → the account's single active store.
3. `PaymentsService.create()`:
   - checks plan quota (`402 quota_exceeded`) and amount bounds;
   - returns the existing payment if `idempotency_key` was seen for this store;
   - loads the store's active `PaymentLink`;
   - `PaywayGateway.createHostedCheckout(link.rawLink, "12.50")` (§4);
   - inserts a `payments` row `status=pending` with the ABA session in `gatewayStatusRaw.paywayHosted`;
   - (detection picks it up on its next 30 s sweep).
4. Returns `{id, status, amount, qr_string, checkout_url, expires_at}`.
5. Customer scans and pays from their bank app.
6. The detection processor polls ABA (§5); on `approved` → `markPaid()`.
7. `markPaid()` in **one transaction**: status → `paid`, ledger row, retire successors,
   write outbox `events` + `event_deliveries`.
8. Webhook sender (polls `event_deliveries`) signs and POSTs to each endpoint, retrying with backoff (max 8).

## 4. Minting a QR from the payment link

```ts
// PaywayGateway.createHostedCheckout(link, amount)
const html = await fetch(link).then(r => r.text());
const abaData     = html.match(/aba_data\s*[=:]\s*"((?:[^"\\]|\\.)*)"/)?.[1];
const requestTime = html.match(/request_time\s*[=:]\s*"?(\d{10,20})"?/)?.[1];
const additional  = JSON.stringify({ amount });           // {"amount":"12.50"}
const hash = createHash('sha512').update(requestTime + abaData + additional).digest('hex');

POST https://pwapp.ababank.com/api/pw-app/v1/payment/gateway/list-payment-options
  { additional_fields: additional, request_time: requestTime, aba_data: abaData, hash }
→ { qr_string, client_id, token, expire_in_sec }
```

Missing any of `qr_string / client_id / token` → throw, API answers `502`. Never hand out a QR
nobody can pay.

> ⚠️ **Unofficial API.** These endpoints were reverse-engineered from ABA's public PayWay page.
> There is no contract with ABA, the hash has no secret, and a page change breaks minting.
> Keep all of it behind `PaywayGateway` so it can be swapped for the official PayWay merchant
> API (merchant_id + api_key, HMAC-SHA512, callbacks) without touching the rest.

## 5. Detection

```ts
// every 30 s (worker loop, rows claimed with FOR UPDATE SKIP LOCKED)
payments where status in (pending, scanned, expired, superseded)
          and createdAt >= now - detectionWindow (1 h)
          order by id asc limit 20
→ check each (payment-detection)

// processor
const device = randomString(10);
POST .../pw-app/v1/payment-link/check-payment-status
  headers: { token }
  body: { device_id: device, request_time, client_id,
          hash: sha512(client_id + device + request_time) }
paid = data.action === 'approved'
```

- `expired` rows are still polled: ABA accepted a payment 9.5 min after its 180 s code expired.
- Every poll is appended to `attemptHistory` (build a **new** array; don't mutate in place).
- When a payment leaves the window it gets one `final` check that sets `detectionClosedAt`;
  no answer from ABA → operator alert.

## 6. Correctness principles

- **DB is source of truth and the queue** (no Redis). Workers must be safe to run twice.
- **Guarded transitions**: `updateMany({ where: { id, status: 'pending' }, data: {...} })`
  and check `count === 1`.
- **Outbox pattern**: event rows are written in the same `prisma.$transaction` as the state change.
- **Idempotency**: `idempotency_key` **body field**, unique per store; webhooks carry stable event ids.
- **Statuses**: `pending → scanned → paid`; `expired` is *not* terminal (can become `paid`);
  `superseded` (replacement code retired); `reversed` (refund recorded manually); `failed`.
  Final: `paid` (until reversed), `reversed`, `failed`.
- **Amounts are integer cents**, matching is exact.

## 7. Security

- API keys stored as SHA-256 hash only; full key shown once (`ck_live_…`).
- Webhook signature: `X-Webhook-Signature: t=<ts>,v1=<hex>` =
  `HMAC-SHA256(secret, `${t}.${rawBody}`)`; receivers compare with `timingSafeEqual`, reject `|now-t| > 300`.
  Sign the **exact bytes** you send.
- ABA session tokens purged after 90 days (retention processor).
- Refuse to boot on a default/empty session secret.
- Dev-only routes (fake rail) behind a flag that is **false** in production, and blocked at nginx too.
- CORS: explicit origin allowlist (credentials on), never `*`.

## 8. Multi-tenancy

```
Account (POS provider)
├── API key(s)                        ── authenticate + provision stores
├── webhook endpoint + signing secret ── shared across all stores
└── Stores (auto-provisioned via POST /v1/stores)
    ├── store A → PayWay link A (money → A's account)
    └── store B → PayWay link B (money → B's account)
```

- One account = one POS provider. Stores are the provider's merchants.
- Quota is pooled per account: `paid` payments in the **current calendar month**.
- Events carry `data.merchant.external_id` so the POS routes without an id map.
- Validate a link when it is attached (fetch the page, require `aba_data`) — don't just mark it verified.

## 9. Non-goals for v1

- Holding or moving money, payouts.
- Automatic refund detection (ABA gives no signal; `POST /v1/payments/:id/reverse` records it manually).
- KHR currency (USD only).
- Cards / recurring billing.
