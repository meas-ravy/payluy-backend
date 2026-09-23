import { z } from 'zod';
import { httpsUrl } from '../../lib/zod';

/** Body of `PUT /v1/stores/:id/link`, and `link` inside create/update (docs/api.md § Stores). */
export const linkSchema = z.object({
  // format is checked by the service: a wrong URL is `400 invalid_payment_link`, not 422
  raw_link: z.string(),
  merchant_account_id: z.string().min(3).max(120),
  merchant_name: z.string().max(120).nullish(),
});

/** Fields shared by create and update. `null` clears an optional field. */
const fields = {
  external_id: z.string().max(255).nullish(),
  city: z.string().max(15).optional(), // KHQR limit; may be omitted but not null (NOT NULL column)
  support_email: z.email().max(255).nullish(),
  redirect_success_url: httpsUrl().nullish(),
  redirect_failure_url: httpsUrl().nullish(),
  telegram_chat_id: z.string().max(64).nullish(),

  // branding: needs whitelabel_enabled when non-null (checked by the service)
  brand_color: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i).nullish(),
  logo_image_url: httpsUrl().nullish(),
  whitelabel_css: z.string().nullish(),

  link: linkSchema.optional(),
};

export const createStoreSchema = z.strictObject({ ...fields, name: z.string().min(1).max(120) });
export const updateStoreSchema = z.strictObject({ ...fields, name: z.string().min(1).max(120).optional() });

export const storeFieldsSchema = z.strictObject(fields);

export type LinkDto = z.infer<typeof linkSchema>;
export type StoreFieldsDto = z.infer<typeof storeFieldsSchema>;
export type CreateStoreDto = z.infer<typeof createStoreSchema>;
export type UpdateStoreDto = z.infer<typeof updateStoreSchema>;
