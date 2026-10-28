/**
 * Dedicated background-worker process.
 *
 * `server/index.js` runs the API and an in-process worker together. Production
 * deployments (activation module 13) need separate worker processes that share
 * the same PostgreSQL database. Conditional job claims in server/worker.js make
 * that safe: two or more of these processes can run concurrently without a job
 * being processed twice.
 *
 *   WORKER_ENABLED=true DATABASE_URL=postgresql://… node server/worker-standalone.js
 */
import { initializeDatabase, closeDb, logger } from './db.js';
import { config } from './config.js';
import { startWorker, stopWorker } from './worker.js';

if (!config.worker.enabled) {
  logger.error({ workerEnabled: false }, 'WORKER_ENABLED is false; refusing to start a worker-only process. Set WORKER_ENABLED=true.');
  process.exit(1);
}

await initializeDatabase();
startWorker();
logger.info({
  database: config.databaseUrl ? 'postgresql' : 'sqlite',
  concurrency: config.worker.concurrency,
}, 'Dedicated worker process started');

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down worker');
  stopWorker();
  try { await closeDb(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => logger.error({ error: error?.stack || String(error) }, 'Unhandled promise rejection'));
process.on('uncaughtException', (error) => logger.error({ error: error?.stack || String(error) }, 'Uncaught exception'));
