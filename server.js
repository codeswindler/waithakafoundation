'use strict';
const fs = require('fs');
const path = require('path');

// Load .env if present (PM2 or the host can also set these directly).
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { init, close } = require('./src/db');
const { createApp } = require('./src/app');
const { ensureAdmin, seedContent, importGallery } = require('./src/seed');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

(async () => {
  await init();
  await ensureAdmin();
  await seedContent();
  await importGallery();
  const app = await createApp();
  const server = app.listen(PORT, HOST, () => {
    console.log(`Waithaka Foundation website running on http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
    if (process.send) process.send('ready'); // PM2 wait_ready
  });
  // Graceful shutdown for PM2 reloads: finish in-flight requests, then close the DB pool.
  const stop = () => server.close(async () => { await close().catch(() => {}); process.exit(0); });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
