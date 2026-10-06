const express = require('express');
const db = require('../config/db');
const { deleteImage, isConfigured, uploadImage } = require('../config/cloudinary');
const mailer = require('../config/mailer');
const { requireStudent } = require('../middleware/authMiddleware');
const { upload, validateImageFiles } = require('../middleware/uploadMiddleware');

const router = express.Router();
const allowedCategories = ['Books', 'Electronics', 'Furniture', 'Clothing', 'Lab equipment', 'Other'];
const itemSelect = `
  SELECT i.id, i.title, i.description, i.category, i.status, i.created_at,
         u.id AS donor_id, u.name AS donor_name, u.profile_pic_url AS donor_avatar,
         (SELECT image_url FROM item_images WHERE item_id = i.id ORDER BY is_cover DESC, id LIMIT 1) AS image_url
  FROM items i
  JOIN users u ON u.id = i.user_id`;

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cloudinaryPublicIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('cloudinary.com')) return null;
    const uploadPath = parsed.pathname.split('/upload/')[1];
    if (!uploadPath) return null;
    const segments = uploadPath.split('/');
    const version = segments[0].slice(1);
    if (segments[0][0] === 'v' && version && [...version].every((character) => character >= '0' && character <= '9')) {
      segments.shift();
    }
    const lastIndex = segments.length - 1;
    const extensionIndex = segments[lastIndex].lastIndexOf('.');
    if (extensionIndex >= 0) segments[lastIndex] = segments[lastIndex].slice(0, extensionIndex);
    return segments.join('/');
  } catch {
    return null;
  }
}

async function uploadFiles(files, folder) {
  const uploaded = [];
  try {
    for (const file of files) {
      const result = await uploadImage(file.buffer, folder);
      uploaded.push({ url: result.secure_url, publicId: result.public_id });
    }
    return uploaded;
  } catch (error) {
    await Promise.allSettled(uploaded.map((image) => deleteImage(image.publicId)));
    error.statusCode = 502;
    error.publicMessage = 'Photo upload failed. Check the Cloudinary settings and try again.';
    throw error;
  }
}

