import type { payments, stores } from '../../generated/prisma/client';
import { formatCents } from '../../lib/money';

export type ReportPayment = payments & { store: Pick<stores, 'public_id' | 'name' | 'external_id'> };

export const REPORT_COLUMNS = [
  'public_id', 'status', 'amount', 'currency', 'reference_id', 'store_public_id',
  'store_name', 'external_id', 'created_at', 'paid_at', 'reversed_at', 'bank_ref',
] as const;

/** One report row: the column list of docs/api.md § Reports, same for JSON and CSV. */
export function toReportRow(p: ReportPayment): Record<(typeof REPORT_COLUMNS)[number], string | null> {
  return {
    public_id: p.public_id,
    status: p.status,
    amount: formatCents(p.amount_cents),
    currency: p.currency,
    reference_id: p.reference_id,
    store_public_id: p.store.public_id,
    store_name: p.store.name,
    external_id: p.store.external_id,
    created_at: p.created_at.toISOString(),
    paid_at: p.paid_at?.toISOString() ?? null,
    reversed_at: p.reversed_at?.toISOString() ?? null,
    bank_ref: p.bank_ref,
  };
}

/**
 * One CSV cell (RFC 4180 quoting). Values starting with = + - @ tab or CR get a leading `'`
 * so a spreadsheet never runs them as a formula: store names and reference_ids come from API callers.
 */
function cell(v: string | null): string {
  if (v === null) return '';
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (values: (string | null)[]) => values.map(cell).join(',') + '\r\n';
