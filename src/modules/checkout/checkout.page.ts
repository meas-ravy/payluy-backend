import { formatCents } from '../../lib/money';
import type { CheckoutPayment } from './checkout.service';

const DEFAULT_BRAND = '#d61f26'; // "anything else falls back to the default red" (pos-provider-integration.md)
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Everything dynamic goes through this: store names and URLs come from API callers. */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The hosted checkout page (docs/api.md § Hosted checkout): store name, KHQR card with countdown,
 * live status. Polls our own /pay/:id/status (never an API key), stops on a terminal status and
 * redirects to the store's URL if one is set. Branding only with the white-label entitlement.
 */
export function renderCheckoutPage(p: CheckoutPayment, opts: { productName: string; nonce: string; qrLive: boolean }) {
  const { store } = p;
  const branded = store.account.whitelabel_enabled;
  const brand = branded && store.brand_color && HEX.test(store.brand_color) ? store.brand_color : DEFAULT_BRAND;
  const logo = branded && store.logo_image_url ? `<img class="logo" src="${esc(store.logo_image_url)}" alt="">` : '';
  // every "<" stripped so nothing can close <style> or add markup (pos-provider-integration.md)
  const css = branded && store.whitelabel_css ? store.whitelabel_css.replace(/</g, '') : '';
  const amount = `${formatCents(p.amount_cents)} ${esc(p.currency)}`;
  const id = esc(p.public_id);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Pay ${esc(store.name)}</title>
<style>
 /**
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;color:#18181b}
  .card{max-width:380px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  header{background:${brand};color:#fff;padding:14px 18px;display:flex;align-items:center;gap:8px;font-weight:600}
  .logo{height:22px;width:auto;border-radius:4px}
  main{padding:20px;text-align:center}
  .amount{font-size:28px;font-weight:700;margin:4px 0 16px}
  .qr{width:240px;height:240px;margin:0 auto;display:block}
  .qr.dead{opacity:.15}
  .timer{font-variant-numeric:tabular-nums;color:#71717a;margin-top:12px}
  .status{margin-top:12px;font-weight:600}
  .status.paid{color:#16a34a} .status.bad{color:#dc2626}
  footer{padding:10px;text-align:center;font-size:12px;color:#a1a1aa}
</style>
${css ? `<style>${css}</style>` : ''}
</head>
<body>
<div class="card">
  <header>${logo}<span>${esc(store.name)}</span></header>
  <main>
    <div class="amount">${amount}</div>
    <img id="qr" class="qr${opts.qrLive ? '' : ' dead'}" src="/pay/${id}/qr.svg" alt="KHQR code" ${opts.qrLive ? '' : 'hidden'}>
    <div id="timer" class="timer"></div>
    <div id="status" class="status">Scan with your banking app</div>
  </main>
  <footer>${branded ? '' : esc(opts.productName)}</footer>
</div>
<script nonce="${opts.nonce}">
(() => {
  const id = ${JSON.stringify(p.public_id)};
  const qr = document.getElementById('qr'), timer = document.getElementById('timer'), statusEl = document.getElementById('status');
  let expiresAt = new Date(${JSON.stringify(p.expires_at.toISOString())}).getTime();
  const TEXT = {
    pending: ['Scan with your banking app', ''], scanned: ['Confirm in your banking app…', ''],
    paid: ['Payment received ✓', 'paid'], expired: ['This code has expired', 'bad'], failed: ['Payment failed', 'bad'],
    superseded: ['This code was replaced', 'bad'], reversed: ['Payment refunded', 'bad'],
  };
  const TERMINAL = ['paid', 'expired', 'failed', 'superseded', 'reversed'];
  let stopped = false;

  function tick() {
    const s = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    timer.textContent = stopped ? '' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function show(st) {
    const [text, cls] = TEXT[st.status] || [st.status, ''];
    statusEl.textContent = text; statusEl.className = 'status ' + cls;
    if (!st.qr_live) qr.classList.add('dead');
  }
  async function poll() {
    if (stopped) return;
    try {
      const st = await (await fetch('/pay/' + encodeURIComponent(id) + '/status', { cache: 'no-store' })).json();
      expiresAt = new Date(st.expires_at).getTime();
      show(st);
      if (TERMINAL.includes(st.status)) {
        stopped = true; tick();
        if (st.redirect_url) setTimeout(() => location.assign(st.redirect_url), 1500);
        return;
      }
    } catch (e) { /* network blip: try again */ }
    setTimeout(poll, 3000);
  }
  setInterval(tick, 1000); tick(); poll();
})();
</script>
</body>
</html>`;
}
