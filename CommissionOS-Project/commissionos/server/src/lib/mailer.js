const config = require('../config');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

let transporter = null;
let lastError = '';

// Resolve IPv4 addresses first. Many home / office networks reset (ECONNRESET) IPv6 connections.
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}

// "Auron CommissionOS <me@x.com>" -> { name, email }
function parseAddress(value) {
  const s = String(value || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: '', email: s };
}

function parseRecipients(to) {
  const list = Array.isArray(to) ? to : String(to || '').split(',');
  return list.map((x) => parseAddress(x)).filter((x) => x.email).map((x) => ({ email: x.email, name: x.name || String(x.email).split('@')[0] }));
}

// nodemailer-style attachments -> Brevo attachments (base64)
function brevoAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return undefined;
  const out = [];
  attachments.forEach((a) => {
    let buf = null;
    if (a.content !== undefined && a.content !== null) {
      buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content), a.encoding === 'base64' ? 'base64' : 'utf8');
    } else if (a.path) {
      try { buf = fs.readFileSync(a.path); } catch (err) { buf = null; }
    }
    if (buf) out.push({ name: a.filename || (a.path ? path.basename(a.path) : 'attachment'), content: buf.toString('base64') });
  });
  return out.length ? out : undefined;
}

// ---- HTTPS (port 443) sending through Brevo: works where SMTP ports are blocked ----
async function sendViaBrevo({ to, subject, text, html, replyTo, attachments }) {
  const sender = parseAddress(config.smtp.from || process.env.MAIL_FROM || config.smtp.user);
  const body = {
    sender: sender.name ? { name: sender.name, email: sender.email } : { email: sender.email },
    to: parseRecipients(to),
    subject,
    htmlContent: html || `<pre style="font-family:inherit">${String(text || '').replace(/</g, '&lt;')}</pre>`,
    textContent: text || undefined,
  };
  if (replyTo) {
    // Brevo requires a name inside replyTo; fall back to the part before the @
    const r = parseAddress(Array.isArray(replyTo) ? replyTo[0] : replyTo);
    body.replyTo = { email: r.email, name: r.name || String(r.email).split('@')[0] || 'Reply' };
  }
  const att = brevoAttachments(attachments);
  if (att) body.attachment = att;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = j.message || JSON.stringify(j); } catch (err) { msg = res.statusText; }
    throw new Error(`Brevo ${res.status}: ${msg}`);
  }
}

// ---- SMTP (used only when BREVO_API_KEY is empty) ----
function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');

    const port = Number(config.smtp.port) || 587;
    const secure = port === 465;

    console.log(`[mail] SMTP: ${config.smtp.host}:${port} (secure=${secure}, user=${config.smtp.user})`);

    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port,
      secure,                 // 465 -> true, 587 -> false (STARTTLS)
      requireTLS: !secure,    // 587: STARTTLS is compulsory
      family: 4,              // force IPv4
      tls: { servername: config.smtp.host },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: String(config.smtp.pass || '').replace(/\s+/g, '') }
        : undefined,
    });
  }
  return transporter;
}

// Returns true if the mail was handed to the mail service, false if mail is not configured / failed.
async function sendMail({ to, subject, text, html, replyTo, attachments }) {
  if (process.env.BREVO_API_KEY) {
    try {
      lastError = '';
      await sendViaBrevo({ to, subject, text, html, replyTo, attachments });
      return true;
    } catch (err) {
      lastError = err.message || 'Could not send the e-mail.';
      console.error('[mail] failed:', lastError);
      return false;
    }
  }

  const t = getTransporter();
  if (!t) {
    lastError = 'E-mail is not set up on the server: set BREVO_API_KEY (or SMTP_HOST) in server/.env.';
    console.error('[mail] ' + lastError);
    return false;
  }
  try {
    lastError = '';
    await t.sendMail({
      from: config.smtp.from || config.smtp.user,
      to,
      subject,
      text,
      html,
      replyTo,
      attachments,
    });
    return true;
  } catch (err) {
    lastError = err.message || 'Could not send the e-mail.';
    console.error('[mail] failed:', err.message);
    transporter = null; // next attempt uses a fresh connection
    return false;
  }
}

const mailError = () => lastError;

module.exports = { sendMail, mailError };
