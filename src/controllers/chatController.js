import { generate, generateStream, healthCheck } from '../services/ollamaService.js';
import { inferenceQueue } from '../utils/queue.js';
import { recordRequest, snapshot } from '../utils/metrics.js';
import { config } from '../config/index.js';

const DEFAULT_SYSTEM = `You are a helpful AI assistant. Reply clearly and concisely.`;

// Gemma ignores the top-level `system` field in practice.
// Triple injection: prime the model with a user→assistant turn so it anchors the persona
// before any real conversation begins.
// Trim to first 220 chars so the full system anchor fits inside num_ctx=256
// alongside the user message and 2-turn history without getting truncated.
const SYSTEM_CHAR_LIMIT = 220;

function buildPayload(message, history = [], systemPrompt = '') {
  const full = (systemPrompt || '').trim() || DEFAULT_SYSTEM;
  const sys = full.length > SYSTEM_CHAR_LIMIT ? full.slice(0, SYSTEM_CHAR_LIMIT) + '.' : full;

  const historyMsgs = history
    .slice(-2) // 2 turns max keeps context tight for speed
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map((m) => ({ role: m.role, content: m.text }));

  const messages = [
    { role: 'user',      content: `[SYSTEM]\n${sys}` },
    { role: 'assistant', content: 'Understood.' },
    ...historyMsgs,
    { role: 'user', content: message },
  ];

  return { system: sys, messages };
}

export async function chat(req, res, next) {
  const { message, history, systemPrompt, numGpu, temperature } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string.' });
  }

  if (history !== undefined && !Array.isArray(history)) {
    return res.status(400).json({ error: 'history must be an array.' });
  }

  const { system, messages } = buildPayload(message.trim(), history ?? [], systemPrompt ?? '');
  const resolvedNumGpu = numGpu !== undefined ? Number(numGpu) : 99;
  const resolvedTemp = temperature !== undefined ? Number(temperature) : undefined;
  const startedAt = Date.now();
  req.log.info(
    {
      chars: message.trim().length,
      historyLen: (history ?? []).length,
      systemChars: system.length,
      customSystem: Boolean((systemPrompt || '').trim()),
      numGpu: resolvedNumGpu,
      temperature: resolvedTemp,
    },
    'Chat request',
  );

  try {
    const reply = await inferenceQueue.enqueue(() => generate(messages, req.log, system, resolvedNumGpu, resolvedTemp));
    const latencyMs = Date.now() - startedAt;
    recordRequest({ success: true, latencyMs });
    req.log.info({ latencyMs }, 'Chat response sent');
    res.json({ reply });
  } catch (err) {
    recordRequest({ success: false, latencyMs: Date.now() - startedAt });
    next(err);
  }
}

export async function streamChat(req, res, next) {
  const { message, history, systemPrompt, numGpu, temperature } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string.' });
  }

  if (history !== undefined && !Array.isArray(history)) {
    return res.status(400).json({ error: 'history must be an array.' });
  }

  const { system, messages } = buildPayload(message.trim(), history ?? [], systemPrompt ?? '');
  const resolvedNumGpu = numGpu !== undefined ? Number(numGpu) : 99;
  const resolvedTemp = temperature !== undefined ? Number(temperature) : undefined;
  const startedAt = Date.now();
  req.log.info({ chars: message.trim().length, numGpu: resolvedNumGpu, temperature: resolvedTemp }, 'Stream chat request');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    for await (const token of generateStream(messages, req.log, system, resolvedNumGpu, resolvedTemp)) {
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }
    const latencyMs = Date.now() - startedAt;
    recordRequest({ success: true, latencyMs });
    req.log.info({ latencyMs }, 'Stream complete');
    res.write(`data: [DONE]\n\n`);
  } catch (err) {
    recordRequest({ success: false, latencyMs: Date.now() - startedAt });
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    req.log.error({ err }, 'Stream error');
  } finally {
    res.end();
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
