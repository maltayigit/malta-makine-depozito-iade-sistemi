const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission, requireRole } = require('../lib/auth.middleware');
const { logFromReq } = require('../lib/activityLog');

router.use(authenticate);

function scopeClause(user, paramIndex) {
  if (user.roleCode === 'SUPER_ADMIN') return { clause: 'TRUE', params: [] };
  if (user.roleCode === 'COMPANY') return { clause: `u.company_id = $${paramIndex}`, params: [user.companyId] };
  return { clause: 'FALSE', params: [] };
}

// GET /api/users
router.get(
  '/',
  requireRole('SUPER_ADMIN', 'COMPANY'),
  asyncHandler(async (req, res) => {
    const { clause, params } = scopeClause(req.user, 1);
    const { rows } = await query(
      `SELECT u.user_id, u.username, u.full_name, u.email, u.phone, u.is_active,
              u.company_id, u.market_id, u.last_login_at, u.created_at, r.role_code
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       WHERE u.deleted_at IS NULL AND (${clause})
       ORDER BY u.created_at DESC`,
      params
    );
    res.json(rows);
  })
);

// GET /api/users/:id
router.get(
  '/:id',
  requireRole('SUPER_ADMIN', 'COMPANY'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT u.user_id, u.username, u.full_name, u.email, u.phone, u.is_active,
              u.company_id, u.market_id, u.last_login_at, u.created_at, r.role_code, r.role_id
       FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = $1 AND u.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Kullanıcı bulunamadı.');
    res.json(rows[0]);
  })
);

