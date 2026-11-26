const jwt = require('jsonwebtoken');
const config = require('../config');

const signToken = (account) =>
  jwt.sign({ sub: account.id, tv: account.tokenVersion, role: account.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

const verifyToken = (token) => jwt.verify(token, config.jwtSecret);

module.exports = { signToken, verifyToken };
