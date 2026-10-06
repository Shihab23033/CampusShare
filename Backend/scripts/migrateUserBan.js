require('dotenv').config();

const db = require('../config/db');

async function migrateUserBan() {
  try {
    const [columns] = await db.query("SHOW COLUMNS FROM users LIKE 'is_banned'");
    if (columns.length) {
      console.log('User ban migration already applied.');
      return;
    }

    await db.query('ALTER TABLE users ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0');
    console.log('User ban migration applied.');
  } finally {
    await db.end();
  }
}

migrateUserBan().catch((error) => {
  console.error('User ban migration failed:', error.code || error.message);
  process.exitCode = 1;
});