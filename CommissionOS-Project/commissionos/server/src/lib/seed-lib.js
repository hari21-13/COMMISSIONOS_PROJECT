// Loads the demo data (the same data the UI showed before the backend existed).
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { COLLECTIONS, SINGLETONS, toRow, orderedRows } = require('./collections');

const seedData = () => require(path.join(__dirname, '../../prisma/seed-data.json'));

const WIPE_ORDER = Object.values(COLLECTIONS).map((c) => c.model);

async function ensureAdminAccount(prisma) {
  const adminCount = await prisma.account.count({ where: { role: 'admin' } });
  if (adminCount > 0) return null;
  const email = config.admin.email;
  const existing = await prisma.account.findUnique({ where: { email } });
  if (existing) {
    return prisma.account.update({ where: { id: existing.id }, data: { role: 'admin', status: 'Active' } });
  }
  return prisma.account.create({
    data: {
      name: config.admin.name,
      email,
      role: 'admin',
      provider: 'Email',
      passwordHash: await bcrypt.hash(config.admin.password, 10),
    },
  });
}

async function seedDemoData(prisma, { wipe = false } = {}) {
  const data = seedData();
  if (wipe) {
    await prisma.$transaction([
      ...WIPE_ORDER.map((m) => prisma[m].deleteMany({})),
      prisma.setting.deleteMany({}),
    ]);
  }
  for (const [name, cfg] of Object.entries(COLLECTIONS)) {
    const items = data[name] || [];
    if (items.length) await prisma[cfg.model].createMany({ data: orderedRows(cfg, items), skipDuplicates: true });
  }
  for (const [name, cfg] of Object.entries(SINGLETONS)) {
    const row = toRow(cfg, data[name] || {});
    await prisma[cfg.model].upsert({ where: { id: 1 }, create: { id: 1, ...row }, update: row });
  }
}

// Seeds only when the database has no organisation yet (first start)
async function seedIfEmpty(prisma) {
  const org = await prisma.organisation.findUnique({ where: { id: 1 } });
  if (org) return false;
  await seedDemoData(prisma);
  return true;
}

module.exports = { seedDemoData, seedIfEmpty, ensureAdminAccount };
