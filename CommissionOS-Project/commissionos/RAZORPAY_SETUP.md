# Razorpay + free first subscription — setup

## 1. Keys
Razorpay Dashboard → *Account & Settings → API Keys → Generate Test Key*. Copy **Key Id** and **Key Secret** into `server/.env`:

```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
FREE_FIRST_SUBSCRIPTION=true
FREE_TRIAL_DAYS=30
```
Restart the server after editing `.env`. The Key **Secret** stays on the server only — it is never sent to the browser.

## 2. Database update (once)
```
cd server
npx prisma migrate dev --name razorpay
```

## 3. How it behaves
| Situation | What the user sees |
|---|---|
| Nothing paid yet | Green banner "Your first subscription is FREE". *Subscribe* → "Activate … free" → plan active, ₹0 invoice, next billing date = today + 30 days |
| Free period already used | *Subscribe* → price + GST → **Pay ₹X with Razorpay** → Razorpay opens with UPI first (QR code / UPI apps), cards and netbanking below → after payment the server verifies it and activates the plan, invoice is created |

To try the free flow again: *Organisation Settings → Data & Backup → Reset to Demo Data* (removes the invoices).

## 3b. Testing in TEST mode
* No real money moves with `rzp_test_` keys.
* In the Razorpay popup choose **UPI** and enter the test UPI ID `success@razorpay` to simulate a successful payment
  (`failure@razorpay` simulates a failure).
* A UPI QR is shown on the UPI screen, but in test mode it cannot be paid with a real app. To scan with PhonePe / GPay,
  switch to **live keys** (`rzp_live_...`, needs KYC approval; if the QR option is missing, ask Razorpay to enable *UPI QR*).

## 4. Webhook (recommended for live)
Without it, a payment made by scanning the QR is activated when the checkout page receives the success callback; if the
user closes the browser at that moment it would not be. Add in *Dashboard → Webhooks*:
* URL: `https://YOUR-DOMAIN/api/billing/razorpay-webhook` (must be public — use a tunnel such as ngrok while developing)
* Events: `payment.captured`, `order.paid`
* Secret: any string you choose, also put it in `server/.env` as `RAZORPAY_WEBHOOK_SECRET`.

## 5. Security notes
* The browser sends only the plan and cycle; the amount is computed on the server and the order is created with Razorpay's API.
* A payment is accepted only if Razorpay's HMAC signature matches, only for the account that created the order, and only once.
