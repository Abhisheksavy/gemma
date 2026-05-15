import { generate, healthCheck } from '../services/ollamaService.js';
import { inferenceQueue } from '../utils/queue.js';
import { recordRequest, snapshot } from '../utils/metrics.js';
import { config } from '../config/index.js';

// Build a Gemma-formatted prompt from system prompt + history + current message
function buildPrompt(message, history = [], systemPrompt = '') {
  let prompt = '';

  if (systemPrompt?.trim()) {
    prompt += `<system>\n${systemPrompt.trim()}\n</system>\n`;
  }

  for (const msg of history.slice(-10)) {
    if (msg.role === 'user') {
      prompt += `<start_of_turn>user\n${msg.text}\n<end_of_turn>\n`;
    } else if (msg.role === 'assistant') {
      prompt += `<start_of_turn>model\n${msg.text}\n<end_of_turn>\n`;
    }
  }

  prompt += `<start_of_turn>user\n${message}\n<end_of_turn>\n<start_of_turn>model\n`;
  return prompt;
}

export async function chat(req, res, next) {
  const { message, history, systemPrompt } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string.' });
  }

  if (history !== undefined && !Array.isArray(history)) {
    return res.status(400).json({ error: 'history must be an array.' });
  }

  const prompt = buildPrompt(message.trim(), history ?? [], systemPrompt ?? '');

  if (prompt.length > config.maxMessageLength * 10) {
    return res.status(400).json({ error: 'Conversation too long.' });
  }

  const startedAt = Date.now();
  req.log.info({ chars: message.trim().length, historyLen: (history ?? []).length }, 'Chat request');

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
