const bcrypt = require('bcryptjs');
const prisma = require('../db');

const hashPassword = (plain) => bcrypt.hash(plain, 10);
const checkPassword = (plain, hash) => (hash ? bcrypt.compare(plain, hash) : Promise.resolve(false));

const roleLabelOf = (role) => (role === 'admin' ? 'Admin / Owner' : role === 'employee' ? 'Employee (Limited access)' : 'User (View only)');

const publicUser = (a) => ({
  id: a.id,
  name: a.name,
  email: a.email,
  role: a.role,
  roleLabel: roleLabelOf(a.role),
  provider: a.provider,
  status: a.status,
});

// Records a successful sign-in on the account and in the activity log.
async function recordLogin(account, { provider, page, name }) {
  const updated = await prisma.account.update({
    where: { id: account.id },
    data: {
      loginCount: (account.loginCount || 0) + 1,
      lastLogin: new Date(),
      ...(name && name.trim() && name.trim() !== account.name ? { name: name.trim() } : {}),
    },
  });
  await prisma.loginActivity.create({
    data: {
      accountId: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      provider,
      page: page || 'default',
    },
  });
  return updated;
}

module.exports = { hashPassword, checkPassword, roleLabelOf, publicUser, recordLogin };
