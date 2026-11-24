// Subscription billing with Razorpay.
//   * The first subscription of the workspace is FREE (FREE_TRIAL_DAYS days, no payment).
//   * After that: order -> Razorpay Checkout (UPI / QR / cards) -> signature verified here -> plan activated.
// The server decides every price; the browser can never set an amount.
const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const config = require('../config');
const wrap = require('../middleware/wrap');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { httpError } = require('../lib/errors');
const { COLLECTIONS, SINGLETONS, fromRow, monotonicNow } = require('../lib/collections');
const { priceFor } = require('../lib/plans');
const { dmy } = require('../lib/format');
const razorpay = require('../lib/razorpay');
const { sendMail, mailError } = require('../lib/mailer');
const { subscriptionInvoicePdf, subscriptionReceiptPdf } = require('../lib/invoicePdf');

const router = express.Router();
// the admin and (view-only) users may subscribe; employees may not
const guard = [requireAuth, requireRoles('admin', 'user')];

const planSchema = z.object({
  planId: z.enum(['starter', 'growth', 'business', 'enterprise']),
  cycle: z.enum(['monthly', 'annual']),
});
const checkoutSchema = planSchema.extend({ email: z.string().trim().toLowerCase().email() });

// the Starter plan is free (no payment); every other plan is paid through Razorpay
const isFreePlan = (planId) => planId === 'starter';

async function nextInvoiceId() {
  const year = new Date().getFullYear();
  let n = (await prisma.billingInvoice.count()) + 1;
  while (await prisma.billingInvoice.findUnique({ where: { id: `INV-SAAS-${year}-${String(n).padStart(4, '0')}` } })) n += 1;
  return `INV-SAAS-${year}-${String(n).padStart(4, '0')}`;
}

