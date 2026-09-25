try {
  process.loadEnvFile();
} catch {}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Everything the app reads from the environment, in one place (see .env.example). */
export const env = {
  port: 3001, // ponytail: fixed; Vercel ignores it (api/index.ts). Read process.env.PORT again if hosting on Railway/Render/Docker
  /**
   * This backend's public URL: checkout_url, the Google redirect URI, the cookie's Secure flag.
   * Unset: on Vercel, the project's production domain (e.g. https://payluy-backend.vercel.app); locally, localhost.
   */
  publicOrigin: trimSlash(
    process.env.PUBLIC_ORIGIN ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3001'),
  ),
  /** The dashboard: CORS allowlist and where Google sign-in lands. */
  frontendUrl: trimSlash(process.env.FRONTEND_URL || 'http://localhost:3000'),
  productName: process.env.PRODUCT_NAME || '[Product name]', // placeholder, configurable (AGENTS.md)
};

export const isLocalhost = () => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.publicOrigin);

export const isCrossSite = () => !isLocalhost() && env.frontendUrl !== env.publicOrigin;
