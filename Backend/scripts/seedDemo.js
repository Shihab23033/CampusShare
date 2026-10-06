require('dotenv').config();

const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');
const db = require('../config/db');

const demoEmail = process.env.DEMO_USER_EMAIL || 'demo.student@campusshare.test';
const demoName = 'CampusShare Demo';
const demoPassword = process.env.DEMO_USER_PASSWORD || randomBytes(18).toString('base64url');

const demoItems = [
  {
    title: 'Calculus: Early Transcendentals',
    category: 'Books',
    description: 'A well-kept calculus textbook with a few pencil notes in the margins. Useful for first-year math courses.',
    image: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=900&q=80'
  },
  {
    title: 'USB-C hub with HDMI',
    category: 'Electronics',
    description: 'Six-port USB-C hub with HDMI and USB-A ports. Works well; I upgraded to a dock.',
    image: 'https://images.unsplash.com/photo-1625842268584-8f3296236761?auto=format&fit=crop&w=900&q=80'
  },
  {
    title: 'Small study desk lamp',
    category: 'Furniture',
    description: 'Adjustable LED desk lamp with a warm light setting. Great for a dorm desk or late study sessions.',
    image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=80'
  },
  {
    title: 'Lab coat, size medium',
    category: 'Lab equipment',
    description: 'Clean, lightly used lab coat. Medium size with two front pockets; freshly laundered.',
    image: 'https://images.unsplash.com/photo-1582719471384-894fbb16e074?auto=format&fit=crop&w=900&q=80'
  },
  {
    title: 'Warm winter jacket',
    category: 'Clothing',
    description: 'A comfortable insulated jacket in good condition. Passing it on because it no longer fits.',
    image: 'https://images.unsplash.com/photo-1544923246-77307dd654cb?auto=format&fit=crop&w=900&q=80'
  }
];

async function seedDemo() {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const passwordHash = await bcrypt.hash(demoPassword, 12);
    const [users] = await connection.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [demoEmail]
    );

    let demoUserId;
    if (users[0]) {
      demoUserId = users[0].id;
      await connection.execute(
        `UPDATE users SET name = ?, password = ?, bio = ?, role = 'student', doner_points = 4,
                department = 'Student Affairs', student_id = COALESCE(student_id, CONCAT('DEMO-', id)),
                email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP())
         WHERE id = ?`,
        [demoName, passwordHash, 'Sharing useful things with fellow students. Happy to pass them along!', demoUserId]
      );
    } else {
      const [result] = await connection.execute(
        `INSERT INTO users (name, email, password, department, student_id, bio, doner_points, email_verified_at)
         VALUES (?, ?, ?, 'Student Affairs', ?, ?, 4, UTC_TIMESTAMP())`,
        [demoName, demoEmail, passwordHash, `DEMO-${randomBytes(4).toString('hex').toUpperCase()}`,
          'Sharing useful things with fellow students. Happy to pass them along!']
      );
      demoUserId = result.insertId;
    }

    for (const item of demoItems) {
      const [existingItems] = await connection.execute(
        'SELECT id FROM items WHERE user_id = ? AND title = ? LIMIT 1',
        [demoUserId, item.title]
      );
      let itemId;

      if (existingItems[0]) {
        itemId = existingItems[0].id;
        await connection.execute(
          'UPDATE items SET description = ?, category = ?, status = \'approved\' WHERE id = ?',
          [item.description, item.category, itemId]
        );
      } else {
        const [result] = await connection.execute(
          'INSERT INTO items (user_id, title, description, category, status) VALUES (?, ?, ?, ?, \'approved\')',
          [demoUserId, item.title, item.description, item.category]
        );
        itemId = result.insertId;
      }

      await connection.execute('DELETE FROM item_images WHERE item_id = ?', [itemId]);
      await connection.execute(
        'INSERT INTO item_images (item_id, image_url) VALUES (?, ?)',
        [itemId, item.image]
      );
    }

    await connection.commit();
    console.log('Demo data is ready.');
    console.log(`Email: ${demoEmail}`);
    console.log(`Password: ${demoPassword}`);
    console.log(`Approved listings: ${demoItems.length}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await db.end();
  }
}

seedDemo().catch((error) => {
  console.error('Could not seed demo data:', error.code || error.message);
  process.exitCode = 1;
});