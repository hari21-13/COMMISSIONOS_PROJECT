// One call that loads everything the admin UI needs after sign-in
const express = require('express');
const prisma = require('../db');
const wrap = require('../middleware/wrap');
const { requireAuth } = require('../middleware/auth');
const { COLLECTIONS, SINGLETONS, fromRow } = require('../lib/collections');
const { scopeData, auditHistory } = require('../lib/scope');

const router = express.Router();

async function loadAll() {
  const out = {};
  await Promise.all([
    ...Object.entries(COLLECTIONS).map(async ([name, cfg]) => {
      const rows = await prisma[cfg.model].findMany({ orderBy: { createdAt: cfg.order } });
      out[name] = rows.map((r) => fromRow(cfg, r));
    }),
    ...Object.entries(SINGLETONS).map(async ([name, cfg]) => {
      out[name] = fromRow(cfg, await prisma[cfg.model].findUnique({ where: { id: 1 } })) || {};
    }),
  ]);
  const [results, exceptions] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'engine.results' } }),
    prisma.setting.findUnique({ where: { key: 'engine.exceptions' } }),
  ]);
  out.engine = {
    results: results ? results.value : [],
    exceptions: exceptions
      ? exceptions.value
      : out.transactions
          .filter((t) => t.status === 'Pending Validation' || t.status === 'On Hold')
          .map((t, idx) => ({
            id: `EXC0${idx + 1}`,
            txnId: t.id,
            employee: t.salesperson,
            issue: `Transaction ${t.id} (${t.invoiceNumber}) is "${t.status}" and excluded from payable run.`,
          })),
  };
  return out;
}

// admin: whole workspace with edit rights.
// employee: only their own records. user: only authorised records + audit history. (see lib/scope.js)
router.get('/bootstrap', requireAuth, wrap(async (req, res) => {
  const full = await loadAll();
  if (req.account.role === 'admin') return res.json(full);
  const data = await scopeData(req.account, full);
  // organisation: keep branding + address for PDFs, drop payment details
  data.org = { ...data.org, upiId: '' };
  if (req.account.role === 'user') data.audit = auditHistory(data);
  return res.json(data);
}));

module.exports = router;
module.exports.loadAll = loadAll;