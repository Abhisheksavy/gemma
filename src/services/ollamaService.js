import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// ── Circuit Breaker ───────────────────────────────────────────────────────────
// States: CLOSED (normal) → OPEN (failing fast) → HALF_OPEN (probing)
const cb = {
  state: 'CLOSED',       // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  failures: 0,
  openedAt: null,
};

function cbCheck() {
  if (cb.state === 'CLOSED') return;
  if (cb.state === 'OPEN') {
    if (Date.now() - cb.openedAt >= config.ollama.cbCooldownMs) {
      cb.state = 'HALF_OPEN';
      logger.info('Circuit breaker → HALF_OPEN (probing Ollama)');
    } else {
      throw new OllamaError('Ollama service is currently unavailable (circuit open).', 503);
    }
  }
  // HALF_OPEN: allow one through
}

function cbSuccess() {
  cb.failures = 0;
  if (cb.state !== 'CLOSED') {
    logger.info('Circuit breaker → CLOSED (Ollama recovered)');
    cb.state = 'CLOSED';
  }
}

function cbFailure() {
  cb.failures++;
  if (cb.state === 'HALF_OPEN' || cb.failures >= config.ollama.cbFailureThreshold) {
    cb.state = 'OPEN';
    cb.openedAt = Date.now();
    logger.error({ failures: cb.failures }, 'Circuit breaker → OPEN');
  }
}

// ── Core fetch with timeout ───────────────────────────────────────────────────
async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Retry with exponential backoff ────────────────────────────────────────────
const RETRYABLE_STATUS = new Set([429, 503, 504]);

async function withRetry(fn, maxRetries, baseDelayMs) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof OllamaError && (RETRYABLE_STATUS.has(err.statusCode) || err.statusCode === 503);
      if (!retryable || attempt === maxRetries) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      logger.warn({ attempt: attempt + 1, delay_ms: delay, msg: err.message }, 'Retrying Ollama request');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── Sanitize model output ─────────────────────────────────────────────────────
function sanitizeReply(raw) {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // strip control chars
    .replace(/\n{3,}/g, '\n\n')                           // collapse excessive newlines
    .trim();
}

// ── Public: generate ─────────────────────────────────────────────────────────
export async function generate(prompt, reqLog = logger) {
  cbCheck();

  const doRequest = async () => {
    const response = await fetchWithTimeout(
      `${config.ollama.baseUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.ollama.model,
          prompt,
          stream: false,
          options: {
            num_predict: config.ollama.numPredict,
            temperature: config.ollama.temperature,
            top_p: config.ollama.topP,
            repeat_penalty: config.ollama.repeatPenalty,
          },
        }),
      },
      config.ollama.timeoutMs,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      reqLog.error({ status: response.status, body: body.slice(0, 200) }, 'Ollama non-2xx');
      throw new OllamaError(`Ollama returned ${response.status}`, response.status);
    }

    const data = await response.json();
    const reply = sanitizeReply(data.response ?? '');
    if (!reply) throw new OllamaError('Empty response from model', 502);

    reqLog.debug(
      { tokens: data.eval_count, duration_ms: Math.round((data.total_duration ?? 0) / 1e6) },
      'Ollama generate OK',
    );
    return reply;
  };

  try {
    const result = await withRetry(doRequest, config.ollama.maxRetries, config.ollama.retryDelayMs);
    cbSuccess();
    return result;
  } catch (err) {
    if (err.name === 'AbortError') {
      cbFailure();
      throw new OllamaError(`Request timed out after ${config.ollama.timeoutMs}ms`, 504);
    }
    cbFailure();
    if (err instanceof OllamaError) throw err;
    reqLog.error({ err }, 'Ollama fetch failed');
    throw new OllamaError('Could not reach Ollama service.', 503);
  }
}

// ── Public: healthCheck ───────────────────────────────────────────────────────
export async function healthCheck() {
  try {
    // 1. Check tags endpoint
    const tagsRes = await fetchWithTimeout(`${config.ollama.baseUrl}/api/tags`, {}, 5_000);
    if (!tagsRes.ok) return { ok: false, detail: `tags endpoint returned ${tagsRes.status}` };

    const { models = [] } = await tagsRes.json();
    const modelNames = models.map((m) => m.name);
    const modelLoaded = modelNames.some((n) => n.startsWith(config.ollama.model.split(':')[0]));

    return {
      ok: true,
      circuit: cb.state,
      models: modelNames,
      modelLoaded,
    };
  } catch {
    return { ok: false, circuit: cb.state, detail: 'unreachable' };
  }
}

// ── Public: readinessCheck (used at startup — fails if model not loaded) ──────
export async function readinessCheck() {
  const h = await healthCheck();
  if (!h.ok) throw new Error('Ollama is not reachable');
  if (!h.modelLoaded) throw new Error(`Model "${config.ollama.model}" is not pulled. Run: ollama pull ${config.ollama.model}`);
}

// ── Error class ───────────────────────────────────────────────────────────────
export class OllamaError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'OllamaError';
    this.statusCode = statusCode;
  }
}
