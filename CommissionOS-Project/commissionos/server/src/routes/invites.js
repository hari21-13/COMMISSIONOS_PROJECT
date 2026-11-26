// Invitations: admin creates a one-time link, the invited person opens it and sets a password
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const config = require('../config');
const wrap = require('../middleware/wrap');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { httpError } = require('../lib/errors');
const { hashPassword, recordLogin, publicUser } = require('../lib/accounts');
const { signToken } = require('../lib/tokens');
const { sendMail } = require('../lib/mailer');

const router = express.Router();
const INVITE_DAYS = 7;

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(100).optional(),
  role: z.string().trim().min(1).max(60).default('Salesperson'),
  department: z.string().trim().max(60).default('Sales'),
});

router.post('/invites', requireAuth, requireAdmin, wrap(async (req, res) => {
  const b = createSchema.parse(req.body);
  const org = await prisma.organisation.findUnique({ where: { id: 1 } });
  const orgName = (org && org.name) || 'Auron CommissionOS';

  await prisma.invite.updateMany({ where: { email: b.email, status: 'Pending' }, data: { status: 'Revoked' } });
  const invite = await prisma.invite.create({
    data: {
      token: crypto.randomBytes(24).toString('hex'),
      email: b.email,
      name: b.name || b.email.split('@')[0],
      role: b.role,
      department: b.department,
      orgName,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000),
    },
  });
  const link = `${config.clientUrl}/?invite=${invite.token}`;
  const emailed = await sendMail({
    to: b.email,
    subject: `You're invited to join ${orgName} on Auron CommissionOS`,
    text: `Hi ${invite.name},\n\nYou have been invited to join ${orgName} on Auron CommissionOS as ${b.role}.\n\nAccept your invitation:\n${link}\n\nThis link is valid for ${INVITE_DAYS} days.\n`,
  });
  res.status(201).json({ link, emailed, orgName, expiresAt: invite.expiresAt });
}));

async function loadPending(token) {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) throw httpError(404, 'This invitation link is not valid.');
  if (invite.status === 'Accepted') throw httpError(410, 'This invitation has already been accepted. Please sign in.');
  if (invite.status !== 'Pending') throw httpError(410, 'This invitation was cancelled.');
  if (invite.expiresAt < new Date()) throw httpError(410, 'This invitation has expired. Ask your admin for a new one.');
  return invite;
}

router.get('/invites/:token', wrap(async (req, res) => {
  const i = await loadPending(req.params.token);
  res.json({ email: i.email, name: i.name, role: i.role, orgName: i.orgName });
}));

const acceptSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your full name.').max(100),
  password: z.string().min(6, 'Password must be at least 6 characters.').max(200),
});

router.post('/invites/:token/accept', wrap(async (req, res) => {
  const b = acceptSchema.parse(req.body);
  const invite = await loadPending(req.params.token);
  const role = invite.role === 'Admin / Owner' ? 'admin' : 'employee';
  const passwordHash = await hashPassword(b.password);

  let account = await prisma.account.findUnique({ where: { email: invite.email } });
  if (account) {
    // an existing account can only be activated by its invite if it has no password yet (e.g. Google-only)
    if (account.passwordHash) throw httpError(409, 'An account with this email already exists. Please sign in.');
    account = await prisma.account.update({ where: { id: account.id }, data: { passwordHash, name: b.name, status: 'Active' } });
  } else {
    account = await prisma.account.create({
      data: { name: b.name, email: invite.email, role, provider: 'Invitation', passwordHash },
    });
  }
  await prisma.invite.update({ where: { id: invite.id }, data: { status: 'Accepted', acceptedAt: new Date() } });

  // mark the team member in Organisation Settings as Active
  const member = (await prisma.orgUser.findMany({})).find((u) => (u.email || '').toLowerCase() === invite.email);
  if (member) await prisma.orgUser.update({ where: { id: member.id }, data: { status: 'Active', name: b.name } });

  const updated = await recordLogin(account, { provider: 'Invitation', page: 'invite', name: b.name });
  res.json({ token: signToken(updated), user: publicUser(updated) });
}));

module.exports = router;