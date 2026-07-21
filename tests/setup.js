// Global test setup: point at a throwaway DB, migrate, and seed once.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { beforeAll, afterAll } from 'vitest';

const tmpDb = path.join(os.tmpdir(), `medledger-test-${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'sqlite3';
process.env.DB_FILE = tmpDb;
process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-xxxxx';

beforeAll(async () => {
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  const knexLib = (await import('knex')).default;
  const config = (await import('../src/db/knexfile.js')).default;
  const knex = knexLib(config);
  await knex.migrate.latest();
  await knex.destroy();

  // Seed via the real seed module logic by requiring it in-process.
  const { execSync } = await import('node:child_process');
  execSync('node src/db/seed.js', {
    env: { ...process.env },
    stdio: 'ignore',
  });
});

afterAll(async () => {
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});
