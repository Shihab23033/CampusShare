const express = require('express');
const bcrypt = require('bcryptjs');
const { createHash, randomInt, timingSafeEqual } = require('crypto');
const db = require('../config/db');
const mailer = require('../config/mailer');
const { loginLimit, otpLimit, passwordResetLimit, registerLimit } = require('../middleware/rateLimitMiddleware');

const router = express.Router();
const otpLifetimeMinutes = 10;
const otpMaxAttempts = 5;
const otpResendSeconds = 60;

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashOtp(email, purpose, code) {
  return createHash('sha256').update(`${email}:${purpose}:${code}`).digest('hex');
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function issueOtp(email, purpose, payload = null) {
  const [recent] = await db.execute(
    `SELECT id FROM email_otps WHERE email = ? AND purpose = ?
     AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)
     ORDER BY id DESC LIMIT 1`,
    [email, purpose, otpResendSeconds]
  );
  if (recent.length) throw httpError(429, 'Wait one minute before requesting another code.');

  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const connection = await db.getConnection();
  let otpId;
  try {
    await connection.beginTransaction();
    await connection.execute(
      'UPDATE email_otps SET consumed_at = UTC_TIMESTAMP() WHERE email = ? AND purpose = ? AND consumed_at IS NULL',
      [email, purpose]
    );
    const [result] = await connection.execute(
      `INSERT INTO email_otps (email, purpose, otp_hash, payload_json, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
      [email, purpose, hashOtp(email, purpose, code), payload ? JSON.stringify(payload) : null, otpLifetimeMinutes]
    );
    otpId = result.insertId;
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  try {
    await mailer.sendOtpEmail(email, code, purpose);
  } catch (error) {
    await db.execute('UPDATE email_otps SET consumed_at = UTC_TIMESTAMP() WHERE id = ?', [otpId]);
    if (error.code === 'MAIL_NOT_CONFIGURED') throw httpError(503, 'Email verification is not configured. Ask the site administrator to set up the Brevo API key.');
    throw httpError(502, 'Could not send the verification email. Check the Brevo settings and try again.');
  }
}

async function consumeOtp(email, purpose, code, action) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, otp_hash, payload_json, attempts FROM email_otps
       WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP()
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [email, purpose]
    );
    const otp = rows[0];
    if (!otp) {
      await connection.rollback();
      throw httpError(400, 'The code is invalid or expired. Request a new code and try again.');
    }

    const expected = Buffer.from(otp.otp_hash, 'hex');
    const actual = Buffer.from(hashOtp(email, purpose, code), 'hex');
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) {
      const attempts = Number(otp.attempts) + 1;
      await connection.execute(
        'UPDATE email_otps SET attempts = ?, consumed_at = ? WHERE id = ?',
        [attempts, attempts >= otpMaxAttempts ? new Date() : null, otp.id]
      );
      await connection.commit();
      throw httpError(400, attempts >= otpMaxAttempts
        ? 'Too many incorrect codes. Request a new code.'
        : `Incorrect code. ${otpMaxAttempts - attempts} attempts remaining.`);
    }

    const result = await action(connection, otp);
    await connection.execute('UPDATE email_otps SET consumed_at = UTC_TIMESTAMP() WHERE id = ?', [otp.id]);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.name = user.name;
      resolve();
    });
  });
}

router.post('/register', registerLimit, async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const department = String(req.body.department || '').trim();
  const studentId = String(req.body.studentId || '').trim().toUpperCase();

  if (name.length < 2 || name.length > 100 || !validEmail(email) || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72 || department.length < 2 || department.length > 100 || !/^[A-Z0-9][A-Z0-9._/-]{2,49}$/.test(studentId)) {
    return res.status(400).json({ error: 'Enter your name, valid email, department, student ID, and password (8–72 UTF-8 bytes). Student ID must be 3–50 letters or numbers.' });
  }

  try {
    const [existing] = await db.execute('SELECT id FROM users WHERE email = ? OR student_id = ? LIMIT 1', [email, studentId]);
    if (existing.length) return res.status(409).json({ error: 'Unable to create an account with that email or student ID.' });
    const passwordHash = await bcrypt.hash(password, 12);
    await issueOtp(email, 'registration', { name, passwordHash, department, studentId });
    res.status(202).json({ message: 'Verification code sent. Check your email to finish creating your account.', email });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Unable to create an account with that email or student ID.' });
    next(error);
  }
});

router.post('/verify-email', otpLimit, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter a valid email and six-digit code.' });

  try {
    const user = await consumeOtp(email, 'registration', code, async (connection, otp) => {
      const payload = typeof otp.payload_json === 'string' ? JSON.parse(otp.payload_json) : otp.payload_json;
      if (!payload?.name || !payload?.passwordHash || !payload?.department || !payload?.studentId) {
        throw httpError(400, 'Registration details expired. Please sign up again.');
      }
      const [result] = await connection.execute(
        `INSERT INTO users (name, email, password, department, student_id, email_verified_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [payload.name, email, payload.passwordHash, payload.department, payload.studentId]
      );
      return { id: result.insertId, name: payload.name, email, role: 'student' };
    });
    await startSession(req, user);
    res.status(201).json({ user });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Unable to create an account with that email or student ID.' });
    next(error);
  }
});

router.post('/resend-code', otpLimit, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    const [rows] = await db.execute(
      `SELECT payload_json FROM email_otps WHERE email = ? AND purpose = 'registration'
       AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`,
      [email]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No pending signup was found. Submit the signup form again.' });
    const payload = typeof rows[0].payload_json === 'string' ? JSON.parse(rows[0].payload_json) : rows[0].payload_json;
    await issueOtp(email, 'registration', payload);
    res.json({ message: 'A new verification code was sent.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post('/forgot-password', passwordResetLimit, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    const [users] = await db.execute('SELECT id FROM users WHERE email = ? AND email_verified_at IS NOT NULL LIMIT 1', [email]);
    if (users[0]) await issueOtp(email, 'password_reset');
    res.status(202).json({ message: 'If a verified account matches that email, a reset code will be sent.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post('/reset-password', passwordResetLimit, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const password = String(req.body.password || '');
  if (!validEmail(email) || !/^\d{6}$/.test(code) || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Enter a valid email, six-digit code, and password with 8–72 UTF-8 bytes.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await consumeOtp(email, 'password_reset', code, async (connection) => {
      const [result] = await connection.execute(
        'UPDATE users SET password = ? WHERE email = ? AND email_verified_at IS NOT NULL',
        [passwordHash, email]
      );
      if (!result.affectedRows) throw httpError(400, 'The code is invalid or expired. Request a new code and try again.');
    });
    res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post('/login', loginLimit, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!validEmail(email) || !password || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Enter a valid email and password.' });
  }

  try {
    const [rows] = await db.execute(
      'SELECT id, name, email, password, role, is_banned, email_verified_at FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    if (user.is_banned) return res.status(403).json({ error: 'This account is suspended. Contact a platform administrator.' });
    if (!user.email_verified_at) return res.status(403).json({ error: 'Verify your email before signing in.' });

    await startSession(req, user);
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('campusshare.sid');
    res.sendStatus(204);
  });
});

router.get('/me', async (req, res, next) => {
  if (!req.session.userId) return res.json({ user: null });

  try {
    const [rows] = await db.execute(
      'SELECT id, name, email, role, is_banned, profile_pic_url, doner_points FROM users WHERE id = ? LIMIT 1',
      [req.session.userId]
    );
    if (!rows[0] || rows[0].is_banned) {
      req.session.destroy(() => {});
      return res.json({ user: null });
    }
    delete rows[0].is_banned;
    res.json({ user: rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;