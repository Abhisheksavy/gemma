import pino from 'pino';
import { config } from '../config/index.js';

const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  base: { service: 'gemma-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(config.isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname,service' },
        },
      }),
});

export default logger;
