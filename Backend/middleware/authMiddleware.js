const db = require('../config/db');

async function requireStudent(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in as a student to continue.' });

  try {
    const [users] = await db.execute('SELECT role, is_banned FROM users WHERE id = ? LIMIT 1', [req.session.userId]);
    if (!users[0]) return res.status(401).json({ error: 'Please sign in as a student to continue.' });
    if (users[0].is_banned) {
      req.session.destroy(() => {});
      return res.status(403).json({ error: 'This account is suspended. Contact a platform administrator.' });
    }
    if (users[0].role !== 'student') return res.status(403).json({ error: 'This action is only available to students.' });
    req.session.role = users[0].role;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in to continue.' });

  try {
    const [users] = await db.execute('SELECT role, is_banned FROM users WHERE id = ? LIMIT 1', [req.session.userId]);
    if (!users[0] || users[0].role !== 'admin' || users[0].is_banned) {
      if (users[0]) req.session.role = users[0].role;
      return res.status(403).json({ error: 'Administrator access is required.' });
    }
    req.session.role = 'admin';
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireStudent, requireAdmin };