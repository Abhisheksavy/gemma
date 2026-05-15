import { OllamaError } from '../services/ollamaService.js';

// Central error handler — must have 4 args for Express to recognize it.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  // Queue overflow (custom statusCode on plain Error)
  if (err.statusCode === 429) {
    req.log?.warn({ msg: err.message }, 'Queue full');
    return res.status(429).json({ error: err.message });
  }

  if (err instanceof OllamaError) {
    req.log?.warn({ msg: err.message, statusCode: err.statusCode }, 'Ollama error');
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Express body-parser errors (malformed JSON)
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }

  req.log?.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error.' });
}
