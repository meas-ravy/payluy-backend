# Launch checklist

Replaces a production-readiness log. Tick an item only when its test passes.

## P0 — blocks launch

- [ ] **Migrations only.** `prisma migrate deploy` in CI and deploy; app exits if a migration is pending.
- [ ] **Live money path proven.** Real $0.10 payment from your own PayWay link: row goes `paid`,
      signed `payment.completed` arrives and verifies against the raw bytes.
- [ ] **Late settlement.** Expired rows keep polling for the detection window; `expired → paid` works;
      final check sets `detectionClosedAt`; unknown outcome alerts.
- [ ] **No double payable code.** Settling a payment retires its reissued successor (`superseded`, QR `410`).
- [ ] **Reversal recordable.** `POST /v1/payments/:id/reverse`; late poll cannot resurrect it.
- [ ] **Offline QR refused** when nothing can confirm it.
- [ ] **Link validated on attach** — fetch the page, require `aba_data`, else `400`.
- [ ] **CI gate.** Lint + type-check + `prisma migrate` + Jest against Postgres on every push; required on merge.
- [x] **No dev routes.** The `/_dev/*` rail and the fake gateway were removed 2026-09-23.
- [ ] **Session secret guard.** Boot fails on empty or placeholder secret (tested).

## P1 — credible fintech

- [ ] Rate limits (`@nestjs/throttler`, Redis storage): per key for payment create/API, per IP for
      `/pay/*`, `/auth/*`. `429` body + `Retry-After`.
- [ ] CORS allowlist with credentials; never `*`.
- [ ] Audit log on every privileged mutation (keys, webhooks, stores, link changes, suspension, reissue,
      reverse). A test enumerates mutating routes and fails if one is unaudited.
- [ ] Structured logs with trace id; `/metrics`; Telegram alerts actually delivered to a person.
- [ ] Error reporting (dedup repeats so the alert channel is not muted).
- [ ] Retention job purges ABA session tokens after 90 days (runs at boot + daily).
- [ ] Terms / Privacy / Contact pages live; terms acceptance recorded with version.
- [ ] Merchant agreement reviewed by a Cambodian lawyer (`legal/merchant-agreement.md` §7).
- [ ] Written answer from ABA on polling share-link checkouts, or official PayWay API access
      (`legal/on-behalf-of.md`).

## P2 — scale and polish

- [ ] Separate `worker` process; two workers never double-process a job.
- [ ] Frontend test runner (Playwright) for checkout and dashboard.
- [ ] Encrypt webhook signing secrets at rest.
- [ ] Retention policy for events, deliveries and audit rows.
