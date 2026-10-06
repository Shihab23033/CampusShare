const nodemailer = require('nodemailer');

let transporter;

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

function gmailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function isConfigured() {
  return smtpConfigured() || gmailConfigured();
}

function describe() {
  if (smtpConfigured()) return process.env.SMTP_HOST;
  if (gmailConfigured()) return 'smtp.gmail.com';
  return 'disabled';
}

function transportConfig() {
  if (smtpConfigured()) {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
    return {
      host: process.env.SMTP_HOST,
      port,
      secure,
      requireTLS: !secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    };
  }
  return {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  };
}

function fromAddress() {
  const user = smtpConfigured() ? process.env.SMTP_USER : process.env.GMAIL_USER;
  return process.env.SMTP_FROM || `CampusShare <${user}>`;
}

function getTransporter() {
  if (!isConfigured()) {
    const error = new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD (or GMAIL_USER and GMAIL_APP_PASSWORD).');
    error.code = 'MAIL_NOT_CONFIGURED';
    throw error;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport(transportConfig());
  }
  return transporter;
}

async function sendEmail({ to, subject, text }) {
  return getTransporter().sendMail({
    from: fromAddress(),
    to,
    subject,
    text
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
    console.error('CampusShare notification email failed:', error.code || 'SMTP_ERROR');
    return false;
  }
}

module.exports = { describe, isConfigured, sendEmail, sendNotification, sendOtpEmail };