// e-mails the invoice (PDF attached, with the organisation's logo + colours) to the person who subscribed,
// and a copy to the support / admin mailbox. Never blocks the subscription: returns false if mail is not set up.
async function emailInvoice(invoice, email) {
  try {
    const orgRow = await prisma.organisation.findUnique({ where: { id: 1 } });
    const orgName = (orgRow && (orgRow.name || orgRow.legalEntity)) || 'Auron CommissionOS';
    const saved = (orgRow && orgRow.extra && orgRow.extra.contact) || {};
    const support = { email: saved.email || config.supportEmail, phone: saved.phoneDisplay || saved.phone || '+91 72076 42479', hours: saved.hours || '9:30 AM - 6:30 PM' };
    const pdf = subscriptionInvoicePdf(invoice, orgRow || {}, support);
    const receipt = subscriptionReceiptPdf(invoice, orgRow || {}, support);
    const attachments = [
      { filename: `Receipt-${invoice.id}.pdf`, content: receipt, contentType: 'application/pdf' },
      { filename: `${invoice.id}.pdf`, content: pdf, contentType: 'application/pdf' },
    ];
    const free = Number(invoice.total) === 0;
    const text = [
      `Hello ${invoice.payerName || ''},`.trim(),
      '',
      free
        ? `Thank you! Your ${invoice.plan} is now active — no payment was needed.`
        : `Thank you for subscribing! We have received your payment of Rs. ${invoice.total} for ${invoice.plan}.`,
      '',
      `Invoice: ${invoice.id}`,
      `Date: ${invoice.date}`,
      `Amount: Rs. ${invoice.total}`,
      invoice.razorpayPaymentId ? `Payment ID: ${invoice.razorpayPaymentId}` : '',
      '',
      'Your payment receipt and invoice are attached as PDFs.',
      `Questions? Reply to this e-mail or write to ${config.supportEmail}.`,
      '',
      `— ${orgName}`,
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
    const sent = await sendMail({ to: email, replyTo: config.supportEmail, subject: `Your payment receipt & invoice ${invoice.id} — ${invoice.plan}`, text, attachments });
    if (config.supportEmail && config.supportEmail.toLowerCase() !== String(email).toLowerCase()) {
      await sendMail({
        to: config.supportEmail,
        replyTo: email,
        subject: `[Subscription] ${invoice.payerName || email} — ${invoice.plan} (${invoice.id})`,
        text: `New subscription\n\nName: ${invoice.payerName}\nEmail: ${email}\nPlan: ${invoice.plan}\nAmount: Rs. ${invoice.total}\nInvoice: ${invoice.id}\n${invoice.razorpayPaymentId ? `Payment ID: ${invoice.razorpayPaymentId}\n` : ''}`,
        attachments,
      });
    }
    return sent;
  } catch (err) {
    console.error('[billing] invoice e-mail failed:', err.message);
    return false;
  }
}

// writes the invoice and switches the subscription to the purchased plan
async function activate({ planId, cycle, email, source, price, method, days, razorpayOrderId, razorpayPaymentId, accountId }) {
  const payer = accountId ? await prisma.account.findUnique({ where: { id: accountId } }) : null;
  const next = new Date();
  if (days) next.setDate(next.getDate() + days);
  else if (price.annual) next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);

  const label = source === 'free'
    ? `${price.plan.name} Plan — Free`
    : `${price.plan.name} Plan (${price.annual ? 'Annual' : 'Monthly'})`;
  const invoice = await prisma.billingInvoice.create({
    data: {
      id: await nextInvoiceId(),
      date: dmy(),
      plan: label,
      subtotal: source === 'free' ? 0 : price.subtotal,
      gst: source === 'free' ? 0 : price.gst,
      total: source === 'free' ? 0 : price.total,
      status: 'Paid',
      method,
      source,
      razorpayOrderId: razorpayOrderId || null,
      razorpayPaymentId: razorpayPaymentId || null,
      accountId: accountId || null,
      payerName: payer ? payer.name : '',
      payerEmail: email || (payer ? payer.email : ''),
      createdAt: monotonicNow(),
    },
  });
  const subData = {
    planId,
    billingCycle: cycle,
    status: 'Active',
    billingEmail: email,
    paymentMethod: source === 'free' ? 'Free plan' : method,
    nextBillingDate: dmy(next),
  };
  const subscription = await prisma.subscription.upsert({ where: { id: 1 }, create: { id: 1, ...subData }, update: subData });
  const emailed = await emailInvoice(invoice, email || (payer && payer.email));
  return {
    emailError: emailed ? '' : mailError(),
    invoice: fromRow(COLLECTIONS.billingInvoices, invoice),
    subscription: fromRow(SINGLETONS.subscription, subscription),
    emailed,
  };
}

// ---- what the billing page needs to know -------------------------------------------------
router.get('/billing/status', ...guard, wrap(async (req, res) => {
  res.json({
    freeEligible: true, // Starter is free
    freePlan: 'starter',
    trialDays: config.freeTrialDays,
    razorpayConfigured: razorpay.isConfigured(),
    mode: razorpay.isConfigured() ? razorpay.mode() : null,
  });
}));

router.get('/billing/quote', ...guard, wrap(async (req, res) => {
  const q = planSchema.parse(req.query);
  const price = priceFor(q.planId, q.cycle);
  res.json({
    planName: price.plan.name,
    subtotal: price.subtotal,
    gst: price.gst,
    total: price.total,
    free: isFreePlan(q.planId),
    trialDays: config.freeTrialDays,
    razorpayConfigured: razorpay.isConfigured(),
    mode: razorpay.isConfigured() ? razorpay.mode() : null,
  });
}));

// ---- free first subscription --------------------------------------------------------------
router.post('/billing/free', ...guard, wrap(async (req, res) => {
  const b = checkoutSchema.parse(req.body);
  if (!isFreePlan(b.planId)) {
    throw httpError(409, 'Only the Starter plan is free. Please pay to subscribe to this plan.');
  }
  const out = await activate({
    planId: b.planId,
    cycle: b.cycle,
    email: b.email,
    source: 'free',
    price: priceFor(b.planId, b.cycle),
    method: 'Free plan',
    days: config.freeTrialDays || 30,
    accountId: req.account.id,
  });
  res.status(201).json(out);
}));

