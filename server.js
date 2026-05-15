import app from './src/app.js';
import { config } from './src/config/index.js';
import logger from './src/utils/logger.js';
import { readinessCheck } from './src/services/ollamaService.js';

const STARTUP_RETRY_INTERVAL_MS = 5_000;
const STARTUP_MAX_WAIT_MS = 120_000;

async function waitForOllama() {
  const deadline = Date.now() + STARTUP_MAX_WAIT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    try {
      await readinessCheck();
      logger.info({ model: config.ollama.model }, 'Ollama ready');
      return;
    } catch (err) {
      attempt++;
      logger.warn({ attempt, msg: err.message }, `Ollama not ready — retrying in ${STARTUP_RETRY_INTERVAL_MS / 1000}s`);
      await new Promise((r) => setTimeout(r, STARTUP_RETRY_INTERVAL_MS));
    }
  }
  logger.fatal('Ollama did not become ready in time. Exiting.');
  process.exit(1);
}

async function main() {
  // Block until Ollama is up and model is loaded
  if (config.nodeEnv !== 'test') {
    await waitForOllama();
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port, env: config.nodeEnv, model: config.ollama.model }, 'Server started');
  });

  // Graceful shutdown — stop accepting new connections, drain in-flight requests
  let shuttingDown = false;

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received — draining connections');

    server.close((err) => {
      if (err) logger.error({ err }, 'Error closing server');
      else logger.info('HTTP server closed gracefully');
      process.exit(err ? 1 : 0);
    });

    // Force-kill if drain takes too long
    setTimeout(() => {
      logger.error('Graceful shutdown timeout — forcing exit');
      process.exit(1);
    }, 15_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException',  (err) => { logger.fatal({ err }, 'Uncaught exception');  process.exit(1); });
  process.on('unhandledRejection', (err) => { logger.fatal({ err }, 'Unhandled rejection'); process.exit(1); });
}

main();
