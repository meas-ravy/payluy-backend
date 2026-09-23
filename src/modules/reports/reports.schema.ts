import { z } from 'zod';
import { intQuery } from '../../lib/zod';
import { PAYMENT_STATUSES } from '../payments/payments.schema';


export const reportQuerySchema = z.object({
  // format checked by the service: a bad date is `400 invalid_date`, not 422 (docs/api.md)
  from: z.string().optional(), // YYYY-MM-DD, inclusive, UTC
  to: z.string().optional(),
  store_id: z.string().optional(), // store public id
  merchant: z.string().optional(), // store external_id

  // `?statuses=paid,reversed`
  statuses: z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(PAYMENT_STATUSES)).nonempty())
    .optional(),

  page: intQuery(1).default(1),
  per_page: intQuery(1, 100).default(20),
});

export type ReportQueryDto = z.infer<typeof reportQuerySchema>;
