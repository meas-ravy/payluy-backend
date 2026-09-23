// Loaded before anything reads process.env (server.ts imports this first).
// Prisma 7 no longer loads .env itself; a missing file is fine when the env is already set.
try {
  process.loadEnvFile();
} catch {}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Everything the app reads from the environment, in one place (see .env.example). */
export const env = {
  port: Number(process.env.PORT ?? 3001),
  /** This backend's public URL: checkout_url, the Google redirect URI, the cookie's Secure flag. */
  publicOrigin: trimSlash(process.env.PUBLIC_ORIGIN ?? 'http://localhost:3001'),
  /** The dashboard: CORS allowlist and where Google sign-in lands. */
  frontendUrl: trimSlash(process.env.FRONTEND_URL ?? 'http://localhost:3000'),
  productName: process.env.PRODUCT_NAME ?? '[Product name]', // placeholder, configurable (AGENTS.md)
  /** Fake ABA rail + `/_dev/*` routes; never true in production (hard rule 8). */
  devGateway: process.env.ENABLE_DEV_GATEWAY === 'true',
};

export const isLocalhost = () => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.publicOrigin);
