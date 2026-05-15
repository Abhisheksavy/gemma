import { generate, healthCheck } from '../services/ollamaService.js';
import { inferenceQueue } from '../utils/queue.js';
import { recordRequest } from '../utils/metrics.js';
import { snapshot } from '../utils/metrics.js';
import { config } from '../config/index.js';

export async function chat(req, res, next) {
  const { message } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string.' });
  }

  const prompt = message.trim();

  if (prompt.length > config.maxMessageLength) {
    return res.status(400).json({
      error: `message exceeds maximum length of ${config.maxMessageLength} characters.`,
    });
  }

  const startedAt = Date.now();
  req.log.info({ chars: prompt.length }, 'Chat request');

  try {
    const reply = await inferenceQueue.enqueue(() => generate(prompt, req.log));
    const latencyMs = Date.now() - startedAt;
    recordRequest({ success: true, latencyMs });
    req.log.info({ latencyMs }, 'Chat response sent');
    res.json({ reply });
  } catch (err) {
    recordRequest({ success: false, latencyMs: Date.now() - startedAt });
    next(err);
  }
}

export async function health(req, res) {
  const result = await healthCheck();
  const metrics = snapshot();
  const status = result.ok ? 200 : 503;

  res.status(status).json({
    status: result.ok ? 'ok' : 'degraded',
    model: result.modelLoaded ? 'loaded' : 'not loaded',
    circuit: result.circuit,
    queue: {
      running: inferenceQueue.runningCount,
      pending: inferenceQueue.pendingCount,
    },
    uptime_s: metrics.uptime_s,
    timestamp: new Date().toISOString(),
  });
}

export async function metrics(_req, res) {
  res.json(snapshot());
}
