/**
 * ============================================
 *  FLASHLOAN-AI — PM2 Ecosystem Config
 *  Auto-restart, crash recovery, log rotation
 * ============================================
 *
 *  Quick start:  npm run pm2:start
 *  Status:       npm run pm2:status
 *  Logs:         npm run pm2:logs
 *  Stop:         npm run pm2:stop
 *  Restart:      npm run pm2:restart
 *  Auto-boot:    npm run pm2:save && npm run pm2:startup
 */

module.exports = {
  apps: [
    {
      name: "flashloan-server",
      script: "server/app.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",

      // Restart policy
      restart_delay: 3000,           // Wait 3s before restart
      max_restarts: 100,             // Max restarts before giving up
      min_uptime: "10s",             // Must run 10s to count as "started"
      exp_backoff_restart_delay: 1000, // Exponential backoff on crashes

      // Environment
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // Logs
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/server-error.log",
      out_file: "logs/server-out.log",
      merge_logs: true,

      // Log rotation (keeps logs manageable)
      log_type: "json",
    },
  ],
};
