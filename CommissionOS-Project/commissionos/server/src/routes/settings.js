// Organisation settings and subscription (single-row tables)
const express = require('express');
const prisma = require('../db');
const wrap = require('../middleware/wrap');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { SINGLETONS, toRow, fromRow } = require('../lib/collections');

const router = express.Router();

for (const [name, cfg] of Object.entries(SINGLETONS)) {
  router.get(`/settings/${name}`, requireAuth, requireAdmin, wrap(async (req, res) => {
    const row = await prisma[cfg.model].findUnique({ where: { id: 1 } });
    res.json(fromRow(cfg, row) || {});
  }));

  router.put(`/settings/${name}`, requireAuth, requireAdmin, wrap(async (req, res) => {
    const data = toRow(cfg, req.body && typeof req.body === 'object' ? req.body : {});
    const row = await prisma[cfg.model].upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    res.json(fromRow(cfg, row));
  }));
}

module.exports = router;
