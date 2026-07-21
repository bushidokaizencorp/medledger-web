'use strict';
/** Binds the app to a port. Import app.js directly in tests instead. */
const { createApp } = require('./app');
const { env } = require('./config/env');
const db = require('./db');

async function start() {
  // Fail fast if the database isn't reachable.
  try {
    await db.raw('SELECT 1');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Cannot reach the database:', e.message);
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`MedLedger listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
  });

  const shutdown = (sig) => {
    // eslint-disable-next-line no-console
    console.log(`\n${sig} received, shutting down.`);
    server.close(() => db.destroy().then(() => process.exit(0)));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
