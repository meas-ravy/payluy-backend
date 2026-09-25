# Task log

One small task at a time. Each task is proposed here first and implemented only once approved.
Status: `proposed` → `approved` → `done`.

## Build order step 1: scaffold, `common/`, Prisma schema + first migration

### T1. Install Prisma: done

- Installed `prisma@6.19.3` (dev) and `@prisma/client@6.19.3` in `backend/`.
- **Why 6, not 7/8:** the schema in `docs/data-model.md` uses `url = env("DATABASE_URL")` and
  `prisma-client-js`. Prisma 7+ no longer allows `url` in the schema (it moves to `prisma.config.ts` plus a driver adapter).
  Prisma 6 lets us use the doc schema exactly as written.

### T2. `prisma/schema.prisma`: done

- `backend/prisma/schema.prisma`, copied exactly from `docs/data-model.md`, then `prisma format`,
  `prisma validate` and `prisma generate`. All passed.
- No migration yet: needs `DATABASE_URL` (see T5).

### T3. Remove the Nest "Hello World" scaffold: done

- Deleted `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`,
  `test/app.e2e-spec.ts`. No doc asks for `GET /`.

### T4. `common/` + `PrismaService`: written, NOT tested, waiting for your review

Installed `class-validator` and `class-transformer` (the ValidationPipe needs them).

| File | What it does |
| --- | --- |
| `src/common/ids.ts` | payment id (24 chars), `st_` store id, `ck_live_` key, `whsec_` secret, event UUID, `sha256`, `keyPrefix` |
| `src/common/money.ts` | `toCents(number)` → integer cents, or `null` if more than 2 decimals; `formatCents(150)` → `"1.50"` |
| `src/common/http-exception.filter.ts` | every error becomes `{ "detail": "<code>" }`; Nest sentences become status names (`not_found`); unknown errors become `500 internal_error` |
| `src/common/validation.pipe.ts` | `422 { "detail": [{ loc, msg, input }] }`; `loc` starts with `body`/`query`/`param` |
| `src/prisma/prisma.service.ts` | `PrismaService` + global `PrismaModule`; **refuses to boot if the DB is behind** (compares `prisma/migrations/*` with `_prisma_migrations`) |
| `src/app.module.ts` | registers the filter and pipe as `APP_FILTER` / `APP_PIPE` (so e2e tests get them too) |

Not done yet: unit tests for these files. Nothing compiled or linted yet.

### T5. First migration: done

- `npx prisma migrate dev --name init` against your DB (`Payluy` on `localhost:5432`).
- Created `prisma/migrations/20260921084022_init/migration.sql`: 12 tables, matching the 12 models.
- `npx prisma migrate status` → "Database schema is up to date".

### T6. Tests for T4: proposed

- `src/common/common.spec.ts`: id shapes, money edge cases (`1.1`, `0.001`, `1.005`, `NaN`),
  error filter (code passthrough, sentence → status name, 429 shape kept, 500 hidden, 404 route),
  422 shape (nested field, extra field, custom `invalid_amount` message).
- `test/app.e2e-spec.ts`: boots `AppModule` against Postgres (`DATABASE_URL` must contain `test`),
  checks the boot refusal and a 404.
- Needs a test database, e.g. `payment_test`.

### T7. VS Code Prisma extension showed a Prisma 7 error: done

- The extension (v31) checks schemas with Prisma 7 rules and flagged `url` in `datasource`.
- Added `.vscode/settings.json` → `"prisma.pinToPrisma6": true`. Only this workspace is affected.
- **Undone by T8**: the setting was removed once we moved to Prisma 7.

### T8. Switch to Prisma 7: done

| File | Change |
| --- | --- |
| `package.json` | `prisma` / `@prisma/client` `7.10.0`, added `@prisma/adapter-pg` `7.10.0` |
| `prisma/schema.prisma` | generator `prisma-client` (output `src/generated/prisma`, `cjs`); removed `url` from `datasource` |
| `prisma.config.ts` (new) | schema + migrations path, `DATABASE_URL`; loads `.env` with Node's `process.loadEnvFile()` (no `dotenv`) |
| `src/prisma/prisma.service.ts` | `new PrismaClient({ adapter: new PrismaPg(...) })`, import from `../generated/prisma/client` |
| `src/main.ts` | loads `.env` at startup (Prisma 7 no longer does) |
| `.gitignore`, `.oxlintrc.json` | ignore `src/generated` |
| `docs/data-model.md` | schema header updated to Prisma 7 + a note |
| `.vscode/settings.json` | removed (T7 not needed any more) |

