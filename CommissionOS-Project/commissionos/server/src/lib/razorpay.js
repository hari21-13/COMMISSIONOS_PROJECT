// Minimal Razorpay REST client + signature checks (no SDK needed; Node 18+ has fetch)
const crypto = require('crypto');
const config = require('../config');
const { httpError } = require('./errors');

const isConfigured = () => Boolean(config.razorpay.keyId && config.razorpay.keySecret);
const mode = () => (config.razorpay.keyId.startsWith('rzp_live_') ? 'live' : 'test');

async function request(method, path, body) {
  if (!isConfigured()) {
    throw httpError(501, 'Razorpay is not configured on the server (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET).');
  }
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  let res;
  try {
    res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw httpError(502, 'Could not reach Razorpay. Please try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(502, (data.error && data.error.description) || 'Razorpay rejected the request.');
  return data;
}

const createOrder = ({ amountPaise, receipt, notes }) =>
  request('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes, payment_capture: 1 });

const fetchPayment = (paymentId) => request('GET', `/payments/${encodeURIComponent(paymentId)}`);

// Dynamic UPI QR with a fixed amount (single use, valid for `minutes`). The image_url can be shown in our own page.
const createQr = ({ amountPaise, name, description, notes, minutes = 15 }) =>
  request('POST', '/payments/qr_codes', {
    type: 'upi_qr',
    name,
    usage: 'single_use',
    fixed_amount: true,
    payment_amount: amountPaise,
    description,
    close_by: Math.floor(Date.now() / 1000) + minutes * 60,
    notes,
  });

const fetchQrPayments = (qrId) => request('GET', `/payments/qr_codes/${encodeURIComponent(qrId)}/payments`);

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Checkout success callback: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
function verifyPaymentSignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
}

// Webhook: signature = HMAC_SHA256(raw request body, webhook_secret)
function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret || !rawBody) return false;
  const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

module.exports = { isConfigured, mode, createOrder, fetchPayment, createQr, fetchQrPayments, verifyPaymentSignature, verifyWebhookSignature };
