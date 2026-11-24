// Describes every business table: which UI field maps to which Prisma column.
// Anything the UI sends that is NOT listed here is stored in the `extra` JSON column and
// returned again unchanged — so adding a field in the UI never loses data.
const { z } = require('zod');

const S = 'string';
const N = 'number';
const B = 'boolean';
const J = 'json';

// column spec: uiKey -> [type, prismaField]
const cols = (spec) =>
  Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, Array.isArray(v) ? v : [v, k]]));

const COLLECTIONS = {
  employees: {
    model: 'employee', idKey: 'id', order: 'asc',
    cols: cols({ id: S, name: S, email: S, phone: S, department: S, branch: S, manager: S, joiningDate: S, exitDate: S,
      eligibility: S, planId: S, planName: S, status: S, type: S, monthlyTarget: N, eligibleSales: N,
      earnedCommission: N, pendingCommission: N, approvedCommission: N, paidCommission: N }),
  },
  policies: {
    model: 'policy', idKey: 'id', order: 'asc',
    cols: cols({ id: S, name: S, model: [S, 'modelCode'], modelLabel: S, description: S, rate: N, fixedAmount: N,
      tierMethod: S, targetAmount: N, targetBonus: N, referralRate: N, eligibleGroup: S, effectiveFrom: S,
      effectiveTo: S, reversalRule: S, status: S, version: S, slabs: J, productRates: J, multiLevelSplits: J, versions: J }),
  },
  transactions: {
    model: 'transaction', idKey: 'id', order: 'desc',
    cols: cols({ id: S, invoiceNumber: S, customer: S, product: S, date: S, invoiceAmount: N, discount: N,
      eligibleBase: N, salesperson: S, salespersonId: S, department: S, status: S, referrer: S }),
  },
  reversals: {
    model: 'reversal', idKey: 'id', order: 'desc',
    cols: cols({ id: S, transactionId: S, invoiceNumber: S, employee: S, type: S, originalSales: N, originalCommission: N,
      refundAmount: N, reversedCommission: N, remainingCommission: N, date: S, reason: S, status: S }),
  },
  adjustments: {
    model: 'adjustment', idKey: 'id', order: 'desc',
    cols: cols({ id: S, employee: S, statementId: S, type: S, amount: N, reason: S, requestedBy: S, date: S, status: S }),
  },
  statements: {
    model: 'statement', idKey: 'id', order: 'desc',
    cols: cols({ id: S, employeeId: S, employee: S, department: S, period: S, eligibleSales: N, commissionRate: S,
      policyApplied: S, grossCommission: N, reversals: N, adjustments: N, deductions: N, netPayable: N,
      submittedDate: S, status: S, locked: B, comments: J }),
  },
  payouts: {
    model: 'payout', idKey: 'id', order: 'desc',
    cols: cols({ id: S, batchId: S, statementId: S, employee: S, approvedAmount: N, bankPaidAmount: N, paymentDate: S,
      paymentMethod: S, referenceNumber: S, status: S }),
  },
  disputes: {
    model: 'dispute', idKey: 'id', order: 'desc',
    cols: cols({ id: S, employee: S, statementId: S, transactionId: S, claimedAmount: N, currentAmount: N, reason: S,
      document: S, assignedTo: S, status: S, createdDate: S, comments: J }),
  },
  departments: {
    model: 'department', idKey: 'id', order: 'asc',
    cols: cols({ id: S, name: S, head: S, members: N, budgetTarget: S }),
  },
  users: {
    model: 'orgUser', idKey: 'id', order: 'asc',
    cols: cols({ id: S, email: S, name: S, role: S, department: S, status: S }),
  },
  rolePermissions: {
    model: 'rolePermission', idKey: 'role', order: 'asc',
    cols: cols({ role: S, orgSettings: B, billing: B, policies: B, transactions: B, calculate: B, approve: B, payouts: B, reports: B }),
  },
  billingInvoices: {
    model: 'billingInvoice', idKey: 'id', order: 'desc',
    readOnly: true, // written only by the billing routes (free activation / Razorpay payment)
    cols: cols({ id: S, date: S, plan: S, subtotal: N, gst: N, total: N, status: S, method: S, source: S,
      payerName: S, payerEmail: S, accountId: S, razorpayOrderId: S, razorpayPaymentId: S }),
  },
  calcRuns: {
    model: 'calcRun', idKey: 'runId', order: 'desc', readOnly: true, // created by POST /api/engine/run
    cols: cols({ runId: S, period: S, scope: S, timestamp: S, totalSales: N, totalCommission: N, exceptionsCount: N, status: S }),
  },
};

