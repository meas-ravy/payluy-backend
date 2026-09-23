import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const TIMEOUT_MS = 10_000;
const PREVIEW_CHARS = 500;

/** `X-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>` (AGENTS.md pinned). */
export function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

// Never let a customer-supplied URL reach our own network (SSRF).
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv6');
}

// ponytail: checks DNS once before the request; a DNS-rebinding host could still switch IPs in between.
// Pin the resolved IP in a custom agent if that ever matters.
async function assertPublicHttps(url: string) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('https_required');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const { address, family } of addrs) {
    const v4 = address.startsWith('::ffff:') ? address.slice(7) : null; // IPv4-mapped IPv6
    const blocked = v4 ? PRIVATE.check(v4, 'ipv4') : PRIVATE.check(address, family === 6 ? 'ipv6' : 'ipv4');
    if (blocked) throw new Error('blocked_destination');
  }
}

export type WebhookResult = {
  status: number | null; // null = no HTTP response (DNS, timeout, blocked…)
  bodyPreview: string;
  error: string | null;
  headers: Record<string, string>;
};

/** One signed POST. Never throws: failures come back as `error`. Redirects are not followed. */
export async function postWebhook(url: string, secret: string, eventType: string, body: string): Promise<WebhookResult> {
  const headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': eventType,
    'X-Webhook-Signature': signWebhook(secret, body),
  };
  try {
    await assertPublicHttps(url);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual', // a 3xx is not an ack, and following it could reach an internal host
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    const ok = res.status >= 200 && res.status < 300;
    return { status: res.status, bodyPreview: text.slice(0, PREVIEW_CHARS), error: ok ? null : `http_${res.status}`, headers };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'TimeoutError' ? 'timeout' : e.message) : 'unknown';
    return { status: null, bodyPreview: '', error: msg.slice(0, PREVIEW_CHARS), headers };
  }
}
