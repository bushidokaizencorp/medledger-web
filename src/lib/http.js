'use strict';
/** Small shared helpers used across modules. */

/** Wrap an async route so thrown errors reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** An error carrying an HTTP status. Thrown by services, caught centrally. */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (m, d) => new HttpError(400, m, d);
const unauthorized = (m = 'Unauthorized') => new HttpError(401, m);
const forbidden = (m = 'Forbidden') => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);
const conflict = (m) => new HttpError(409, m);
const unprocessable = (m, d) => new HttpError(422, m, d);

/**
 * Write an audit record. Append-only by convention: nothing updates or deletes
 * audit_log rows. Takes the same trx the caller is using so the audit entry
 * commits or rolls back atomically with the action it describes.
 */
async function audit(trx, { userId, action, entityType, entityId, detail }) {
  await trx('audit_log').insert({
    user_id: userId ?? null,
    action,
    entity_type: entityType,
    entity_id: entityId != null ? String(entityId) : null,
    detail: detail ?? null,
    at: new Date().toISOString(),
  });
}

module.exports = {
  asyncHandler,
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  audit,
};
