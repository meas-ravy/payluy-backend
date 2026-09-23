import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env itself; a missing file is fine when the env is already set
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'ts-node --transpile-only prisma/seed.ts' },
  // process.env, not env(): env() throws when unset, which breaks `prisma generate` in CI/Docker builds.
  // migrate still fails clearly without it ("datasource.url property is required").
  datasource: { url: process.env.DATABASE_URL },
});
