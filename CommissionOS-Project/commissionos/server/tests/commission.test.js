const test = require('node:test');
const assert = require('node:assert');
const { computePolicyCommission, runEngine } = require('../src/lib/commission');

test('Model A: fixed percentage', () => {
  const r = computePolicyCommission({ model: 'A', rate: 5 }, 100000);
  assert.strictEqual(r.commission, 5000);
});

test('Model B: fixed amount per sale', () => {
  assert.strictEqual(computePolicyCommission({ model: 'B', fixedAmount: 1500 }, 0, 3).commission, 4500);
});

test('Model C: marginal slabs and attainment tier', () => {
  const slabs = [
    { min: 0, max: 100000, rate: 2 },
    { min: 100001, max: 300000, rate: 4 },
    { min: 300001, max: 99999999, rate: 6 },
  ];
  // 100000*2% + 200000*4% + 100000*6% = 2000 + 8000 + 6000
  assert.strictEqual(computePolicyCommission({ model: 'C', tierMethod: 'marginal', slabs }, 400000).commission, 16000);
  assert.strictEqual(computePolicyCommission({ model: 'C', tierMethod: 'attainment', slabs }, 400000).commission, 24000);
});

test('Model D: target bonus', () => {
  const p = { model: 'D', targetAmount: 500000, targetBonus: 10000 };
  assert.strictEqual(computePolicyCommission(p, 499999).commission, 0);
  assert.strictEqual(computePolicyCommission(p, 500000).commission, 10000);
});

test('Model E: product mix', () => {
  const p = { model: 'E', productRates: [{ product: 'Product A', rate: 3 }, { product: 'Product C', rate: 8 }] };
  assert.strictEqual(computePolicyCommission(p, 100000, 1, 'Product C').commission, 8000);
});

test('Models F and G', () => {
  assert.strictEqual(computePolicyCommission({ model: 'F', referralRate: 4 }, 50000).commission, 2000);
  assert.strictEqual(computePolicyCommission({ model: 'G', rate: 10 }, 100000).commission, 10000);
});

test('no policy / unknown model', () => {
  assert.strictEqual(computePolicyCommission(null, 1000).commission, 0);
  assert.strictEqual(computePolicyCommission({ model: 'Z' }, 1000).commission, 0);
});

test('engine: only Validated/Eligible sales count, pending ones become exceptions', () => {
  const policies = [{ id: 'P1', name: 'Plan', version: 'v1', modelLabel: 'A', model: 'A', rate: 5 }];
  const employees = [{ id: 'E1', name: 'Rahul', department: 'Sales', planId: 'P1' }];
  const transactions = [
    { id: 'T1', invoiceNumber: 'I1', product: 'X', eligibleBase: 100000, salesperson: 'Rahul', status: 'Validated' },
    { id: 'T2', invoiceNumber: 'I2', product: 'X', eligibleBase: 50000, salesperson: 'Rahul', status: 'Pending Validation' },
  ];
  const out = runEngine({ employees, policies, transactions });
  assert.strictEqual(out.results[0].eligibleSales, 100000);
  assert.strictEqual(out.results[0].calculatedCommission, 5000);
  assert.strictEqual(out.exceptions.length, 1);
  assert.strictEqual(out.exceptions[0].txnId, 'T2');
});
