import './lib/env'; // must stay the first import: loads .env
import { buildApp } from './app';
import { env } from './lib/env';
import { buildContainer } from './container';
import { closeDb, connectDb } from './lib/prisma';
import { log } from './lib/log';

const logger = log('server');

async function start() {
  const c = buildContainer();
  await connectDb(c.db); // refuses to boot when the database is behind the migrations

  const server = buildApp(c).listen(env.port, () => logger.info(`Backend running on http://localhost:${env.port}`));
  c.jobs.forEach((j) => j.start());

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      c.jobs.forEach((j) => j.stop());
      server.close(() => void closeDb(c.db).then(() => process.exit(0)));
    });
  }
}

void start();
