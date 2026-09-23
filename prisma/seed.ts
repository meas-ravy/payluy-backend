// Dev bootstrap: plans + one account + one API key. Run: npx prisma db seed
// Safe to re-run: plans/account are upserted, and a key is only minted when the account has none.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { keyPrefix, newApiKey, sha256 } from '../src/lib/ids';

const EMAIL = process.env.SEED_EMAIL ?? 'dev@example.com';

// AGENTS.md "Plans". ponytail: monthly fees aren't in the docs, left at 0
const PLANS = [
  { code: 'free', name: 'Free', max_stores: 1, max_keys: 1, payments_included: 3_000, csv_export_enabled: false },
  { code: 'starter', name: 'Starter', max_stores: 5, max_keys: 3, payments_included: 15_000, csv_export_enabled: true },
  { code: 'pro', name: 'Pro', max_stores: 50, max_keys: 10, payments_included: 1_000_000, csv_export_enabled: true },
].map((p) => ({ ...p, max_webhooks: 10 }));

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    for (const p of PLANS) {
      await prisma.plans.upsert({ where: { code: p.code }, create: p, update: p });
    }

    const account = await prisma.accounts.upsert({
      where: { email: EMAIL },
      create: { email: EMAIL, name: 'Dev account' },
      update: {},
    });

    if (!(await prisma.plan_subscriptions.findFirst({ where: { account_id: account.id } }))) {
      const free = await prisma.plans.findUniqueOrThrow({ where: { code: 'free' } });
      const now = new Date();
      await prisma.plan_subscriptions.create({
        data: {
          account_id: account.id,
          plan_id: free.id,
          status: 'active',
          started_at: now,
          next_billing_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
        },
      });
    }

    const existing = await prisma.api_keys.findFirst({ where: { account_id: account.id, status: 'active' } });
    if (existing) {
      console.log(`account ${EMAIL} already has key ${existing.key_prefix}… (raw key is only shown at creation)`);
      return;
    }
    const raw = newApiKey();
    await prisma.api_keys.create({
      data: { account_id: account.id, name: 'seed', key_prefix: keyPrefix(raw), key_hash: sha256(raw) },
    });
    console.log(`account ${EMAIL}, API key (shown once):\n${raw}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
