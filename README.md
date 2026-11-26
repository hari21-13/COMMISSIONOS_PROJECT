<<<<<<< HEAD
<<<<<<< HEAD
# Auron CommissionOS — full-stack edition

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + CSS (`client/src/styles.css`) |
| Backend | Node.js + Express |
| Database | PostgreSQL + Prisma ORM |
| Auth | JWT, bcrypt passwords, optional Google Sign-In, roles `admin` / `user` |

Everything from the previous single-file app is here: all 12 modules (Organisation Settings, Employees & Partners with
exit date, Commission Policies, Sales Transactions, Commission Engine, Returns & Reversals, Commission Dashboard,
Statements, Approval Workflow, Payouts, Disputes & Adjustments, Reports & Analytics), Users & Login Activity, Subscription
& Billing (4 plans, UPI/PhonePe QR, invoice PDF), contact form, invitations, animations, footer, `#admin` / `#employee`
portals and the view-only employee portal. The difference: **data now lives in PostgreSQL**, not in the browser.

## 1. Run it (5 minutes)

Requirements: Node.js 18+, Docker (or any PostgreSQL 14+).

```bash
# 1) database
docker compose up -d

# 2) API  (http://localhost:4000)
cd server
cp .env.example .env            # then edit JWT_SECRET (see comment inside)
npm install
npx prisma migrate dev --name init   # creates the tables  (or: npm run db:push)
npm run dev                     # first start also creates the admin + loads demo data

# 3) React app  (http://localhost:5173)  — in a second terminal
cd client
npm install
npm run dev
```

Open <http://localhost:5173>.

| URL | What you get |
|---|---|
| `/` | User login / sign-up → view-only portal (only their own data) |
| `/#employee` | Employee login → "My Details" portal (view-only) |
| `/#admin` | Admin login → full app with edit rights + **Users & Login Activity** |

First admin (created from `server/.env`): **admin@aurontech.in / Admin@123** — change it after the first login
(Users & Login Activity → Edit → Reset password) and set your own `ADMIN_*` values for a fresh database.

## 2. How it fits together

```
React (client/)  ──/api──►  Express (server/src)  ──Prisma──►  PostgreSQL
  Vite dev proxy              routes → middleware → lib
```

* **Screens did not change.** The React state hooks (`useSyncedCollection`, `useSyncedObject` in `client/src/App.jsx`) keep
  the same `[value, setValue]` shape; every change a screen makes is diffed and sent to the API (create / update /
  delete) in order, and the whole workspace is loaded with one call (`GET /api/bootstrap`) after admin sign-in.
* **Rules are enforced on the server**, not in the UI: only admins can read or write business data; a non-admin only
  gets `/api/portal`, which filters to *their own* employee record, sales, statements, payouts, disputes; suspended or
  deleted accounts and "sign out everywhere" (password reset) take effect immediately; plan prices and GST are computed
  by the server; a UPI reference (UTR) can be used only once; the last active admin cannot be removed.
* **Commission calculation runs on the server** (`server/src/lib/commission.js`, all 7 models A–G) —
  `POST /api/engine/run`.
* **Invitations work across devices:** `POST /api/invites` creates a one-time 7-day link; the invited person opens it,
  sets a password and is signed in. If SMTP is configured the server e-mails the link, otherwise the admin's mail app opens.

### Database (`server/prisma/schema.prisma`)
`Account`, `LoginActivity`, `Invite`, `ContactMessage`, `Organisation`, `Subscription`, `Department`, `OrgUser`,
`RolePermission`, `Employee`, `Policy`, `Transaction`, `Reversal`, `Adjustment`, `Statement`, `Payout`, `Dispute`,
`CalcRun`, `BillingInvoice`, `Setting`. Business tables have typed columns plus an `extra` JSON column, so any new field
the UI adds is stored and returned without a migration. Browse the data with `npm run db:studio`.

