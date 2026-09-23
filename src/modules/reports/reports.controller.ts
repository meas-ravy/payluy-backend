import { Router, type RequestHandler } from 'express';
import { currentAccount } from '../../middleware/auth';
import { log } from '../../lib/log';
import { query } from '../../middleware/validate';
import { reportQuerySchema } from './reports.schema';
import { REPORT_COLUMNS, csvLine, toReportRow } from './reports.view';
import { ReportsService } from './reports.service';

const logger = log('reports');

/** docs/api.md § Reports. HTTP only. */
export function reportsController(reports: ReportsService, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth);

  r.get('/payments.json', async (req, res) => {
    const q = query(reportQuerySchema, req);
    const { rows, total } = await reports.page(currentAccount(req), q);
    res.json({ data: rows.map(toReportRow), page: q.page, per_page: q.per_page, total });
  });

  /** Streamed, no paging. Errors before the first byte are normal JSON errors (plan gate, invalid_date…). */
  r.get('/payments.csv', async (req, res) => {
    const q = query(reportQuerySchema, req);
    const where = await reports.prepareCsv(currentAccount(req), q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
    res.write(csvLine([...REPORT_COLUMNS]));
    try {
      for await (const batch of reports.csvBatches(where)) {
        res.write(batch.map((p) => csvLine(Object.values(toReportRow(p)))).join(''));
      }
      res.end();
    } catch (e) {
      // headers are already sent: cut the stream so the client sees an incomplete file, not a clean one
      logger.error(e);
      res.destroy();
    }
  });

  return r;
}
