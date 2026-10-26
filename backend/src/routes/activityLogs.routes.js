const router = require('express').Router();
const { query } = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const ApiError = require('../lib/errors');
const { authenticate, requirePermission } = require('../lib/auth.middleware');
const { logFromReq } = require('../lib/activityLog');

router.use(authenticate);

// GET /api/activity-logs?userId=&actionType=&entityType=&page=&pageSize=
router.get(
  '/',
  requirePermission('LOG_VIEW_ALL'),
  asyncHandler(async (req, res) => {
    const conditions = [];
    const values = [];
    const addFilter = (col, val) => {
      values.push(val);
      conditions.push(`al.${col} = $${values.length}`);
    };
    if (req.query.userId) addFilter('user_id', req.query.userId);
    if (req.query.actionType) addFilter('action_type', req.query.actionType);
    if (req.query.entityType) addFilter('entity_type', req.query.entityType);
    // Kullanıcı adı / e-posta araması: eşleşen kullanıcının username/email
    // alanlarında VEYA (kullanıcı bulunamayan başarısız giriş denemelerinde
    // olduğu gibi) details JSON'ındaki attemptedUsername içinde arar.
    if (req.query.username) {
      values.push('%' + req.query.username + '%');
      const idx = values.length;
      conditions.push(`(u.username ILIKE $${idx} OR u.email ILIKE $${idx} OR al.details ILIKE $${idx})`);
    }
    if (req.query.dateFrom) {
      values.push(req.query.dateFrom);
      conditions.push(`al.created_at >= $${values.length}`);
    }
    if (req.query.dateTo) {
      values.push(req.query.dateTo);
      conditions.push(`al.created_at <= $${values.length}`);
    }

    const pageSize = Math.min(Number(req.query.pageSize) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * pageSize;

    values.push(pageSize, offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT al.*, u.username, u.full_name FROM activity_logs al
       LEFT JOIN users u ON u.user_id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM activity_logs al
       LEFT JOIN users u ON u.user_id = al.user_id
       ${where}`,
      values.slice(0, values.length - 2)
    );

    res.json({ page, pageSize, total: countRows[0]?.total || 0, items: rows });
  })
);

// DELETE /api/activity-logs?userId=&actionType=&entityType=&username=&dateFrom=&dateTo=&confirmAll=
// Filtre parametreleriyle eşleşen log kayıtlarını siler. Hiç filtre
// verilmeden TÜM kayıtları silmek için ayrıca confirmAll=true şart —
// yanlışlıkla boş sorguyla her şeyin silinmesini önlemek için.
router.delete(
  '/',
  requirePermission('LOG_DELETE'),
  asyncHandler(async (req, res) => {
    const conditions = [];
    const values = [];
    const addFilter = (col, val) => {
      values.push(val);
      conditions.push(`${col} = $${values.length}`);
    };
    if (req.query.userId) addFilter('user_id', req.query.userId);
    if (req.query.actionType) addFilter('action_type', req.query.actionType);
    if (req.query.entityType) addFilter('entity_type', req.query.entityType);
    if (req.query.dateFrom) {
      values.push(req.query.dateFrom);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (req.query.dateTo) {
      values.push(req.query.dateTo);
      conditions.push(`created_at <= $${values.length}`);
    }
    // username filtresi users tablosuna bağlı olduğundan alt sorgu ile uygulanıyor.
    if (req.query.username) {
      values.push('%' + req.query.username + '%');
      const idx = values.length;
      conditions.push(
        `(user_id IN (SELECT user_id FROM users WHERE username ILIKE $${idx} OR email ILIKE $${idx}) OR details ILIKE $${idx})`
      );
    }

    if (!conditions.length && req.query.confirmAll !== 'true') {
      throw ApiError.badRequest(
        'Tüm log kayıtlarını silmek için confirmAll=true parametresi gereklidir.'
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rowCount } = await query(`DELETE FROM activity_logs ${where}`, values);

    // Silme işleminin kendisini de logluyoruz — aksi halde "logları kim,
    // ne zaman temizledi" bilgisi de silinen kayıtlarla birlikte kaybolur.
    await logFromReq(req, {
      actionType: 'LOG_PURGE',
      entityType: 'ActivityLog',
      details: { deletedCount: rowCount, filters: req.query },
    });

    res.json({ deletedCount: rowCount });
  })
);

module.exports = router;