// ---- paid: create the Razorpay order ------------------------------------------------------
router.post('/billing/order', ...guard, wrap(async (req, res) => {
  const b = checkoutSchema.parse(req.body);
  if (isFreePlan(b.planId)) {
    throw httpError(409, 'The Starter plan is free — activate it without payment.', { code: 'FREE_AVAILABLE' });
  }
  const price = priceFor(b.planId, b.cycle);
  const order = await razorpay.createOrder({
    amountPaise: price.total * 100,
    receipt: `rcpt_${Date.now()}`,
    notes: { planId: b.planId, cycle: b.cycle, accountId: req.account.id },
  });
  await prisma.paymentOrder.create({
    data: {
      razorpayOrderId: order.id,
      accountId: req.account.id,
      planId: b.planId,
      cycle: b.cycle,
      email: b.email,
      amount: price.total * 100,
      currency: 'INR',
    },
  });
  res.status(201).json({
    orderId: order.id,
    amount: price.total * 100,
    currency: 'INR',
    keyId: config.razorpay.keyId,
    planName: price.plan.name,
    subtotal: price.subtotal,
    gst: price.gst,
    total: price.total,
  });
}));

// ---- paid: our own QR code (Razorpay dynamic UPI QR, fixed amount) ----------------------
router.post('/billing/qr', ...guard, wrap(async (req, res) => {
  const b = checkoutSchema.parse(req.body);
  if (isFreePlan(b.planId)) {
    throw httpError(409, 'The Starter plan is free — activate it without payment.', { code: 'FREE_AVAILABLE' });
  }
  const price = priceFor(b.planId, b.cycle);
  const qr = await razorpay.createQr({
    amountPaise: price.total * 100,
    name: `Auron CommissionOS - ${price.plan.name}`,
    description: `${price.plan.name} Plan (${price.annual ? 'Annual' : 'Monthly'}) incl. 18% GST`,
    notes: { planId: b.planId, cycle: b.cycle, accountId: req.account.id },
  });
  await prisma.paymentOrder.create({
    data: {
      razorpayOrderId: qr.id, // for kind "qr" this column holds the QR id
      kind: 'qr',
      qrImageUrl: qr.image_url || '',
      accountId: req.account.id,
      planId: b.planId,
      cycle: b.cycle,
      email: b.email,
      amount: price.total * 100,
      currency: 'INR',
    },
  });
  res.status(201).json({ qrId: qr.id, imageUrl: qr.image_url, amount: price.total * 100, total: price.total, expiresInMinutes: 15 });
}));

// the page polls this every few seconds; once Razorpay shows a captured payment the plan is activated
router.get('/billing/qr/:id', ...guard, wrap(async (req, res) => {
  const order = await prisma.paymentOrder.findUnique({ where: { razorpayOrderId: req.params.id } });
  if (!order || order.kind !== 'qr') throw httpError(404, 'Unknown QR code.');
  if (order.accountId !== req.account.id) throw httpError(403, 'This QR code belongs to another account.');
  if (order.status === 'paid') {
    const invoice = await prisma.billingInvoice.findUnique({ where: { razorpayOrderId: order.razorpayOrderId } });
    const subscription = await prisma.subscription.findUnique({ where: { id: 1 } });
    return res.json({ paid: true, invoice: fromRow(COLLECTIONS.billingInvoices, invoice), subscription: fromRow(SINGLETONS.subscription, subscription) });
  }
  const list = await razorpay.fetchQrPayments(order.razorpayOrderId);
  const hit = ((list && list.items) || []).find((p) => p.status === 'captured' && Number(p.amount) === order.amount);
  if (!hit) return res.json({ paid: false });
  const out = await settleOrder(order, hit.id);
  return res.json({ paid: true, ...out });
}));

