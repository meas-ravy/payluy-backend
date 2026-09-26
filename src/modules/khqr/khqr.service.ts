import QRCode from 'qrcode';

// KHQR card, 360 × 481: red header with the KHQR mark, name, amount, dashed rule, QR with a centre badge
const RED = '#E1232E'; // KHQR red
const W = 360;
const PAD = 24;
const QR_TOP = 145;
const QR_SIZE = W - 2 * PAD;
const H = QR_TOP + QR_SIZE + PAD;
const CX = W / 2;
const CY = QR_TOP + QR_SIZE / 2;

/** The KHQR wordmark, 60 × 14 (paths from @manethpak/khqr-sdk, ISC). */
const KHQR_MARK =
  '<path d="M39.006 5.194v4.404h-4.474a.795.795 0 0 1-.803-.79V5.222c0-.452.372-.79.803-.79h3.642c.488-.029.832.31.832.761ZM59.972 6.972h-2.238c0-2.625-2.18-4.77-4.847-4.77-2.122 0-3.986 1.354-4.617 3.33-.144.48-.23.96-.23 1.44v7h-.057c-1.205 0-2.18-.96-2.18-2.145V6.972h.029c0-1.92.803-3.754 2.237-5.08A7.144 7.144 0 0 1 52.916 0c3.9 0 7.056 3.133 7.056 6.972Z"/>' +
  '<path d="M60 13.971 56.845 14l-.774-.763-1.721-1.693L51.97 9.2h3.154L60 13.971ZM39.752 11.77h-6.74a1.47 1.47 0 0 1-1.492-1.468V3.67c0-.818.66-1.467 1.492-1.467h6.74c.831 0 1.491.649 1.491 1.467v6.633l2.237 2.202V2.145C43.48.96 42.505 0 41.3 0h-9.837c-1.205 0-2.18.96-2.18 2.145v9.682c0 1.185.975 2.145 2.18 2.145h10.526l-2.237-2.202ZM12.361 14H9.207L2.61 7.48V14H0V0h2.61v6.238L8.948 0h3.098L5.163 6.718 12.36 14ZM24.15 0h2.552v14h-2.553V7.931h-7.285V14h-2.553V0h2.553v5.843h7.285V0Z"/>';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** KHQR payload → the KHQR card SVG. Used by the hosted checkout's qr.svg only. */
export type KhqrService = ReturnType<typeof createKhqrService>;

export function createKhqrService() {
  /**
   * The KHQR payment card. ECC H: the centre badge hides ~2% of the code.
   * `payload` is ABA's qr_string, so an encoding failure is ours (500), not the caller's.
   * `amount` is already formatted ("1.50").
   */
  function renderCardSvg(payload: string, card: { name: string; amount: string; currency: string }): string {
    const modules = QRCode.create(payload, { errorCorrectionLevel: 'H' }).modules;

    // one path, a run of dark modules per segment (the card's padding is the quiet zone)
    const n = modules.size;
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; ) {
        if (!modules.get(y, x)) {
          x++;
          continue;
        }
        const start = x;
        while (x < n && modules.get(y, x)) x++;
        d += `M${start} ${y}h${x - start}v1h${start - x}z`;
      }
    }

    // ponytail: long names are cut at 30 chars, no text measuring
    const name = esc(card.name.length > 30 ? `${card.name.slice(0, 29)}…` : card.name);
    const currency = esc(card.currency);
    const symbol = '$'; // ponytail: USD only in v1 (AGENTS.md); KHR would be ៛

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, 'Noto Sans Khmer', sans-serif">
<title>${name} - ${esc(card.amount)} ${currency} (KHQR)</title>
<rect width="${W}" height="${H}" rx="16" fill="#fff"/>
<path d="M0 16a16 16 0 0 1 16-16h${W - 32}a16 16 0 0 1 16 16v28H0z" fill="${RED}"/>
<g transform="translate(${CX - 30} 15)" fill="#fff">${KHQR_MARK}</g>
<path d="M${W - 24} 44h24v24z" fill="${RED}"/>
<text x="${PAD}" y="75" font-size="14" fill="#334155">${name}</text>
<text x="${PAD}" y="105" font-size="24" font-weight="700" fill="#1f2937">${esc(card.amount)}<tspan dx="8" dy="-3" font-size="14" font-weight="500" fill="#475569">${currency}</tspan></text>
<line x1="0" y1="121" x2="${W}" y2="121" stroke="#d1d5db" stroke-dasharray="4 4"/>
<path transform="translate(${PAD} ${QR_TOP}) scale(${QR_SIZE / n})" shape-rendering="crispEdges" d="${d}"/>
<circle cx="${CX}" cy="${CY}" r="20" fill="#000" stroke="#fff" stroke-width="3"/>
<text x="${CX}" y="${CY + 8}" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">${symbol}</text>
</svg>`;
  }

  return { renderCardSvg };
}
