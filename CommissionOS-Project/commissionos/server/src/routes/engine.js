// Commission Engine: calculation runs on the server using the policies in the database
const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const wrap = require('../middleware/wrap');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { COLLECTIONS, fromRow, toRow, monotonicNow } = require('../lib/collections');
const { runEngine } = require('../lib/commission');

const router = express.Router();

const bodySchema = z.object({
  period: z.string().trim().min(1).max(60).default('November 2026'),
  scope: z.string().trim().min(1).max(60).default('ALL'),
});

router.post('/engine/run', requireAuth, requireAdmin, wrap(async (req, res) => {
  const { period, scope } = bodySchema.parse(req.body || {});
  const [employees, policies, transactions] = await Promise.all(
    ['employees', 'policies', 'transactions'].map(async (name) => {
      const cfg = COLLECTIONS[name];
      return (await prisma[cfg.model].findMany({ orderBy: { createdAt: cfg.order } })).map((r) => fromRow(cfg, r));
    })
  );
  const out = runEngine({ employees, policies, transactions, scope });

  const runCfg = COLLECTIONS.calcRuns;
  const now = new Date();
  const prefix = `RUN-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
  let n = (await prisma.calcRun.count()) + 1;
  while (await prisma.calcRun.findUnique({ where: { runId: `${prefix}${String(n).padStart(2, '0')}` } })) n += 1;

  const run = {
    runId: `${prefix}${String(n).padStart(2, '0')}`,
    period,
    scope: scope === 'ALL' ? 'All Eligible Employees & Partners' : scope,
    timestamp: now.toLocaleString('en-IN'),
    totalSales: out.totalSales,
    totalCommission: out.totalCommission,
    exceptionsCount: out.exceptions.length,
    status: 'Calculated (Draft)',
  };
  const saved = await prisma.calcRun.create({ data: { ...toRow(runCfg, run), createdAt: monotonicNow() } });

  await prisma.setting.upsert({ where: { key: 'engine.results' }, create: { key: 'engine.results', value: out.results }, update: { value: out.results } });
  await prisma.setting.upsert({ where: { key: 'engine.exceptions' }, create: { key: 'engine.exceptions', value: out.exceptions }, update: { value: out.exceptions } });

  res.json({ results: out.results, exceptions: out.exceptions, run: fromRow(runCfg, saved) });
}));

module.exports = router;