- Migration SQL and tables are unchanged. `migrate status`: up to date.
- **After a fresh clone, or after any schema change, run `npx prisma generate`.** Prisma 7 no longer
  generates the client on `npm install` or `migrate dev`.
- Checked: `tsc --noEmit` ✅, `npm run lint` ✅, app boots against the DB, and `GET /nope` →
  `404 {"detail":"not_found"}` ✅. Tests not run (as asked).
- **Bug found in T4 while booting:** `APP_PIPE` with `useClass: ApiValidationPipe` crashed at startup
  (Nest tried to inject the parent `ValidationPipe(options)` argument). Fixed in `app.module.ts` with
  `useValue: new ApiValidationPipe()`.

### T9. Schema style: all snake_case, no `@map`: done

- `prisma/schema.prisma`: model = table name (`payment_links`), field = column name (`raw_link`),
  relation fields snake_case too (`api_keys`, `reissued_from`). All `@map`/`@@map` removed.
- Code now reads `prisma.payment_links.findMany({ where: { store_id } })`, and types are `payment_links` etc.
- **Database unchanged:** `prisma migrate diff` (live DB → new schema) = "empty migration". No new migration.
- `prisma generate` + `tsc --noEmit` ✅.
- Docs: `docs/data-model.md` schema block + rules text updated; `AGENTS.md` pinned "API JSON" row
  changed (was "TypeScript/Prisma use camelCase and map") and the Retention row now says `gateway_status_raw`.
- **Not updated yet:** the old camelCase field names are still used in `docs/UI.md` (9), `docs/architecture.md` (3) and
  `docs/launch-checklist.md` (1).

## Build order step 2: `auth` (API-key guard) + `accounts` minimal

### T10. `ApiKeyGuard`: done

Source: `docs/api.md` ("Auth: `Authorization: Bearer ck_live_…`", Errors table, API keys) and
`docs/architecture.md` §2.1 / request flow step 2.

| File | What |
| --- | --- |
| `src/auth/api-key.guard.ts` | reads `Authorization: Bearer ck_live_…` → `sha256` → `api_keys.key_hash` (only `status = 'active'`) → loads the account; puts it on the request |
| `src/auth/current-account.decorator.ts` | `@CurrentAccount()` so controllers get the account |
| `src/auth/auth.module.ts` | exports the guard |

Behaviour (from the docs):
- no header, wrong format, unknown key, revoked key → `401 {"detail":"unauthorized"}`
- account `suspended` → `403 {"detail":"account_suspended"}`
- sets `api_keys.last_used_at`

Not in this task: dashboard session cookie / Google OAuth (Phase 2 dashboard), `/v1/me` (session only).

Decisions (answered 2026-09-21):
1. Account `closed` → `401 unauthorized`.
2. `last_used_at` → updated only when older than 60 s.
3. First account + key → `prisma/seed.ts` (plans free/starter/pro from AGENTS.md, one account, one
   key, raw key printed once; run with `npx prisma db seed`).

Built (approved 2026-09-21):

| File | What |
| --- | --- |
| `src/auth/api-key.guard.ts` | `ApiKeyGuard` + `@CurrentAccount()` decorator (one file). Key must match `ck_live_` + 32 chars before any DB lookup |
| `prisma/seed.ts` | upserts plans free/starter/pro, account `dev@example.com`, a free-plan subscription, and one key if the account has none. Prints the raw key once |
| `prisma.config.ts` | `seed: 'ts-node --transpile-only prisma/seed.ts'` |
| `prisma/schema.prisma` | generator `importFileExtension = ""`: ts-node couldn't load the generated client's `./enums.js` imports |

- **Changed from the proposal:** no `auth.module.ts`. The guard only needs `PrismaService`, which is global,
  so `@UseGuards(ApiKeyGuard)` works without a module. No route uses the guard yet; `payments` (step 4) will be the first.
