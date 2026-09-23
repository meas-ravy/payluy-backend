-- stores.public_id: VARCHAR(40) (`st_…`) → real UUID column (AGENTS.md, Store id, 2026-09-23).
-- Rewritten by hand: Prisma's default drops the column, which would lose every store's public id.

-- 1. give any pre-UUID id (`st_…`) a fresh UUID; its old URLs stop working, as agreed
UPDATE "stores"
SET "public_id" = gen_random_uuid()::text
WHERE "public_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 2. change the type in place; the unique index follows the column
ALTER TABLE "stores" ALTER COLUMN "public_id" TYPE UUID USING "public_id"::uuid;