// POST /api/users  (SUPER_ADMIN her rolü oluşturabilir; COMPANY sadece kendi firmasına
// MARKET veya SERVICE_PERSONNEL kullanıcısı oluşturabilir.)
router.post(
  '/',
  requireRole('SUPER_ADMIN', 'COMPANY'),
  asyncHandler(async (req, res) => {
    const { username, password, fullName, email, phone, roleCode, companyId, marketId } = req.body || {};
    if (!username || !password || !fullName || !roleCode) {
      throw ApiError.badRequest('username, password, fullName ve roleCode gereklidir.');
    }
    if (password.length < 8) throw ApiError.badRequest('Şifre en az 8 karakter olmalıdır.');

    let effectiveCompanyId = companyId || null;
    if (req.user.roleCode === 'COMPANY') {
      if (roleCode === 'SUPER_ADMIN' || roleCode === 'COMPANY') {
        throw ApiError.forbidden('Firma kullanıcısı sadece MARKET veya SERVICE_PERSONNEL oluşturabilir.');
      }
      effectiveCompanyId = req.user.companyId; // kendi firması dışına kullanıcı açamaz
    }

    const { rows: roleRows } = await query('SELECT role_id FROM roles WHERE role_code = $1', [roleCode]);
    if (!roleRows.length) throw ApiError.badRequest('Geçersiz roleCode.');

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows: existing } = await query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (existing.length) throw ApiError.conflict('Bu kullanıcı adı zaten kullanılıyor.');

    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, email, phone, role_id, company_id, market_id, password_changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       RETURNING user_id, username, full_name, email, phone, company_id, market_id, is_active, created_at`,
      [username, passwordHash, fullName, email || null, phone || null, roleRows[0].role_id, effectiveCompanyId, marketId || null]
    );
    await logFromReq(req, { actionType: 'USER_CREATE', entityType: 'User', entityId: rows[0].user_id, details: { username, roleCode } });
    res.status(201).json({ ...rows[0], roleCode });
  })
);

// PATCH /api/users/:id
router.patch(
  '/:id',
  requireRole('SUPER_ADMIN', 'COMPANY'),
  asyncHandler(async (req, res) => {
    const map = { fullName: 'full_name', email: 'email', phone: 'phone', isActive: 'is_active' };
    const sets = [];
    const params = [];
    let i = 1;
    for (const [key, col] of Object.entries(map)) {
      if (req.body?.[key] !== undefined) {
        sets.push(`${col} = $${i++}`);
        params.push(req.body[key]);
      }
    }

    if (req.body?.roleCode !== undefined) {
      const { roleCode } = req.body;
      if (req.user.roleCode === 'COMPANY' && (roleCode === 'SUPER_ADMIN' || roleCode === 'COMPANY')) {
        throw ApiError.forbidden('Firma kullanıcısı sadece MARKET veya SERVICE_PERSONNEL rolü atayabilir.');
      }

      const { rows: roleRows } = await query('SELECT role_id FROM roles WHERE role_code = $1', [roleCode]);
      if (!roleRows.length) throw ApiError.badRequest('Geçersiz roleCode.');

      // trg_validate_user_role_scope, role_id ile birlikte company_id/market_id'nin
      // tutarlı olmasını zorunlu kılıyor (ör. MARKET -> ikisi de dolu olmalı).
      // Body'de verilmediyse mevcut değerleri fallback olarak kullanıyoruz.
      const { rows: mevcut } = await query('SELECT company_id, market_id FROM users WHERE user_id = $1', [req.params.id]);
      if (!mevcut.length) throw ApiError.notFound('Kullanıcı bulunamadı.');

      let companyId = req.body.companyId !== undefined ? req.body.companyId : mevcut[0].company_id;
      let marketId = req.body.marketId !== undefined ? req.body.marketId : mevcut[0].market_id;

      if (roleCode === 'SUPER_ADMIN') {
        companyId = null;
        marketId = null;
      } else if (roleCode === 'COMPANY') {
        if (!companyId) throw ApiError.badRequest('COMPANY rolü için bir firma seçilmelidir.');
        marketId = null;
      } else if (roleCode === 'MARKET') {
        if (!companyId) throw ApiError.badRequest('MARKET rolü için bir firma seçilmelidir.');
        if (!marketId) throw ApiError.badRequest('MARKET rolü için bir market/mağaza seçilmelidir.');
      } else if (roleCode === 'SERVICE_PERSONNEL') {
        if (!companyId) throw ApiError.badRequest('SERVICE_PERSONNEL rolü için bir firma seçilmelidir.');
      }

      sets.push(`role_id = $${i++}`);
      params.push(roleRows[0].role_id);
      sets.push(`company_id = $${i++}`);
      params.push(companyId);
      sets.push(`market_id = $${i++}`);
      params.push(marketId);
    } else {
      // roleCode değişmiyor ama company_id/market_id ayrı güncellenmek istenirse.
      if (req.body?.companyId !== undefined) { sets.push(`company_id = $${i++}`); params.push(req.body.companyId); }
      if (req.body?.marketId !== undefined) { sets.push(`market_id = $${i++}`); params.push(req.body.marketId); }
    }

    if (!sets.length) throw ApiError.badRequest('Güncellenecek alan yok.');
    sets.push('updated_at = now()');
    params.push(req.params.id);

    const { rows } = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE user_id = $${i} AND deleted_at IS NULL
       RETURNING user_id, username, full_name, email, phone, is_active, company_id, market_id`,
      params
    );
    if (!rows.length) throw ApiError.notFound('Kullanıcı bulunamadı.');
    await logFromReq(req, { actionType: 'USER_EDIT', entityType: 'User', entityId: req.params.id, details: req.body });
    res.json(rows[0]);
  })
);

