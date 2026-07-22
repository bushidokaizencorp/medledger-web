'use strict';
/**
 * Knex configuration. The same query-builder code runs against SQLite locally
 * (for development and the test suite) and against SQL Server in production —
 * that is the whole reason for using Knex here rather than a SQL-Server-only
 * driver. Migrations and queries are written in the portable subset; anywhere
 * a dialect difference matters, it is handled explicitly in the migration.
 */
const path = require('path');
const { env } = require('../config/env');

/** @type {import('knex').Knex.Config} */
const sqlite = {
  client: 'better-sqlite3',
  connection: { filename: env.DB_FILE },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn, done) => {
      // Enforce foreign keys — SQLite ignores them unless asked.
      conn.pragma('foreign_keys = ON');
      conn.pragma('journal_mode = WAL');
      done(null, conn);
    },
  },
  migrations: { directory: path.join(__dirname, 'migrations') },
  seeds: { directory: path.join(__dirname, 'seeds') },
};

/** @type {import('knex').Knex.Config} */
const mssql = {
  client: 'mssql',
  connection: {
    server: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: {
      encrypt: env.DB_ENCRYPT, // TLS to the database
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: { min: 2, max: 10 },
  },
  migrations: { directory: path.join(__dirname, 'migrations') },
  seeds: { directory: path.join(__dirname, 'seeds') },
};

const configs = { sqlite3: sqlite, mssql };

module.exports = configs[env.DB_CLIENT];
module.exports.all = configs;
