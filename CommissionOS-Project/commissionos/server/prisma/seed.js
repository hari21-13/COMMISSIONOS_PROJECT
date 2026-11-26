// npm run db:seed   -> loads demo data + creates the first admin account
const prisma = require('../src/db');
const { seedDemoData, ensureAdminAccount } = require('../src/lib/seed-lib');

(async () => {
  const wipe = process.argv.includes('--wipe');
  await seedDemoData(prisma, { wipe });
  const admin = await ensureAdminAccount(prisma);
  console.log(`Demo data loaded${wipe ? ' (existing business data wiped first)' : ''}.`);
  if (admin) console.log(`Admin account created: ${admin.email}`);
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
