// Send a real test mail:  node test-mail.js            (to SMTP_USER)
//                         node test-mail.js you@x.com  (to any address)
const config = require('./src/config');
const { sendMail, mailError } = require('./src/lib/mailer');
const to = process.argv[2] || config.smtp.user;
console.log('Mode: ' + (process.env.BREVO_API_KEY ? 'Brevo HTTPS API (port 443)' : 'SMTP ' + config.smtp.host + ':' + config.smtp.port));
console.log('Sending test mail to ' + to + ' ...');
sendMail({ to, subject: 'CommissionOS test mail', text: 'If you can read this, e-mail sending works.' })
  .then((ok) => console.log(ok ? 'MAIL SENT - check the inbox (and spam).' : 'FAILED: ' + mailError()));
