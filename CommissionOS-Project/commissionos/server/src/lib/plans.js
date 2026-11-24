// Subscription plan prices (INR). The server — not the browser — decides what a plan costs.
const PLANS = {
  starter: { name: 'Starter', monthly: 0, annualMonthly: 0 }, // the Starter plan is FREE
  growth: { name: 'Growth', monthly: 2499, annualMonthly: 1999 },
  business: { name: 'Business', monthly: 5999, annualMonthly: 4799 },
  // Enterprise is custom-priced; this is the default amount used for online checkout
  enterprise: { name: 'Enterprise', monthly: 24999, annualMonthly: 19999 },
};
const GST_RATE = 0.18;

function priceFor(planId, cycle) {
  const plan = PLANS[planId];
  if (!plan) return null;
  const annual = cycle === 'annual';
  const subtotal = annual ? plan.annualMonthly * 12 : plan.monthly;
  const gst = Math.round(subtotal * GST_RATE);
  return { plan, annual, subtotal, gst, total: subtotal + gst };
}

module.exports = { PLANS, GST_RATE, priceFor };
