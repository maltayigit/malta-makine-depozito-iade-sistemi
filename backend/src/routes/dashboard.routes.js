const router = require('express').Router();
const { query } = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission } = require('../lib/auth.middleware');
const { machineScopeClause } = require('../lib/scope');

router.use(authenticate, requirePermission('DASHBOARD_VIEW'));

// GET /api/dashboard/summary
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { clause, params } = machineScopeClause(req.user, 1);

    const [machineStats, faultStats, serviceStats, avgFill] = await Promise.all([
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE m.status = 'ACTIVE') AS active,
           COUNT(*) FILTER (WHERE m.online_status = 'ONLINE') AS online,
           COUNT(*) FILTER (WHERE m.is_faulty) AS faulty
         FROM machines m WHERE m.deleted_at IS NULL AND (${clause})`,
        params
      ),
      query(
        `SELECT COUNT(*) FILTER (WHERE fr.status = 'OPEN') AS open,
                COUNT(*) FILTER (WHERE fr.status = 'IN_PROGRESS') AS in_progress,
                COUNT(*) FILTER (WHERE fr.status = 'RESOLVED' AND fr.resolved_at > now() - interval '30 days') AS resolved_last_30d
         FROM fault_records fr
         JOIN machines m ON m.machine_id = fr.machine_id
         WHERE (${clause})`,
        params
      ),
      query(
        `SELECT COUNT(*) FILTER (WHERE sr.status != 'COMPLETED') AS open
         FROM service_requests sr
         JOIN machines m ON m.machine_id = sr.machine_id
         WHERE (${clause})`,
        params
      ),
      query(
        `SELECT mc.compartment_code, AVG(mc.fill_percent) AS avg_fill
         FROM machine_compartments mc
         JOIN machines m ON m.machine_id = mc.machine_id
         WHERE m.deleted_at IS NULL AND (${clause})
         GROUP BY mc.compartment_code`,
        params
      ),
    ]);

    res.json({
      machines: machineStats.rows[0],
      faults: faultStats.rows[0],
      serviceRequests: serviceStats.rows[0],
      averageFillByCompartment: avgFill.rows,
    });
  })
);

// GET /api/dashboard/critical-machines — kritik doluluk veya arızalı makineler
router.get(
  '/critical-machines',
  asyncHandler(async (req, res) => {
    const { clause, params } = machineScopeClause(req.user, 1);
    const { rows } = await query(
      `SELECT DISTINCT m.machine_id, m.machine_code, m.is_faulty, m.online_status,
              mc.compartment_code, mc.fill_percent
       FROM machines m
       JOIN machine_compartments mc ON mc.machine_id = m.machine_id
       WHERE m.deleted_at IS NULL AND (${clause})
         AND (m.is_faulty OR mc.fill_percent >= mc.critical_threshold OR m.online_status = 'OFFLINE')
       ORDER BY m.machine_code`,
      params
    );
    res.json(rows);
  })
);

module.exports = router;
