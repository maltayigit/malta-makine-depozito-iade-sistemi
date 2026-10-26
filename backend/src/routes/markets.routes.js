const router = require('express').Router();
const { query } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission } = require('../lib/auth.middleware');
const { logFromReq } = require('../lib/activityLog');

router.use(authenticate);

function scopeClause(user, paramIndex) {
  if (user.roleCode === 'SUPER_ADMIN') return { clause: 'TRUE', params: [] };
  if (user.roleCode === 'COMPANY') return { clause: `mk.company_id = $${paramIndex}`, params: [user.companyId] };
  if (user.roleCode === 'MARKET') return { clause: `mk.market_id = $${paramIndex}`, params: [user.marketId] };
  return { clause: 'FALSE', params: [] };
}

// GET /api/markets
router.get(
  '/',
  requirePermission('DASHBOARD_VIEW'),
  asyncHandler(async (req, res) => {
    const { clause, params } = scopeClause(req.user, 1);
    const { rows } = await query(
      `SELECT mk.* FROM markets mk WHERE mk.deleted_at IS NULL AND (${clause}) ORDER BY mk.market_name`,
      params
    );
    res.json(rows);
  })
);

// GET /api/markets/:id
router.get(
  '/:id',
  requirePermission('DASHBOARD_VIEW'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(`SELECT * FROM markets WHERE market_id = $1 AND deleted_at IS NULL`, [
      req.params.id,
    ]);
    if (!rows.length) throw ApiError.notFound('Market bulunamadı.');
    res.json(rows[0]);
  })
);

// POST /api/markets
router.post(
  '/',
  requirePermission('MARKET_CREATE'),
  asyncHandler(async (req, res) => {
    const { companyId, marketName, address, latitude, longitude, contactPerson, phone } = req.body || {};
    if (!companyId || !marketName) throw ApiError.badRequest('companyId ve marketName gereklidir.');

    const { rows } = await query(
      `INSERT INTO markets (company_id, market_name, address, latitude, longitude, contact_person, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [companyId, marketName, address || null, latitude || null, longitude || null, contactPerson || null, phone || null]
    );
    await logFromReq(req, { actionType: 'MARKET_CREATE', entityType: 'Market', entityId: rows[0].market_id, details: req.body });
    res.status(201).json(rows[0]);
  })
);

// PATCH /api/markets/:id
router.patch(
  '/:id',
  requirePermission('MARKET_EDIT'),
  asyncHandler(async (req, res) => {
    const map = {
      marketName: 'market_name',
      address: 'address',
      latitude: 'latitude',
      longitude: 'longitude',
      contactPerson: 'contact_person',
      phone: 'phone',
      isActive: 'is_active',
    };
    const sets = [];
    const params = [];
    let i = 1;
    for (const [key, col] of Object.entries(map)) {
      if (req.body?.[key] !== undefined) {
        sets.push(`${col} = $${i++}`);
        params.push(req.body[key]);
      }
    }
    if (!sets.length) throw ApiError.badRequest('Güncellenecek alan yok.');
    sets.push('updated_at = now()');
    params.push(req.params.id);

    const { rows } = await query(
      `UPDATE markets SET ${sets.join(', ')} WHERE market_id = $${i} AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (!rows.length) throw ApiError.notFound('Market bulunamadı.');
    await logFromReq(req, { actionType: 'MARKET_EDIT', entityType: 'Market', entityId: req.params.id, details: req.body });
    res.json(rows[0]);
  })
);

// DELETE /api/markets/:id
router.delete(
  '/:id',
  requirePermission('MARKET_DELETE'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE markets SET deleted_at = now(), is_active = FALSE WHERE market_id = $1 AND deleted_at IS NULL RETURNING market_id`,
      [req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Market bulunamadı.');
    await logFromReq(req, { actionType: 'MARKET_DELETE', entityType: 'Market', entityId: req.params.id });
    res.status(204).send();
  })
);

module.exports = router;
