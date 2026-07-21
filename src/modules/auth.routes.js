'use strict';
/** Authentication routes: login, token refresh, logout, current user. */
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const {
  hashPassword, verifyPassword, signAccessToken, signRefreshToken, verifyToken,
} = require('../lib/auth');
const { asyncHandler, unauthorized, audit } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/security');
const { env } = require('../config/env');

const router = express.Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginSchema = {
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
};

function setAuthCookies(res, accessToken, refreshToken) {
  const base = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
  };
  res.cookie('access_token', accessToken, { ...base, maxAge: 30 * 60 * 1000 });
  res.cookie('refresh_token', refreshToken, { ...base, maxAge: 7 * 24 * 3600 * 1000 });
}

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await db('users').where({ email, is_deleted: false }).first();

  // Uniform failure: never reveal whether the email exists.
  const genericFail = () => { throw unauthorized('Incorrect email or password'); };

  if (!user) {
    // Spend time comparable to a real verify to blunt user-enumeration timing.
    await hashPassword('timing-equaliser-not-stored').catch(() => {});
    return genericFail();
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw unauthorized('Account temporarily locked. Try again later.');
  }
  if (!user.is_active) throw unauthorized('Account is disabled');

  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) {
    const failed = user.failed_login_count + 1;
    const patch = { failed_login_count: failed };
    if (failed >= MAX_FAILED) {
      patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
      patch.failed_login_count = 0;
    }
    await db('users').where({ id: user.id }).update(patch);
    return genericFail();
  }

  const role = await db('roles').where({ id: user.role_id }).first();

  await db.transaction(async (trx) => {
    await trx('users').where({ id: user.id }).update({
      failed_login_count: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    });
    const claims = { sub: user.id, email: user.email, role: role.code };
    const accessToken = signAccessToken(claims);
    const { token: refreshToken, jti } = signRefreshToken({ ...claims, typ: 'refresh' });
    await trx('refresh_tokens').insert({
      jti,
      user_id: user.id,
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    });
    await audit(trx, { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id });

    setAuthCookies(res, accessToken, refreshToken);
    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      user: { id: user.id, email: user.email, full_name: user.full_name, role: role.code },
    });
  });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.body?.refresh_token || req.cookies?.refresh_token;
  if (!token) throw unauthorized('Missing refresh token');
  const claims = verifyToken(token);
  if (!claims || claims.typ !== 'refresh') throw unauthorized('Invalid refresh token');

  const record = await db('refresh_tokens').where({ jti: claims.jti }).first();
  if (!record || record.revoked) throw unauthorized('Refresh token revoked');
  if (new Date(record.expires_at) < new Date()) throw unauthorized('Refresh token expired');

  const accessClaims = { sub: claims.sub, email: claims.email, role: claims.role };
  const accessToken = signAccessToken(accessClaims);
  res.cookie('access_token', accessToken, {
    httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict',
    path: '/', maxAge: 30 * 60 * 1000,
  });
  res.json({ access_token: accessToken, token_type: 'bearer' });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  const token = req.body?.refresh_token || req.cookies?.refresh_token;
  if (token) {
    const claims = verifyToken(token);
    if (claims?.jti) {
      await db('refresh_tokens').where({ jti: claims.jti }).update({ revoked: true });
    }
  }
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
  res.json({ ok: true });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await db('users').where({ id: req.user.id }).first();
  if (!user) throw unauthorized();
  res.json({
    id: user.id, email: user.email, full_name: user.full_name, role: req.user.role,
    legal_entity_id: user.legal_entity_id,
  });
}));

module.exports = router;
