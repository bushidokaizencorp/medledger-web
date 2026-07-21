'use strict';
/** Request validation via Zod. Rejects bad input before it reaches a service. */
const { unprocessable } = require('../lib/http');

/**
 * validate({ body, params, query }) — each is a Zod schema. On success the
 * parsed (and coerced) values replace the originals so handlers get clean data.
 */
function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      next();
    } catch (e) {
      const details = e.errors?.map((x) => ({
        path: x.path.join('.'),
        message: x.message,
      }));
      next(unprocessable('Validation failed', details));
    }
  };
}

module.exports = { validate };
