import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

// Attach a unique request ID to every request.
// Client may send X-Request-ID; we echo it back and use it in logs.
export function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || randomUUID();
  req.id = id;
  res.setHeader('X-Request-ID', id);
  // Give each request its own child logger so all logs carry the request ID
  req.log = logger.child({ reqId: id });
  next();
}
