// Who may change what.
//   admin    -> everything
//   employee -> sees only their own records, and may only (a) update the phone number on their OWN employee record,
//               (b) raise disputes / add comments on their OWN disputes, (c) add comments on their OWN statements (approval workflow)
//   user     -> (Partner) sees only their own records; writes only: raise disputes and add notes to their OWN disputes (Module 11)
const prisma = require('../db');
const { httpError } = require('./errors');
const { COLLECTIONS, fromRow } = require('./collections');

const lc = (v) => String(v || '').trim().toLowerCase();

async function employeeOf(account) {
  const rows = await prisma.employee.findMany({ where: { email: { equals: account.email, mode: 'insensitive' } } });
  if (rows.length) return fromRow(COLLECTIONS.employees, rows[0]);
  const byName = (await prisma.employee.findMany({})).filter((e) => lc(e.name) === lc(account.name));
  return byName.length === 1 ? fromRow(COLLECTIONS.employees, byName[0]) : null;
}


// Manual sales entry (Module 4): employees and partners may add a transaction and edit their OWN ones.
// The server forces the owner to be the signed-in person and keeps the status under admin control.
async function ownTransactionWrite({ me, method, existing, body }) {
  if (method === 'POST') {
    return { ...body, salesperson: me.name, salespersonId: me.id, status: 'Pending Validation' };
  }
  if (method === 'PUT') {
    if (!existing || !(existing.salespersonId === me.id || lc(existing.salesperson) === lc(me.name))) {
      throw httpError(403, 'You can only edit your own sales entries.');
    }
    return { ...body, id: existing.id, salesperson: existing.salesperson, salespersonId: existing.salespersonId, status: existing.status };
  }
  throw httpError(403, 'You cannot delete sales transactions.');
}

// Returns the body that may really be written (possibly reduced), or throws 403.
async function authoriseWrite({ account, name, method, id, body, existing }) {
  if (account.role === 'admin') return body;
  if (account.role === 'user') {
    // partners are view-only, except Module 11 (Disputes & Adjustments): they may raise disputes and add notes to THEIR OWN disputes
    const meP = await employeeOf(account);
    const myName = meP ? meP.name : account.name;
    if (name === 'transactions' && meP) return ownTransactionWrite({ me: meP, method, existing, body });
    if (name === 'disputes' && method === 'POST') return { ...body, status: 'Open', employee: myName };
    if (name === 'disputes' && method === 'PUT') {
      if (!existing) throw httpError(404, 'Dispute not found.');
      if (lc(existing.employee) !== lc(myName)) throw httpError(403, 'You can only add comments to your own disputes.');
      return { ...existing, comments: Array.isArray(body.comments) ? body.comments : existing.comments };
    }
    throw httpError(403, 'View-only access: you cannot change data.');
  }
  if (account.role !== 'employee') throw httpError(403, 'View-only access: you cannot change data.');

  const me = await employeeOf(account);
  if (!me) throw httpError(403, 'Your login is not linked to an employee record yet. Ask your admin to add you with this e-mail.');

  if (name === 'employees' && method === 'PUT') {
    if (!existing || existing.id !== me.id) throw httpError(403, 'You can only update your own details.');
    // employees may change only their phone number
    return { ...existing, phone: body.phone === undefined ? existing.phone : body.phone };
  }
  if (name === 'transactions') return ownTransactionWrite({ me, method, existing, body });
  if (name === 'disputes' && method === 'POST') {
    return { ...body, employee: me.name, status: 'Open' };
  }
  if (name === 'disputes' && method === 'PUT') {
    if (!existing || lc(existing.employee) !== lc(me.name)) throw httpError(403, 'You can only add comments to your own disputes.');
    return { ...existing, comments: Array.isArray(body.comments) ? body.comments : existing.comments };
  }
  if (name === 'statements' && method === 'PUT') {
    if (!existing || !(existing.employeeId === me.id || lc(existing.employee) === lc(me.name))) throw httpError(403, 'You can only comment on your own statements.');
    return { ...existing, comments: Array.isArray(body.comments) ? body.comments : existing.comments };
  }
  throw httpError(403, 'Employees have limited access: you cannot change this.');
}

module.exports = { employeeOf, authoriseWrite };
