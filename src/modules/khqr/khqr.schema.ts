import { z } from 'zod';
import { intQuery } from '../../lib/zod';

/** `GET /v1/khqr/render.svg?payload=…&ecc=H&scale=6`. */
export const renderQuerySchema = z.object({
  payload: z.string().min(1),
  ecc: z.enum(['L', 'M', 'Q', 'H']).default('H'),
  scale: intQuery(1, 20).default(6),
});
