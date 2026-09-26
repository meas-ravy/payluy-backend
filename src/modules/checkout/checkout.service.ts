import type { accounts, payments, stores } from '../../generated/prisma/client';
import { KhqrService } from '../khqr/khqr.service';
import type { Db } from '../../lib/prisma';
import { gone, notFound } from '../../lib/errors';
import { formatCents } from '../../lib/money';

export type CheckoutPayment = payments & { store: stores & { account: accounts } };

/** Where the page sends the payer, per status (docs/api.md § Hosted checkout). */
const REDIRECT: Partial<Record<string, 'success' | 'failure'>> = { paid: 'success', expired: 'failure', failed: 'failure' };

/** Public hosted checkout: no API key, so nothing here may expose metadata, keys or the ABA session. */
export type CheckoutService = ReturnType<typeof createCheckoutService>;

export function createCheckoutService(
  prisma: Db,
  khqr: KhqrService,
  ) {
  function find(publicId: string): Promise<CheckoutPayment | null> {
    return prisma.payments.findUnique({
      where: { public_id: publicId },
      include: { store: { include: { account: true } } },
    });
  }

  /** The code is payable only while pending/scanned and before ABA's expiry. */
  function isQrLive(p: payments) {
    return (p.status === 'pending' || p.status === 'scanned') && p.expires_at > new Date();
  }

  /**
   * The KHQR card (store name, amount, QR). `410` once the code is dead: expired, superseded, paid…
   * (docs/api.md). One sale can't be paid twice.
   */
  async function qrSvg(publicId: string): Promise<string> {
    const p = await find(publicId);
    if (!p) throw notFound('payment_not_found');
    if (!isQrLive(p)) throw gone('qr_expired');
    return khqr.renderCardSvg(p.qr_string, { name: p.store.name, amount: formatCents(p.amount_cents), currency: p.currency });
  }

  /** What the page polls. Deliberately small. */
  async function status(publicId: string) {
    const p = await find(publicId);
    if (!p) throw notFound('payment_not_found');
    return {
      status: p.status,
      expires_at: p.expires_at.toISOString(),
      qr_live: isQrLive(p),
      redirect_url: redirectUrl(p),
    };
  }

  /** `<store url>?status=<paid|expired|failed>&payment_id=…&reference_id=…`, or null if none configured. */
  function redirectUrl(p: CheckoutPayment): string | null {
    const kind = REDIRECT[p.status];
    const base = kind === 'success' ? p.store.redirect_success_url : kind === 'failure' ? p.store.redirect_failure_url : null;
    if (!base) return null;
    const url = new URL(base);
    url.searchParams.set('status', p.status); // the raw payment status, not success/failed
    url.searchParams.set('payment_id', p.public_id);
    if (p.reference_id) url.searchParams.set('reference_id', p.reference_id);
    return url.toString();
  }

  return { find, isQrLive, qrSvg, status, redirectUrl };
}
