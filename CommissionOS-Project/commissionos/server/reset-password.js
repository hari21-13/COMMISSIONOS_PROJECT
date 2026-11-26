// Fix employee / partner logins.  Run inside the server folder:
//   node reset-password.js --list                       -> shows every Employee/Partner and whether they have a login
//   node reset-password.js email@x.com NewPass@123      -> sets that person's password (creates the login if it does not exist yet)
//   node reset-password.js --all NewPass@123            -> sets the same password for EVERY listed Employee/Partner (for testing)
require('./src/config');
const prisma = require('./src/db');
const { hashPassword } = require('./src/lib/accounts');

const roleFor = (rec) => (String(rec.type || '').trim().toLowerCase() === 'partner' ? 'user' : 'employee');

async function setFor(rec, password) {
  const email = String(rec.email || '').trim().toLowerCase();
  if (!email) return console.log(`SKIP  ${rec.name}: no e-mail on the Employees & Partners record`);
  const passwordHash = await hashPassword(password);
  const acc = await prisma.account.findUnique({ where: { email } });
  if (acc) {
    if (acc.role === 'admin') return console.log(`SKIP  ${email}: this is the admin account`);
    await prisma.account.update({ where: { id: acc.id }, data: { passwordHash, role: roleFor(rec), status: 'Active', tokenVersion: acc.tokenVersion + 1 } });
    console.log(`RESET ${email}  (${rec.type || 'Employee'}) -> password updated`);
  } else {
    await prisma.account.create({ data: { name: rec.name || email, email, role: roleFor(rec), provider: 'Email', passwordHash } });
    console.log(`NEW   ${email}  (${rec.type || 'Employee'}) -> login created`);
  }
}

(async () => {
  const [a, b] = process.argv.slice(2);
  const records = await prisma.employee.findMany({});
  if (!a || a === '--list') {
    for (const r of records) {
      const acc = r.email ? await prisma.account.findUnique({ where: { email: String(r.email).trim().toLowerCase() } }) : null;
      console.log(`${String(r.type || 'Employee').padEnd(9)} ${String(r.name).padEnd(22)} ${String(r.email || '(no email)').padEnd(34)} ${acc ? `login: ${acc.role}, ${acc.status}` : 'NO LOGIN YET'}`);
    }
  } else if (a === '--all') {
    if (!b) throw new Error('Usage: node reset-password.js --all NewPassword');
    for (const r of records) await setFor(r, b);
  } else {
    if (!b) throw new Error('Usage: node reset-password.js email@x.com NewPassword');
    const rec = records.find((r) => String(r.email || '').trim().toLowerCase() === a.trim().toLowerCase());
    if (!rec) throw new Error(`${a} is not on the Employees & Partners list. Ask admin to add this e-mail first.`);
    await setFor(rec, b);
  }
})().catch((e) => console.log('ERROR:', e.message)).finally(() => prisma.$disconnect());
