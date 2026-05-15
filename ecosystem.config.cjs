module.exports = {
  apps: [
    {
      name: 'gemma-api',
      script: 'server.js',
      instances: 1,               // Ollama is the bottleneck — one instance is right
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 4000,
      exp_backoff_restart_delay: 1000,
      // Logs
      out_file: '/var/log/gemma/out.log',
      error_file: '/var/log/gemma/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Memory guard
      max_memory_restart: '300M',
      // Kill timeout — give graceful shutdown 12s before SIGKILL
      kill_timeout: 12000,
      listen_timeout: 10000,
    },
  ],
};
