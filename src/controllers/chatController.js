import { generate } from '../services/ollamaService.js';
import { healthCheck } from '../services/ollamaService.js';
import logger from '../utils/logger.js';

export async function chat(req, res, next) {
  const { message } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string' });
  }

  const prompt = message.trim();
  logger.info({ prompt: prompt.slice(0, 100) }, 'Chat request received');

  try {
    const reply = await generate(prompt);
    res.json({ reply });
  } catch (err) {
    next(err);
  }
}

export async function health(req, res) {
  const result = await healthCheck();
  const status = result.ok ? 200 : 503;
  res.status(status).json({
    status: result.ok ? 'ok' : 'degraded',
    model: result.modelLoaded ? 'loaded' : 'not found',
    models: result.models ?? [],
    detail: result.detail ?? null,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
