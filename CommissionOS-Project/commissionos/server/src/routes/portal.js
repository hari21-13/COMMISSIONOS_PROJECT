// Read-only portal data: the signed-in person sees ONLY their own records (enforced here, not in the UI)
const express = require('express');
const prisma = require('../db');
const wrap = require('../middleware/wrap');
const { requireAuth } = require('../middleware/auth');
const { COLLECTIONS, fromRow } = require('../lib/collections');
const { publicUser } = require('../lib/accounts');

const router = express.Router();

const many = async (name, where) => {
  const cfg = COLLECTIONS[name];
  const rows = await prisma[cfg.model].findMany({ where, orderBy: { createdAt: cfg.order } });
  return rows.map((r) => fromRow(cfg, r));
};

router.get('/portal', requireAuth, wrap(async (req, res) => {
  const account = req.account;
  const emailLc = account.email.toLowerCase();
  const nameLc = account.name.trim().toLowerCase();

  const empCfg = COLLECTIONS.employees;
  const allEmployees = (await prisma.employee.findMany({ orderBy: { createdAt: 'asc' } })).map((r) => fromRow(empCfg, r));
  // match by e-mail first; fall back to an exact (unique) name match
  let employee = allEmployees.find((e) => (e.email || '').toLowerCase() === emailLc) || null;
  if (!employee) {
    const byName = allEmployees.filter((e) => (e.name || '').trim().toLowerCase() === nameLc);
    if (byName.length === 1) [employee] = byName;
  }

  const orgRow = await prisma.organisation.findUnique({ where: { id: 1 } });
  const org = { name: (orgRow && orgRow.name) || 'Auron CommissionOS', address: (orgRow && orgRow.address) || '', tagline: (orgRow && orgRow.tagline) || '' };
  const base = { user: publicUser(account), org, employee, policy: null, transactions: [], statements: [], payouts: [], disputes: [], adjustments: [] };
  if (!employee) return res.json(base);

  const polCfg = COLLECTIONS.policies;
  const polRow = employee.planId ? await prisma.policy.findUnique({ where: { id: employee.planId } }) : null;
  const [transactions, statements, payouts, disputes, adjustments] = await Promise.all([
    many('transactions', { OR: [{ salespersonId: employee.id }, { salesperson: employee.name }, { referrer: employee.name }] }),
    many('statements', { OR: [{ employeeId: employee.id }, { employee: employee.name }] }),
    many('payouts', { employee: employee.name }),
    many('disputes', { employee: employee.name }),
    many('adjustments', { employee: employee.name }),
  ]);
  return res.json({ ...base, policy: fromRow(polCfg, polRow), transactions, statements, payouts, disputes, adjustments });
}));

module.exports = router;
