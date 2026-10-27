import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, logger } from './db.js';
import { startWorker, stopWorker } from './worker.js';

const app = await createApp();
const server = app.listen(config.port, config.host, () => {
  logger.info({
    url: `http://${config.host}:${config.port}`,
    publicBaseUrl: config.publicBaseUrl,
    environment: config.isProduction ? 'production' : 'development',
    worker: config.worker.enabled,
  }, `${config.appName} is listening`);
  if (config.worker.enabled) startWorker();
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  stopWorker();
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => logger.error({ error: error?.stack || String(error) }, 'Unhandled promise rejection'));
process.on('uncaughtException', (error) => logger.error({ error: error?.stack || String(error) }, 'Uncaught exception'));