// single-row tables
const SINGLETONS = {
  org: {
    model: 'organisation',
    cols: cols({ name: S, legalEntity: S, tagline: S, industry: S, gstin: S, pan: S, fiscalYear: S, address: S, upiId: S,
      currency: S, primaryColor: S, accentColor: S, logoIcon: S, logoDataUrl: S, calcFrequency: S, tdsRate: N,
      roundingRule: S, autoHoldOnDispute: B, autoLockOnApproval: B, clawbackDays: N }),
  },
  subscription: {
    model: 'subscription',
    cols: cols({ planId: S, billingCycle: S, status: S, nextBillingDate: S, paymentMethod: S, billingEmail: S }),
  },
};

const INTERNAL = new Set(['createdAt', 'updatedAt', 'utr']);
const JSON_DEFAULT = (type) => (type === J ? [] : undefined);

function coerce(type, v) {
  switch (type) {
    case S: return v === null || v === undefined ? '' : String(v);
    case N: { const n = Number(v); return Number.isFinite(n) ? n : 0; }
    case B: return Boolean(v);
    case J: return v === undefined || v === null ? JSON_DEFAULT(J) : v;
    default: return v;
  }
}

// UI object -> Prisma `data`
function toRow(cfg, body, { skipId = false } = {}) {
  const data = {};
  const extra = {};
  for (const [k, v] of Object.entries(body)) {
    const spec = cfg.cols[k];
    if (spec) {
      if (v === undefined) continue;
      if (skipId && k === cfg.idKey) continue;
      data[spec[1]] = coerce(spec[0], v);
    } else if (!INTERNAL.has(k)) {
      extra[k] = v;
    }
  }
  data.extra = extra;
  return data;
}

// Prisma row -> UI object
function fromRow(cfg, row) {
  if (!row) return null;
  const out = { ...(row.extra || {}) };
  for (const [k, [, pk]] of Object.entries(cfg.cols)) {
    const v = row[pk];
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// zod validator for request bodies (loose on purpose: unknown keys are kept for `extra`)
function buildValidator(cfg) {
  const shape = {};
  for (const [k, [type]] of Object.entries(cfg.cols)) {
    let f;
    if (type === S) f = z.union([z.string().max(20000), z.number()]).nullable();
    else if (type === N) f = z.union([z.number(), z.string().max(40)]);
    else if (type === B) f = z.boolean();
    else f = z.any();
    shape[k] = k === cfg.idKey ? z.string().min(1).max(120) : f.optional();
  }
  const schema = z.object(shape).passthrough();
  return (body) => schema.parse(body);
}

const idField = (cfg) => cfg.cols[cfg.idKey][1];

// strictly increasing timestamps so list order is stable even for bulk inserts
let lastTs = 0;
const monotonicNow = () => {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return new Date(lastTs);
};

// for bulk inserts: first item must come first in the list order the UI expects
function orderedRows(cfg, items) {
  const base = Date.now() - 24 * 3600 * 1000;
  const n = items.length;
  return items.map((item, i) => ({
    ...toRow(cfg, item),
    createdAt: new Date(base + (cfg.order === 'desc' ? n - i : i) * 1000),
  }));
}

module.exports = {
  COLLECTIONS, SINGLETONS, toRow, fromRow, buildValidator, idField, monotonicNow, orderedRows,
};
