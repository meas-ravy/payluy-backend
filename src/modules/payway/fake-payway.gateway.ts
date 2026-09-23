import { randomBytes } from 'node:crypto';
import { HostedCheckout, HostedSession, HostedStatus, PAYWAY_LINK, PaywayGateway } from './payway.gateway';

type FakeState = HostedStatus['state'];

/**
 * Dev/test rail: no HTTP to ABA. Only bound when ENABLE_DEV_GATEWAY=true (hard rule 8).
 * - A link slug starting with "invalid" behaves like a page without aba_data (`400 invalid_payment_link`).
 * - Every minted checkout starts `unpaid`; the /_dev routes flip it with `simulate()`, and detection
 *   picks the change up on its next check, exactly like a real ABA answer.
 */
export class FakePaywayGateway extends PaywayGateway {
  // ponytail: in-memory, per process: lost on restart and not shared between instances. Dev only.
  private readonly states = new Map<string, FakeState>();

  async verifyLink(rawLink: string): Promise<boolean> {
    const slug = PAYWAY_LINK.exec(rawLink)?.[1];
    return !!slug && !slug.toLowerCase().startsWith('invalid');
  }

  async createHostedCheckout(rawLink: string, amount: string): Promise<HostedCheckout> {
    const slug = PAYWAY_LINK.exec(rawLink)?.[1] ?? 'unknown';
    const id = randomBytes(8).toString('hex');
    return {
      // not a payable KHQR: clearly marked so it can't be mistaken for one
      qr_string: `FAKE-KHQR|${slug}|${amount}|${id}`,
      client_id: `fake_${id}`,
      token: randomBytes(16).toString('hex'),
      request_time: String(Date.now()),
      expire_in_sec: 180, // what ABA returns (docs/api.md: 180 s observed)
    };
  }

  async fetchHostedStatus(session: HostedSession): Promise<HostedStatus> {
    const state = this.states.get(session.clientId) ?? 'unpaid';
    return {
      state,
      tran_id: state === 'paid' ? `fake_tran_${session.clientId}` : null,
      action: state === 'paid' ? 'approved' : state === 'unpaid' ? 'request_qr' : `fake_${state}`,
    };
  }

  /** Dev only: what the next status poll for this checkout will answer. */
  simulate(clientId: string, state: FakeState) {
    this.states.set(clientId, state);
  }
}
