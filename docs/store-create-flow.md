# Creating a store with a payment link — the code path

Written for a developer working in this repo. A line-by-line trace of what happens between
`POST /v1/stores` and the two rows that end up in Postgres. Contract lives in `docs/api.md`;
this file only follows the code. Companion: [payment-link-flow.md](payment-link-flow.md).

## The request

```http
POST /v1/stores
Authorization: Bearer ck_live_…
Content-Type: application/json

{
  "name": "Sunrise Coffee",
  "external_id": "shop-42",
  "link": {
    "raw_link": "https://link.payway.com.kh/ABAPAYxxxx",
    "merchant_account_id": "ABAPAYxxxx",
    "merchant_name": "Sunrise Coffee Co Ltd"
  }
}
```

The dashboard sends the same thing:
[new/page.tsx:59](../frontend/src/app/dashboard/(home)/new/page.tsx#L59) asks for a name and a link,
pulls `merchant_account_id` out of the URL with the slug capture group, and calls `createStore`.

## Step 0 — routing and auth

`app.ts:34` mounts the router at `/v1/stores`, and the router's first line is `r.use(auth)`
([stores.controller.ts:11](../backend/src/modules/stores/stores.controller.ts#L11)).

[`accountAuth`](../backend/src/middleware/auth.ts#L21) accepts **either** a Bearer key or the
dashboard session cookie — if an `Authorization` header is present it is judged on the key alone.
The key is looked up by `sha256(raw)` (we never store the key itself), `last_used_at` is touched at
most once a minute, and then `checkStatus` turns a missing/closed account into `401` and a
suspended one into `403 account_suspended`. The account lands on `req.account`; every service call
below takes it as its first argument, which is what makes cross-account access impossible.

## Step 1 — validation (controller)

[stores.controller.ts:13](../backend/src/modules/stores/stores.controller.ts#L13):

```ts
res.status(201).json(toStoreResponse(await stores.create(currentAccount(req), body(createStoreSchema, req))));
```

That one line is the whole controller: validate → call the service → shape the response. Controllers
never touch Prisma.

`body()` runs [`parse`](../backend/src/middleware/validate.ts#L17), which on failure throws
`422 { error: "validation_error", message, detail: [{location, message, input}] }`. `createStoreSchema`
([stores.schema.ts:31](../backend/src/modules/stores/stores.schema.ts#L31)) is a **strictObject**, so
an unknown field is a `422 unknown_field`, not silently ignored.

Note what the schema deliberately does *not* check: `raw_link` is just `z.string()`. A malformed
PayWay URL must come back as `400 invalid_payment_link` (a business rule), not as a 422 field
error — so the service owns that check.

`nullish()` on the optional fields is the "`null` clears it" contract; `city` is `optional()` only,
because the column is NOT NULL with a default.

## Step 2 — the service, in order

[stores.service.ts `create`](../backend/src/modules/stores/stores.service.ts#L51):

```ts
const { link, ...fields } = dto;
assertBranding(account, fields);
await assertStoreLimit(account.id);
const verified = link && (await verifyLink(link)); // network call: keep it outside the transaction
```

**2a. `assertBranding`** ([:160](../backend/src/modules/stores/stores.service.ts#L160)) — sending
`brand_color`, `logo_image_url` or `whitelabel_css` non-null without `account.whitelabel_enabled` is
`403 whitelabel_not_enabled`. Sending them as `null` is always allowed (you may clear what you
cannot set).

**2b. `assertStoreLimit`** ([:168](../backend/src/modules/stores/stores.service.ts#L168)) — asks
`billing.currentPlan`, and returns immediately when `max_stores` is `null`. Today that is always the
case: plans are parked, `currentPlan` hands back the in-code `UNLIMITED` plan
([billing.service.ts:5](../backend/src/modules/billing/billing.service.ts#L5)), so no store limit
applies. The check is a count-then-insert and carries a `ponytail:` note saying so — two parallel
creates can both pass it.

**2c. `verifyLink`** ([:176](../backend/src/modules/stores/stores.service.ts#L176)) — the interesting
one:

```ts
if (!PAYWAY_LINK.test(link.raw_link) || !(await payway.verifyLink(link.raw_link))) {
  throw badRequest('invalid_payment_link');
}
```

Two gates, one error code. First the shape (`https://link.payway.com.kh/<slug>`,
[payway.gateway.ts:2](../backend/src/modules/payway/payway.gateway.ts#L2)); then a real HTTP GET of
the page by
[`PaywayHttpGateway.verifyLink`](../backend/src/modules/payway/payway-http.gateway.ts#L24), which
delegates to [`readLinkPage`](../backend/src/modules/payway/payway-http.gateway.ts#L85): 10 s
timeout, follow redirects, and scrape `aba_data` + `request_time` out of the HTML. Missing either →
`aba_data_not_found` → `verifyLink` returns null → `400 invalid_payment_link`. It also reads the
link's `currency` from the same page: not found → `400 invalid_payment_link`; not `USD` →
`400 payment_link_currency_not_supported` ("Only USD payment links are supported (this link is KHR).").

This is **hard rule 10**: a link is never stored as verified without having been fetched. `verified_at`
is only set here, on the object the transaction is about to write:

```ts
return { raw_link, merchant_account_id, merchant_name: … ?? null, verified_at: new Date() };
```

Note `merchant_account_id` is taken from the request, not from the page — we trust the caller for the
label and the page for the proof.

Also note the ordering comment: the fetch happens **before** `prisma.$transaction`. A 10-second
network call must never hold a DB transaction open.

**2d. The transaction** ([:57](../backend/src/modules/stores/stores.service.ts#L57)) — everything
that touches the DB, in one atomic block:

```ts
const store = await tx.stores.create({
  data: {
    ...fields,
    public_id: newStoreId(),
    account_id: account.id,
    status: verified ? 'active' : 'draft',
    link: verified ? { create: verified } : undefined,
  },
  include: { link: true },
});
await audit(tx, account.id, 'store.created', store.id, { link: !!verified });
```

- `public_id` is `randomUUID()` ([lib/ids.ts:9](../backend/src/lib/ids.ts#L9)); the `Int` `id` stays
  internal and never leaves the process.
- `account_id` comes from the authenticated account, never from the body.
- **Status is derived, not sent**: a link that verified → `active`; no link → `draft`. A draft store
  cannot mint payments — `resolveTarget` rejects it with `payment_link_disabled`.
- Prisma's nested `{ create: verified }` writes the `payment_links` row in the same statement batch,
  so a store and its link are born together or not at all.
- The [audit row](../backend/src/modules/audit/audit.service.ts#L11) is written **inside** the same
  transaction. `details` is `{ link: true }` — a boolean, not the link — because audit rows never
  carry secrets (hard rule 6).

**2e. `mapExternalIdTaken`** ([:25](../backend/src/modules/stores/stores.service.ts#L25)) wraps the
whole transaction. The only unique constraint a caller can hit on `stores` is
`@@unique([account_id, external_id])`, so a Prisma `P2002` is translated to `409 external_id_taken`
instead of leaking a 500. Two different accounts can happily use `shop-42`.

## Step 3 — the response

[`toStoreResponse`](../backend/src/modules/stores/stores.view.ts#L6) maps the row to the API object:
`public_id` is published as `id`, timestamps become ISO strings, internal `id`/`account_id` are
dropped, and `link` is nested (or `null`). The controller answers `201`.

Anything thrown along the way — from zod, `badRequest`, `forbidden`, Prisma — lands in the global
[`errorHandler`](../backend/src/middleware/error.ts#L8), which is the only place that writes
`{ error, message }`.

## What exists afterwards

```
stores           ← status 'active', public_id UUID, account_id = caller
payment_links    ← store_id UNIQUE, raw_link, merchant_account_id, verified_at, currency USD,
                   min_amount_cents 1, status 'active'
audit_logs       ← store.created
```

That is the store ready to sell: `POST /v1/payments` with `merchant: "shop-42"` now resolves to this
store, mints a KHQR on this `raw_link`, and the money lands in this merchant's ABA account.

## The other ways in

Same service, same rules, different entry points:

| Call | Function | Difference |
| --- | --- | --- |
| `POST /v1/stores` without `link` | `create` | store is born `draft`, no `payment_links` row |
| `PUT /v1/stores/:id/link` | [`setLink`](../backend/src/modules/stores/stores.service.ts#L91) | verifies, then `attachLink` |
| `PATCH /v1/stores/:id` with `link` | [`update`](../backend/src/modules/stores/stores.service.ts#L75) | same, plus the other fields |

[`attachLink`](../backend/src/modules/stores/stores.service.ts#L190) is where replacing differs from
creating: it **upserts** on `store_id` (one link per store), so a replacement overwrites in place and
old payments keep pointing at the same row — there is no link history. The promotion to `active` is a
guarded `updateMany({ where: { id, status: 'draft' } })` (hard rule 3), so attaching a link to a
*disabled* store does not silently re-open it; it stays disabled until `enable`.

## Failure modes, in one table

| What went wrong | Where | Answer |
| --- | --- | --- |
| No/invalid key, closed account | `accountAuth` | `401 unauthorized` |
| Account suspended | `checkStatus` | `403 account_suspended` |
| Missing `name`, bad email, unknown field | `createStoreSchema` | `422 validation_error` + `detail: [{location,message,input}]` |
| Branding without the entitlement | `assertBranding` | `403 whitelabel_not_enabled` |
| Plan store limit (currently never) | `assertStoreLimit` | `400 store_limit_reached` |
| Not a PayWay URL | `PAYWAY_LINK` | `400 invalid_payment_link` |
| Page missing `aba_data`, ABA down, timeout | `readLinkPage` | `400 invalid_payment_link` |
| Link currency is not USD (e.g. KHR) | `stores.service` `verifyLink` | `400 payment_link_currency_not_supported` |
| `external_id` already used in this account | `mapExternalIdTaken` | `409 external_id_taken` |

Note the third and fourth rows collapse to the same code on purpose: from the caller's side "this
link is not usable" is one condition. The gateway's internal reason (`link_page_http_404`,
`aba_data_not_found`) is swallowed by the `try/catch` in `verifyLink` — if you need to debug a
rejected link, that is the catch to instrument.
