import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// ponytail: resolved from cwd, so the app must start from backend-express/ (npm scripts do)
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

/** The database handle every service takes. */
export type Db = PrismaClient;

export const createDb = (): Db => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

export async function connectDb(db: Db) {
  await db.$connect();
  await assertMigrated(db);
}

export const closeDb = (db: Db) => db.$disconnect();

/** Refuse to boot when the database is behind the migrations on disk. */
async function assertMigrated(db: Db) {
  const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const applied = await db.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const done = new Set(applied.map((r) => r.migration_name));
  const pending = onDisk.filter((m) => !done.has(m));
  if (pending.length) throw new Error(`database is behind, run prisma migrate deploy: ${pending.join(', ')}`);
}
