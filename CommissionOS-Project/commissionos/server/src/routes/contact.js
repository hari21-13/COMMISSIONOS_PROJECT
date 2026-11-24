// "Contact us" form: stored in the database and e-mailed to support (if SMTP is configured)
const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const config = require('../config');
const wrap = require('../middleware/wrap');
const { sendMail } = require('../lib/mailer');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(30).optional().default(''),
  topic: z.string().trim().max(80).default('Other'),
  message: z.string().trim().min(1).max(5000),
});

router.post('/contact', wrap(async (req, res) => {
  const b = bodySchema.parse(req.body);
  const saved = await prisma.contactMessage.create({ data: b });
  const emailed = await sendMail({
    to: config.supportEmail,
    replyTo: b.email,
    subject: `[Auron CommissionOS] ${b.topic} — ${b.name}`,
    text: `Name: ${b.name}\nEmail: ${b.email}\nPhone: ${b.phone}\nTopic: ${b.topic}\n\n${b.message}\n`,
  });
  // confirmation to the person who wrote to us
  await sendMail({
    to: b.email,
    replyTo: config.supportEmail,
    subject: 'We received your message — Auron CommissionOS',
    text: `Hello ${b.name},\n\nThanks for contacting us. We received your message about "${b.topic}" and will reply soon.\n\nYour message:\n${b.message}\n\n— Auron CommissionOS support`,
  });
  res.status(201).json({ id: saved.id, emailed });
}));

// admin inbox: everything customers / users wrote through "Contact Us — Any Query?"
router.get('/contact', requireAuth, requireAdmin, wrap(async (req, res) => {
  const rows = await prisma.contactMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  res.json(rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone, topic: r.topic, message: r.message,
    createdAt: r.createdAt.toISOString(),
  })));
}));

module.exports = router;