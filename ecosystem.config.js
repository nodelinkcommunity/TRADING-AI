/**
 * PM2 Ecosystem Config
 * Dung voi: pm2 start ecosystem.config.js
 */

module.exports = {
  apps: [
    {
      name: "flashloan-ai",
      script: "server/app.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 3000,
      },
      // Logs
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,

      // Restart policy
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};
