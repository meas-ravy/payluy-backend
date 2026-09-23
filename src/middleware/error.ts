import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors';
import { log } from '../lib/log';

const logger = log('http');

/** The last middleware: turns anything thrown in a route into `{ detail }` (docs/api.md § Errors). */
export function errorHandler(e: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(e); // a stream already started (CSV): let Express close it

  if (e instanceof ApiError) {
    res.status(e.status).json(typeof e.detail === 'string' ? { detail: e.detail } : e.detail);
    return;
  }
  logger.error(e);
  res.status(500).json({ detail: 'internal_error' });
}

/** Unknown path (docs/api.md: every error is a code, never an HTML page). */
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ detail: 'not_found' });
}
