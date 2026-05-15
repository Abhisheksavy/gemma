// In-memory metrics — lightweight, no external dependency.
// For production at scale, swap the flush target to Prometheus/CloudWatch.

const state = {
  requests: { total: 0, success: 0, error: 0, queued: 0 },
  latencies: [],       // rolling window of last 1000 response times (ms)
  startedAt: Date.now(),
};

const MAX_LATENCY_SAMPLES = 1000;

export function recordRequest({ success, latencyMs }) {
  state.requests.total++;
  success ? state.requests.success++ : state.requests.error++;
  state.latencies.push(latencyMs);
  if (state.latencies.length > MAX_LATENCY_SAMPLES) state.latencies.shift();
}

export function recordQueued(delta) {
  state.requests.queued = Math.max(0, state.requests.queued + delta);
}

export function snapshot() {
  const sorted = [...state.latencies].sort((a, b) => a - b);
  const len = sorted.length;
  return {
    uptime_s: Math.floor((Date.now() - state.startedAt) / 1000),
    requests: { ...state.requests },
    latency_ms: len === 0 ? null : {
      avg:  Math.round(sorted.reduce((s, v) => s + v, 0) / len),
      p50:  sorted[Math.floor(len * 0.5)] ?? 0,
      p95:  sorted[Math.floor(len * 0.95)] ?? 0,
      p99:  sorted[Math.floor(len * 0.99)] ?? 0,
      max:  sorted[len - 1] ?? 0,
    },
    error_rate_pct: state.requests.total === 0
      ? 0
      : +((state.requests.error / state.requests.total) * 100).toFixed(2),
  };
}