router.get('/', async (req, res, next) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const category = String(req.query.category || '').trim().slice(0, 50);
  const conditions = ["i.status = 'approved'", 'u.is_banned = 0'];
  const values = [];

  if (search) {
    conditions.push('(i.title LIKE ? OR i.description LIKE ?)');
    values.push(`%${search}%`, `%${search}%`);
  }
  if (category && category !== 'All') {
    if (!allowedCategories.includes(category)) return res.status(400).json({ error: 'Unknown category.' });
    conditions.push('i.category = ?');
    values.push(category);
  }

  try {
    const [items] = await db.execute(
      `${itemSelect} WHERE ${conditions.join(' AND ')} ORDER BY i.created_at DESC, i.id DESC LIMIT 60`,
      values
    );
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.get('/mine', requireStudent, async (req, res, next) => {
  try {
    const [items] = await db.execute(
      `SELECT i.id, i.title, i.description, i.category, i.status, i.created_at,
              (SELECT image_url FROM item_images WHERE item_id = i.id ORDER BY is_cover DESC, id LIMIT 1) AS image_url,
              (SELECT COUNT(*) FROM requests r WHERE r.item_id = i.id) AS request_count
       FROM items i WHERE i.user_id = ? ORDER BY i.created_at DESC`,
      [req.session.userId]
    );
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid item id.' });

  try {
    const [items] = await db.execute(
      `${itemSelect} WHERE i.id = ? AND u.is_banned = 0 AND (i.status = 'approved' OR i.user_id = ?) LIMIT 1`,
      [id, req.session.userId || 0]
    );
    if (!items[0]) return res.status(404).json({ error: 'This item is not available.' });

    const [images] = await db.execute(
      'SELECT id, image_url, is_cover FROM item_images WHERE item_id = ? ORDER BY is_cover DESC, id',
      [id]
    );
    res.json({
      item: {
        ...items[0],
        images: images.map((image) => image.image_url),
        imageData: images.map((image) => ({ id: image.id, url: image.image_url, isCover: image.is_cover === 1 }))
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', requireStudent, upload.array('images', 5), async (req, res, next) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const category = String(req.body.category || '').trim();
  const files = req.files || [];

  if (!title || title.length > 150 || !description || description.length > 5000 || !allowedCategories.includes(category)) {
    return res.status(400).json({ error: 'Add a title (up to 150 characters), description, and valid category.' });
  }
  if (files.length < 1 || files.length > 5) return res.status(400).json({ error: 'Add between 1 and 5 item photos.' });
  if (!(await validateImageFiles(files))) return res.status(400).json({ error: 'One or more files are not valid JPEG, PNG, or WebP images.' });
  if (!isConfigured()) return res.status(503).json({ error: 'Image uploads are not configured on this server.' });

  let images = [];
  let connection;
  try {
    images = await uploadFiles(files, 'campusshare/items');
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute(
      'INSERT INTO items (user_id, title, description, category) VALUES (?, ?, ?, ?)',
      [req.session.userId, title, description, category]
    );
    for (const [index, image] of images.entries()) {
      await connection.execute('INSERT INTO item_images (item_id, image_url, is_cover) VALUES (?, ?, ?)', [result.insertId, image.url, index === 0 ? 1 : 0]);
    }
    await connection.commit();
    res.status(201).json({ item: { id: result.insertId, title, status: 'pending' } });
  } catch (error) {
    if (connection) await connection.rollback();
    await Promise.allSettled(images.map((image) => deleteImage(image.publicId)));
    next(error);
  } finally {
    connection?.release();
  }
});

router.put('/:id', requireStudent, upload.array('images', 5), async (req, res, next) => {
  const itemId = parseId(req.params.id);
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const category = String(req.body.category || '').trim();
  const files = req.files || [];

  if (!itemId) return res.status(400).json({ error: 'Invalid item id.' });
  if (!title || title.length > 150 || !description || description.length > 5000 || !allowedCategories.includes(category)) {
    return res.status(400).json({ error: 'Add a title (up to 150 characters), description, and valid category.' });
  }
  if (files.length > 5) return res.status(400).json({ error: 'Choose no more than five photos.' });
  if (files.length && !(await validateImageFiles(files))) {
    return res.status(400).json({ error: 'One or more files are not valid JPEG, PNG, or WebP images.' });
  }
  if (files.length && !isConfigured()) {
    return res.status(503).json({ error: 'Image uploads are not configured on this server.' });
  }

  let connection;
  let uploadedImages = [];
  let oldPublicIds = [];
  try {
    const [ownedItems] = await db.execute('SELECT status FROM items WHERE id = ? AND user_id = ? LIMIT 1', [itemId, req.session.userId]);
    if (!ownedItems[0]) return res.status(404).json({ error: 'Listing not found or not yours.' });
    if (ownedItems[0].status === 'donated') return res.status(409).json({ error: 'Donated listings can no longer be edited.' });

    if (files.length) uploadedImages = await uploadFiles(files, 'campusshare/items');
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [items] = await connection.execute(
      'SELECT id, status FROM items WHERE id = ? AND user_id = ? FOR UPDATE',
      [itemId, req.session.userId]
    );
    if (!items[0]) {
      await connection.rollback();
      await Promise.allSettled(uploadedImages.map((image) => deleteImage(image.publicId)));
      return res.status(404).json({ error: 'Listing not found or not yours.' });
    }
    if (items[0].status === 'donated') {
      await connection.rollback();
      await Promise.allSettled(uploadedImages.map((image) => deleteImage(image.publicId)));
      return res.status(409).json({ error: 'Donated listings can no longer be edited.' });
    }

    if (files.length) {
      const [oldImages] = await connection.execute('SELECT image_url FROM item_images WHERE item_id = ?', [itemId]);
      oldPublicIds = oldImages.map((image) => cloudinaryPublicIdFromUrl(image.image_url)).filter(Boolean);
      await connection.execute('DELETE FROM item_images WHERE item_id = ?', [itemId]);
      for (const [index, image] of uploadedImages.entries()) {
        await connection.execute('INSERT INTO item_images (item_id, image_url, is_cover) VALUES (?, ?, ?)', [itemId, image.url, index === 0 ? 1 : 0]);
      }
    }

    await connection.execute(
      "UPDATE items SET title = ?, description = ?, category = ?, status = 'pending' WHERE id = ?",
      [title, description, category, itemId]
    );
    await connection.commit();
    await Promise.allSettled(oldPublicIds.map((publicId) => deleteImage(publicId)));
    res.json({ item: { id: itemId, title, status: 'pending', replacedPhotos: files.length > 0 } });
  } catch (error) {
    if (connection) await connection.rollback();
    await Promise.allSettled(uploadedImages.map((image) => deleteImage(image.publicId)));
    next(error);
  } finally {
    connection?.release();
  }
});

router.put('/:id/cover', requireStudent, async (req, res, next) => {
  const itemId = parseId(req.params.id);
  const imageId = parseId(req.body.imageId);
  if (!itemId || !imageId) return res.status(400).json({ error: 'Choose a photo to use as the cover.' });

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [items] = await connection.execute('SELECT status FROM items WHERE id = ? AND user_id = ? FOR UPDATE', [itemId, req.session.userId]);
    if (!items[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Listing not found or not yours.' });
    }
    if (items[0].status === 'donated') {
      await connection.rollback();
      return res.status(409).json({ error: 'Donated listings can no longer be edited.' });
    }

    const [images] = await connection.execute('SELECT id FROM item_images WHERE id = ? AND item_id = ? LIMIT 1', [imageId, itemId]);
    if (!images[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'That photo does not belong to this listing.' });
    }

    await connection.execute('UPDATE item_images SET is_cover = 0 WHERE item_id = ?', [itemId]);
    await connection.execute('UPDATE item_images SET is_cover = 1 WHERE id = ?', [imageId]);
    await connection.commit();
    res.json({ coverImageId: imageId });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.put('/:id/donated', requireStudent, async (req, res, next) => {
  const itemId = parseId(req.params.id);
  const requesterId = parseId(req.body.requesterId);
  if (!itemId || !requesterId) return res.status(400).json({ error: 'A valid item and requester are required.' });

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [items] = await connection.execute('SELECT id, status FROM items WHERE id = ? AND user_id = ? FOR UPDATE', [itemId, req.session.userId]);
    if (!items[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Listing not found or not yours.' });
    }
    if (items[0].status !== 'approved') {
      await connection.rollback();
      return res.status(409).json({ error: 'This listing is no longer available to donate.' });
    }

    const [requests] = await connection.execute(
      "SELECT id FROM requests WHERE item_id = ? AND requester_id = ? AND status = 'pending' FOR UPDATE",
      [itemId, requesterId]
    );
    if (!requests[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'No pending request exists for this student.' });
    }

    const [[itemSummary]] = await connection.execute(
      'SELECT title FROM items WHERE id = ? LIMIT 1',
      [itemId]
    );
    const [[winner]] = await connection.execute(
      `SELECT u.name, u.email FROM requests r JOIN users u ON u.id = r.requester_id
       WHERE r.id = ? LIMIT 1`,
      [requests[0].id]
    );
    const [otherRequesters] = await connection.execute(
      `SELECT u.name, u.email FROM requests r JOIN users u ON u.id = r.requester_id
       WHERE r.item_id = ? AND r.id <> ? AND r.status = 'pending'`,
      [itemId, requests[0].id]
    );

    await connection.execute("UPDATE requests SET status = 'accepted' WHERE id = ?", [requests[0].id]);
    await connection.execute("UPDATE requests SET status = 'declined' WHERE item_id = ? AND id <> ? AND status = 'pending'", [itemId, requests[0].id]);
    await connection.execute("UPDATE items SET status = 'donated' WHERE id = ?", [itemId]);
    await connection.execute('UPDATE users SET doner_points = doner_points + 1 WHERE id = ?', [req.session.userId]);
    await connection.commit();
    await Promise.all([
      mailer.sendNotification(winner?.email, 'Your CampusShare request was accepted', `Your Need Pitch for "${itemSummary.title}" was accepted. Sign in to arrange the handoff with the donor.`),
      ...otherRequesters.map((requester) => mailer.sendNotification(
        requester.email,
        'CampusShare item update',
        `The donor selected another student for "${itemSummary.title}". Thanks for participating.`
      ))
    ]);
    res.json({ status: 'donated', acceptedRequestId: requests[0].id });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

module.exports = router;