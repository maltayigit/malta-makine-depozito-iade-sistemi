const router = require('express').Router();
const { query } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission } = require('../lib/auth.middleware');
const { machineScopeClause, assertMachineInScope } = require('../lib/scope');
const { logFromReq } = require('../lib/activityLog');
const { notifyUsersForMachine } = require('../lib/notifications');

router.use(authenticate);

// GET /api/faults?status=&machineId=
router.get(
  '/',
  requirePermission('FAULT_VIEW'),
  asyncHandler(async (req, res) => {
    const { clause, params } = machineScopeClause(req.user, 1);
    const conditions = [clause];
    const values = [...params];

    if (req.query.status) {
      values.push(req.query.status);
      conditions.push(`fr.status = $${values.length}`);
    }
    if (req.query.machineId) {
      values.push(req.query.machineId);
      conditions.push(`fr.machine_id = $${values.length}`);
    }

    const { rows } = await query(
      `SELECT fr.*, m.machine_code, ru.full_name AS reported_by_name
       FROM fault_records fr
       JOIN machines m ON m.machine_id = fr.machine_id
       JOIN users ru ON ru.user_id = fr.reported_by_user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY fr.created_at DESC`,
      values
    );
    res.json(rows);
  })
);

// GET /api/faults/:id
router.get(
  '/:id',
  requirePermission('FAULT_VIEW'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT fr.*, m.machine_code FROM fault_records fr JOIN machines m ON m.machine_id = fr.machine_id
       WHERE fr.fault_id = $1`,
      [req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Arıza kaydı bulunamadı.');
    const { rows: attachments } = await query('SELECT * FROM fault_attachments WHERE fault_id = $1', [
      req.params.id,
    ]);
    res.json({ ...rows[0], attachments });
  })
);

// POST /api/faults  { machineId, faultDescription }
router.post(
  '/',
  requirePermission('FAULT_CREATE'),
  asyncHandler(async (req, res) => {
    const { machineId, faultDescription } = req.body || {};
    if (!machineId || !faultDescription) throw ApiError.badRequest('machineId ve faultDescription gereklidir.');
    await assertMachineInScope(req.user, machineId);

    const { rows } = await query(
      `INSERT INTO fault_records (machine_id, reported_by_user_id, fault_description)
       VALUES ($1,$2,$3) RETURNING *`,
      [machineId, req.user.userId, faultDescription]
    );
    await query('UPDATE machines SET is_faulty = TRUE WHERE machine_id = $1', [machineId]);

    await notifyUsersForMachine(machineId, {
      type: 'FAULT',
      title: 'Yeni Arıza Bildirimi',
      message: faultDescription,
      relatedEntityType: 'Fault',
      relatedEntityId: rows[0].fault_id,
    });

    await logFromReq(req, { actionType: 'FAULT_CREATE', entityType: 'Fault', entityId: rows[0].fault_id, details: req.body });
    res.status(201).json(rows[0]);
  })
);

// PATCH /api/faults/:id  { status }
router.patch(
  '/:id',
  requirePermission('FAULT_VIEW'),
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) {
      throw ApiError.badRequest("status 'OPEN', 'IN_PROGRESS' veya 'RESOLVED' olmalıdır.");
    }
    const resolvedFields = status === 'RESOLVED' ? ', resolved_by_user_id = $3, resolved_at = now()' : '';
    const params = status === 'RESOLVED' ? [status, req.params.id, req.user.userId] : [status, req.params.id];

    const { rows } = await query(
      `UPDATE fault_records SET status = $1 ${resolvedFields} WHERE fault_id = $2 RETURNING *`,
      params
    );
    if (!rows.length) throw ApiError.notFound('Arıza kaydı bulunamadı.');

    if (status === 'RESOLVED') {
      const { rows: openOthers } = await query(
        "SELECT 1 FROM fault_records WHERE machine_id = $1 AND status != 'RESOLVED' LIMIT 1",
        [rows[0].machine_id]
      );
      if (!openOthers.length) {
        await query('UPDATE machines SET is_faulty = FALSE WHERE machine_id = $1', [rows[0].machine_id]);
      }
    }

    await logFromReq(req, { actionType: 'FAULT_STATUS_UPDATE', entityType: 'Fault', entityId: req.params.id, details: { status } });
    res.json(rows[0]);
  })
);

// POST /api/faults/:id/attachments  { fileUrl, fileType }
router.post(
  '/:id/attachments',
  requirePermission('FAULT_CREATE'),
  asyncHandler(async (req, res) => {
    const { fileUrl, fileType } = req.body || {};
    if (!fileUrl) throw ApiError.badRequest('fileUrl gereklidir.');
    const { rows } = await query(
      `INSERT INTO fault_attachments (fault_id, file_url, file_type, uploaded_by_user_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, fileUrl, fileType || null, req.user.userId]
    );
    res.status(201).json(rows[0]);
  })
);

module.exports = router;
