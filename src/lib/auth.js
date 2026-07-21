'use strict';
/**
 * Authentication primitives: password hashing (Argon2id) and JWT tokens.
 *
 * Argon2id is the current OWASP-recommended password hash — memory-hard and
 * resistant to GPU cracking in a way bcrypt is not. Tokens are short-lived
 * access tokens plus longer refresh tokens.
 */
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { env } = require('../config/env');

// OWASP-aligned Argon2id parameters.
const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  return argon2.hash(plain, ARGON_OPTS);
}

async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: 'medledger',
  });
}

function signRefreshToken(payload) {
  // Include a random jti so refresh tokens can be individually revoked.
  const jti = crypto.randomBytes(16).toString('hex');
  return {
    token: jwt.sign({ ...payload, jti }, env.JWT_SECRET, {
      expiresIn: env.JWT_REFRESH_TTL,
      issuer: 'medledger',
    }),
    jti,
  };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { issuer: 'medledger' });
  } catch {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyToken,
};
