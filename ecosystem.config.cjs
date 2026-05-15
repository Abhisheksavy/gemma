module.exports = {
  apps: [
    {
      name: 'gemma-api',
      script: 'server.js',
      instances: 1,               // single instance — Ollama is the bottleneck
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      // Logging
      out_file: '/var/log/gemma/out.log',
      error_file: '/var/log/gemma/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Memory guard — restart if RSS > 300 MB
      max_memory_restart: '300M',
    },
  ],
};
