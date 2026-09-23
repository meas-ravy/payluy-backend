import QRCode, { type QRCodeErrorCorrectionLevel } from 'qrcode';
import { badRequest } from '../../lib/errors';

const MARGIN = 2; // quiet zone, in modules

/** QR → SVG. Shared by the hosted checkout (qr.svg) and GET /v1/khqr/render.svg. */
export type KhqrService = ReturnType<typeof createKhqrService>;

export function createKhqrService() {
  /**
   * Default ECC H so the KHQR centre medallion survives (docs/api.md). `scale` = pixels per module.
   * Throws 400 payload_too_long / invalid_payload (docs/api.md § Errors).
   */
  async function renderSvg(payload: string, ecc: QRCodeErrorCorrectionLevel = 'H', scale = 6): Promise<string> {
    try {
      const size = QRCode.create(payload, { errorCorrectionLevel: ecc }).modules.size;
      return await QRCode.toString(payload, {
        type: 'svg',
        errorCorrectionLevel: ecc,
        margin: MARGIN,
        width: (size + 2 * MARGIN) * scale,
      });
    } catch (e) {
      const tooBig = e instanceof Error && /too big/i.test(e.message);
      throw badRequest(tooBig ? 'payload_too_long' : 'invalid_payload');
    }
  }

  return { renderSvg };
}
