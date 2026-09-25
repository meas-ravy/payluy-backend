# Data model (PostgreSQL + Prisma)

Conventions: model = table name and field = column name, both snake_case, with no `@map`/`@@map`
(so code reads `prisma.payments.findMany({ where: { store_id } })`). Integer PKs internally, opaque public tokens (`payments.public_id`, `stores.public_id`)
over the API. Money is **integer cents**. Timestamps are `timestamptz` (UTC). Schema changes go
through `prisma migrate` only; the app refuses to boot if the database is behind.

Tenant hierarchy: **Account** (POS provider) → **Store** (merchant) → **PaymentLink** (the store's
ABA PayWay link = money destination). API keys and webhooks live on the account.

## Status values

| Model | Values |
| --- | --- |
| Account | `active`, `suspended`, `closed` |
| Store | `draft` (no link), `active`, `disabled` |
| PaymentLink | `active`, `disabled` |
| Payment | `pending`, `scanned`, `paid`, `expired`, `superseded`, `reversed`, `failed` |
| EventDelivery | `pending`, `retrying`, `success`, `failed` |
| WebhookEndpoint | `active`, `disabled` |

Kept as strings (not Prisma enums) so adding a value is a code change, not a migration.

## schema.prisma

Prisma 7: the connection URL is in `backend/prisma.config.ts`, and `lib/prisma.ts` connects
through `@prisma/adapter-pg`. Import the client from `src/generated/prisma/client`, not `@prisma/client`.

