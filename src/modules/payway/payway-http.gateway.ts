import { createHash, randomBytes } from 'node:crypto';
import { HostedCheckout, HostedSession, HostedStatus, LinkInfo, PAYWAY_LINK, PaywayGateway } from './payway.gateway';

// ⚠️ Unofficial API, reverse-engineered from ABA's public PayWay page (docs/architecture.md §4).
// No contract, no secret in the hash; a page change breaks it. Everything ABA-specific stays in this file.
const ABA_API = 'https://pwapp.ababank.com/api/pw-app/v1';
const MINT_URL = `${ABA_API}/payment/gateway/list-payment-options`;
const STATUS_URL = `${ABA_API}/payment-link/check-payment-status`;
const TIMEOUT_MS = 10_000;

const ABA_DATA = /aba_data\s*[=:]\s*"((?:[^"\\]|\\.)*)"/;
const REQUEST_TIME = /request_time\s*[=:]\s*"?(\d{10,20})"?/;
// the link's own settings object: transaction_summary.order_details.currency ("USD" seen; "KHR" assumed)
const CURRENCY = /currency\s*:\s*"([A-Z]{3})"/;

const sha512 = (s: string) => createHash('sha512').update(s).digest('hex');

type Json = Record<string, unknown>;

/**
 * The real rail (Phase 2). Errors are short codes (`link_page_http_404`, `mint_incomplete`…):
 * they end up in API errors and attempt_history, so they must never contain the session token.
 */
export class PaywayHttpGateway extends PaywayGateway {
  /** Hard rule 10: verified only if the page really carries aba_data + request_time. */
  async verifyLink(rawLink: string): Promise<LinkInfo | null> {
    if (!PAYWAY_LINK.test(rawLink)) return null;
    try {
      const { currency } = await this.readLinkPage(rawLink);
      return { currency };
    } catch {
      return null;
    }
  }

  async createHostedCheckout(rawLink: string, amount: string): Promise<HostedCheckout> {
    const { abaData, requestTime } = await this.readLinkPage(rawLink);
    const additional = JSON.stringify({ amount }); // {"amount":"12.50"}
    const body = await this.postJson(MINT_URL, {
      additional_fields: additional,
      request_time: requestTime,
      aba_data: abaData,
      hash: sha512(requestTime + abaData + additional),
    }, {}, 'mint');

    const d = unwrap(body);
    const qr_string = str(d.qr_string);
    const client_id = str(d.client_id);
    const token = str(d.token);
    // never hand out a QR nobody can pay (docs/architecture.md §4)
    if (!qr_string || !client_id || !token) throw new Error('mint_incomplete');
    return {
      qr_string,
      client_id,
      token,
      request_time: requestTime,
      expire_in_sec: Number(d.expire_in_sec) > 0 ? Number(d.expire_in_sec) : 180,
    };
  }

  /** `action: "approved"` = paid; `"request_qr"` = not scanned yet (docs/bakong-gateway-notes.md §3). */
  async fetchHostedStatus(session: HostedSession): Promise<HostedStatus> {
    const device = randomBytes(8).toString('hex').slice(0, 10); // random 10-char device id per call
    const body = await this.postJson(
      STATUS_URL,
      {
        device_id: device,
        request_time: session.requestTime,
        client_id: session.clientId,
        hash: sha512(session.clientId + device + session.requestTime),
      },
      { token: session.token },
      'status',
    );
    const d = unwrap(body);
    const action = str(d.action) ?? 'unknown';
    // ponytail: ABA's "scanned" action name was never observed; anything but approved keeps polling as unpaid
    return {
      state: action === 'approved' ? 'paid' : 'unpaid',
      tran_id: action === 'approved' ? (str(d.tran_id) ?? null) : null,
      action,
    };
  }

  // ---- internals ----

  private async readLinkPage(rawLink: string) {
    const res = await fetch(rawLink, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`link_page_http_${res.status}`);
    const html = await res.text();
    const raw = ABA_DATA.exec(html)?.[1];
    const requestTime = REQUEST_TIME.exec(html)?.[1];
    if (!raw || !requestTime) throw new Error('aba_data_not_found');
    return { abaData: unescapeJs(raw), requestTime, currency: CURRENCY.exec(html)?.[1] ?? null };
  }

  private async postJson(url: string, body: Json, headers: Record<string, string>, what: 'mint' | 'status'): Promise<Json> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`${what}_${e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network_error'}`);
    }
    if (!res.ok) throw new Error(`${what}_http_${res.status}`);
    try {
      return (await res.json()) as Json;
    } catch {
      throw new Error(`${what}_bad_json`);
    }
  }
}

/**
 * aba_data sits in the page as a JS string literal (`/` written as `/`); the browser sends the
 * decoded value, and ABA answers 403 "Invalid Data" to the raw one.
 */
export function unescapeJs(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s; // not a valid JSON escape sequence: send as is
  }
}

/** ABA answers either flat or wrapped in `data`; read both. */
const unwrap = (body: Json): Json => (body.data && typeof body.data === 'object' ? (body.data as Json) : body);
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : undefined);
