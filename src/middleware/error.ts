import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors';
import { log } from '../lib/log';

const logger = log('http');

/** The last middleware: turns anything thrown in a route into `{ error, message }` (docs/api.md § Errors). */
export function errorHandler(e: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(e); // a stream already started (CSV): let Express close it

  if (e instanceof ApiError) {
    res.status(e.status).json(e.body());
    return;
  }
  logger.error(e);
  res.status(500).json(new ApiError(500, 'internal_error').body());
}

/** Unknown path (docs/api.md: every error is a code, never an HTML page). */
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json(new ApiError(404, 'not_found').body());
}
