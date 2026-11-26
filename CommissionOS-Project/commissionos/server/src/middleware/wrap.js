// Lets route handlers be `async` and forwards rejected promises to the error handler.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
