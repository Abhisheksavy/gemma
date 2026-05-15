import app from './src/app.js';
import { config } from './src/config/index.js';
import logger from './src/utils/logger.js';

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, env: config.nodeEnv, model: config.ollama.model }, 'Server started');
});

// Graceful shutdown
function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',  (err) => { logger.fatal({ err }, 'Uncaught exception');  process.exit(1); });
process.on('unhandledRejection', (err) => { logger.fatal({ err }, 'Unhandled rejection'); process.exit(1); });
