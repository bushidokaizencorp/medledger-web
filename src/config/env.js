'use strict';
/**
 * Centralised configuration. Every environment variable the app reads is
 * declared and validated here, so a misconfigured deployment fails loudly at
 * boot rather than mysteriously at runtime.
 */
require('dotenv').config();

const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  // Database. DB_CLIENT chooses the driver:
  //   sqlite3 -> local dev / tests (zero infrastructure)
  //   mssql   -> production SQL Server
  DB_CLIENT: z.enum(['sqlite3', 'mssql']).default('sqlite3'),
  DB_FILE: z.string().default('./medledger.db'),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().default(1433),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_ENCRYPT: z.coerce.boolean().default(true),

  // Auth. In production the secret MUST be supplied; we refuse to boot with
  // the throwaway default so no one ships forgeable tokens by accident.
  JWT_SECRET: z.string().min(32).default('dev-only-secret-change-me-please-32byte'),
  JWT_ACCESS_TTL: z.string().default('30m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  // Security knobs
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  CORS_ORIGINS: z.string().default('http://localhost:8080'),
  COOKIE_SECURE: z.coerce.boolean().default(false),

  // Fiscalisation / traceability run in simulator mode until real credentials
  // are supplied. Never silently "succeed" against a regulator that isn't there.
  FDMS_MODE: z.enum(['simulator', 'live']).default('simulator'),
  FDMS_BASE_URL: z.string().optional(),
  FDMS_DEVICE_ID: z.string().optional(),
  MCAZ_MODE: z.enum(['simulator', 'live']).default('simulator'),
  MCAZ_BASE_URL: z.string().optional(),
});

const path = require('path');

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

// Anchor the SQLite file to the project root so the DB is the same file no
// matter which working directory a command runs from (the knex CLI, for one,
// changes into the migrations directory).
if (env.DB_CLIENT === 'sqlite3' && !path.isAbsolute(env.DB_FILE)) {
  env.DB_FILE = path.resolve(__dirname, '..', '..', env.DB_FILE);
}

// Hard stops that a schema can't express on its own.
if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET === 'dev-only-secret-change-me-please-32byte') {
    // eslint-disable-next-line no-console
    console.error('Refusing to start in production with the default JWT_SECRET.');
    process.exit(1);
  }
  if (env.DB_CLIENT === 'mssql' && (!env.DB_HOST || !env.DB_NAME || !env.DB_USER)) {
    // eslint-disable-next-line no-console
    console.error('Production SQL Server config incomplete (DB_HOST/DB_NAME/DB_USER).');
    process.exit(1);
  }
}

module.exports = { env };
