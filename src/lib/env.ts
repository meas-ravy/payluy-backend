try {
  process.loadEnvFile();
} catch {}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Everything the app reads from the environment, in one place (see .env.example). */
export const env = {
  port: 3001, // ponytail: fixed; Vercel ignores it (api/index.ts). Read process.env.PORT again if hosting on Railway/Render/Docker
  /**
   * This backend's public URL, used in checkout_url (the /pay/:id page POS systems hand to payers).
   * Unset: on Vercel, the project's production domain (e.g. https://payluy-backend.vercel.app); locally, localhost.
   */
  publicOrigin: trimSlash(
    process.env.PUBLIC_ORIGIN ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3001'),
  ),
  /** The dashboard: CORS allowlist. */
  frontendUrl: trimSlash(process.env.FRONTEND_URL || 'http://localhost:3000'),
  /**
   * Shared with the dashboard's Next.js server only: it authenticates POST /internal/auth/google
   * (sign-in). Checked at boot like SESSION_SECRET (middleware/auth.ts `internalAuth`).
   */
  internalApiSecret: process.env.INTERNAL_API_SECRET ?? '',
  productName: process.env.PRODUCT_NAME || '[Product name]', // placeholder, configurable (AGENTS.md)
};
