const { BrevoClient } = require('@getbrevo/brevo');

let client;

function isConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.SENDER_EMAIL);
}

function describe() {
  return isConfigured() ? 'brevo' : 'disabled';
}

function getClient() {
  if (!isConfigured()) {
    const error = new Error('Brevo is not configured. Set BREVO_API_KEY and SENDER_EMAIL.');
    error.code = 'MAIL_NOT_CONFIGURED';
    throw error;
  }
  if (!client) {
    client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  }
  return client;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function htmlFrom(text) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#17251f">${escapeHtml(text).replace(/\r?\n/g, '<br>')}</div>`;
}

async function sendEmail({ to, subject, text }) {
  return getClient().transactionalEmails.sendTransacEmail({
    subject,
    textContent: text,
    htmlContent: htmlFrom(text),
    sender: { email: process.env.SENDER_EMAIL, name: process.env.SENDER_NAME || 'CampusShare' },
    to: [{ email: to }]
  });
}

async function sendOtpEmail(email, code, purpose) {
  const isRegistration = purpose === 'registration';
  return sendEmail({
    to: email,
    subject: isRegistration ? 'Verify your CampusShare email' : 'Reset your CampusShare password',
    text: `Your CampusShare ${isRegistration ? 'verification' : 'password reset'} code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`
  });
}

async function sendNotification(email, subject, text) {
  if (!email || !isConfigured()) return false;
  try {
    await sendEmail({ to: email, subject, text });
    return true;
  } catch (error) {
    console.error('CampusShare notification email failed:', error.statusCode || error.code || 'BREVO_ERROR');
    return false;
  }
}

module.exports = { describe, isConfigured, sendEmail, sendNotification, sendOtpEmail };
