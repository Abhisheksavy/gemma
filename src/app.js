import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { config } from './config/index.js';
import chatRouter from './routes/chat.js';
import { requestId } from './middleware/requestId.js';
import { httpLogger } from './middleware/httpLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { setupSwagger } from './utils/swagger.js';

const app = express();

// ── Trust proxy (required for rate-limit behind Nginx / Render) ───────────────
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: config.cors.origin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'Content-Type'],
}));

// ── Compression ───────────────────────────────────────────────────────────────
app.use(compression());

// ── Request ID + per-request logger ──────────────────────────────────────────
app.use(requestId);

// ── HTTP access log ───────────────────────────────────────────────────────────
app.use(httpLogger);

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(
  '/api',
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
    message: { error: 'Too many requests — please slow down.' },
  }),
);

// ── Body parsing — tight limit prevents large payload DoS ────────────────────
app.use(express.json({ limit: '64kb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', chatRouter);

// ── Swagger UI (/api/docs) ────────────────────────────────────────────────────
setupSwagger(app);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// ── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

export default app;
