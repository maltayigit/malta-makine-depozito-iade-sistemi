const router = require('express').Router();
const { query } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission } = require('../lib/auth.middleware');
const { logFromReq } = require('../lib/activityLog');

router.use(authenticate);

// GET /api/companies
router.get(
  '/',
  requirePermission('DASHBOARD_VIEW'),
  asyncHandler(async (req, res) => {
    // SUPER_ADMIN tüm firmaları görür; diğer roller sadece kendi firmasını görür.
    const isSuperAdmin = req.user.roleCode === 'SUPER_ADMIN';
    const { rows } = await query(
      `SELECT company_id, company_name, contact_person, phone, email, address, is_active, created_at
       FROM companies
       WHERE deleted_at IS NULL AND ($1::bool OR company_id = $2)
       ORDER BY company_name`,
      [isSuperAdmin, req.user.companyId]
    );
    res.json(rows);
  })
);

// GET /api/companies/:id
router.get(
  '/:id',
  requirePermission('DASHBOARD_VIEW'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT c.*, cs.low_fill_alert_threshold, cs.offline_alert_minutes,
              cs.notify_by_email, cs.notify_by_push
       FROM companies c
       LEFT JOIN company_settings cs ON cs.company_id = c.company_id
       WHERE c.company_id = $1 AND c.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Firma bulunamadı.');
    res.json(rows[0]);
  })
);

// POST /api/companies
router.post(
  '/',
  requirePermission('COMPANY_CREATE'),
  asyncHandler(async (req, res) => {
    const { companyName, contactPerson, phone, email, address } = req.body || {};
    if (!companyName) throw ApiError.badRequest('companyName gereklidir.');

    const { rows } = await query(
      `INSERT INTO companies (company_name, contact_person, phone, email, address)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [companyName, contactPerson || null, phone || null, email || null, address || null]
    );
    await query('INSERT INTO company_settings (company_id) VALUES ($1)', [rows[0].company_id]);
    await logFromReq(req, {
      actionType: 'COMPANY_CREATE',
      entityType: 'Company',
      entityId: rows[0].company_id,
      details: req.body,
    });
    res.status(201).json(rows[0]);
  })
);

// PATCH /api/companies/:id
router.patch(
  '/:id',
  requirePermission('COMPANY_EDIT'),
  asyncHandler(async (req, res) => {
    const fields = ['company_name', 'contact_person', 'phone', 'email', 'address', 'is_active'];
    const map = {
      companyName: 'company_name',
      contactPerson: 'contact_person',
      phone: 'phone',
      email: 'email',
      address: 'address',
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
    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    const { rows } = await query(
      `UPDATE companies SET ${sets.join(', ')} WHERE company_id = $${i} AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (!rows.length) throw ApiError.notFound('Firma bulunamadı.');
    await logFromReq(req, {
      actionType: 'COMPANY_EDIT',
      entityType: 'Company',
      entityId: req.params.id,
      details: req.body,
    });
    res.json(rows[0]);
  })
);

// DELETE /api/companies/:id  (soft delete)
router.delete(
  '/:id',
  requirePermission('COMPANY_DELETE'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE companies SET deleted_at = now(), is_active = FALSE
       WHERE company_id = $1 AND deleted_at IS NULL RETURNING company_id`,
      [req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Firma bulunamadı.');
    await logFromReq(req, { actionType: 'COMPANY_DELETE', entityType: 'Company', entityId: req.params.id });
    res.status(204).send();
  })
);

// PATCH /api/companies/:id/settings
router.patch(
  '/:id/settings',
  requirePermission('SETTINGS_MANAGE'),
  asyncHandler(async (req, res) => {
    const { lowFillAlertThreshold, offlineAlertMinutes, notifyByEmail, notifyByPush } = req.body || {};
    const { rows } = await query(
      `UPDATE company_settings SET
         low_fill_alert_threshold = COALESCE($1, low_fill_alert_threshold),
         offline_alert_minutes    = COALESCE($2, offline_alert_minutes),
         notify_by_email          = COALESCE($3, notify_by_email),
         notify_by_push           = COALESCE($4, notify_by_push),
         updated_at = now()
       WHERE company_id = $5 RETURNING *`,
      [lowFillAlertThreshold, offlineAlertMinutes, notifyByEmail, notifyByPush, req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Firma ayarı bulunamadı.');
    res.json(rows[0]);
  })
);

module.exports = router;
