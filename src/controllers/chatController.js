import { generate, healthCheck } from '../services/ollamaService.js';
import { inferenceQueue } from '../utils/queue.js';
import { recordRequest, snapshot } from '../utils/metrics.js';
import { config } from '../config/index.js';

const DEFAULT_SYSTEM = `You are a helpful AI assistant. Reply clearly and concisely.`;

// Gemma 4 supports the system role natively via Ollama's chat template.
// Clean payload — no triple injection needed.
function buildPayload(message, history = [], systemPrompt = '') {
  const sys = (systemPrompt || '').trim() || DEFAULT_SYSTEM;

  const historyMsgs = history
    .slice(-10)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map((m) => ({ role: m.role, content: m.text }));

  const messages = [
    ...historyMsgs,
    { role: 'user', content: message },
  ];

  return { system: sys, messages };
}

export async function chat(req, res, next) {
  const { message, history, systemPrompt } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string.' });
  }

  if (history !== undefined && !Array.isArray(history)) {
    return res.status(400).json({ error: 'history must be an array.' });
  }

  const { system, messages } = buildPayload(message.trim(), history ?? [], systemPrompt ?? '');
  const startedAt = Date.now();
  req.log.info(
    {
      chars: message.trim().length,
      historyLen: (history ?? []).length,
      systemChars: system.length,
      customSystem: Boolean((systemPrompt || '').trim()),
    },
    'Chat request',
  );

  try {
    const reply = await inferenceQueue.enqueue(() => generate(messages, req.log, system));
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
