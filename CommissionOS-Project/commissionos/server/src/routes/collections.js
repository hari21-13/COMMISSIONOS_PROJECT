// Generic CRUD for every business table (see lib/collections.js)
//   GET    -> any signed-in account (admin, employee, user) — everyone sees the admin's data
//   POST / PUT / DELETE -> admin; employees only for the few things lib/permissions.js allows
const express = require('express');
const prisma = require('../db');
const wrap = require('../middleware/wrap');
const { requireAuth } = require('../middleware/auth');
const { httpError } = require('../lib/errors');
const { COLLECTIONS, toRow, fromRow, buildValidator, idField, monotonicNow } = require('../lib/collections');
const { authoriseWrite } = require('../lib/permissions');
const { scopeData } = require('../lib/scope');

const router = express.Router();

for (const [name, cfg] of Object.entries(COLLECTIONS)) {
  const delegate = () => prisma[cfg.model];
  const validate = buildValidator(cfg);
  const pk = idField(cfg);

  router.get(`/${name}`, requireAuth, wrap(async (req, res) => {
    const rows = await delegate().findMany({ orderBy: { createdAt: cfg.order } });
    const items = rows.map((r) => fromRow(cfg, r));
    // employees only get their own records, users only authorised ones (lib/scope.js)
    const scoped = await scopeData(req.account, { [name]: items });
    res.json(scoped[name]);
  }));

  if (cfg.readOnly) continue;

  router.post(`/${name}`, requireAuth, wrap(async (req, res) => {
    const raw = validate(req.body);
    const body = await authoriseWrite({ account: req.account, name, method: 'POST', body: raw });
    const row = await delegate().create({ data: { ...toRow(cfg, body), createdAt: monotonicNow() } });
    res.status(201).json(fromRow(cfg, row));
  }));

  router.put(`/${name}/:id`, requireAuth, wrap(async (req, res) => {
    const found = await delegate().findUnique({ where: { [pk]: req.params.id } });
    if (!found) throw httpError(404, 'Record not found.');
    const raw = validate({ ...req.body, [cfg.idKey]: req.params.id });
    const body = await authoriseWrite({ account: req.account, name, method: 'PUT', id: req.params.id, body: raw, existing: fromRow(cfg, found) });
    const row = await delegate().update({
      where: { [pk]: req.params.id },
      data: toRow(cfg, body, { skipId: true }),
    });
    res.json(fromRow(cfg, row));
  }));

  router.delete(`/${name}/:id`, requireAuth, wrap(async (req, res) => {
    await authoriseWrite({ account: req.account, name, method: 'DELETE', id: req.params.id, body: {} });
    const found = await delegate().findUnique({ where: { [pk]: req.params.id } });
    if (!found) throw httpError(404, 'Record not found.');
    await delegate().delete({ where: { [pk]: req.params.id } });
    res.json({ ok: true });
  }));
}

module.exports = router;