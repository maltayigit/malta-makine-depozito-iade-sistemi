require('dotenv').config();
const app = require('./app');
const { pool } = require('./db');

const PORT = process.env.PORT || 4000;

async function start() {
  // Erken uyarı: DB'ye bağlanılamıyorsa hemen bildir.
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('[server] Veritabanına bağlanılamadı:', err.message);
    console.error('[server] .env dosyanızdaki PG* değişkenlerini kontrol edin.');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`[server] Malta Makine backend API ${PORT} portunda çalışıyor.`);
  });

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} alındı, kapatılıyor...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
