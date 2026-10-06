const buckets = new Map();

function sweepBuckets() {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

const sweeper = setInterval(sweepBuckets, 60 * 1000);
sweeper.unref();

function clientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function subjectKey(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return email ? `${clientKey(req)}|${email}` : clientKey(req);
}

function rateLimit({ windowMs, max, scope, keyFor = clientKey, message }) {
  return (req, res, next) => {
    const key = `${scope}|${keyFor(req)}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retrySeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set('Retry-After', String(retrySeconds));
      const wait = retrySeconds < 60 ? `${retrySeconds} seconds` : `${Math.ceil(retrySeconds / 60)} minutes`;
      return res.status(429).json({ error: message || `Too many attempts. Try again in ${wait}.` });
    }
    return next();
  };
}

const registerLimit = rateLimit({
  scope: 'register',
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many signup attempts from this device. Try again in a few minutes.'
});

const otpLimit = rateLimit({
  scope: 'otp',
  windowMs: 10 * 60 * 1000,
  max: 12,
  keyFor: subjectKey,
  message: 'Too many verification attempts. Try again in a few minutes.'
});

const loginLimit = rateLimit({
  scope: 'login',
  windowMs: 10 * 60 * 1000,
  max: 15,
  keyFor: subjectKey,
  message: 'Too many sign-in attempts. Try again in a few minutes.'
});

const passwordResetLimit = rateLimit({
  scope: 'password_reset',
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyFor: subjectKey,
  message: 'Too many password reset attempts. Try again in a few minutes.'
});

module.exports = { loginLimit, otpLimit, passwordResetLimit, registerLimit };
