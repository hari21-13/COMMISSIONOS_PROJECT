const config = require('./config');
const prisma = require('./db');
const { createApp } = require('./app');
const { seedIfEmpty, ensureAdminAccount } = require('./lib/seed-lib');

async function main() {
  await prisma.$connect();
  const admin = await ensureAdminAccount(prisma);
  if (admin) console.log(`[setup] Admin account created: ${admin.email}`);
  if (config.autoSeed && (await seedIfEmpty(prisma))) console.log('[setup] Empty database detected — demo data loaded.');

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Auron CommissionOS API listening on http://localhost:${config.port}`);
  });

  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  console.error('Failed to start server:', err);
  await prisma.$disconnect();
  process.exit(1);
});
