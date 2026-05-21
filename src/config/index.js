import 'dotenv/config';

function requireEnv(name, fallback) {
  const val = process.env[name];
  if (val !== undefined && val !== '') return val;
  if (fallback !== undefined) return fallback;
  console.error(`[config] Missing required environment variable: ${name}`);
  process.exit(1);
}

function parsePositiveInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    console.error(`[config] ${name} must be a positive integer, got "${raw}"`);
    process.exit(1);
  }
  return n;
}

export const config = {
  port: parsePositiveInt('PORT', 3000),
  nodeEnv: requireEnv('NODE_ENV', 'development'),
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',

  // Optional API key — if set, all /api/* routes require Authorization: Bearer <key>
  apiKey: process.env.API_KEY ?? null,

  ollama: {
    baseUrl: requireEnv('OLLAMA_BASE_URL', 'http://localhost:11434'),
    // Default to Gemma 4 E4B — Google's latest open model (Apr 2026).
    // Multimodal (text + image), 256K context, 140+ languages, ~9.6 GB.
    // Alternatives: gemma4:e2b (7.2 GB), gemma4:26b (18 GB), gemma4:31b (20 GB).
    model: requireEnv('OLLAMA_MODEL', 'gemma4:e4b'),
    timeoutMs: parsePositiveInt('OLLAMA_TIMEOUT_MS', 90_000),
    // Retry config
    maxRetries: parsePositiveInt('OLLAMA_MAX_RETRIES', 2),
    retryDelayMs: parsePositiveInt('OLLAMA_RETRY_DELAY_MS', 1_000),
    // Circuit breaker: open after N consecutive failures, probe after cooldownMs
    cbFailureThreshold: parsePositiveInt('CB_FAILURE_THRESHOLD', 5),
    cbCooldownMs: parsePositiveInt('CB_COOLDOWN_MS', 30_000),
    // Generation options (tunable per deployment)
    numPredict: parsePositiveInt('OLLAMA_NUM_PREDICT', 512),
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE ?? '0.7'),
    topP: parseFloat(process.env.OLLAMA_TOP_P ?? '0.9'),
    repeatPenalty: parseFloat(process.env.OLLAMA_REPEAT_PENALTY ?? '1.1'),
  },

  queue: {
    // Max concurrent Ollama requests (1 = serialized, best for CPU-only)
    concurrency: parsePositiveInt('QUEUE_CONCURRENCY', 1),
    // Max waiting in queue before rejecting with 429
    maxPending: parsePositiveInt('QUEUE_MAX_PENDING', 10),
  },

  rateLimit: {
    windowMs: parsePositiveInt('RATE_LIMIT_WINDOW_MS', 60_000),
    max: parsePositiveInt('RATE_LIMIT_MAX', 30),
  },

  cors: {
    origin: requireEnv('CORS_ORIGIN', '*'),
  },

  // Max input message length in characters
  maxMessageLength: parsePositiveInt('MAX_MESSAGE_LENGTH', 2_000),
};
