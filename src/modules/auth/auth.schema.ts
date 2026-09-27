import { z } from 'zod';

/**
 * Body of `POST /internal/auth/google`: the Google identity NextAuth verified on the dashboard's
 * Next.js server (docs/api.md § Auth). Only a verified email may sign in.
 */
export const googleIdentitySchema = z.strictObject({
  sub: z.string().min(1).max(255),
  email: z.email().max(255),
  name: z.string().max(255).nullish(),
  email_verified: z.literal(true, { error: 'email_not_verified' }),
});

export type GoogleIdentityDto = z.infer<typeof googleIdentitySchema>;
