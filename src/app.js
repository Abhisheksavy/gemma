import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { config } from './config/index.js';
import chatRouter from './routes/chat.js';
import logger from './utils/logger.js';
import { OllamaError } from './services/ollamaService.js';

const app = express();

// ── Security & transport middleware ──────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({ origin: config.cors.origin }));
app.set('trust proxy', 1);

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(
  '/api',
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — please slow down.' },
  }),
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '64kb' }));

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.url, ip: req.ip }, 'Incoming request');
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', chatRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof OllamaError) {
    logger.warn({ msg: err.message, statusCode: err.statusCode }, 'Ollama error');
    return res.status(err.statusCode).json({ error: err.message });
  }
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
