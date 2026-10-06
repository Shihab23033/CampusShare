const express = require('express');
const db = require('../config/db');
const { requireAdmin } = require('../middleware/authMiddleware');
const mailer = require('../config/mailer');

const router = express.Router();

router.get('/analytics', requireAdmin, async (req, res, next) => {
  try {
    const [[itemCounts]] = await db.execute(
            `SELECT COUNT(*) AS totalItems,
              COALESCE(SUM(status = 'pending'), 0) AS pendingItems,
              COALESCE(SUM(status = 'approved'), 0) AS availableItems,
              COALESCE(SUM(status = 'rejected'), 0) AS rejectedItems,
              COALESCE(SUM(status = 'donated'), 0) AS donatedItems
       FROM items`
    );
    const [[userCounts]] = await db.execute(
      `SELECT COUNT(*) AS totalUsers, COALESCE(SUM(is_banned = 1), 0) AS bannedUsers
       FROM users WHERE role = 'student'`
    );
    const [[received]] = await db.execute(
      "SELECT COUNT(*) AS successfullyReceived FROM requests WHERE status = 'accepted'"
    );
    const [topRecipients] = await db.execute(
      `SELECT u.id, u.name, COUNT(*) AS received_count
       FROM requests r JOIN users u ON u.id = r.requester_id
       WHERE r.status = 'accepted' AND u.role = 'student'
       GROUP BY u.id, u.name ORDER BY received_count DESC, u.name ASC LIMIT 8`
    );
    res.json({ stats: { ...itemCounts, ...userCounts, ...received }, topRecipients });
  } catch (error) {
    next(error);
  }
});

router.get('/items', requireAdmin, async (req, res, next) => {
  const allowedStatuses = ['all', 'pending', 'approved', 'rejected', 'donated'];
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim().slice(0, 100);
  if (!allowedStatuses.includes(status)) return res.status(400).json({ error: 'Unknown item status.' });

  const conditions = [];
  const values = [];
  if (status !== 'all') {
    conditions.push('i.status = ?');
    values.push(status);
  }
  if (search) {
    conditions.push('(i.title LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  try {
    const [items] = await db.execute(
      `SELECT i.id, i.title, i.description, i.category, i.status, i.created_at,
              u.id AS donor_id, u.name AS donor_name, u.email AS donor_email, u.is_banned AS donor_banned,
              (SELECT image_url FROM item_images WHERE item_id = i.id ORDER BY is_cover DESC, id LIMIT 1) AS image_url
       FROM items i JOIN users u ON u.id = i.user_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY i.created_at DESC, i.id DESC LIMIT 200`,
      values
    );
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.get('/users', requireAdmin, async (req, res, next) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const banned = String(req.query.banned || 'all');
  if (!['all', 'banned', 'active'].includes(banned)) return res.status(400).json({ error: 'Unknown user status.' });

  const conditions = ["u.role = 'student'"];
  const values = [];
  if (banned === 'banned') conditions.push('u.is_banned = 1');
  if (banned === 'active') conditions.push('u.is_banned = 0');
  if (search) {
    conditions.push('(u.name LIKE ? OR u.email LIKE ?)');
    values.push(`%${search}%`, `%${search}%`);
  }

  try {
    const [users] = await db.execute(
      `SELECT u.id, u.name, u.email, u.is_banned, u.doner_points, u.created_at,
              (SELECT COUNT(*) FROM requests r WHERE r.requester_id = u.id AND r.status = 'accepted') AS received_count
       FROM users u WHERE ${conditions.join(' AND ')} ORDER BY u.created_at DESC LIMIT 200`,
      values
    );
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

router.put('/users/:id/ban', requireAdmin, async (req, res, next) => {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId < 1 || typeof req.body.banned !== 'boolean') {
    return res.status(400).json({ error: 'A valid student id and banned boolean are required.' });
  }
  if (userId === Number(req.session.userId)) return res.status(409).json({ error: 'You cannot ban your own account.' });

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [users] = await connection.execute('SELECT role FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!users[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Student account not found.' });
    }
    if (users[0].role !== 'student') {
      await connection.rollback();
      return res.status(409).json({ error: 'Administrator accounts cannot be banned here.' });
    }

    await connection.execute('UPDATE users SET is_banned = ? WHERE id = ?', [req.body.banned ? 1 : 0, userId]);
    if (req.body.banned) {
      await connection.execute(
        "UPDATE items SET status = 'rejected' WHERE user_id = ? AND status IN ('pending', 'approved')",
        [userId]
      );
      await connection.execute(
        `UPDATE requests r JOIN items i ON i.id = r.item_id
         SET r.status = 'declined' WHERE r.status = 'pending' AND (i.user_id = ? OR r.requester_id = ?)`,
        [userId, userId]
      );
    }
    await connection.commit();
    res.json({ user: { id: userId, is_banned: req.body.banned } });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.get('/pending-items', requireAdmin, async (req, res, next) => {
  try {
    const [items] = await db.execute(
      `SELECT i.id, i.title, i.description, i.category, i.created_at,
              u.name AS donor_name, u.email AS donor_email,
              (SELECT image_url FROM item_images WHERE item_id = i.id ORDER BY is_cover DESC, id LIMIT 1) AS image_url
       FROM items i JOIN users u ON u.id = i.user_id
       WHERE i.status = 'pending' ORDER BY i.created_at ASC LIMIT 100`
    );
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

async function moderate(req, res, next, status) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid item id.' });

  try {
    const [items] = await db.execute(
      `SELECT i.title, u.name AS donor_name, u.email AS donor_email
       FROM items i JOIN users u ON u.id = i.user_id WHERE i.id = ? LIMIT 1`,
      [id]
    );
    const [result] = await db.execute(
      "UPDATE items SET status = ? WHERE id = ? AND status = 'pending'",
      [status, id]
    );
    if (!result.affectedRows) return res.status(409).json({ error: 'This item is not pending review.' });
    if (items[0]) {
      const approved = status === 'approved';
      await mailer.sendNotification(
        items[0].donor_email,
        approved ? 'Your CampusShare listing was approved' : 'Your CampusShare listing was not approved',
        approved
          ? `Good news, ${items[0].donor_name}: "${items[0].title}" is approved and visible to students.`
          : `Your listing "${items[0].title}" was not approved. Sign in to review it and make changes before resubmitting.`
      );
    }
    res.json({ id, status });
  } catch (error) {
    next(error);
  }
}

router.put('/approve/:id', requireAdmin, (req, res, next) => moderate(req, res, next, 'approved'));
router.put('/reject/:id', requireAdmin, (req, res, next) => moderate(req, res, next, 'rejected'));

module.exports = router;