require('dotenv').config();

const db = require('../config/db');

async function promoteAdmin() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Usage: npm run admin:promote -- student@example.edu');
  }

  try {
    const [result] = await db.execute('UPDATE users SET role = \'admin\' WHERE email = ?', [email]);
    if (!result.affectedRows) throw new Error('No account exists for that email. Register the account first.');
    console.log(`Administrator access enabled for ${email}. Sign out and sign in again to refresh the session.`);
  } finally {
    await db.end();
  }
}

promoteAdmin().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});