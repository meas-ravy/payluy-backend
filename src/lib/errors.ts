/** Every failure leaves as `{ "detail": … }` (docs/api.md § Errors). `detail` is a code, or the 422 list. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(typeof detail === 'string' ? detail : 'invalid');
  }
}

const err = (status: number) => (detail: unknown) => new ApiError(status, detail);

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
