// Log every request with method, path, status, duration, and IP.
export function httpLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level](
      { method: req.method, path: req.path, status: res.statusCode, ms, ip: req.ip },
      `${req.method} ${req.path} ${res.statusCode} ${ms}ms`,
    );
  });
  next();
}
