-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "google_sub" TEXT,
    "password_hash" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "whitelabel_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "terms_accepted_at" TIMESTAMPTZ,
    "terms_accepted_version" VARCHAR(32),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" SERIAL NOT NULL,
    "public_id" VARCHAR(40) NOT NULL,
    "account_id" INTEGER NOT NULL,
    "external_id" TEXT,
    "created_via" VARCHAR(16) NOT NULL DEFAULT 'api',
    "name" VARCHAR(120) NOT NULL,
    "city" VARCHAR(15) NOT NULL DEFAULT 'Phnom Penh',
    "support_email" TEXT,
    "redirect_success_url" TEXT,
    "redirect_failure_url" TEXT,
    "telegram_chat_id" VARCHAR(64),
    "brand_color" VARCHAR(16),
    "logo_image_url" TEXT,
    "whitelabel_css" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "link_type" VARCHAR(24) NOT NULL DEFAULT 'aba_payway',
    "raw_link" TEXT NOT NULL,
    "merchant_account_id" VARCHAR(120) NOT NULL,
    "merchant_name" VARCHAR(120),
    "currency" VARCHAR(8) NOT NULL DEFAULT 'USD',
    "verified_at" TIMESTAMPTZ,
    "min_amount_cents" INTEGER NOT NULL DEFAULT 1,
    "max_amount_cents" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" VARCHAR(64),
    "key_prefix" VARCHAR(24) NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "can_manage_stores" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "public_id" VARCHAR(40) NOT NULL,
    "store_id" INTEGER NOT NULL,
    "payment_link_id" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'USD',
    "reference_id" VARCHAR(255),
    "metadata" JSONB,
    "idempotency_key" VARCHAR(255),
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "qr_string" TEXT NOT NULL,
    "qr_md5" VARCHAR(32),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "scanned_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "bank_ref" VARCHAR(255),
    "reversed_at" TIMESTAMPTZ,
    "reversal_reason" VARCHAR(255),
    "detection_closed_at" TIMESTAMPTZ,
    "gateway_status_raw" JSONB,
    "attempt_history" JSONB,
    "reissued_from_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "secret_key" VARCHAR(128) NOT NULL,
    "events" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" VARCHAR(40) NOT NULL,
    "account_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_deliveries" (
    "id" SERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "endpoint_id" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,
    "last_response_status" INTEGER,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "monthly_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "payments_included" INTEGER NOT NULL DEFAULT 0,
    "max_stores" INTEGER,
    "max_keys" INTEGER NOT NULL DEFAULT 5,
    "max_webhooks" INTEGER NOT NULL DEFAULT 10,
    "csv_export_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_subscriptions" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'trial',
    "started_at" TIMESTAMPTZ,
    "next_billing_at" TIMESTAMPTZ NOT NULL,
    "canceled_at" TIMESTAMPTZ,

    CONSTRAINT "plan_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_ledger_entries" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "period_month" VARCHAR(7) NOT NULL,
    "resource_type" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(64) NOT NULL,
    "amount_cents_delta" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_account_id" INTEGER,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_id" INTEGER NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_google_sub_key" ON "accounts"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "stores_public_id_key" ON "stores"("public_id");

-- CreateIndex
CREATE INDEX "stores_account_id_idx" ON "stores"("account_id");

-- CreateIndex
CREATE INDEX "stores_status_idx" ON "stores"("status");

-- CreateIndex
CREATE UNIQUE INDEX "stores_account_id_external_id_key" ON "stores"("account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_store_id_key" ON "payment_links"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_account_id_idx" ON "api_keys"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_public_id_key" ON "payments"("public_id");

-- CreateIndex
CREATE INDEX "payments_store_id_status_created_at_idx" ON "payments"("store_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payments_reference_id_idx" ON "payments"("reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_store_id_idempotency_key_key" ON "payments"("store_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "webhook_endpoints_account_id_idx" ON "webhook_endpoints"("account_id");

-- CreateIndex
CREATE INDEX "events_account_id_idx" ON "events"("account_id");

-- CreateIndex
CREATE INDEX "events_type_idx" ON "events"("type");

-- CreateIndex
CREATE UNIQUE INDEX "event_deliveries_event_id_endpoint_id_key" ON "event_deliveries"("event_id", "endpoint_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "plan_subscriptions_account_id_idx" ON "plan_subscriptions"("account_id");

-- CreateIndex
CREATE INDEX "plan_ledger_entries_account_id_period_month_idx" ON "plan_ledger_entries"("account_id", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "plan_ledger_entries_period_month_resource_type_resource_id_key" ON "plan_ledger_entries"("period_month", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reissued_from_id_fkey" FOREIGN KEY ("reissued_from_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_subscriptions" ADD CONSTRAINT "plan_subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_subscriptions" ADD CONSTRAINT "plan_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
