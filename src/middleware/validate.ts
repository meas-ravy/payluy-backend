import type { Request } from 'express';
import type { ZodType } from 'zod';
import { unprocessable } from '../lib/errors';

// zod's issue codes are used as is (too_small, too_big, invalid_value…), except these two
const MESSAGE: Record<string, string> = {
  unrecognized_keys: 'unknown_field',
  invalid_union: 'invalid_type',
};

/**
 * Parse `value`, or throw `422 {error: "validation_error", message, detail: [{location, message, input}]}`
 * (docs/api.md § Errors). Each item's `message` is a code: the schema's own ("invalid_amount") or zod's.
 */
export function parse<T>(schema: ZodType<T>, value: unknown, where: 'body' | 'query'): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw unprocessable(
    'validation_error',
    result.error.issues.map((i) => ({
      location: [where, ...i.path.map(String)],
      message: /^[a-z0-9_]+$/.test(i.message) ? i.message : (MESSAGE[i.code] ?? i.code),
      input: i.path.reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k as string], value) ?? null,
    })),
  );
}

export const body = <T>(schema: ZodType<T>, req: Request) => parse(schema, req.body, 'body');
export const query = <T>(schema: ZodType<T>, req: Request) => parse(schema, req.query, 'query');
