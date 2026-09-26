/** A PayWay share link: https://link.payway.com.kh/<slug>. The slug is the merchant_account_id. */
export const PAYWAY_LINK = /^https:\/\/link\.payway\.com\.kh\/([A-Za-z0-9_-]{3,120})$/;

/** What ABA returns when it mints a hosted checkout (docs/architecture.md §4). */
export type HostedCheckout = {
  qr_string: string;
  client_id: string;
  token: string; // secret: never log or return it (hard rule 6)
  request_time: string;
  expire_in_sec: number;
};

/** The session ABA hands back at mint; stored in payments.gateway_status_raw.paywayHosted. */
export type HostedSession = { clientId: string; requestTime: string; token: string };

/**
 * One status poll, normalised. ABA answers `action: "request_qr"` while unscanned and
 * `action: "approved"` once paid (docs/bakong-gateway-notes.md §3).
 */
export type HostedStatus = {
  state: 'unpaid' | 'scanned' | 'paid' | 'failed';
  tran_id: string | null; // ABA transaction id once paid → payments.bank_ref
  action: string; // ABA's raw action, kept in attempt_history
};

/** What a link's page says about it. `currency` is the link's own ("USD", "KHR"), null if not found. */
export type LinkInfo = { currency: string | null };

/**
 * Every ABA call goes through this class (AGENTS.md hard rule 2). The ABA endpoints are unofficial
 * (docs/architecture.md §4), so implementations must stay swappable.
 * Abstract class, not an interface: Nest uses it as the injection token.
 */
export abstract class PaywayGateway {
  /** Fetch the link's page; null unless it contains `aba_data` and `request_time` (hard rule 10). */
  abstract verifyLink(rawLink: string): Promise<LinkInfo | null>;

  /**
   * Mint a payable KHQR for `amount` (decimal string, "12.50") from the store's link.
   * Throws when ABA refuses or leaves out qr_string / client_id / token: never hand out a QR nobody can pay.
   */
  abstract createHostedCheckout(rawLink: string, amount: string): Promise<HostedCheckout>;

  /** Ask ABA about one checkout. Throws on no/garbled answer (the caller records it and retries later). */
  abstract fetchHostedStatus(session: HostedSession): Promise<HostedStatus>;
}