### API summary
| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register · login · google · confirm`, `GET /api/auth/me · config` |
| Workspace (admin) | `GET /api/bootstrap`, `GET/PUT /api/settings/org`, `/settings/subscription` |
| CRUD (admin) | `GET/POST /api/<name>`, `PUT/DELETE /api/<name>/:id` for `employees policies transactions reversals adjustments statements payouts disputes departments users rolePermissions billingInvoices` |
| Engine | `POST /api/engine/run` |
| Portal (any signed-in user) | `GET /api/portal` |
| Admin | `GET/POST/PUT/DELETE /api/admin/accounts`, `GET/DELETE /api/admin/login-activity`, `GET /api/admin/backup`, `POST /api/admin/restore`, `POST /api/admin/reset` |
| Invites | `POST /api/invites` (admin), `GET /api/invites/:token`, `POST /api/invites/:token/accept` |
| Billing | `POST /api/billing/checkout` |
| Public | `POST /api/contact`, `GET /api/health` |

## 3. Google Sign-In
1. Google Cloud Console → *APIs & Services → Credentials → OAuth client ID → Web application*; add `http://localhost:5173`
   under *Authorised JavaScript origins*.
2. Put the client ID in `server/.env` as `GOOGLE_CLIENT_ID=...` and restart the API. The button appears automatically
   (the client reads it from `GET /api/auth/config`); the server verifies the Google ID token.
3. Only e-mails listed in `ADMIN_GOOGLE_EMAILS` can become admins through Google; everyone else becomes a view-only user.

Without a client ID the button is disabled. For local demos only you can set `ALLOW_DEMO_GOOGLE=true` to get the demo
account chooser (the server refuses to start with this flag in production).

## 4. Subscriptions & payments (Razorpay)
* **First subscription is free** (default 30 days, once per workspace — `FREE_FIRST_SUBSCRIPTION`, `FREE_TRIAL_DAYS` in `server/.env`).
* After that, *Subscribe* creates a Razorpay order on the server, opens Razorpay Checkout with **UPI first (QR code / UPI apps)**,
  and the server verifies Razorpay's signature before activating the plan. A webhook (`POST /api/billing/razorpay-webhook`)
  activates the plan even if the browser is closed after paying. Prices and GST are always computed by the server.
* Setup: put `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (test keys `rzp_test_...` first) in `server/.env`. See `RAZORPAY_SETUP.md`.

## 5. E-mail (optional)
Fill `SMTP_*` in `server/.env` to e-mail invitations and contact-form messages (to `SUPPORT_EMAIL`). Contact messages are
always stored in the `ContactMessage` table.

## 6. Production
```bash
cd client && npm run build            # creates client/dist
cd ../server && NODE_ENV=production npm start
```
When `client/dist` exists the Express server also serves the React app, so one process serves everything on `PORT`.
Use `npx prisma migrate deploy` instead of `migrate dev`, a strong `JWT_SECRET` (the server refuses weak ones in
production), HTTPS, and set `CORS_ORIGINS` / `CLIENT_URL` to your real domain.

## 7. Tests
`cd server && npm test` — commission models A–G, the engine, and a consistency test that checks `schema.prisma`, the
UI↔column mapping and the demo data agree (no database needed).

## 8. Good to know
* Styles: `client/src/styles.css` is plain CSS (utility classes used by the JSX + custom animations). No CSS framework
  is needed to build or run the app.
* The login token is kept in `localStorage` (business data is not). For stricter setups move it to an httpOnly cookie.
* Reset: *Organisation Settings → Data & Backup* can download a JSON backup, restore one, or reset to demo data
  (login accounts are never touched).
=======
# Alpha_CommissionOS_Project
>>>>>>> 7afcd225ca03b921536915945ea66c4930d68a86
=======
# COMMISSIONOS_PROJECT
>>>>>>> f1625393d481d606b59584f68fd1c91d54f0c3e2
