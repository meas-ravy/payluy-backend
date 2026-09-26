# The payment link: what it is, how the code uses it, why one per store

Written for a developer joining this repo who has an ABA PayWay link in hand and wants to know
what the system does with it. Source of truth stays `docs/api.md` / `docs/architecture.md`; this
file only connects them to the code.

## 1. What a payment link is

A PayWay share link looks like `https://link.payway.com.kh/ABAPAYxxxx`. A merchant creates it
once inside their own ABA app. It is a public page that mints a KHQR for whoever opens it, and
**money paid against it lands in that merchant's own ABA account**. We never touch the money
(AGENTS.md hard rule 1).

The slug is the `merchant_account_id`. The regex lives in one place:
[payway.gateway.ts:2](backend/src/modules/payway/payway.gateway.ts#L2).

The page carries two hidden values, `aba_data` and `request_time`. Those are the whole trick:
they are the credentials ABA's unofficial hosted-checkout API accepts. Everything below is built
on scraping them.

## 2. Why a payment link at all

The obvious design would be "get API credentials from the bank and call them". We do not, and the
reason is in `docs/bakong-gateway-notes.md` §1–§2 and §6 — measured on a real 0.10 USD payment on
2026-09-17, not assumed.

Three options existed:

| Option | Why not |
| --- | --- |
| **Bakong Open API credentials** | Needs a Bakong account per merchant, or one credential acting for many sub-merchants — which was never established (§1, still **open**). It also puts us in the middle of the money, which is the one thing this product must not be. `BAKONG_API_TOKEN` is empty and stays empty |
| **Build the KHQR ourselves (offline TLV)** | We *can* — `khqr/` encodes EMVCo TLV + CRC-16 correctly. But nothing on ABA's side has a record of that code, so a wallet answers **"QR not found"**, and there is nothing to poll. Not payable. This is why [payments.service.ts:65](../backend/src/modules/payments/payments.service.ts#L65) rejects `hosted_qr: false` outright with `offline_qr_requires_a_confirmation_source` |
| **PayWay merchant API** | A per-merchant commercial onboarding with ABA for every shop. That is the thing a POS provider comes to us to avoid |

The link wins because of one property: **the link page itself is the authorisation.** `aba_data` +
`request_time` scraped from that public page are all ABA needs to mint a real, payable, poll-able
checkout. No API key, no signed request, no browser, no bank onboarding.

What that buys the product:

- **Self-serve onboarding.** A merchant pastes a URL they already own; the store is live in one
  request. No contract, no credential exchange, no waiting on ABA.
- **Multi-tenant with zero shared credentials.** Each store carries its own authorisation, so one
  account can hold thousands of merchants without any of them trusting us with a secret
  (`docs/bakong-gateway-notes.md` §1: "the link *is* the authorisation").
- **Direct-to-merchant money, structurally.** We cannot pool funds even if we wanted to: the mint is
  bound to the merchant's own link, so the payment can only land in their account. That keeps hard
  rule 1 true by construction rather than by discipline.

The cost is stated honestly in §8: it is a scraped page, not a contract.

## 3. What the code can do with a link — and what it can't

| Capability | Where | Notes |
| --- | --- | --- |
| Prove a link is real | `verifyLink` → `readLinkPage` | Only signal we have: the page carries `aba_data` + `request_time` |
| Mint a payable KHQR for an arbitrary amount | `createHostedCheckout` | The amount is ours, per sale: `additional_fields: {"amount":"12.50"}` |
| Know whether that one QR was paid | `fetchHostedStatus` | Keyed by the `client_id`/`token`/`request_time` triple from the mint |
| Get the bank's transaction id | `HostedStatus.tran_id` | → `payments.bank_ref` once `approved` |
| Mint again for the same sale | `reissue` | A fresh session; the root payment ties them together |
| Charge different shops separately | one link per store | See §7 |

And what a link cannot give us, which explains several design choices:

- **No callback.** ABA does not push. That is the whole reason `detection/` exists as a 30 s polling
  sweep — strategy B in `docs/bakong-gateway-notes.md` §6, because strategy A was not available.
- **No ledger access.** We can ask about a checkout we minted; we cannot list a merchant's
  transactions or reconcile against a statement. So a payment we never minted is invisible to us,
  and `reverse` can only *record* a refund someone else performed (hard rule 1).
- **No authoritative expiry.** ABA says `expire_in_sec: 180`, but a real payment was observed
  arriving **9.5 minutes** after that. Hence `expired` is not terminal: the sweeper keeps polling
  expired rows, and a row can go `expired` → `paid`, firing `payment.completed` after
  `payment.expired`. The dashboard must render that as a recovery, not a contradiction.
- **No min/max from the rail.** Unknown (`docs/bakong-gateway-notes.md` §5, open), so the limits are ours:
  `min_amount_cents` / `max_amount_cents` on the `payment_links` row, enforced by `assertAmount`.
- **No stable contract.** The endpoints are unofficial and the page can change shape at any time,
  which is why hard rule 2 confines every ABA call to `PaywayGateway`.

## 4. Giving us the link (store create / link attach)

`POST /v1/stores` with a `link`, or `PUT /v1/stores/:id/link` later.

[stores.service.ts `verifyLink`](backend/src/modules/stores/stores.service.ts#L177) does two things
before anything is stored:

1. the URL matches `PAYWAY_LINK`;
2. `payway.verifyLink()` actually fetches the page and finds `aba_data` + `request_time`
   ([payway-http.gateway.ts `readLinkPage`](backend/src/modules/payway/payway-http.gateway.ts#L96)).

Only then do we write a `payment_links` row with `verified_at` set (hard rule 10 — never mark a
link verified without having fetched it). A store created without a link stays `draft`; attaching
a verified link promotes it to `active`
([`attachLink`](backend/src/modules/stores/stores.service.ts#L190)).

The link row also carries the payment rules for that merchant: `currency`, `min_amount_cents`,
`max_amount_cents`. One row per store — `store_id` is `@unique` — so replacing a link overwrites
it in place and old payments keep pointing at the same row.

## 5. Selling something (mint a QR)

`POST /v1/payments` → [payments.service.ts `create`](backend/src/modules/payments/payments.service.ts#L64):

1. **Which store?** `stores.resolveTarget` resolves `merchant` (the POS's own id) → `store` (our
   public id) → "the account's single active store". A store with no active link fails with
   `payment_link_disabled`. This is the step that decides whose bank account gets the money.
2. **Idempotency** — a repeated `idempotency_key` returns the existing payment (200, not 201).
3. **Amount** against the link's min/max, then quota.
4. **Mint** — `payway.createHostedCheckout(link.raw_link, "12.50")`
   ([payway-http.gateway.ts:41](backend/src/modules/payway/payway-http.gateway.ts#L41)): re-reads
   the link page for fresh `aba_data`/`request_time`, posts them plus
   `sha512(request_time + aba_data + {"amount":"12.50"})` to ABA, and gets back
   `qr_string`, `client_id`, `token`, `expire_in_sec`.
5. **Store the row**: the `qr_string` is the payable KHQR; `expires_at` is *ABA's* lifetime, not
   ours; and `{clientId, requestTime, token}` go into `gateway_status_raw.paywayHosted` — that is
   the handle detection polls with. The `token` is a secret: never logged, never returned
   (hard rule 6).

The POS gets back `qr_string` (render it yourself) and `checkout_url` (our hosted `/pay/:id` page,
which serves the KHQR card `qr.svg`, drawn by `khqr.service.ts`).

So: **one payment link → many QR codes**, one per sale, each with its own amount and its own ABA
session. The link is the merchant's identity; the QR is one sale.

## 6. Detecting payment

We have no callback from ABA, so we poll. The sweeper claims rows with `FOR UPDATE SKIP LOCKED`
and calls [detection.service.ts `check`](backend/src/modules/detection/detection.service.ts#L25):
it reads the saved session, asks
[`fetchHostedStatus`](backend/src/modules/payway/payway-http.gateway.ts#L69), and treats
`action: "approved"` as paid (`tran_id` → `bank_ref`). Every poll is appended to
`attempt_history`, never with the token.

Sweep every 30 s, batch 20, for 1 hour after creation (AGENTS.md pinned). `expired` is **not**
terminal — a customer can scan a stale-looking QR and ABA will still approve it, so we keep
polling. Only `paid`, `reversed`, `failed` stop detection.

On `markPaid` the outbox writes the payment state change + `Event` + `EventDelivery` in one
transaction (hard rule 4); the webhook sender delivers it HMAC-signed to the account's endpoint,
tagged with the store so the POS knows which merchant it belongs to.

If the code died unpaid, `POST /v1/payments/:id/reissue` mints a fresh ABA session for the same
sale, linked to the root payment so that when one of them is paid the others are `superseded`.

## 7. Why multiple stores

A store is **one merchant = one payment link = one bank account**. Our customer is the POS
provider (one account, one API key, one webhook endpoint); their customers are the shops. A store
is how a shop exists in our system.

Concretely, one store per merchant is what makes these possible:

| Need | What a store provides |
| --- | --- |
| Money must reach the *right* shop | `resolveTarget` → that store's link → mint on that link. Direct-to-merchant, no pooling, nothing to reconcile |
| The POS already has its own merchant ids | `external_id` (unique per account) so they send `merchant: "shop-42"` and never store our ids |
| Per-shop rules | currency, min/max amount live on that shop's `payment_links` row |
| Per-shop checkout page | `name`, `city`, logo, brand colour, whitelabel CSS, success/failure redirects |
| Routing one webhook endpoint | every event is tagged with the store; the POS fans out from there |
| Per-shop reporting | `payments.store_id` — reports and CSV slice by store |
| Onboarding and offboarding | a shop starts `draft` (no link yet), goes `active` when its link verifies, `disabled` stops new payments but keeps history |

Without stores you would have exactly one payment link for the whole platform, meaning every
payment lands in one bank account — which would make us a money transmitter, the one thing this
product is designed not to be.

Store ids are UUID v4; stores created before 2026-09-23 keep their old `st_…` ids.

## 8. The link is a scraped page, so

- All ABA HTTP lives in `PaywayGateway` (hard rule 2) and is swappable: the endpoints are
  unofficial and a page change breaks them.
- Link verification can fail for boring reasons (ABA down, merchant deleted the link). The store
  stays `draft`/keeps its old link; nothing half-written is stored.
- Mint errors are short codes (`mint_incomplete`, `mint_timeout`) that surface in API errors and
  `attempt_history` — they must never carry the token.
