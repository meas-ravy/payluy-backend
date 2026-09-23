/** JSON number with ≤ 2 decimals → integer cents; null when it has more precision or isn't finite. */
export function toCents(amount: number): number | null {
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  // tolerance absorbs float noise (1.1 * 100 = 110.00000000000001) but rejects 0.001
  return Math.abs(amount * 100 - cents) < 1e-6 ? cents : null;
}

/** Integer cents → decimal string ("12.50"). Integer math, no float rounding. */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? '-' : '';
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
