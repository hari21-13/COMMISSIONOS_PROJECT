const { ZodError } = require('zod');
const { HttpError } = require('../lib/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const where = first && first.path.length ? `${first.path.join('.')}: ` : '';
    return res.status(400).json({ error: `${where}${first ? first.message : 'Invalid request'}`, issues: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request is too large.' });
  }
  if (err && err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with the same unique value already exists.' });
  }
  if (err && err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found.' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on the server.' });
}

function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
