// Which records each kind of sign-in may SEE (enforced on the server, the screen only shows what it is given).
//   admin    -> everything
//   employee -> only their OWN records (profile, sales, refunds, statements, payouts, disputes, adjustments) + all commission plans
//   user     -> (shown as "Partner") ONLY their OWN records, same as an employee; the one exception is Module 2
//               (Employees & Partners directory) which still lists everyone
const { employeeOf } = require('./permissions');

const lc = (v) => String(v || '').trim().toLowerCase();

const AUTH_STATEMENT = new Set(['Approved', 'Finalised & Locked']);
const AUTH_PAYOUT = new Set(['Paid', 'Reconciled']);
const AUTH_ADJUSTMENT = new Set(['Approved']);
const AUTH_DISPUTE = new Set(['Resolved', 'Closed']);

const EMPTY = {
  employees: [], policies: [], transactions: [], reversals: [], adjustments: [], statements: [], payouts: [],
  disputes: [], departments: [], users: [], rolePermissions: [], billingInvoices: [], calcRuns: [],
};

// builds the audit history (approval trail) from the records a user is allowed to see
function auditHistory(data) {
  const items = [];
  (data.statements || []).forEach((s) => items.push({
    ref: s.id, kind: 'Statement', title: `${s.employee} — ${s.period}`, status: s.status, date: s.submittedDate || '',
    amount: s.netPayable, events: Array.isArray(s.comments) ? s.comments : [],
  }));
  (data.adjustments || []).forEach((a) => items.push({
    ref: a.id, kind: 'Adjustment', title: `${a.employee} — ${a.type}`, status: a.status, date: a.date || '',
    amount: a.amount, events: [{ author: a.requestedBy || '', text: a.reason || '', time: a.date || '' }],
  }));
  (data.payouts || []).forEach((p) => items.push({
    ref: p.id, kind: 'Payout', title: `${p.employee} — ${p.statementId}`, status: p.status, date: p.paymentDate || '',
    amount: p.bankPaidAmount, events: [{ author: p.paymentMethod || '', text: `Reference ${p.referenceNumber || '-'}`, time: p.paymentDate || '' }],
  }));
  (data.disputes || []).forEach((d) => items.push({
    ref: d.id, kind: 'Dispute', title: `${d.employee} — ${d.statementId}`, status: d.status, date: d.createdDate || '',
    amount: d.claimedAmount, events: Array.isArray(d.comments) ? d.comments : [],
  }));
  return items;
}

// `data` = { employees: [...], ... } (any subset). Returns a scoped copy.
async function scopeData(account, data) {
  if (account.role === 'admin') return data;

  // employee
  const me = await employeeOf(account);
  const mine = (name) => me && lc(name) === lc(me.name);
  const isPartner = account.role === 'user';
  const out = { ...data };
  // Module 2 (Employees & Partners directory): partners keep the full directory, employees see only themselves
  if (data.employees) out.employees = isPartner ? data.employees : (me ? data.employees.filter((e) => e.id === me.id) : []);
  // every commission plan is visible so employees can see how each plan pays (policies are not personal data)
  if (data.transactions) out.transactions = me ? data.transactions.filter((t) => t.salespersonId === me.id || mine(t.salesperson) || mine(t.referrer)) : [];
  if (data.reversals) out.reversals = data.reversals.filter((r) => mine(r.employee));
  if (data.adjustments) out.adjustments = data.adjustments.filter((a) => mine(a.employee));
  if (data.statements) out.statements = me ? data.statements.filter((s) => s.employeeId === me.id || mine(s.employee)) : [];
  if (data.payouts) out.payouts = data.payouts.filter((p) => mine(p.employee));
  if (data.disputes) out.disputes = data.disputes.filter((d) => mine(d.employee));
  if (data.departments) out.departments = isPartner ? data.departments : (me ? data.departments.filter((d) => lc(d.name) === lc(me.department)) : []);
  ['users', 'rolePermissions', 'billingInvoices', 'calcRuns'].forEach((k) => { if (k in data) out[k] = []; });
  if (data.engine) {
    out.engine = {
      results: (data.engine.results || []).filter((r) => me && (r.employeeId === me.id || mine(r.employeeName))),
      exceptions: (data.engine.exceptions || []).filter((x) => mine(x.employee)),
    };
  }
  return out;
}

module.exports = { scopeData, auditHistory };
