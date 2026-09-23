import type { payments } from '../../generated/prisma/client';
import { formatCents } from '../../lib/money';

const iso = (d: Date | null) => d?.toISOString() ?? null;
const origin = () => (process.env.PUBLIC_ORIGIN ?? 'http://localhost:3001').replace(/\/+$/, '');

/** Fields every payment view shares. `approved_at` = when it was paid. */
function base(p: payments) {
  return {
    id: p.public_id,
    status: p.status,
    amount: formatCents(p.amount_cents),
    currency: p.currency,
    reference_id: p.reference_id,
    approved_at: iso(p.paid_at),
  };
}

/** `POST /v1/payments` (and later reissue/reverse): the only responses that carry `checkout_url`. */
export function toCreatedPayment(p: payments) {
  return {
    ...base(p),
    metadata: p.metadata,
    qr_string: p.qr_string,
    checkout_url: `${origin()}/pay/${p.public_id}`,
    created_at: p.created_at.toISOString(),
    expires_at: p.expires_at.toISOString(),
  };
}

/** `GET /v1/payments/:id`: the payment object table of docs/api.md, plus metadata + qr_string. */
export function toPaymentDetail(p: payments) {
  return {
    ...base(p),
    metadata: p.metadata,
    qr_string: p.qr_string,
    paid_at: iso(p.paid_at),
    reversed_at: iso(p.reversed_at),
    detection_closed_at: iso(p.detection_closed_at),
    created_at: p.created_at.toISOString(),
    expires_at: p.expires_at.toISOString(),
  };
}

/** reissue / reverse: "the payment object with checkout_url" (docs/api.md). */
export function toPaymentWithCheckout(p: payments) {
  return { ...toPaymentDetail(p), checkout_url: `${origin()}/pay/${p.public_id}` };
}

/** A `GET /v1/payments` row: carries `store`, never metadata / qr_string / checkout_url. */
export function toPaymentRow(p: payments & { store: { public_id: string } }) {
  return {
    ...base(p),
    store: p.store.public_id,
    paid_at: iso(p.paid_at),
    reversed_at: iso(p.reversed_at),
    detection_closed_at: iso(p.detection_closed_at),
    created_at: p.created_at.toISOString(),
    expires_at: p.expires_at.toISOString(),
  };
}
