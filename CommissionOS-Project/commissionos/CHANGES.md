# What changed (red/black theme, roles, payments, invoices)

1. Theme: red + black (styles.css palette, PlanCheckout.css, schema/seed defaults). Existing DBs keep old org colours until changed in Organisation Settings.
2. Roles: admin | employee | user.  user = view everything, no edits (can subscribe). employee = view everything, may edit only own phone + raise/comment own disputes.
3. Employee portal (#employee): register/login only with an e-mail present in Employees & Partners. New page "My Profile & Commission".
4. Billing: first subscription free; Razorpay checkout + own "Show QR code" (Razorpay dynamic UPI QR, auto-detect payment); payer name/email/payment id visible to admin.
5. Invoice PDFs (Disputes & Adjustments + subscription) with org logo and brand colours: client/src/pdfInvoice.js.
6. Server enforces permissions: server/src/lib/permissions.js. UI hides controls: client/src/viewOnly.js.

Run after unzipping:  cd server && npx prisma migrate dev --name roles-payments
Razorpay QR needs "UPI QR" enabled on your Razorpay account.

## Round 2
- Opening animation "CommissionOS" (red + black, styles.css `intro-*`) before the login page.
- Employee: sees ONLY own records (profile, sales, refunds, statements, payouts, disputes, adjustments, plan). Organisation Settings, Employees & Partners, Subscription removed. Enforced in server/src/lib/scope.js.
- User: sees ONLY authorised records (approved statements, paid payouts, approved adjustments, resolved disputes) + Audit History. M11 invoice PDFs (with logo) downloadable.
- Fixed: employee login bounced back to plain localhost (role/portal mismatch). URL now stays #admin / #employee after sign-in.
- No new database migration in this round.

## Round 3
- Whole app is now a dark RED + BLACK theme (white only for text). Opening animation -> login -> app.
- Login page no longer shows User / Employee / Admin links: open the portal by typing the URL (/#admin, /#employee).
- Employee: Commission Policies shows ALL plans + live calculator + "How each plan works"; Commission Engine 4 illustrated steps;
  Commission Statements has the full step-by-step calculation; Approval Workflow lets the employee add/edit comments on OWN statements;
  Reports has bar graph + pie chart at the top.
- Server: employees get all policies (scope.js) and may PUT comments on own statements (permissions.js).
