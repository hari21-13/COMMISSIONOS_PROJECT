// Subscription checkout:
//   * the first subscription of the workspace is FREE (the server decides, one time only)
//   * otherwise the server creates a Razorpay order and Razorpay Checkout opens with UPI first
//     (UPI QR / UPI apps / cards); after payment the server verifies the signature and activates the plan.
import React, { useEffect, useState } from 'react';
import { api } from './api';
import './PlanCheckout.css';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error('Could not load Razorpay. Please check your internet connection.'));
    document.body.appendChild(s);
    return undefined;
  });
}

// Put this at the top of the billing page.
// `refreshKey`: change it (e.g. the number of invoices) to re-check the status after a subscription is activated
export function FreeSubscriptionBanner({ refreshKey = 0 }) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    api.get('/billing/status').then(setSt).catch(() => {});
  }, [refreshKey]);
  if (!st) return null;
  return (
    <>
      {st.freeEligible && (
        <div className="pc-banner">
          <div className="pc-gift">🎁</div>
          <div>
            <b>The Starter plan is FREE</b>
            <span>Activate Starter without any payment. Growth, Business and Enterprise are paid securely through Razorpay.</span>
          </div>
        </div>
      )}
      {st.razorpayConfigured && (
        <div className="pc-banner pc-info">
          <div className="pc-gift">🔒</div>
          <div>
            <b>Secure payments with Razorpay</b>
            <span>Pay with UPI (QR code or any UPI app), cards or netbanking.{st.mode === 'test' ? ' Test mode: no real money is charged.' : ''}</span>
          </div>
        </div>
      )}
      {!st.razorpayConfigured && (
        <div className="pc-banner pc-alert">
          <div className="pc-gift">⚠️</div>
          <div>
            <b>Razorpay is not configured yet</b>
            <span>Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env and restart the server to accept payments.</span>
          </div>
        </div>
      )}
    </>
  );
}

