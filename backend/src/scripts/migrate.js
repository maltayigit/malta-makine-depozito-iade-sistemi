require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function run() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows: applied } = await client.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(applied.map((r) => r.filename));

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[migrate] atlanıyor (zaten uygulanmış): ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] uygulanıyor: ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] tamamlandı: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] HATA (${file}):`, err.message);
        throw err;
      }
    }
    console.log('[migrate] Tüm migrationlar tamam.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
