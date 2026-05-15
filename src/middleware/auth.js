import { config } from '../config/index.js';

// Optional API key gate. Disabled if API_KEY env var is not set.
// Clients must send:  Authorization: Bearer <API_KEY>
export function auth(req, res, next) {
  if (!config.apiKey) return next();

  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || token !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key.' });
  }
  next();
}
