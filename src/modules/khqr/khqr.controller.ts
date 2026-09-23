import { Router } from 'express';
import { query } from '../../middleware/validate';
import { renderQuerySchema } from './khqr.schema';
import { KhqrService } from './khqr.service';

/** `GET /v1/khqr/render.svg`: public, no auth (docs/api.md). Renders any payload; knows nothing about payments. */
export function khqrController(khqr: KhqrService): Router {
  const r = Router();
  r.get('/render.svg', async (req, res) => {
    const { payload, ecc, scale } = query(renderQuerySchema, req);
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // same payload → same image
    res.send(await khqr.renderSvg(payload, ecc, scale));
  });
  return r;
}