// POST /api/users/:id/reset-password  (yönetici tarafından zorla sıfırlama)
router.post(
  '/:id/reset-password',
  requireRole('SUPER_ADMIN', 'COMPANY'),
  asyncHandler(async (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 8) {
      throw ApiError.badRequest('newPassword en az 8 karakter olmalıdır.');
    }
    const hash = await bcrypt.hash(newPassword, 12);
    const { rows } = await query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, password_changed_at = now(),
                        failed_login_attempts = 0, locked_until = NULL
       WHERE user_id = $2 AND deleted_at IS NULL RETURNING user_id`,
      [hash, req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Kullanıcı bulunamadı.');
    await logFromReq(req, { actionType: 'USER_PASSWORD_RESET', entityType: 'User', entityId: req.params.id });
    res.status(204).send();
  })
);

// DELETE /api/users/:id
router.delete(
  '/:id',
  requireRole('SUPER_ADMIN', 'COMPANY'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE users SET deleted_at = now(), is_active = FALSE WHERE user_id = $1 AND deleted_at IS NULL RETURNING user_id`,
      [req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Kullanıcı bulunamadı.');
    await logFromReq(req, { actionType: 'USER_DELETE', entityType: 'User', entityId: req.params.id });
    res.status(204).send();
  })
);

/* ── Servis personeli ↔ makine ataması ────────────────────────────── */

// GET /api/users/:id/machines
router.get(
  '/:id/machines',
  requirePermission('MACHINE_ASSIGN'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT spm.id, spm.machine_id, m.machine_code, spm.assigned_at
       FROM service_personnel_machines spm
       JOIN machines m ON m.machine_id = spm.machine_id
       WHERE spm.user_id = $1`,
      [req.params.id]
    );
    res.json(rows);
  })
);

// POST /api/users/:id/machines  { machineId }
router.post(
  '/:id/machines',
  requirePermission('MACHINE_ASSIGN'),
  asyncHandler(async (req, res) => {
    const { machineId } = req.body || {};
    if (!machineId) throw ApiError.badRequest('machineId gereklidir.');
    const { rows } = await query(
      `INSERT INTO service_personnel_machines (user_id, machine_id, assigned_by_user_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, machine_id) DO NOTHING
       RETURNING *`,
      [req.params.id, machineId, req.user.userId]
    );
    await logFromReq(req, { actionType: 'MACHINE_ASSIGN', entityType: 'User', entityId: req.params.id, details: { machineId } });
    res.status(201).json(rows[0] || { message: 'Atama zaten mevcuttu.' });
  })
);

// DELETE /api/users/:id/machines/:machineId
router.delete(
  '/:id/machines/:machineId',
  requirePermission('MACHINE_ASSIGN'),
  asyncHandler(async (req, res) => {
    await query('DELETE FROM service_personnel_machines WHERE user_id = $1 AND machine_id = $2', [
      req.params.id,
      req.params.machineId,
    ]);
    await logFromReq(req, {
      actionType: 'MACHINE_UNASSIGN',
      entityType: 'User',
      entityId: req.params.id,
      details: { machineId: req.params.machineId },
    });
    res.status(204).send();
  })
);

/* ── Kullanıcıya özel yetki istisnası (override) ─────────────────── */

// POST /api/users/:id/permissions  { permissionCode, isGranted, note }
router.post(
  '/:id/permissions',
  requirePermission('USER_PERMISSION_OVERRIDE'),
  asyncHandler(async (req, res) => {
    const { permissionCode, isGranted = true, note } = req.body || {};
    if (!permissionCode) throw ApiError.badRequest('permissionCode gereklidir.');

    const { rows: permRows } = await query('SELECT permission_id FROM permissions WHERE permission_code = $1', [
      permissionCode,
    ]);
    if (!permRows.length) throw ApiError.badRequest('Geçersiz permissionCode.');

    const { rows } = await query(
      `INSERT INTO user_permissions (user_id, permission_id, is_granted, granted_by_user_id, note)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, permission_id) DO UPDATE SET is_granted = $3, note = $5, granted_at = now()
       RETURNING *`,
      [req.params.id, permRows[0].permission_id, isGranted, req.user.userId, note || null]
    );
    await logFromReq(req, {
      actionType: 'USER_PERMISSION_OVERRIDE',
      entityType: 'User',
      entityId: req.params.id,
      details: { permissionCode, isGranted },
    });
    res.status(201).json(rows[0]);
  })
);

module.exports = router;