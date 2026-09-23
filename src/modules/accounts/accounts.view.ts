import type { accounts } from '../../generated/prisma/client';

// ponytail: no doc names where the current terms version comes from; bump this when the terms change
export const TERMS_VERSION = '2026-09-01';

/** Profile object (docs/api.md § Account). Never includes google_sub or password_hash. */
export const toProfile = (a: accounts) => ({
  id: a.id,
  email: a.email,
  name: a.name,
  status: a.status,
  whitelabel_enabled: a.whitelabel_enabled,
  is_platform_admin: a.is_platform_admin,
  created_at: a.created_at,
  updated_at: a.updated_at,
  terms_accepted_at: a.terms_accepted_at,
  terms_accepted_version: a.terms_accepted_version,
  terms_required_version: TERMS_VERSION,
  auth_method: a.google_sub ? 'google' : 'password',
});
