import type { Request } from 'express';
import type { ZodType } from 'zod';
import { unprocessable } from '../lib/errors';

// class-validator used to report the failed rule; zod's issue codes map onto the same short codes
const MSG: Record<string, string> = {
  invalid_type: 'invalid_type',
  too_small: 'min',
  too_big: 'max',
  invalid_format: 'invalid_format',
  invalid_value: 'is_in',
  unrecognized_keys: 'unknown_field',
  invalid_union: 'invalid_type',
};

/** Parse `value`, or throw `422 {detail:[{loc,msg,input}]}` (docs/api.md § Errors). */
export function parse<T>(schema: ZodType<T>, value: unknown, where: 'body' | 'query'): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw unprocessable({
    detail: result.error.issues.map((i) => ({
      loc: [where, ...i.path.map(String)],
      msg: /^[a-z0-9_]+$/.test(i.message) ? i.message : (MSG[i.code] ?? i.code),
      input: i.path.reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k as string], value) ?? null,
    })),
  });
}

export const body = <T>(schema: ZodType<T>, req: Request) => parse(schema, req.body, 'body');
export const query = <T>(schema: ZodType<T>, req: Request) => parse(schema, req.query, 'query');
