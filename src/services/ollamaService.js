import { config } from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Send a prompt to Ollama and return the full response text.
 * Uses the /api/generate endpoint with streaming disabled.
 */
export async function generate(prompt) {
  const url = `${config.ollama.baseUrl}/api/generate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ollama.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        prompt,
        stream: false,
        options: {
          num_predict: 512,
          temperature: 0.7,
          top_p: 0.9,
          repeat_penalty: 1.1,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body }, 'Ollama returned non-2xx');
      throw new OllamaError(`Ollama error ${response.status}`, response.status);
    }

    const data = await response.json();
    const reply = (data.response ?? '').trim();

    if (!reply) throw new OllamaError('Empty response from model', 502);

    logger.debug({ tokens: data.eval_count, duration_ms: Math.round((data.total_duration ?? 0) / 1e6) }, 'Ollama generate done');
    return reply;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new OllamaError(`Request timed out after ${config.ollama.timeoutMs}ms`, 504);
    }
    if (err instanceof OllamaError) throw err;
    logger.error({ err }, 'Ollama fetch failed');
    throw new OllamaError('Could not reach Ollama service', 503);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ping Ollama to verify it is reachable and the model is loaded.
 */
export async function healthCheck() {
  const url = `${config.ollama.baseUrl}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, detail: `status ${res.status}` };
    const data = await res.json();
    const models = (data.models ?? []).map((m) => m.name);
    const loaded = models.some((n) => n.startsWith(config.ollama.model.split(':')[0]));
    return { ok: true, models, modelLoaded: loaded };
  } catch {
    return { ok: false, detail: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export class OllamaError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'OllamaError';
    this.statusCode = statusCode;
  }
}