// marks an order paid exactly once and activates the plan (used by verify AND the webhook)
async function settleOrder(order, paymentId) {
  const claimed = await prisma.paymentOrder.updateMany({
    where: { id: order.id, status: 'created' },
    data: { status: 'paid', razorpayPaymentId: paymentId, paidAt: new Date() },
  });
  if (claimed.count === 0) {
    // already settled (browser callback and webhook can both arrive) -> return what was created
    const invoice = await prisma.billingInvoice.findUnique({ where: { razorpayOrderId: order.razorpayOrderId } });
    const subscription = await prisma.subscription.findUnique({ where: { id: 1 } });
    return { invoice: fromRow(COLLECTIONS.billingInvoices, invoice), subscription: fromRow(SINGLETONS.subscription, subscription) };
  }
  let method = order.kind === 'qr' ? 'Razorpay (UPI QR)' : 'Razorpay';
  try {
    const p = await razorpay.fetchPayment(paymentId);
    if (p && p.method) method = `Razorpay (${String(p.method).toUpperCase()})`;
  } catch (err) { /* the method label is cosmetic */ }
  return activate({
    planId: order.planId,
    cycle: order.cycle,
    email: order.email,
    source: 'razorpay',
    price: priceFor(order.planId, order.cycle),
    method,
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: paymentId,
    accountId: order.accountId,
  });
}

// ---- paid: Checkout success callback ------------------------------------------------------
const verifySchema = z.object({
  razorpay_order_id: z.string().min(5).max(100),
  razorpay_payment_id: z.string().min(5).max(100),
  razorpay_signature: z.string().min(10).max(200),
});

router.post('/billing/verify', ...guard, wrap(async (req, res) => {
  const b = verifySchema.parse(req.body);
  const order = await prisma.paymentOrder.findUnique({ where: { razorpayOrderId: b.razorpay_order_id } });
  if (!order) throw httpError(404, 'Unknown payment order.');
  if (order.accountId !== req.account.id) throw httpError(403, 'This payment belongs to another account.');
  if (!razorpay.verifyPaymentSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) {
    throw httpError(400, 'Payment verification failed (signature mismatch). If money was deducted it will be refunded or activated automatically.');
  }
  res.json(await settleOrder(order, b.razorpay_payment_id));
}));

// ---- paid: Razorpay webhook (activates the plan even if the browser was closed after paying) ----
router.post('/billing/razorpay-webhook', wrap(async (req, res) => {
  if (!razorpay.verifyWebhookSignature(req.rawBody, req.headers['x-razorpay-signature'])) {
    throw httpError(400, 'Invalid webhook signature.');
  }
  const event = JSON.parse(req.rawBody.toString('utf8'));
  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    const payment = event.payload && event.payload.payment && event.payload.payment.entity;
    const key = payment && (payment.order_id || payment.qr_code_id);
    if (key) {
      const order = await prisma.paymentOrder.findUnique({ where: { razorpayOrderId: key } });
      if (order && order.status === 'created' && Number(payment.amount) === order.amount) {
        await settleOrder(order, payment.id);
      }
    }
  }
  if (event.event === 'qr_code.credited') {
    const qr = event.payload && event.payload.qr_code && event.payload.qr_code.entity;
    const payment = event.payload && event.payload.payment && event.payload.payment.entity;
    if (qr && payment) {
      const order = await prisma.paymentOrder.findUnique({ where: { razorpayOrderId: qr.id } });
      if (order && order.status === 'created' && Number(payment.amount) === order.amount) {
        await settleOrder(order, payment.id);
      }
    }
  }
  res.json({ ok: true });
}));

// re-send the receipt + invoice e-mail for one of your invoices (admin: any invoice; user: only their own)
router.post('/billing/invoices/:id/email', ...guard, wrap(async (req, res) => {
  const invoice = await prisma.billingInvoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) throw httpError(404, 'Invoice not found.');
  if (req.account.role !== 'admin' && invoice.accountId !== req.account.id) throw httpError(403, 'This invoice belongs to another account.');
  const to = String((req.body && req.body.email) || invoice.payerEmail || req.account.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(to)) throw httpError(400, 'Enter a valid e-mail address.');
  const emailed = await emailInvoice(invoice, to);
  res.json({ emailed, to, error: emailed ? '' : mailError() });
}));

module.exports = router;
module.exports = router;
