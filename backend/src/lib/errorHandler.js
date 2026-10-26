const ApiError = require('./errors');

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: 'İstenen kaynak bulunamadı.', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
      details: err.details,
    });
  }

  // PostgreSQL kısıtlama (constraint) hataları için okunabilir dönüş.
  if (err.code === '23505') {
    return res.status(409).json({ error: 'UNIQUE_VIOLATION', message: 'Bu kayıt zaten mevcut.' });
  }
  if (err.code === '23503') {
    return res.status(409).json({ error: 'FOREIGN_KEY_VIOLATION', message: 'İlişkili kayıt bulunamadı veya kullanımda.' });
  }
  if (err.code === '23514' || err.code === '22P02') {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Gönderilen veri geçersiz.' });
  }

  console.error('[errorHandler] Beklenmeyen hata:', err);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Sunucuda beklenmeyen bir hata oluştu.' });
}

module.exports = { errorHandler, notFoundHandler };
