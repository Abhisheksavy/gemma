import { generate, healthCheck } from '../services/ollamaService.js';
import { inferenceQueue } from '../utils/queue.js';
import { recordRequest, snapshot } from '../utils/metrics.js';
import { config } from '../config/index.js';

const DEFAULT_SYSTEM = `You are a helpful AI assistant. Reply clearly and concisely.`;

// Build OpenAI-style messages array — Ollama /api/chat handles templating automatically
function buildMessages(message, history = [], systemPrompt = '') {
  const messages = [];

  messages.push({ role: 'system', content: systemPrompt.trim() || DEFAULT_SYSTEM });

  for (const msg of history.slice(-10)) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.text });
    }
  }

  messages.push({ role: 'user', content: message });
  return messages;
}

export async function chat(req, res, next) {
  const { message, history, systemPrompt } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string.' });
  }

  if (history !== undefined && !Array.isArray(history)) {
    return res.status(400).json({ error: 'history must be an array.' });
  }

  const messages = buildMessages(message.trim(), history ?? [], systemPrompt ?? '');
  const startedAt = Date.now();
  req.log.info({ chars: message.trim().length, historyLen: (history ?? []).length }, 'Chat request');

  try {
    const reply = await inferenceQueue.enqueue(() => generate(messages, req.log));
    const latencyMs = Date.now() - startedAt;
    recordRequest({ success: true, latencyMs });
    req.log.info({ latencyMs }, 'Chat response sent');
    res.json({ reply });
  } catch (err) {
    recordRequest({ success: false, latencyMs: Date.now() - startedAt });
    next(err);
  }
}

export async function health(_req, res) {
  const result = await healthCheck();
  const metrics = snapshot();
  res.status(result.ok ? 200 : 503).json({
    status: result.ok ? 'ok' : 'degraded',
    model: result.modelLoaded ? 'loaded' : 'not loaded',
    circuit: result.circuit,
    queue: { running: inferenceQueue.runningCount, pending: inferenceQueue.pendingCount },
    uptime_s: metrics.uptime_s,
    timestamp: new Date().toISOString(),
  });
}

export async function metrics(_req, res) {
  res.json({ ...snapshot(), model: config.ollama.model });
}
