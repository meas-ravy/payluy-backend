# Roadmap & milestones

Phased plan, with the answers the earlier prototype already found folded in.

## Phase 0 — Rail spike (done in the prototype; re-verify)

Known from `bakong-gateway-notes.md`:

- Payable QR = ABA hosted checkout from the merchant's PayWay link. An offline-built KHQR is
  **not** payable ("QR not found").
- Confirmation = poll ABA `check-payment-status` with the session from mint. `approved` = paid.
- No push/callback on this path. Detection budget = sweep interval (30 s).
- ABA code lives 180 s, but payment was accepted 9.5 min later → keep polling expired rows.

Still open — ask **ABA in writing**:
1. Is polling share-link checkouts permitted use? Or get official PayWay merchant/partner API access.
2. Min/max amounts per link. 3. Any callback available.

**Exit:** a script in `scripts/spike.ts` mints a real $0.10 QR from your link and sees `approved`.

## Phase 1 — Vertical slice

- Nest project, modules per `architecture.md` §2.1. ESLint + Prettier, TS strict.
- Prisma schema from `data-model.md` + first migration; boot refuses if DB is behind.
- `POST /v1/payments`, `GET /v1/payments/:id`, `GET /v1/payments`.
- `PaywayGateway` interface with one implementation: `PaywayHttpGateway` (real ABA).
- Hosted checkout `/pay/:id` (+ `qr.svg`, `status`), success/failure redirects.
- Outbox + webhook sender polling `event_deliveries` (no Redis), HMAC signing, retries.
- Expiry sweeper; guarded transitions; idempotency replay returns the same payment.
- Jest + Supertest against Postgres.

**Exit:** API creates a payment, QR renders, a real payment is detected, a verified webhook arrives,
all under automated tests.

## Phase 2 — Real rail, one merchant (yourself)

- Real `PaywayGateway` (mint + status) behind the same interface.
- Detection processor + 30 s sweep, 1 h window, final check + alert.
- `markPaid` transaction: ledger, retire successors, outbox, double-charge alert.
- Link validation on attach.
- Retention processor (purge ABA session after 90 days).
- Telegram operator alerts (worker stalled, webhook backlog, unknown outcome).
- Dashboard: Google auth, stores, links, API keys, webhooks, payments list.
- Quota enforced at create (`402`).

**Exit:** you accept a live $0.10 payment into your own ABA account and receive the signed webhook.

## Phase 3 — Multi-merchant + hardening

- `POST /v1/stores` auto-provisioning, `external_id` routing, per-plan store limits.
- Reissue, reverse, `superseded` handling.
- `@nestjs/throttler` rate limits; CORS allowlist; audit log on every privileged mutation.
- `prom-client` metrics, trace id in logs, error reporting.
- Docker compose (db, migrate, api, worker, web, nginx); `/health` checks.
- Legal: merchant agreement (no-custody clause), Terms/Privacy, data retention.

**Exit:** external POS provider onboards stores via API and settles real payments.

## Phase 4 — Growth

- Official ABA PayWay API (if granted) as a second `PaywayGateway` implementation with callbacks.
- Bakong Open API reconciliation (needs NBC developer token).
- Test-mode keys + sandbox stores. SDK examples (Node/PHP/Python). KHR currency.

## Carried-over lessons (bugs found in the prototype — avoid them)

- Migrations are the only schema path; never auto-sync in production.
- Test on Postgres, not SQLite.
- JSON columns you "clear" must become SQL `NULL`, not JSON `null`.
- Append to JSON arrays by creating a new array.
- Don't mark a link verified without checking it.
- Bind dev routes to a flag that is hard-coded false in production compose, and 404 them at nginx.
- Telegram returns HTTP 200 with `ok:false` on failure — check the body.
