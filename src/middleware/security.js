'use strict';
/** Authn/authz middleware and the central error handler. */
const { verifyToken } = require('../lib/auth');
const { unauthorized, forbidden, HttpError } = require('../lib/http');

/**
 * Require a valid access token. Attaches req.user = { id, email, role }.
 * Reads the token from the Authorization header (Bearer) or an httpOnly cookie.
 */
function requireAuth(req, _res, next) {
  const header = req.headers.authorization;
  let token = null;
  if (header && header.startsWith('Bearer ')) token = header.slice(7);
  else if (req.cookies && req.cookies.access_token) token = req.cookies.access_token;

  if (!token) return next(unauthorized('Missing authentication token'));

  const claims = verifyToken(token);
  if (!claims || claims.typ === 'refresh') {
    return next(unauthorized('Invalid or expired token'));
  }
  req.user = { id: claims.sub, email: claims.email, role: claims.role };
  return next();
}

/**
 * Require one of the given roles. ADMIN always passes. Must run after
 * requireAuth.
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'ADMIN') return next();
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`Requires role: ${roles.join(' or ')}`));
    }
    return next();
  };
}

/** Central error handler. Never leaks stack traces to clients. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) {
    req.log?.error({ err }, 'Unhandled error');
  }
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { requireAuth, requireRole, errorHandler };