- Plan monthly fees aren't in the docs, so they're left at `0`.
- Checked: `tsc --noEmit` ✅, `npm run lint` ✅, `nest build` ✅, ts-node loads the generated client ✅.
- **Not run:** the seed (you run it, so the raw key isn't printed in my output) and tests (as asked).

## Backend architecture rule (2026-09-21)

Every feature = its own folder with **hand-written** `<feature>.module.ts` (wiring), `<feature>.service.ts`
(business logic) and `<feature>.controller.ts` (HTTP only: routes, DTOs, guards → calls the service).
**Never** `nest g module|controller|service`. Features without HTTP (prisma, payway) have no controller.

### T10b. Align existing code with the rule: done

| Before | After |
| --- | --- |
| `PrismaModule` lived inside `prisma/prisma.service.ts` | `prisma/prisma.module.ts` (global) + `prisma/prisma.service.ts` |
| `auth/` had no module; decorator inside the guard file | `auth/auth.module.ts` (provides + exports `ApiKeyGuard`), `auth/api-key.guard.ts`, `auth/current-account.decorator.ts` |
| `AppModule` imported `PrismaModule` only | imports `PrismaModule`, `AuthModule` |

Checked: `tsc` ✅, lint ✅, boot ✅ (`AppModule`, `PrismaModule`, `AuthModule` initialized; `GET /x` → `404 {"detail":"not_found"}`).

Target layout for the next features:

```
src/
  app.module.ts            imports every feature module
  common/                  shared helpers only (filter, pipe, ids, money): no feature logic
  prisma/                  prisma.module.ts, prisma.service.ts
  auth/                    auth.module.ts, api-key.guard.ts, current-account.decorator.ts
  payway/                  payway.module.ts, payway.gateway.ts (abstract), fake-payway.gateway.ts
  stores/                  stores.module.ts, stores.controller.ts, stores.service.ts, dto/
  payments/ webhooks/ …    same pattern
```

## Build order step 3: `stores` (+ link validation behind `PaywayGateway`, fake impl)

Source: `docs/api.md` § Stores, `docs/architecture.md` §2.1 + §4, `docs/bakong-gateway-notes.md` §6,
AGENTS.md hard rules 2 + 10. Split into three small tasks, one at a time.

### T11. `PaywayGateway` interface + `FakePaywayGateway` (link check only): proposed

| File | What |
| --- | --- |
| `src/payway/payway.gateway.ts` | abstract class `PaywayGateway` (used as the Nest injection token) with `verifyLink(raw_link): Promise<boolean>` = page has `aba_data` + `request_time`. `createHostedCheckout` / `fetchHostedStatus` get added in step 4 / 6, when something uses them |
| `src/payway/fake-payway.gateway.ts` | no HTTP. Accepts any `https://link.payway.com.kh/<slug>`; a slug starting with `invalid` returns `false`, so tests can hit `400 invalid_payment_link` |
| `src/payway/payway.module.ts` | binds `PaywayGateway` → fake **only when `ENABLE_DEV_GATEWAY=true`**; exports `PaywayGateway`. No controller (no HTTP) |

Question: with `ENABLE_DEV_GATEWAY` off there is no real gateway yet (Phase 2). Proposal: the app
**refuses to boot** ("no PaywayGateway: set ENABLE_DEV_GATEWAY=true until the real one exists"),
so the fake can never mark a real link verified (hard rule 10).

### T12. Stores CRUD: proposed (after T11)

- Files: `stores/v1/stores.module.ts` (imports `AuthModule`, `PaywayModule`), `stores/v1/stores.controller.ts`
  (routes + `@UseGuards(ApiKeyGuard)` + DTOs → service), `stores/v1/stores.service.ts` (limits, uniqueness, white-label
  check, link verify, Prisma), `stores/dto/*.dto.ts` (class-validator rules), `stores/store.response.ts` (DB row → api.md JSON).
- `POST /v1/stores`, `GET /v1/stores`, `GET /v1/stores/:id`, `PATCH /v1/stores/:id`, all behind `ApiKeyGuard`.
- DTO rules from the Fields table (422 on bad input), store object serializer (snake_case JSON, `link` nested, ISO timestamps).
- Errors: `400 store_limit_reached` (plan `max_stores`), `409 external_id_taken`,
  `403 whitelabel_not_enabled` (non-null branding without `whitelabel_enabled`), `404 store_not_found`
  (includes another account's store), `400 invalid_payment_link` when `link` is sent.
- Optional `link` in the body: verify via `PaywayGateway`, set `verified_at`, store → `active`.

### T13. Link + enable/disable: proposed (after T12)

- `PUT /v1/stores/:id/link`, `POST /v1/stores/:id/disable`, `POST /v1/stores/:id/enable`.
- Guarded status changes (`updateMany` + `count`, hard rule 3).

Not in step 3: `POST /v1/stores/:id/telegram/test` (needs Telegram; comes with observability), and the
dashboard-session alternative to the API key.

Question for T12/T13: `docs/api.md` says "every mutation writes an audit row". Add `audit_logs` rows now
(`store.created`, `store.updated`, `store.link_set`, `store.disabled`, `store.enabled`), or later all at once?

## Frontend: dashboard UI (`docs/UI.md`)

Paused backend step 3 (T11–T13 still proposed) to start the UI, at your request.
Source: `docs/UI.md` (layout/UX), data shapes + error codes from `docs/api.md`. Mock data layer only
(no backend calls yet), so switching to the real API later only changes the URL.

Build order from `docs/UI.md` ("start with /dashboard, /dashboard/new, and the store layout shell"):

| Task | What | Status |
| --- | --- | --- |
| T14 | Foundation: install deps, shadcn/ui init, `lib/config.ts` (product name), `lib/types.ts`, `lib/mock.ts` (2 stores, ~40 payments, fake delays + `{detail}` errors) | done |
| T15 | `/dashboard`: top bar + "Your stores" list + empty state | done |
| T16 | `/dashboard/new`: create-store form (react-hook-form + zod, link popover, plan-limit card) | done |
| T17 | `/dashboard/[storeId]` layout shell: sidebar, store switcher, nav, quota ring, theme toggle, mobile drawer | done |
| T18+ | Overview, Payments, API keys, Webhooks, Settings (one task each) | later |

### T14. Frontend foundation: done (approved 2026-09-21, with the 4 proposals below)

- Install: `shadcn` (init + Sidebar, Card, Table, Dialog, Sheet, Popover, Badge, Input, Tabs, Sonner toast,
  Button, Label, DropdownMenu, Skeleton), `react-hook-form`, `zod`, `@hookform/resolvers`, `recharts`,
  `lucide-react`, `qrcode`, `next-themes`. All listed in `docs/UI.md` STACK, except `next-themes` (for the dark-mode toggle).
- `src/lib/config.ts`: `PRODUCT_NAME = "[Product name]"`, `API_URL = "http://localhost:3001"`.
- `src/lib/types.ts`: Account, Store, Payment, ApiKey, WebhookEndpoint, WebhookDelivery.
- `src/lib/mock.ts`: `getAccount()`, `getStores()`, `getStore(id)`, `createStore(body)`, `getPayments(storeId)`;
  seeded data; errors thrown as `{ detail: "<code>" }`.
- Read the relevant `node_modules/next/dist/docs/` guides first (frontend/AGENTS.md: "This is NOT the Next.js you know").

### Doc conflicts found in `docs/UI.md` (api.md wins, per AGENTS.md)

1. **Field names:** UI.md's types are camelCase (`externalId`, `quotaUsed`), but the same doc says mock shapes must
   match api.md's snake_case JSON. Proposal: **snake_case types** (`external_id`, `raw_link`), same as the API and the DB.
2. **Quota reset date:** the Overview says "resets Oct 3", the sidebar says "resets Oct 1". Quota is per calendar month → **1st of next month**.
3. **"/dashboard" subtitle:** says each store has its own "webhooks, and API keys", but keys/v1/webhooks are
   account-level (UI.md itself + api.md). Proposal: "Each store has its own payment link. API keys, webhooks, your plan
   and monthly quota are shared across all of them."
4. **Not specified:** a login page and a Billing page (both are linked from the UI). Proposal: mock signed-in user;
   Billing link goes to a placeholder until specced.

### T14–T17: what was built (done)

**T14 foundation**
- `npx shadcn init` picked the **`base-nova` style = Base UI, not Radix**. Links-as-buttons use
  `render={<Link …/>}` + `nativeButton={false}` (no `asChild`). It also added the `cn` package (by shadcn,
  replaces `clsx` + `tailwind-merge`); checked: official repo, no install scripts.
- Installed: react-hook-form, zod 4, @hookform/resolvers, recharts, lucide-react, qrcode (+ types), next-themes, sonner.
- `src/lib/config.ts`, `src/lib/types.ts` (snake_case, api.md shapes + `ApiError`), `src/lib/mock.ts`
  (2 stores, 40 seeded payments over 14 days, `createStore` with the api.md errors:
  `store_limit_reached`, `external_id_taken`, `invalid_payment_link`; a link slug starting `invalid` simulates "no aba_data").
- `src/hooks/use-data.ts`: tiny client loader (`{ data, error }`); results from an old `key` read as loading.
- Root layout: fonts, `ThemeProvider` (next-themes), `TooltipProvider`, `Toaster`; `/` redirects to `/dashboard`.
- Mock account is on **Starter** (the 2 seeded stores don't fit Free's 1). Set `planCode = "free"` in `mock.ts` to see the plan-limit card.

**T15 `/dashboard`**: `components/top-bar.tsx` (logo, email, Sign out), `components/empty-state.tsx`,
`app/dashboard/(home)/page.tsx` (store rows, skeletons, empty state, error line). `(home)` is a route group with the top-bar layout.

**T16 `/dashboard/new`**: `app/dashboard/(home)/new/page.tsx`. zod rules (name 1–120 trimmed; link must be
`https://link.payway.com.kh/<slug>`), errors on blur/submit, submit disabled until valid, spinner "Creating…",
link popover with 3 steps, slug sent as `merchant_account_id`, error banner + `invalid_payment_link` →
"We couldn't verify this payment link.", toast + redirect to the new store, Esc → `/dashboard`, plan-limit card.

**T17 store shell**: `app/dashboard/[storeId]/layout.tsx` + `components/app-sidebar.tsx`, `store-switcher.tsx`,
`quota-ring.tsx`, `theme-toggle.tsx`. Store + account nav, quota ring (`used / limit · plan · resets <1st of next month>`),
email, theme toggle, Sign out. Mobile: shadcn Sidebar turns into a drawer (hamburger in a top header).

Also: `app/dashboard/(home)/v1/billing/page.tsx` placeholder (conflict 4); `app/dashboard/[storeId]/page.tsx` placeholder
Overview so "Create store" has a landing page.

Fixed while linting: shadcn's `hooks/use-mobile.ts` failed `react-hooks/set-state-in-effect`, so it now uses `useSyncExternalStore`.

Checked: `tsc` ✅, `npm run lint` ✅, `npm run build` ✅, `next start` → `/` 307 → `/dashboard`; `/dashboard`,
`/dashboard/new`, `/dashboard/billing`, `/dashboard/<store>` all 200. **Not clicked through in a browser.**

Known gaps (later tasks):
- Sidebar links **Payments, Settings, API keys, Webhooks → 404** until T18+. `/dashboard/keys` and
  `/dashboard/webhooks` currently hit `[storeId]` → "store not found" until their pages exist.
- Sign out is a mock toast (no auth yet).
- Mock data resets on a full page reload (in-memory).
- `api.md` has **no endpoint for quota used** (`GET /v1/billing/subscription` returns the plan only). The UI needs it
  for the quota ring; the mock computes it. Needs an api.md decision before the real API is wired.
- `next` warned it runs under **Rosetta 2** (x86-64 Node on Apple Silicon); an arm64 Node would be faster.

## Doc conflicts / notes

- `docs/roadmap.md` says "ESLint + Prettier". `backend/package.json` uses **oxlint** (`npm run lint`).
  Kept oxlint. Tell me if you want ESLint.
- The Prisma version isn't pinned in AGENTS.md. Started on 6 (T1), moved to 7.10 at your request (T8).
