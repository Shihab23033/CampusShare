const express = require('express');
const db = require('../config/db');
const { deleteImage, isConfigured, uploadImage } = require('../config/cloudinary');
const { requireStudent } = require('../middleware/authMiddleware');
const { upload, validateImageFiles } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.get('/profile', requireStudent, async (req, res, next) => {
  try {
    const [users] = await db.execute(
      'SELECT id, name, email, department, student_id, profile_pic_url, phone, bio, doner_points, created_at FROM users WHERE id = ? LIMIT 1',
      [req.session.userId]
    );
    if (!users[0]) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ profile: users[0] });
  } catch (error) {
    next(error);
  }
});

router.put('/profile', requireStudent, async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const department = String(req.body.department || '').trim();
  const phone = String(req.body.phone || '').trim();
  const bio = String(req.body.bio || '').trim();
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Name must be 2 to 100 characters.' });
  if (department.length < 2 || department.length > 100) return res.status(400).json({ error: 'Department must be 2 to 100 characters.' });
  if (phone.length > 20 || (phone && !/^[0-9+(). -]+$/.test(phone))) {
    return res.status(400).json({ error: 'Enter a valid phone number, up to 20 characters.' });
  }
  if (bio.length > 1000) return res.status(400).json({ error: 'Bio must be 1,000 characters or fewer.' });

  try {
    await db.execute('UPDATE users SET name = ?, department = ?, phone = ?, bio = ? WHERE id = ?', [name, department, phone, bio || null, req.session.userId]);
    res.json({ profile: { name, department, phone, bio } });
  } catch (error) {
    next(error);
  }
});

router.post('/avatar', requireStudent, upload.single('avatar'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP avatar.' });
  if (!(await validateImageFiles([req.file]))) return res.status(400).json({ error: 'Avatar content does not match a supported image type.' });
  if (!isConfigured()) return res.status(503).json({ error: 'Image uploads are not configured on this server.' });

  try {
    let image;
    try {
      image = await uploadImage(req.file.buffer, 'campusshare/avatars');
    } catch (error) {
      error.statusCode = 502;
      error.publicMessage = 'Profile photo upload failed. Check the Cloudinary settings and try again.';
      throw error;
    }
    try {
      await db.execute('UPDATE users SET profile_pic_url = ? WHERE id = ?', [image.secure_url, req.session.userId]);
    } catch (error) {
      await deleteImage(image.public_id);
      throw error;
    }
    res.json({ profilePicUrl: image.secure_url });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid profile id.' });

  try {
    const [users] = await db.execute(
      `SELECT u.id, u.name, u.department, u.profile_pic_url, u.bio, u.doner_points, u.created_at,
              (SELECT COUNT(*) FROM items i WHERE i.user_id = u.id AND i.status = 'donated') AS donated_count
      FROM users u WHERE u.id = ? AND u.is_banned = 0 LIMIT 1`,
      [id]
    );
    if (!users[0]) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ profile: users[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;