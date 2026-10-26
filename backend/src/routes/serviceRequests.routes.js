const router = require('express').Router();
const { query } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission } = require('../lib/auth.middleware');
const { machineScopeClause, assertMachineInScope } = require('../lib/scope');
const { logFromReq } = require('../lib/activityLog');
const { notifyUsersForMachine } = require('../lib/notifications');

router.use(authenticate);

// GET /api/service-requests?status=&machineId=
router.get(
  '/',
  requirePermission('SERVICE_REQUEST_CREATE'),
  asyncHandler(async (req, res) => {
    const { clause, params } = machineScopeClause(req.user, 1);
    const conditions = [clause];
    const values = [...params];
    if (req.query.status) {
      values.push(req.query.status);
      conditions.push(`sr.status = $${values.length}`);
    }
    if (req.query.machineId) {
      values.push(req.query.machineId);
      conditions.push(`sr.machine_id = $${values.length}`);
    }
    const { rows } = await query(
      `SELECT sr.*, m.machine_code FROM service_requests sr
       JOIN machines m ON m.machine_id = sr.machine_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY sr.created_at DESC`,
      values
    );
    res.json(rows);
  })
);

// POST /api/service-requests  { machineId, description }
router.post(
  '/',
  requirePermission('SERVICE_REQUEST_CREATE'),
  asyncHandler(async (req, res) => {
    const { machineId, description } = req.body || {};
    if (!machineId) throw ApiError.badRequest('machineId gereklidir.');
    await assertMachineInScope(req.user, machineId);

    const { rows } = await query(
      `INSERT INTO service_requests (machine_id, requested_by_user_id, description)
       VALUES ($1,$2,$3) RETURNING *`,
      [machineId, req.user.userId, description || null]
    );

    await notifyUsersForMachine(machineId, {
      type: 'SERVICE_REQUEST',
      title: 'Yeni Servis Talebi',
      message: description || 'Bir servis talebi oluşturuldu.',
      relatedEntityType: 'ServiceRequest',
      relatedEntityId: rows[0].service_request_id,
    });

    await logFromReq(req, {
      actionType: 'SERVICE_REQUEST_CREATE',
      entityType: 'ServiceRequest',
      entityId: rows[0].service_request_id,
      details: req.body,
    });
    res.status(201).json(rows[0]);
  })
);

// PATCH /api/service-requests/:id  { status }
router.patch(
  '/:id',
  requirePermission('SERVICE_REQUEST_COMPLETE'),
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['OPEN', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
      throw ApiError.badRequest("status 'OPEN', 'IN_PROGRESS' veya 'COMPLETED' olmalıdır.");
    }
    const extra = status === 'COMPLETED' ? ', completed_by_user_id = $3, completed_at = now()' : '';
    const params = status === 'COMPLETED' ? [status, req.params.id, req.user.userId] : [status, req.params.id];

    const { rows } = await query(
      `UPDATE service_requests SET status = $1 ${extra} WHERE service_request_id = $2 RETURNING *`,
      params
    );
    if (!rows.length) throw ApiError.notFound('Servis talebi bulunamadı.');
    await logFromReq(req, {
      actionType: 'SERVICE_REQUEST_STATUS_UPDATE',
      entityType: 'ServiceRequest',
      entityId: req.params.id,
      details: { status },
    });
    res.json(rows[0]);
  })
);

module.exports = router;
