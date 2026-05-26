import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// ── Circuit Breaker ───────────────────────────────────────────────────────────
const cb = { state: 'CLOSED', failures: 0, openedAt: null };

function cbCheck() {
  if (cb.state === 'CLOSED') return;
  if (cb.state === 'OPEN') {
    if (Date.now() - cb.openedAt >= config.ollama.cbCooldownMs) {
      cb.state = 'HALF_OPEN';
      logger.info('Circuit breaker → HALF_OPEN');
    } else {
      throw new OllamaError('Ollama is currently unavailable (circuit open).', 503);
    }
  }
}

function cbSuccess() {
  cb.failures = 0;
  if (cb.state !== 'CLOSED') { logger.info('Circuit breaker → CLOSED'); cb.state = 'CLOSED'; }
}

function cbFailure() {
  cb.failures++;
  if (cb.state === 'HALF_OPEN' || cb.failures >= config.ollama.cbFailureThreshold) {
    cb.state = 'OPEN'; cb.openedAt = Date.now();
    logger.error({ failures: cb.failures }, 'Circuit breaker → OPEN');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

const RETRYABLE = new Set([429, 503, 504]);

async function withRetry(fn, maxRetries, baseDelayMs) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      const retryable = err instanceof OllamaError && RETRYABLE.has(err.statusCode);
      if (!retryable || attempt === maxRetries) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      logger.warn({ attempt: attempt + 1, delay_ms: delay }, 'Retrying Ollama');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function sanitize(raw) {
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Public: generate ──────────────────────────────────────────────────────────
// Uses Ollama /api/chat — passes messages array plus an optional top-level
// `system` so Ollama applies the model's chat template (including the system
// anchor) for us. This is the supported way to inject a system prompt for
// models like Gemma that don't expose a `system` role in their template.
export async function generate(messages, reqLog = logger, system, numGpu = 99, temperature = undefined) {
  cbCheck();

  const doRequest = async () => {
    const body = {
      model: config.ollama.model,
      messages,
      stream: false,
      keep_alive: -1,
      options: {
        num_ctx: config.ollama.numCtx,
        num_predict: config.ollama.numPredict,
        temperature: temperature !== undefined ? temperature : config.ollama.temperature,
        top_k: config.ollama.topK,
        top_p: config.ollama.topP,
        repeat_penalty: config.ollama.repeatPenalty,
        num_gpu: numGpu,
      },
    };
    if (system && typeof system === 'string') body.system = system;

    const response = await fetchWithTimeout(
      `${config.ollama.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      config.ollama.timeoutMs,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      reqLog.error({ status: response.status, body: body.slice(0, 300) }, 'Ollama non-2xx');
      throw new OllamaError(`Ollama returned ${response.status}`, response.status);
    }

    const data = await response.json();
    const reply = sanitize(data.message?.content ?? '');
    if (!reply) throw new OllamaError('Empty response from model', 502);

    reqLog.debug({ tokens: data.eval_count, ms: Math.round((data.total_duration ?? 0) / 1e6) }, 'Ollama OK');
    return reply;
  };

  try {
    const result = await withRetry(doRequest, config.ollama.maxRetries, config.ollama.retryDelayMs);
    cbSuccess();
    return result;
  } catch (err) {
    if (err.name === 'AbortError') { cbFailure(); throw new OllamaError(`Timed out after ${config.ollama.timeoutMs}ms`, 504); }
    cbFailure();
    if (err instanceof OllamaError) throw err;
    reqLog.error({ err }, 'Ollama fetch failed');
    throw new OllamaError('Could not reach Ollama.', 503);
  }
}

// ── Public: generateStream ────────────────────────────────────────────────────
export async function* generateStream(messages, reqLog = logger, system, numGpu = 99, temperature = undefined) {
  cbCheck();

  const body = {
    model: config.ollama.model,
    messages,
    stream: true,
    keep_alive: -1,
    options: {
      num_ctx: config.ollama.numCtx,
      num_predict: config.ollama.numPredict,
      temperature: temperature !== undefined ? temperature : config.ollama.temperature,
      top_k: config.ollama.topK,
      top_p: config.ollama.topP,
      repeat_penalty: config.ollama.repeatPenalty,
      num_gpu: numGpu,
    },
  };
  if (system && typeof system === 'string') body.system = system;

  let response;
  try {
    response = await fetchWithTimeout(
      `${config.ollama.baseUrl}/api/chat`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      config.ollama.timeoutMs,
    );
  } catch (err) {
    cbFailure();
    throw err instanceof OllamaError ? err : new OllamaError('Could not reach Ollama.', 503);
  }

  if (!response.ok) {
    cbFailure();
    const errBody = await response.text().catch(() => '');
    reqLog.error({ status: response.status, body: errBody.slice(0, 300) }, 'Ollama stream non-2xx');
    throw new OllamaError(`Ollama returned ${response.status}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const token = parsed.message?.content ?? '';
          if (token) yield token;
          if (parsed.done) { cbSuccess(); return; }
        } catch { /* skip malformed line */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  cbSuccess();
}

// ── Public: healthCheck ───────────────────────────────────────────────────────
export async function healthCheck() {
  try {
    const res = await fetchWithTimeout(`${config.ollama.baseUrl}/api/tags`, {}, 5_000);
    if (!res.ok) return { ok: false, circuit: cb.state, detail: `status ${res.status}` };
    const { models = [] } = await res.json();
    const names = models.map((m) => m.name);
    const modelLoaded = names.some((n) => n.startsWith(config.ollama.model.split(':')[0]));
    return { ok: true, circuit: cb.state, models: names, modelLoaded };
  } catch {
    return { ok: false, circuit: cb.state, detail: 'unreachable' };
  }
}

// ── Public: readinessCheck ────────────────────────────────────────────────────
export async function readinessCheck() {
  const h = await healthCheck();
  if (!h.ok) throw new Error('Ollama is not reachable');
  if (!h.modelLoaded) throw new Error(`Model "${config.ollama.model}" not pulled. Run: ollama pull ${config.ollama.model}`);
}

export class OllamaError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'OllamaError';
    this.statusCode = statusCode;
  }
}
