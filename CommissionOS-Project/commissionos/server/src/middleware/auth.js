const prisma = require('../db');
const { verifyToken } = require('../lib/tokens');
const { httpError } = require('../lib/errors');

// Reads "Authorization: Bearer <jwt>", loads the account and rejects suspended / signed-out accounts.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw httpError(401, 'Please sign in.');
    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      throw httpError(401, 'Your session has expired. Please sign in again.');
    }
    const account = await prisma.account.findUnique({ where: { id: payload.sub } });
    if (!account || account.status !== 'Active' || account.tokenVersion !== payload.tv) {
      throw httpError(401, 'Your session is no longer valid. Please sign in again.');
    }
    req.account = account;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.account || req.account.role !== 'admin') {
    return next(httpError(403, 'Admin access required.'));
  }
  return next();
}

// allow only the listed roles, e.g. requireRoles('admin', 'user')
const requireRoles = (...roles) => (req, res, next) => {
  if (!req.account || !roles.includes(req.account.role)) return next(httpError(403, 'You do not have access to this.'));
  return next();
};

module.exports = { requireAuth, requireAdmin, requireRoles };
