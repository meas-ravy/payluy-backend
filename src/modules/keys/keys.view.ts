import type { api_keys } from '../../generated/prisma/client';

/** The key object of docs/api.md. `raw_key` only on create/rotate; the hash is never returned. */
export function toKeyResponse(k: api_keys, rawKey?: string) {
  return {
    id: k.id,
    name: k.name,
    key_prefix: k.key_prefix,
    status: k.status,
    last_used_at: k.last_used_at?.toISOString() ?? null,
    created_at: k.created_at.toISOString(),
    revoked_at: k.revoked_at?.toISOString() ?? null,
    ...(rawKey ? { raw_key: rawKey } : {}),
  };
}
