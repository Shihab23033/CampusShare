const express = require('express');
const db = require('../config/db');
const { requireStudent } = require('../middleware/authMiddleware');
const mailer = require('../config/mailer');

const router = express.Router();

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.post('/', requireStudent, async (req, res, next) => {
  const itemId = parseId(req.body.itemId);
  const pitch = String(req.body.needPitch || '').trim();
  if (!itemId || pitch.length < 10 || pitch.length > 2000) {
    return res.status(400).json({ error: 'Explain why you need this item in 10 to 2,000 characters.' });
  }

  let connection;
  let donorEmail;
  let itemTitle;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [items] = await connection.execute(
      `SELECT i.user_id, i.title AS item_title, u.name AS donor_name, u.email AS donor_email FROM items i JOIN users u ON u.id = i.user_id
       WHERE i.id = ? AND i.status = 'approved' AND u.is_banned = 0 FOR UPDATE`,
      [itemId]
    );
    if (!items[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'This item is not available.' });
    }
    donorEmail = items[0].donor_email;
    itemTitle = items[0].item_title;
    if (Number(items[0].user_id) === Number(req.session.userId)) {
      await connection.rollback();
      return res.status(409).json({ error: 'You cannot request your own listing.' });
    }

    const [result] = await connection.execute(
      'INSERT INTO requests (item_id, requester_id, need_pitch) VALUES (?, ?, ?)',
      [itemId, req.session.userId, pitch]
    );
    await connection.commit();
    await mailer.sendNotification(
      donorEmail,
      'New Need Pitch on CampusShare',
      `${req.session.name || 'A student'} sent a Need Pitch for "${itemTitle}". Sign in to review the request and reply.`
    );
    res.status(201).json({ request: { id: result.insertId, itemId, status: 'pending' } });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'You have already requested this item.' });
    next(error);
  } finally {
    connection?.release();
  }
});

router.get('/my-pitches', requireStudent, async (req, res, next) => {
  try {
    const [pitches] = await db.execute(
      `SELECT r.id, r.item_id, r.requester_id, r.need_pitch, r.status, r.created_at,
              i.title AS item_title, i.category AS item_category, i.status AS item_status,
              u.name AS requester_name, u.profile_pic_url AS requester_avatar
       FROM requests r JOIN items i ON i.id = r.item_id
       JOIN users u ON u.id = r.requester_id
       WHERE i.user_id = ? ORDER BY r.created_at DESC`,
      [req.session.userId]
    );
    res.json({ pitches });
  } catch (error) {
    next(error);
  }
});

router.get('/my-requests', requireStudent, async (req, res, next) => {
  try {
    const [requests] = await db.execute(
      `SELECT r.id, r.item_id, r.need_pitch, r.status, r.created_at,
              i.title AS item_title, i.status AS item_status,
              u.id AS donor_id, u.name AS donor_name,
              (SELECT image_url FROM item_images WHERE item_id = i.id ORDER BY is_cover DESC, id LIMIT 1) AS image_url
       FROM requests r JOIN items i ON i.id = r.item_id JOIN users u ON u.id = i.user_id
       WHERE r.requester_id = ? ORDER BY r.created_at DESC`,
      [req.session.userId]
    );
    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

router.get('/item/:itemId', requireStudent, async (req, res, next) => {
  const itemId = parseId(req.params.itemId);
  if (!itemId) return res.status(400).json({ error: 'Invalid item id.' });

  try {
    const [items] = await db.execute('SELECT id FROM items WHERE id = ? AND user_id = ? LIMIT 1', [itemId, req.session.userId]);
    if (!items[0]) return res.status(404).json({ error: 'Listing not found or not yours.' });
    const [requests] = await db.execute(
      `SELECT r.id, r.requester_id, r.need_pitch, r.status, r.created_at,
              u.name AS requester_name, u.profile_pic_url AS requester_avatar
       FROM requests r JOIN users u ON u.id = r.requester_id
       WHERE r.item_id = ? ORDER BY r.created_at DESC`,
      [itemId]
    );
    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

module.exports = router;