// Admin: user accounts and the login-activity log
const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const wrap = require('../middleware/wrap');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { httpError } = require('../lib/errors');
const { hashPassword } = require('../lib/accounts');

const router = express.Router();
router.use('/admin', requireAuth, requireAdmin);

const view = (a) => ({
  id: a.id, name: a.name, email: a.email, role: a.role, provider: a.provider, status: a.status,
  createdAt: a.createdAt, lastLogin: a.lastLogin, loginCount: a.loginCount,
});

const activeAdmins = () => prisma.account.count({ where: { role: 'admin', status: 'Active' } });

router.get('/admin/accounts', wrap(async (req, res) => {
  const rows = await prisma.account.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(rows.map(view));
}));

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6).max(200),
  role: z.enum(['admin', 'employee', 'user']).default('user'),
});

router.post('/admin/accounts', wrap(async (req, res) => {
  const b = createSchema.parse(req.body);
  if (await prisma.account.findUnique({ where: { email: b.email } })) throw httpError(409, 'An account with this email already exists.');
  const row = await prisma.account.create({
    data: { name: b.name, email: b.email, role: b.role, provider: 'Email', passwordHash: await hashPassword(b.password) },
  });
  res.status(201).json(view(row));
}));

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(['admin', 'employee', 'user']).optional(),
  status: z.enum(['Active', 'Suspended']).optional(),
  newPassword: z.string().min(6).max(200).optional().or(z.literal('')),
});

router.put('/admin/accounts/:id', wrap(async (req, res) => {
  const b = updateSchema.parse(req.body);
  const target = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!target) throw httpError(404, 'Account not found.');
  const role = b.role || target.role;
  const status = b.status || target.status;
  const losesAdmin = target.role === 'admin' && target.status === 'Active' && (role !== 'admin' || status !== 'Active');
  if (losesAdmin && (await activeAdmins()) <= 1) throw httpError(400, 'At least one active admin is required.');
  if (target.id === req.account.id && (role !== target.role || status !== 'Active')) {
    throw httpError(400, 'You cannot change your own role or suspend yourself.');
  }
  const data = { role, status };
  if (b.name) data.name = b.name;
  let bump = role !== target.role || status !== target.status;
  if (b.newPassword) {
    data.passwordHash = await hashPassword(b.newPassword);
    bump = true;
  }
  if (bump) data.tokenVersion = target.tokenVersion + 1; // signs the person out everywhere
  const row = await prisma.account.update({ where: { id: target.id }, data });
  res.json(view(row));
}));

router.delete('/admin/accounts/:id', wrap(async (req, res) => {
  const target = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!target) throw httpError(404, 'Account not found.');
  if (target.id === req.account.id) throw httpError(400, 'You cannot delete your own account.');
  if (target.role === 'admin' && target.status === 'Active' && (await activeAdmins()) <= 1) {
    throw httpError(400, 'At least one active admin is required.');
  }
  await prisma.account.delete({ where: { id: target.id } });
  res.json({ ok: true });
}));

router.get('/admin/login-activity', wrap(async (req, res) => {
  const rows = await prisma.loginActivity.findMany({ orderBy: { time: 'desc' } });
  res.json(rows.slice(0, 500));
}));

router.delete('/admin/login-activity', wrap(async (req, res) => {
  await prisma.loginActivity.deleteMany({});
  res.json({ ok: true });
}));

module.exports = router;