// Admin: download a full backup, restore from one, or reset to the demo data
const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const wrap = require('../middleware/wrap');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { httpError } = require('../lib/errors');
const { COLLECTIONS, SINGLETONS, toRow, orderedRows } = require('../lib/collections');
const { loadAll } = require('./bootstrap');
const { seedDemoData } = require('../lib/seed-lib');

const router = express.Router();
router.use('/admin', requireAuth, requireAdmin);

router.get('/admin/backup', wrap(async (req, res) => {
  const data = await loadAll();
  res.json({ app: 'auron-commissionos', version: 1, exportedAt: new Date().toISOString(), data });
}));

const restoreSchema = z.object({
  app: z.literal('auron-commissionos'),
  version: z.literal(1),
  data: z.record(z.any()),
});

router.post('/admin/restore', wrap(async (req, res) => {
  const parsed = restoreSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'This file is not a valid Auron CommissionOS backup.');
  const { data } = parsed.data;

  const ops = [];
  for (const [name, cfg] of Object.entries(COLLECTIONS)) {
    if (!Array.isArray(data[name])) continue;
    ops.push(prisma[cfg.model].deleteMany({}));
    if (data[name].length) ops.push(prisma[cfg.model].createMany({ data: orderedRows(cfg, data[name]), skipDuplicates: true }));
  }
  for (const [name, cfg] of Object.entries(SINGLETONS)) {
    if (data[name] && typeof data[name] === 'object') {
      const row = toRow(cfg, data[name]);
      ops.push(prisma[cfg.model].upsert({ where: { id: 1 }, create: { id: 1, ...row }, update: row }));
    }
  }
  if (data.engine) {
    for (const key of ['results', 'exceptions']) {
      if (Array.isArray(data.engine[key])) {
        ops.push(prisma.setting.upsert({
          where: { key: `engine.${key}` },
          create: { key: `engine.${key}`, value: data.engine[key] },
          update: { value: data.engine[key] },
        }));
      }
    }
  }
  await prisma.$transaction(ops);
  res.json({ ok: true });
}));

router.post('/admin/reset', wrap(async (req, res) => {
  await seedDemoData(prisma, { wipe: true });
  res.json({ ok: true });
}));

module.exports = router;
