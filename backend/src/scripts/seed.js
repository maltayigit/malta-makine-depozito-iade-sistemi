require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

async function run() {
  const client = await pool.connect();
  try {
    const username = process.env.SEED_SUPER_ADMIN_USERNAME || 'admin';
    const password = process.env.SEED_SUPER_ADMIN_PASSWORD || 'Degistir123!';
    const fullName = process.env.SEED_SUPER_ADMIN_FULLNAME || 'Sistem Yoneticisi';
    const email = process.env.SEED_SUPER_ADMIN_EMAIL || null;

    const { rows: existing } = await client.query(
      'SELECT user_id FROM users WHERE username = $1',
      [username]
    );
    if (existing.length) {
      console.log(`[seed] '${username}' kullanıcısı zaten mevcut, atlanıyor.`);
      return;
    }

    const { rows: roleRows } = await client.query(
      "SELECT role_id FROM roles WHERE role_code = 'SUPER_ADMIN'"
    );
    if (!roleRows.length) {
      throw new Error(
        "SUPER_ADMIN rolü bulunamadı. Önce 'npm run migrate' ile şemayı ve seed verilerini uygulayın."
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      `INSERT INTO users (username, password_hash, full_name, email, role_id, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [username, passwordHash, fullName, email, roleRows[0].role_id]
    );

    console.log('[seed] Super Admin kullanıcısı oluşturuldu:');
    console.log(`        kullanıcı adı: ${username}`);
    console.log(`        şifre        : ${password}  (ilk girişten sonra değiştirin!)`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[seed] Hata:', err.message);
  process.exit(1);
});
