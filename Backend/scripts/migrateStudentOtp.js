require('dotenv').config();

const db = require('../config/db');

async function hasColumn(column) {
  const [rows] = await db.query('SHOW COLUMNS FROM users LIKE ?', [column]);
  return rows.length > 0;
}

async function migrateStudentOtp() {
  try {
    if (!(await hasColumn('department'))) {
      await db.query("ALTER TABLE users ADD COLUMN department VARCHAR(100) NOT NULL DEFAULT 'Unspecified'");
    }
    if (!(await hasColumn('student_id'))) {
      await db.query('ALTER TABLE users ADD COLUMN student_id VARCHAR(50) NULL');
    }
    if (!(await hasColumn('email_verified_at'))) {
      await db.query('ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL DEFAULT NULL');
    }

    await db.query("UPDATE users SET student_id = CONCAT('legacy-', id) WHERE student_id IS NULL OR student_id = ''");
    await db.query('UPDATE users SET email_verified_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE email_verified_at IS NULL');
    await db.query('ALTER TABLE users MODIFY student_id VARCHAR(50) NOT NULL');

    const [indexes] = await db.query("SHOW INDEX FROM users WHERE Key_name = 'uq_users_student_id'");
    if (!indexes.length) await db.query('CREATE UNIQUE INDEX uq_users_student_id ON users (student_id)');

    await db.query(`
      CREATE TABLE IF NOT EXISTS email_otps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(100) NOT NULL,
        purpose ENUM('registration', 'password_reset') NOT NULL,
        otp_hash CHAR(64) NOT NULL,
        payload_json JSON DEFAULT NULL,
        attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        consumed_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email_otps_lookup (email, purpose, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Student identity and email OTP migration complete. Existing users are treated as verified.');
  } finally {
    await db.end();
  }
}

migrateStudentOtp().catch((error) => {
  console.error('Student identity migration failed:', error.code || error.message);
  process.exitCode = 1;
});