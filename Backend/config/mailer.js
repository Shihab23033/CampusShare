const nodemailer = require('nodemailer');

let transporter;

function isConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function getTransporter() {
  if (!isConfigured()) {
    const error = new Error('Gmail SMTP is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.');
    error.code = 'MAIL_NOT_CONFIGURED';
    throw error;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, text }) {
  return getTransporter().sendMail({
    from: `CampusShare <${process.env.GMAIL_USER}>`,
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

module.exports = { isConfigured, sendEmail, sendNotification, sendOtpEmail };