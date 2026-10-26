const { Pool } = require('pg');

const useUrl = !!process.env.DATABASE_URL;

const pool = new Pool(
  useUrl
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
      }
    : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
      }
);

pool.on('error', (err) => {
  // Havuzdaki boşta bir bağlantı beklenmedik şekilde koparsa süreci düşürmeyelim.
  console.error('[db] Beklenmeyen havuz hatası:', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Bir dizi işlemi tek bir transaction içinde çalıştırır.
 * fn(client) => Promise
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