```prisma
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "cjs"
  importFileExtension = "" // extensionless, so ts-node (seed) can load it
}

// URL lives in prisma.config.ts (Prisma 7)
datasource db {
  provider = "postgresql"
}

// Style: model = table name, field = column name, both snake_case. No @map / @@map.

model accounts {
  id                     Int       @id @default(autoincrement())
  email                  String    @unique
  name                   String    @db.VarChar(120)
  google_sub             String?   @unique
  password_hash          String?
  status                 String    @default("active") @db.VarChar(16)
  whitelabel_enabled     Boolean   @default(false)
  is_platform_admin      Boolean   @default(false)
  terms_accepted_at      DateTime? @db.Timestamptz
  terms_accepted_version String?   @db.VarChar(32)
  created_at             DateTime  @default(now()) @db.Timestamptz
  updated_at             DateTime  @updatedAt @db.Timestamptz

  stores        stores[]
  api_keys      api_keys[]
  webhooks      webhook_endpoints[]
  subscriptions plan_subscriptions[]
}

model stores {
  id                   Int      @id @default(autoincrement())
  public_id            String   @unique @db.VarChar(40) // UUID v4
  account_id           Int
  external_id          String? // the POS's own merchant id
  created_via          String   @default("api") @db.VarChar(16)
  name                 String   @db.VarChar(120)
  city                 String   @default("Phnom Penh") @db.VarChar(15) // KHQR limit
  support_email        String?
  redirect_success_url String?
  redirect_failure_url String?
  telegram_chat_id     String?  @db.VarChar(64)
  brand_color          String?  @db.VarChar(16)
  logo_image_url       String?
  whitelabel_css       String?
  status               String   @default("draft") @db.VarChar(16)
  created_at           DateTime @default(now()) @db.Timestamptz
  updated_at           DateTime @updatedAt @db.Timestamptz

  account  accounts       @relation(fields: [account_id], references: [id])
  link     payment_links?
  payments payments[]

  @@unique([account_id, external_id])
  @@index([account_id])
  @@index([status])
}

model payment_links {
  id                  Int       @id @default(autoincrement())
  store_id            Int       @unique // one link per store
  link_type           String    @default("aba_payway") @db.VarChar(24)
  raw_link            String // https://link.payway.com.kh/ABAPAY…
  merchant_account_id String    @db.VarChar(120)
  merchant_name       String?   @db.VarChar(120)
  currency            String    @default("USD") @db.VarChar(8)
  verified_at         DateTime? @db.Timestamptz // set only after aba_data was found
  min_amount_cents    Int       @default(1)
  max_amount_cents    Int?
  status              String    @default("active") @db.VarChar(16)
  created_at          DateTime  @default(now()) @db.Timestamptz
  updated_at          DateTime  @updatedAt @db.Timestamptz

  store    stores     @relation(fields: [store_id], references: [id])
  payments payments[]
}

model api_keys {
  id                Int       @id @default(autoincrement())
  account_id        Int
  name              String?   @db.VarChar(64)
  key_prefix        String    @db.VarChar(24) // first 16 chars of the key, for display
  key_hash          String    @unique @db.VarChar(64) // sha256(full key)
  can_manage_stores Boolean   @default(true)
  status            String    @default("active") @db.VarChar(16)
  last_used_at      DateTime? @db.Timestamptz
  created_at        DateTime  @default(now()) @db.Timestamptz
  revoked_at        DateTime? @db.Timestamptz

  account accounts @relation(fields: [account_id], references: [id])

  @@index([account_id])
}

model payments {
  id                  Int       @id @default(autoincrement())
  public_id           String    @unique @db.VarChar(40)
  store_id            Int
  payment_link_id     Int
  amount_cents        Int
  currency            String    @default("USD") @db.VarChar(8)
  reference_id        String?   @db.VarChar(255)
  metadata            Json?
  idempotency_key     String?   @db.VarChar(255)
  status              String    @default("pending") @db.VarChar(16)
  qr_string           String
  qr_md5              String?   @db.VarChar(32)
  expires_at          DateTime  @db.Timestamptz
  scanned_at          DateTime? @db.Timestamptz
  paid_at             DateTime? @db.Timestamptz
  bank_ref            String?   @db.VarChar(255) // ABA tran_id
  reversed_at         DateTime? @db.Timestamptz
  reversal_reason     String?   @db.VarChar(255)
  detection_closed_at DateTime? @db.Timestamptz
  gateway_status_raw  Json? // { paywayHosted: { clientId, token, requestTime, … } } — purged after 90 days
  attempt_history     Json? // array; always write a NEW array
  reissued_from_id    Int?
  created_at          DateTime  @default(now()) @db.Timestamptz

  store         stores        @relation(fields: [store_id], references: [id])
  link          payment_links @relation(fields: [payment_link_id], references: [id])
  reissued_from payments?     @relation("reissue", fields: [reissued_from_id], references: [id])
  successors    payments[]    @relation("reissue")
  events        events[]

  @@unique([store_id, idempotency_key])
  @@index([store_id, status, created_at])
  @@index([status, expires_at]) // expiry sweep
  @@index([status, created_at]) // detection sweep
  @@index([reference_id])
}

model webhook_endpoints {
  id         Int      @id @default(autoincrement())
  account_id Int
  url        String
  secret_key String   @db.VarChar(128) // whsec_…; must be recoverable to sign
  events     Json? // ["payment.completed", …] or null = all
  status     String   @default("active") @db.VarChar(16)
  created_at DateTime @default(now()) @db.Timestamptz
  updated_at DateTime @updatedAt @db.Timestamptz

  account    accounts           @relation(fields: [account_id], references: [id])
  deliveries event_deliveries[]

  @@index([account_id])
}

/// Outbox: written in the same transaction as the payment state change.
model events {
  id         String   @id @db.VarChar(40) // uuid, stable across retries
  account_id Int
  store_id   Int
  payment_id Int
  type       String   @db.VarChar(32) // payment.completed | scanned | expired | failed | superseded | reversed
  payload    Json // full event body, signed exactly as stored
  created_at DateTime @default(now()) @db.Timestamptz

  payment    payments           @relation(fields: [payment_id], references: [id])
  deliveries event_deliveries[]

  @@index([account_id])
  @@index([type])
}

model event_deliveries {
  id                   Int       @id @default(autoincrement())
  event_id             String
  endpoint_id          Int
  status               String    @default("pending") @db.VarChar(16)
  attempts             Int       @default(0)
  next_attempt_at      DateTime? @db.Timestamptz
  last_response_status Int?
  last_error           String?
  created_at           DateTime  @default(now()) @db.Timestamptz
  updated_at           DateTime  @updatedAt @db.Timestamptz

  event    events            @relation(fields: [event_id], references: [id])
  endpoint webhook_endpoints @relation(fields: [endpoint_id], references: [id])

  @@unique([event_id, endpoint_id])
  @@index([status, next_attempt_at]) // webhook sender claims due rows every 2 s
}

model plans {
  id                 Int     @id @default(autoincrement())
  code               String  @unique @db.VarChar(32) // free | starter | pro
  name               String  @db.VarChar(64)
  monthly_fee_cents  Int     @default(0)
  payments_included  Int     @default(0) // paid payments / calendar month
  max_stores         Int?
  max_keys           Int     @default(5)
  max_webhooks       Int     @default(10)
  csv_export_enabled Boolean @default(true)
  is_active          Boolean @default(true)

  subscriptions plan_subscriptions[]
}

model plan_subscriptions {
  id              Int       @id @default(autoincrement())
  account_id      Int
  plan_id         Int
  status          String    @default("trial") @db.VarChar(16) // trial | active | canceled
  started_at      DateTime? @db.Timestamptz
  next_billing_at DateTime  @db.Timestamptz
  canceled_at     DateTime? @db.Timestamptz

  account accounts @relation(fields: [account_id], references: [id])
  plan    plans    @relation(fields: [plan_id], references: [id])

  @@index([account_id])
}

/// Usage log: one row per money movement. Usage = SUM(amount_cents_delta) GROUP BY period_month.
model plan_ledger_entries {
  id                 Int      @id @default(autoincrement())
  account_id         Int
  period_month       String   @db.VarChar(7) // 2026-09
  resource_type      String   @db.VarChar(32) // payment | payment_reversal
  resource_id        String   @db.VarChar(64)
  amount_cents_delta Int // negative for a reversal
  created_at         DateTime @default(now()) @db.Timestamptz

  @@unique([period_month, resource_type, resource_id]) // a retry cannot double-count
  @@index([account_id, period_month])
}

/// Append-only. Survives account deletion (no FK cascade).
model audit_logs {
  id               Int      @id @default(autoincrement())
  actor_account_id Int?
  action           String   @db.VarChar(64) // key.created, store.link_set, account.suspended, …
  target_type      String   @db.VarChar(32)
  target_id        Int
  details          Json? // never contains a key or secret
  created_at       DateTime @default(now()) @db.Timestamptz

  @@index([action])
}
```

## Rules the schema alone cannot enforce

- **Guarded transitions.** Every status change is
  `updateMany({ where: { id, status: <expected> } })` and checks `count === 1`.
- **Outbox in one transaction.** `prisma.$transaction(async tx => { update payment; create Event; create EventDelivery[] })`.
- **Clearing JSON.** To purge `gateway_status_raw` write `Prisma.DbNull` (SQL `NULL`), not `null` /
  `Prisma.JsonNull` — otherwise `IS NOT NULL` still matches and the purge repeats forever.
- **Appending JSON.** `attempt_history: [...existing, attempt]` — a new array every time.
- **Quota** = `count(payments where status='paid' and paid_at >= start of calendar month)` across the
  account's stores, checked before minting.
- **Money destination** is always read from the store's active `payment_links` row at create time.
- **Webhook secret** is stored in plaintext because it is needed to sign; protect with DB access
  control (or envelope-encrypt later).

## Public ↔ internal mapping

- API `payment.id` = `payments.public_id`; API `store` = `stores.public_id`; API `merchant` = `stores.external_id`.
- API key → `sha256(presented key)` → `api_keys.key_hash` → account.
