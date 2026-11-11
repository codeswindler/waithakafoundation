// PM2 process file for the VPS.
//   pm2 start ecosystem.config.js --env production
//   pm2 save && pm2 startup        (start on boot)
//   pm2 reload waithaka            (zero-downtime restart after git pull)
// Secrets (DATABASE_URL, SMTP_*) live in .env next to this file, which server.js loads.
module.exports = {
  apps: [
    {
      name: 'waithaka',
      script: 'server.js',
      cwd: __dirname,
      // One process: uploads, rate limiting and login sessions are all handled safely in a single
      // instance, and a small NGO site needs no more. Raise only together with a shared rate limiter.
      exec_mode: 'fork',
      instances: 1,
      wait_ready: true, // server.js signals 'ready' once the DB is connected and it is listening
      listen_timeout: 20000,
      kill_timeout: 10000, // let in-flight uploads finish on reload
      max_memory_restart: '450M',
      exp_backoff_restart_delay: 200,
      time: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      env: { NODE_ENV: 'development', PORT: 3460 },
      env_production: { NODE_ENV: 'production', PORT: 3460, HOST: '127.0.0.1', COOKIE_SECURE: '1', BASE_URL: 'https://waithakafoundation.org' },
    },
  ],
};
