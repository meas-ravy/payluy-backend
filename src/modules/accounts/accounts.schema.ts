import { z } from 'zod';

/** `POST /v1/me/terms`: `{"version": "2026-09-01"}`. */
export const acceptTermsSchema = z.strictObject({ version: z.string().max(32) });

/** `PATCH /v1/me`: `{"name"?: "≤120", "email"?: "≤255"}` (docs/api.md § Account). */
export const updateMeSchema = z.strictObject({
  name: z.string().min(1).max(120).optional(),
  email: z.email().max(255).optional(),
});

export type UpdateMeDto = z.infer<typeof updateMeSchema>;
