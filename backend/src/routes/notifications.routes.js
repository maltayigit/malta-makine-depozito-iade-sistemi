const router = require('express').Router();
const { query } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission } = require('../lib/auth.middleware');

router.use(authenticate);

// GET /api/notifications?unreadOnly=true
router.get(
  '/',
  requirePermission('NOTIFICATION_VIEW'),
  asyncHandler(async (req, res) => {
    const conditions = ['user_id = $1'];
    const params = [req.user.userId];
    if (req.query.unreadOnly === 'true') conditions.push('is_read = FALSE');

    const { rows } = await query(
      `SELECT * FROM notifications WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json(rows);
  })
);

// PATCH /api/notifications/:id/read
router.patch(
  '/:id/read',
  requirePermission('NOTIFICATION_MANAGE'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE notifications SET is_read = TRUE, read_at = now()
       WHERE notification_id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.userId]
    );
    if (!rows.length) throw ApiError.notFound('Bildirim bulunamadı.');
    res.json(rows[0]);
  })
);

// PATCH /api/notifications/read-all
router.patch(
  '/read-all',
  requirePermission('NOTIFICATION_MANAGE'),
  asyncHandler(async (req, res) => {
    await query(`UPDATE notifications SET is_read = TRUE, read_at = now() WHERE user_id = $1 AND is_read = FALSE`, [
      req.user.userId,
    ]);
    res.status(204).send();
  })
);

module.exports = router;