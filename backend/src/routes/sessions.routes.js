const router = require('express').Router();
const { query } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission } = require('../lib/auth.middleware');
const { logFromReq } = require('../lib/activityLog');

router.use(authenticate, requirePermission('LOG_VIEW_ALL'));

// GET /api/sessions/active?userId=&onlyOnline=
// Aktif oturum = revoked_at IS NULL AND expires_at > now() olan refresh token
// kaydı. is_online ayrıca, o oturuma ait access token'ın SON_GORULME_ESIGI
// içinde gerçekten kullanılıp kullanılmadığını gösterir (bkz. auth.middleware.js
// — her istekte last_seen_at güncellenir). onlyOnline=true verilirse sadece
// şu an gerçekten aktif olanlar (sekmesi açık, poll atıyor) döner.
const SON_GORULME_ESIGI_SANIYE = 60;

router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const conditions = ['rt.revoked_at IS NULL', 'rt.expires_at > now()'];
    const values = [];
    if (req.query.userId) {
      values.push(req.query.userId);
      conditions.push(`rt.user_id = $${values.length}`);
    }
    if (req.query.onlyOnline === 'true') {
      conditions.push(`rt.last_seen_at > now() - interval '${SON_GORULME_ESIGI_SANIYE} seconds'`);
    }

    const { rows } = await query(
      `SELECT rt.token_id, rt.user_id, u.username, u.full_name, r.role_code,
              rt.ip_address, rt.user_agent, rt.issued_at AS session_started_at,
              rt.expires_at, rt.last_seen_at,
              (rt.last_seen_at > now() - interval '${SON_GORULME_ESIGI_SANIYE} seconds') AS is_online
       FROM refresh_tokens rt
       JOIN users u ON u.user_id = rt.user_id
       JOIN roles r ON r.role_id = u.role_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY rt.last_seen_at DESC NULLS LAST`,
      values
    );

    res.json({ items: rows, total: rows.length });
  })
);

// DELETE /api/sessions?userId=&onlyOnline=&includeSelf=
// Filtreye uyan TÜM aktif oturumları toplu olarak sonlandırır (force logout).
// Kazara kendi oturumunu kilitlememek için, includeSelf=true verilmediği
// sürece isteği yapan yöneticinin kendi oturumu bu işlemin dışında tutulur.
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const conditions = ['rt.revoked_at IS NULL', 'rt.expires_at > now()'];
    const values = [];
    if (req.query.userId) {
      values.push(req.query.userId);
      conditions.push(`rt.user_id = $${values.length}`);
    }
    if (req.query.onlyOnline === 'true') {
      conditions.push(`rt.last_seen_at > now() - interval '${SON_GORULME_ESIGI_SANIYE} seconds'`);
    }
    if (req.query.includeSelf !== 'true' && req.user.sessionId) {
      values.push(req.user.sessionId);
      conditions.push(`rt.token_id <> $${values.length}`);
    }

    const { rows } = await query(
      `SELECT rt.token_id, rt.user_id FROM refresh_tokens rt
       WHERE ${conditions.join(' AND ')}`,
      values
    );

    if (!rows.length) {
      return res.json({ endedCount: 0 });
    }

    const tokenIds = rows.map((r) => r.token_id);
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_id = ANY($1::int[])', [
      tokenIds,
    ]);

    // Her sonlandırılan oturum için ayrı bir SESSION_FORCE_LOGOUT kaydı
    // atıyoruz — tek tek sonlandırmayla aynı iz bırakılsın diye.
    for (const session of rows) {
      await logFromReq(req, {
        actionType: 'SESSION_FORCE_LOGOUT',
        entityType: 'User',
        entityId: session.user_id,
        details: { targetUserId: session.user_id, bulk: true },
      });
    }

    res.json({ endedCount: rows.length });
  })
);

// DELETE /api/sessions/:tokenId -> oturumu zorla sonlandır (force logout)
router.delete(
  '/:tokenId',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT rt.user_id, rt.ip_address, r.role_code FROM refresh_tokens rt
       JOIN users u ON u.user_id = rt.user_id
       JOIN roles r ON r.role_id = u.role_id
       WHERE rt.token_id = $1 AND rt.revoked_at IS NULL`,
      [req.params.tokenId]
    );
    const session = rows[0];
    if (!session) throw ApiError.notFound('Aktif oturum bulunamadı.');

    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_id = $1', [
      req.params.tokenId,
    ]);

    await logFromReq(req, {
      actionType: 'SESSION_FORCE_LOGOUT',
      entityType: 'User',
      entityId: session.user_id,
      details: { targetUserId: session.user_id },
    });

    res.status(204).send();
  })
);

module.exports = router;