export default function PlanCheckout({ plan, cycle, defaultEmail = '', defaultName = '', adminQr = '', onClose, onPaid, notify }) {
  const [quote, setQuote] = useState(null);
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [qr, setQr] = useState(null); // { qrId, imageUrl, total, startedAt }
  const [qrLeft, setQrLeft] = useState(0);

  useEffect(() => {
    api.get(`/billing/quote?planId=${plan.id}&cycle=${cycle}`).then(setQuote).catch((e) => setError(e.message));
  }, [plan.id, cycle]);

  const emailOk = /^\S+@\S+\.\S+$/.test(email);
  const cycleLabel = cycle === 'annual' ? '12 months' : '1 month';

  const finish = (out) => {
    onPaid(out);
    setResult(out);
    setBusy(false);
    if (notify) notify(`${plan.name} Plan is now active!`);
  };

  const activateFree = async () => {
    setBusy(true);
    setError('');
    try {
      finish(await api.post('/billing/free', { planId: plan.id, cycle, email }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const payWithRazorpay = async () => {
    setBusy(true);
    setError('');
    try {
      const order = await api.post('/billing/order', { planId: plan.id, cycle, email });
      await loadRazorpay();
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'Auron CommissionOS',
        description: `${order.planName} Plan — ${cycleLabel}`,
        prefill: { name: defaultName, email },
        theme: { color: '#DC2626' },
        // show UPI first (QR code / UPI apps); the other methods stay available below it
        config: {
          display: {
            blocks: { upi: { name: 'Pay with UPI / QR code', instruments: [{ method: 'upi', flows: ['qr', 'intent', 'collect'] }] } },
            sequence: ['block.upi'],
            preferences: { show_default_blocks: true },
          },
        },
        handler: async (resp) => {
          try {
            finish(await api.post('/billing/verify', resp));
          } catch (err) {
            setError(`${err.message} (Payment id: ${resp.razorpay_payment_id})`);
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on('payment.failed', (r) => {
        setError((r && r.error && r.error.description) || 'Payment failed. Please try again.');
        setBusy(false);
      });
      rzp.open();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // ---- our own QR code: the server creates a fixed-amount Razorpay UPI QR, we poll until it is paid ----
  const showQr = async () => {
    setBusy(true);
    setError('');
    try {
      const q = await api.post('/billing/qr', { planId: plan.id, cycle, email });
      setQr({ ...q, startedAt: Date.now() });
      setQrLeft((q.expiresInMinutes || 15) * 60);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (!qr || result) return undefined;
    const tick = setInterval(() => {
      setQrLeft((s) => {
        if (s <= 1) { clearInterval(tick); return 0; }
        return s - 1;
      });
    }, 1000);
    const poll = setInterval(async () => {
      try {
        const r = await api.get(`/billing/qr/${qr.qrId}`);
        if (r && r.paid) {
          clearInterval(poll);
          clearInterval(tick);
          setQr(null);
          finish({ invoice: r.invoice, subscription: r.subscription });
        }
      } catch (err) { /* keep polling; a temporary network error is fine */ }
    }, 4000);
    return () => { clearInterval(tick); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr && qr.qrId, result]);

  const mmss = `${String(Math.floor(qrLeft / 60)).padStart(2, '0')}:${String(qrLeft % 60).padStart(2, '0')}`;

  const free = quote && quote.free;

  return (
    <div className="pc-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pc-modal" role="dialog" aria-modal="true">
        <div className="pc-head">
          <div>
            <small>{result ? 'Subscription active' : free ? 'Free plan' : 'Checkout'}</small>
            <strong>{plan.name} Plan · {cycleLabel}</strong>
          </div>
          <button className="pc-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        {result ? (
          <div className="pc-done">
            <div className="pc-tick">✓</div>
            <h3>{plan.name} Plan is active</h3>
            <p>Invoice <b>{result.invoice.id}</b> · {inr(result.invoice.total)}</p>
            <p>Next billing date: <b>{result.subscription.nextBillingDate}</b></p>
            <p className="pc-mail">{result.emailed ? `📧 Your receipt and invoice (PDF) were e-mailed to ${email}.` : `📧 E-mail was not sent${result.emailError ? `: ${result.emailError}` : ''}. Use "Email me" in the billing history to try again.`}</p>
            <button className="pc-btn" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div className="pc-body">
            {!quote && !error && <div className="pc-note">Loading price…</div>}

            {quote && free && (
              <div className="pc-free">
                <b>🎁 Your first subscription is FREE</b>
                The {plan.name} plan is free. No card or UPI payment is needed.
              </div>
            )}

            {quote && (
              <div className="pc-summary">
                <div className={`pc-row ${free ? 'pc-strike' : ''}`}><span>{plan.name} Plan ({cycleLabel})</span><strong>{inr(quote.subtotal)}</strong></div>
                <div className={`pc-row ${free ? 'pc-strike' : ''}`}><span>GST (18%)</span><strong>{inr(quote.gst)}</strong></div>
                <div className="pc-row pc-total"><span>{free ? 'You pay today' : 'Total payable'}</span><strong>{free ? '₹0 (FREE)' : inr(quote.total)}</strong></div>
              </div>
            )}

            <div>
              <label className="pc-label" htmlFor="pc-email">Billing e-mail (invoice goes here)</label>
              <input id="pc-email" className="pc-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>

            {quote && !free && (
              <div>
                <div className="pc-methods">
                  <span className="pc-chip pc-upi">UPI · QR code</span>
                  <span className="pc-chip">PhonePe · GPay · Paytm</span>
                  <span className="pc-chip">Cards</span>
                  <span className="pc-chip">Netbanking</span>
                </div>
              </div>
            )}

            {quote && !free && !quote.razorpayConfigured && (
              <div className="pc-warn">Razorpay is not configured on the server yet, so payment cannot start. Add <b>RAZORPAY_KEY_ID</b> and <b>RAZORPAY_KEY_SECRET</b> to <b>server/.env</b> and restart the server.</div>
            )}
            {error && <div className="pc-error">{error}</div>}

            {quote && free && (
              <button className="pc-btn pc-green" disabled={busy || !emailOk} onClick={activateFree}>
                {busy ? 'Activating…' : `Activate ${plan.name} free`}
              </button>
            )}
            {quote && !free && (
              <button className="pc-btn" disabled={busy || !emailOk || !quote.razorpayConfigured} onClick={payWithRazorpay}>
                {busy ? 'Waiting for payment…' : `Pay ${inr(quote.total)} with Razorpay`}
              </button>
            )}
            {quote && !free && !qr && (
              <button className="pc-btn pc-dark" data-allow="all" disabled={busy || !emailOk || !quote.razorpayConfigured} onClick={showQr}>
                Show QR code · scan with PhonePe / GPay / Paytm
              </button>
            )}
            {qr && (
              <div className="pc-qr" data-allow="all">
                {qr.imageUrl && <img src={qr.imageUrl} alt="UPI QR code" />}
                <b>Scan &amp; pay {inr(qr.total)}</b>
                <span>{qrLeft > 0 ? `QR valid for ${mmss}. This page updates automatically when the payment is received.` : 'This QR code has expired.'}</span>
                {qrLeft === 0 && <button className="pc-btn" onClick={() => { setQr(null); showQr(); }}>Generate a new QR</button>}
                {qrLeft > 0 && <div className="pc-wait">Waiting for payment…</div>}
              </div>
            )}
            {quote && !free && adminQr && (
              <div className="pc-qr" data-allow="all">
                <img src={adminQr} alt="Payment QR code" />
                <b>Scan &amp; pay {inr(quote.total)}</b>
                <span>Scan this QR with PhonePe, GPay, Paytm or any UPI app.</span>
              </div>
            )}
            <div className="pc-note">
              {free ? 'No payment is required for the Starter plan.' : `Secured by Razorpay${quote && quote.mode === 'test' ? ' · TEST MODE: no real money is charged' : ''}. Choose UPI to get a QR code.`}
            </div>
            <button className="pc-link" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
