'use strict';
// Optional email alerts when someone writes in through the website.
// Turn on by setting SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally SMTP_FROM) in .env,
// plus an address under Admin > Website content > Contact > "Send enquiries to".
const nodemailer = require('nodemailer');

let transport = null;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

const LABEL = { partner: 'Partner / sponsor enquiry', volunteer: 'Volunteer sign-up', contact: 'Website message' };

function notify(msg, s, baseUrl) {
  const t = getTransport();
  const to = s.notify_email || process.env.NOTIFY_EMAIL;
  if (!t || !to) return;
  const lines = [
    `${LABEL[msg.type] || 'Website message'} from ${msg.name}${msg.organisation ? ` (${msg.organisation})` : ''}`, '',
    msg.email ? `Email: ${msg.email}` : null, msg.phone ? `Phone: ${msg.phone}` : null, '',
    msg.message || '(no message)', '', `See all messages: ${baseUrl}/admin/messages`,
  ].filter((l) => l !== null);
  t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    replyTo: msg.email || undefined,
    subject: `${LABEL[msg.type] || 'Website message'}: ${msg.name}${msg.organisation ? ' · ' + msg.organisation : ''}`,
    text: lines.join('\n'),
  }).catch((e) => console.error('Email alert failed:', e.message));
}

module.exports = { notify };
