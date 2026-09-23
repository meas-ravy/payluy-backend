import { z } from 'zod';

/** `POST /v1/keys`: `{"name": "1–64 chars"}`, no other fields (docs/api.md § API keys). */
export const createKeySchema = z.strictObject({ name: z.string().min(1).max(64) });
