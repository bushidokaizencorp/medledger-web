'use strict';
/**
 * Express application: the security middleware stack, static frontend, API
 * routes, and the error handler. Kept separate from server.js so tests can
 * import the app without binding a port.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');

const { env } = require('./config/env');
const { errorHandler } = require('./middleware/security');
const { notFound } = require('./lib/http');

const authRoutes = require('./modules/auth.routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind a reverse proxy in production

  // ---- Security headers (Helmet) --------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // inline styles on the login page
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      hsts: env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // ---- CORS allowlist --------------------------------------------------
  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || origins.includes(origin)) return cb(null, true);
        return cb(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
    })
  );

  // ---- Parsers ---------------------------------------------------------
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // ---- Structured request logging (redacting secrets) ------------------
  if (env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        serializers: {
          req(req) {
            return { method: req.method, url: req.url };
          },
        },
      })
    );
  }

  // ---- Rate limiting ---------------------------------------------------
  const globalLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const loginLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later' },
  });
  app.use('/api/', globalLimiter);
  app.use('/api/auth/login', loginLimiter);

  // ---- Health ----------------------------------------------------------
  app.get('/healthz', (_req, res) =>
    res.json({ ok: true, service: 'MedLedger', version: '0.1.0', env: env.NODE_ENV }));
  app.get('/readyz', async (_req, res) => {
    try {
      const db = require('./db');
      await db.raw('SELECT 1');
      res.json({ ok: true, database: 'up' });
    } catch (e) {
      res.status(503).json({ ok: false, database: 'down' });
    }
  });

  // ---- API routes ------------------------------------------------------
  app.use('/api/auth', authRoutes);
  app.use('/api/items', require('./modules/items.routes'));
  app.use('/api/customers', require('./modules/customers.routes'));
  app.use('/api/inventory', require('./modules/inventory.routes'));
  app.use('/api/sales', require('./modules/sales.routes'));
  app.use('/api/gl', require('./modules/gl.routes'));

  // ---- Static frontend -------------------------------------------------
  app.get('/', (_req, res) => res.redirect('/pages/login.html'));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ---- 404 for unmatched API, else fall through to error handler -------
  app.use('/api', (_req, _res, next) => next(notFound('Endpoint not found')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
