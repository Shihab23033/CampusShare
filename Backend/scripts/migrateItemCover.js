require('dotenv').config();

const db = require('../config/db');

async function hasColumn(column) {
  const [rows] = await db.query('SHOW COLUMNS FROM item_images LIKE ?', [column]);
  return rows.length > 0;
}

async function migrateItemCover() {
  try {
    if (!(await hasColumn('is_cover'))) {
      await db.query('ALTER TABLE item_images ADD COLUMN is_cover TINYINT(1) NOT NULL DEFAULT 0');
    }

    const [indexes] = await db.query("SHOW INDEX FROM item_images WHERE Key_name = 'idx_item_images_item_cover'");
    if (!indexes.length) {
      await db.query('CREATE INDEX idx_item_images_item_cover ON item_images (item_id, is_cover)');
    }

    await db.query('UPDATE item_images SET is_cover = 0');
    await db.query(`
      UPDATE item_images ii
      JOIN (
        SELECT item_id, MIN(id) AS cover_id
        FROM item_images
        GROUP BY item_id
      ) first_image ON first_image.item_id = ii.item_id
      SET ii.is_cover = 1
      WHERE ii.id = first_image.cover_id
    `);

    const [covered] = await db.query('SELECT COUNT(*) AS total FROM item_images WHERE is_cover = 1');
    console.log(`Cover image migration complete. ${covered[0].total} listing cover(s) set.`);
  } finally {
    await db.end();
  }
}

migrateItemCover().catch((error) => {
  console.error('Cover image migration failed:', error.code || error.message);
  process.exitCode = 1;
});
