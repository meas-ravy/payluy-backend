import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { renderCheckoutPage } from './checkout.page';
import { CheckoutService } from './checkout.service';

const PRODUCT_NAME = process.env.PRODUCT_NAME ?? '[Product name]'; // placeholder, configurable (AGENTS.md)

/** Public hosted checkout (docs/api.md): no auth. HTTP only; logic in CheckoutService. */
export function checkoutController(checkout: CheckoutService): Router {
  const r = Router();

  r.get('/:id', async (req, res) => {
    const p = await checkout.find(req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    if (!p) {
      res.status(404).type('html').send('<!doctype html><title>Not found</title><p>Payment not found.</p>');
      return;
    }
    // inline script allowed only with this request's nonce; images from us (QR) and https (store logo)
    const nonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' https:; connect-src 'self'; base-uri 'none'; form-action 'none'`,
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.type('html').send(renderCheckoutPage(p, { productName: PRODUCT_NAME, nonce, qrLive: checkout.isQrLive(p) }));
  });

  r.get('/:id/qr.svg', async (req, res) => {
    const svg = await checkout.qrSvg(req.params.id); // 410 once the code is dead
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    res.send(svg);
  });

  r.get('/:id/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await checkout.status(req.params.id));
  });

  return r;
}
