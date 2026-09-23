import { z } from 'zod';

/** https-only absolute URL (docs/api.md: redirects and webhook endpoints are https). */
export const httpsUrl = (max = 2048) => z.url({ protocol: /^https$/ }).max(max);

/** Query strings are text: `?limit=20` must become a number before the range check. */
export const intQuery = (min: number, max?: number) => {
  const base = z.coerce.number().int().min(min);
  return max === undefined ? base : base.max(max);
};
