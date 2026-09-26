/** A readable sentence per error code. The code is the contract; the sentence may be reworded any time. */
const MESSAGES: Record<string, string> = {
  // 400
  amount_too_high: "The amount is above the store's payment link maximum.",
  amount_too_low: "The amount is below the store's payment link minimum.",
  email_already_taken: 'This email is already used by another account.',
  invalid_date: 'The date must be YYYY-MM-DD.',
  invalid_oauth_state: 'The sign-in request expired or was tampered with. Sign in again.',
  invalid_payment_link: 'The payment link is not a valid ABA PayWay link.',
  key_limit_reached: 'Your plan allows no more API keys.',
  merchant_store_disabled: "This merchant's store is disabled.",
  offline_qr_requires_a_confirmation_source: 'An offline QR cannot be confirmed, so it cannot be created.',
  payment_link_disabled: 'This store has no active payment link.',
  payment_link_currency_not_supported: 'Only USD payment links are supported (this link is {reason}).',
  store_disabled: 'This store is disabled.',
  store_limit_reached: 'Your plan allows no more stores.',
  store_required_or_merchant_required: 'Give a store or a merchant: this account has more than one active store.',
  webhook_limit_reached: 'Your plan allows no more webhook endpoints.',
  // 401 / 402 / 403
  unauthorized: 'Missing or invalid API key.',
  invalid_session: 'You are not signed in, or your session expired.',
  quota_exceeded: "Your plan's monthly payment quota is used up.",
  account_suspended: 'This account is suspended.',
  csv_export_not_available: 'CSV export is not included in your plan.',
  whitelabel_not_enabled: 'Branding fields need the white-label option.',
  // 404
  not_found: 'This URL does not exist.',
  key_not_found: 'API key not found.',
  merchant_not_found: 'Merchant not found.',
  payment_not_found: 'Payment not found.',
  store_not_found: 'Store not found.',
  webhook_not_found: 'Webhook endpoint not found.',
  // 409 / 410
  external_id_taken: 'Another store already uses this external_id.',
  payment_already_paid: 'This payment is already paid.',
  payment_already_reversed: 'This payment is already reversed.',
  payment_not_expired: 'Only an expired or failed payment can be reissued.',
  payment_not_paid: 'Only a paid payment can be reversed.',
  payment_reversed: 'This payment was reversed.',
  terms_version_superseded: 'These terms were replaced by a newer version.',
  qr_expired: 'This QR code can no longer be paid.',
  // 422 / 5xx
  validation_error: 'The request has invalid fields. See detail.',
  invalid_amount: 'The amount must be a number with at most 2 decimals.',
  internal_error: 'Something went wrong on our side.',
  payway_hosted_error: 'ABA could not create the QR code.',
  google_oauth_not_configured: 'Google sign-in is not configured.',
  google_unavailable: 'Google sign-in is unavailable. Try again.',
};

/**
 * Every failure leaves as `{ "error": "<code>", "message": "<sentence>" }` (docs/api.md § Errors),
 * plus `detail` (the field list) on a 422 validation error.
 * A code may carry a reason after ": " (`payway_hosted_error: mint_timeout`); it goes into the message,
 * in place of `{reason}` if the sentence has one, else appended in brackets.
 */
export class ApiError extends Error {
  readonly code: string;
  private readonly reason: string | undefined;

  constructor(
    readonly status: number,
    code: string,
    readonly detail?: unknown,
  ) {
    super(code);
    [this.code, this.reason] = code.split(/: (.*)/s);
  }

  body() {
    const text = MESSAGES[this.code] ?? this.code;
    const message = !this.reason ? text : text.includes('{reason}') ? text.replace('{reason}', this.reason) : `${text} (${this.reason})`;
    return {
      error: this.code,
      message,
      ...(this.detail !== undefined && { detail: this.detail }),
    };
  }
}

const err = (status: number) => (code: string, detail?: unknown) => new ApiError(status, code, detail);

export const badRequest = err(400);
export const unauthorized = err(401);
export const paymentRequired = err(402);
export const forbidden = err(403);
export const notFound = err(404);
export const conflict = err(409);
export const gone = err(410);
export const unprocessable = err(422);
export const badGateway = err(502);
export const unavailable = err(503);
