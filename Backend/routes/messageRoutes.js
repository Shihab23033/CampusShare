const express = require('express');
const db = require('../config/db');
const { requireStudent } = require('../middleware/authMiddleware');

const router = express.Router();

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function getConversation(requestId, userId) {
  const [rows] = await db.execute(
        `SELECT r.id, r.status, i.user_id AS donor_id, r.requester_id,
          donor.is_banned AS donor_banned, requester.is_banned AS requester_banned
         FROM requests r JOIN items i ON i.id = r.item_id
         JOIN users donor ON donor.id = i.user_id
         JOIN users requester ON requester.id = r.requester_id
         WHERE r.id = ? LIMIT 1`,
    [requestId]
  );
  const conversation = rows[0];
  if (conversation?.donor_banned || conversation?.requester_banned) return null;
  if (!conversation || Number(conversation.donor_id) === Number(userId) && Number(conversation.requester_id) === Number(userId)) return null;
  if (!conversation || (Number(conversation.donor_id) !== Number(userId) && Number(conversation.requester_id) !== Number(userId))) return null;
  if (conversation.status === 'declined') return null;
  return conversation;
}

router.get('/threads/my-threads', requireStudent, async (req, res, next) => {
  try {
    const [threads] = await db.execute(
      `SELECT r.id AS request_id, r.status AS request_status, r.created_at,
              i.id AS item_id, i.title AS item_title,
              donor.id AS donor_id, donor.name AS donor_name, donor.profile_pic_url AS donor_avatar,
              requester.id AS requester_id, requester.name AS requester_name, requester.profile_pic_url AS requester_avatar,
              (SELECT message_text FROM messages m WHERE m.request_id = r.id ORDER BY m.id DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages m WHERE m.request_id = r.id ORDER BY m.id DESC LIMIT 1) AS last_message_at
       FROM requests r JOIN items i ON i.id = r.item_id
       JOIN users donor ON donor.id = i.user_id
       JOIN users requester ON requester.id = r.requester_id
       WHERE (i.user_id = ? OR r.requester_id = ?) AND r.status <> 'declined'
         AND donor.is_banned = 0 AND requester.is_banned = 0
       ORDER BY COALESCE(last_message_at, r.created_at) DESC LIMIT 100`,
      [req.session.userId, req.session.userId]
    );
    res.json({ threads });
  } catch (error) {
    next(error);
  }
});

router.get('/:requestId', requireStudent, async (req, res, next) => {
  const requestId = parseId(req.params.requestId);
  if (!requestId) return res.status(400).json({ error: 'Invalid conversation id.' });

  try {
    const conversation = await getConversation(requestId, req.session.userId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });

    const afterId = req.query.afterId === undefined ? null : parseId(req.query.afterId);
    if (req.query.afterId !== undefined && !afterId) return res.status(400).json({ error: 'Invalid message cursor.' });
    let messages;
    if (afterId) {
      [messages] = await db.execute(
        `SELECT m.id, m.sender_id, m.message_text, m.created_at, u.name AS sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.request_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 100`,
        [requestId, afterId]
      );
    } else {
      [messages] = await db.execute(
        `SELECT recent.id, recent.sender_id, recent.message_text, recent.created_at, recent.sender_name
         FROM (SELECT m.id, m.sender_id, m.message_text, m.created_at, u.name AS sender_name
               FROM messages m JOIN users u ON u.id = m.sender_id
               WHERE m.request_id = ? ORDER BY m.id DESC LIMIT 100) recent ORDER BY recent.id ASC`,
        [requestId]
      );
    }
    res.json({ messages, requestStatus: conversation.status });
  } catch (error) {
    next(error);
  }
});

router.post('/', requireStudent, async (req, res, next) => {
  const requestId = parseId(req.body.requestId);
  const message = String(req.body.message || '').trim();
  if (!requestId || !message || message.length > 2000) {
    return res.status(400).json({ error: 'Message must be 1 to 2,000 characters.' });
  }

  try {
    const [result] = await db.execute(
      `INSERT INTO messages (request_id, sender_id, message_text)
       SELECT r.id, ?, ? FROM requests r JOIN items i ON i.id = r.item_id
       JOIN users donor ON donor.id = i.user_id JOIN users requester ON requester.id = r.requester_id
       WHERE r.id = ? AND r.status <> 'declined' AND donor.is_banned = 0 AND requester.is_banned = 0
         AND (i.user_id = ? OR r.requester_id = ?)`,
      [req.session.userId, message, requestId, req.session.userId, req.session.userId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Conversation not found.' });
    res.status(201).json({ message: { id: result.insertId, sender_id: req.session.userId, message_text: message } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;