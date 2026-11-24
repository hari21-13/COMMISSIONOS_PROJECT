// Commission engine — all 7 models (A–G). Pure functions: no database access here.
const { formatINR } = require('./format');

function computePolicyCommission(policy, salesAmount, saleCount = 1, product = 'Product A') {
  const sales = Number(salesAmount) || 0;
  if (!policy) return { commission: 0, breakdown: 'No policy assigned' };

  switch (policy.model) {
    case 'A': {
      const rate = Number(policy.rate) || 0;
      const comm = (sales * rate) / 100;
      return { commission: comm, breakdown: `${formatINR(sales)} × ${rate}% = ${formatINR(comm)}` };
    }
    case 'B': {
      const perSale = Number(policy.fixedAmount) || 0;
      const comm = saleCount * perSale;
      return { commission: comm, breakdown: `${saleCount} sale(s) × ${formatINR(perSale)} = ${formatINR(comm)}` };
    }
    case 'C': {
      const slabs = policy.slabs && policy.slabs.length
        ? policy.slabs
        : [
            { min: 0, max: 100000, rate: 2 },
            { min: 100001, max: 300000, rate: 4 },
            { min: 300001, max: 99999999, rate: 6 },
          ];
      if (policy.tierMethod === 'attainment') {
        const matched = slabs.find((s) => sales >= s.min && sales <= s.max) || slabs[slabs.length - 1];
        const comm = (sales * matched.rate) / 100;
        return {
          commission: comm,
          breakdown: `Attainment Tier (${matched.rate}% on full ${formatINR(sales)}) = ${formatINR(comm)}`,
        };
      }
      let remaining = sales;
      let total = 0;
      const parts = [];
      let prevMax = 0;
      for (const s of slabs) {
        if (remaining <= 0) break;
        const span = s.max >= 99999999 ? remaining : Math.min(remaining, s.max - prevMax);
        const sliceComm = (span * s.rate) / 100;
        total += sliceComm;
        parts.push(`${formatINR(span)}×${s.rate}%=${formatINR(sliceComm)}`);
        remaining -= span;
        prevMax = s.max;
      }
      return { commission: total, breakdown: `Marginal: ${parts.join(' + ')} = ${formatINR(total)}` };
    }
    case 'D': {
      const target = Number(policy.targetAmount) || 500000;
      const bonus = Number(policy.targetBonus) || 10000;
      const pct = target > 0 ? Math.round((sales / target) * 100) : 0;
      const achieved = sales >= target;
      return {
        commission: achieved ? bonus : 0,
        breakdown: `Target ${formatINR(target)} | Actual ${formatINR(sales)} (${pct}%) → ${
          achieved ? `Bonus ${formatINR(bonus)}` : 'Target not met (₹0)'
        }`,
      };
    }
    case 'E': {
      const map = policy.productRates && policy.productRates.length
        ? policy.productRates
        : [
            { product: 'Product A', rate: 3 },
            { product: 'Product B', rate: 5 },
            { product: 'Product C', rate: 8 },
          ];
      const found = map.find((p) => p.product === product) || map[0];
      const rate = found ? Number(found.rate) : 3;
      const comm = (sales * rate) / 100;
      return { commission: comm, breakdown: `${product} (${rate}%) on ${formatINR(sales)} = ${formatINR(comm)}` };
    }
    case 'F': {
      const rate = Number(policy.referralRate || policy.rate) || 5;
      const comm = (sales * rate) / 100;
      return { commission: comm, breakdown: `Referral ${formatINR(sales)} × ${rate}% = ${formatINR(comm)}` };
    }
    case 'G': {
      const poolRate = Number(policy.rate) || 10;
      const pool = (sales * poolRate) / 100;
      const splits = policy.multiLevelSplits && policy.multiLevelSplits.length
        ? policy.multiLevelSplits
        : [
            { role: 'Sales Representative', share: 70 },
            { role: 'Sales Manager', share: 20 },
            { role: 'Referral Partner', share: 10 },
          ];
      const splitSummary = splits
        .map((sp) => `${sp.role} ${sp.share}% (${formatINR((pool * sp.share) / 100)})`)
        .join(', ');
      return { commission: pool, breakdown: `Pool ${formatINR(pool)} → ${splitSummary}` };
    }
    default:
      return { commission: 0, breakdown: 'Custom rule' };
  }
}

// Runs the whole commission calculation for a scope of employees.
//   employees / policies / transactions are plain objects (UI shape).
function runEngine({ employees, policies, transactions, scope = 'ALL' }) {
  const scopeEmployees =
    scope === 'ALL' ? employees : employees.filter((e) => e.id === scope || e.department === scope);

  const exceptions = transactions
    .filter((t) => t.status === 'Pending Validation' || t.status === 'On Hold')
    .map((t, idx) => ({
      id: `EXC0${idx + 1}`,
      txnId: t.id,
      employee: t.salesperson,
      issue: `Transaction ${t.id} (${t.invoiceNumber}) is "${t.status}" and excluded from payable run.`,
    }));

  const results = [];
  scopeEmployees.forEach((emp) => {
    const policy = policies.find((p) => p.id === emp.planId) || policies[0];
    if (!policy) return;
    const empTxns = transactions.filter(
      (t) =>
        (t.salesperson === emp.name || t.referrer === emp.name) &&
        (t.status === 'Validated' || t.status === 'Eligible')
    );
    const totalEligible = empTxns.reduce((acc, t) => acc + (Number(t.eligibleBase) || 0), 0);
    const txnDetails = empTxns.map((t) => {
      const res = computePolicyCommission(policy, t.eligibleBase, 1, t.product);
      return {
        txnId: t.id,
        invoice: t.invoiceNumber,
        product: t.product,
        base: t.eligibleBase,
        commission: res.commission,
        formula: res.breakdown,
      };
    });
    const aggregate =
      policy.model === 'C' || policy.model === 'D'
        ? computePolicyCommission(policy, totalEligible, empTxns.length)
        : {
            commission: txnDetails.reduce((sum, x) => sum + x.commission, 0),
            breakdown: txnDetails.map((x) => x.formula).join(' | ') || 'No eligible sales in period',
          };
    results.push({
      employeeId: emp.id,
      employeeName: emp.name,
      department: emp.department,
      policyName: `${policy.name} (${policy.version})`,
      modelLabel: policy.modelLabel,
      txnCount: empTxns.length,
      eligibleSales: totalEligible,
      calculatedCommission: aggregate.commission,
      formulaSummary: aggregate.breakdown,
      txnDetails,
    });
  });

  return {
    results,
    exceptions,
    totalSales: results.reduce((s, r) => s + r.eligibleSales, 0),
    totalCommission: results.reduce((s, r) => s + r.calculatedCommission, 0),
  };
}

module.exports = { computePolicyCommission, runEngine };
