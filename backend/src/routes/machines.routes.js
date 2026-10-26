const router = require('express').Router();
const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission } = require('../lib/auth.middleware');
const { machineScopeClause, assertMachineInScope } = require('../lib/scope');
const { logFromReq } = require('../lib/activityLog');

router.use(authenticate);

// Yeni makinede varsayılan olarak açılan doluluk bölmeleri (doluluk-veri.js ile birebir).
const DEFAULT_COMPARTMENTS = [
  { code: 'plastik', name: 'Plastik Atık', unit: 'adet', capacity: 6000 },
  { code: 'teneke', name: 'Teneke / Alüminyum', unit: 'adet', capacity: 8000 },
  { code: 'cam', name: 'Cam Atık', unit: 'adet', capacity: 250 },
  { code: 'atiksu', name: 'Atık Su Tankı', unit: 'litre', capacity: 750 },
];

// Yeni makinede varsayılan olarak açılan işleme üniteleri (ezme-veri.js ile birebir).
const DEFAULT_UNITS = [
  { code: 'ezme1_05l', name: '1. Plastik Ezme Ünitesi (0.5L)' },
  { code: 'ezme1_13l', name: '1. Plastik Ezme Ünitesi (1-3L)' },
  { code: 'ezme2_05l', name: '2. Plastik Ezme Ünitesi (0.5L)' },
  { code: 'ezme2_13l', name: '2. Plastik Ezme Ünitesi (1-3L)' },
  { code: 'ezme3', name: 'Teneke Ezme Ünitesi' },
  { code: 'camKirma', name: '1. Cam Kırma Ünitesi' },
  { code: 'camKirma2', name: '2. Cam Kırma Ünitesi' },
  { code: 'suKaristirma', name: 'Atık Su Karıştırma Ünitesi' },
  { code: 'atikSuPompa', name: 'Atık Su Pompa Ünitesi' },
];

// Varsayılan 4 ekran (ekran-veri.js ile birebir).
const DEFAULT_SCREENS = [
  { code: 'ekran1', name: '1. Tablet - Ana Panel' },
  { code: 'ekran2', name: '2. Tablet' },
  { code: 'ekran3', name: '3. Tablet' },
  { code: 'ekran4', name: '4. Tablet' },
];

async function provisionMachineDefaults(client, machineId) {
  for (const c of DEFAULT_COMPARTMENTS) {
    await client.query(
      `INSERT INTO machine_compartments (machine_id, compartment_code, display_name, unit, capacity)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (machine_id, compartment_code) DO NOTHING`,
      [machineId, c.code, c.name, c.unit, c.capacity]
    );
  }
  for (const u of DEFAULT_UNITS) {
    await client.query(
      `INSERT INTO machine_units (machine_id, unit_code, display_name)
       VALUES ($1,$2,$3) ON CONFLICT (machine_id, unit_code) DO NOTHING`,
      [machineId, u.code, u.name]
    );
  }
  for (const s of DEFAULT_SCREENS) {
    await client.query(
      `INSERT INTO machine_screens (machine_id, screen_code, display_name)
       VALUES ($1,$2,$3) ON CONFLICT (machine_id, screen_code) DO NOTHING`,
      [machineId, s.code, s.name]
    );
  }
  for (const covNo of Array.from({ length: 10 }, (_, i) => i + 1)) {
    await client.query(
      `INSERT INTO machine_covers (machine_id, cover_number) VALUES ($1,$2)
       ON CONFLICT (machine_id, cover_number) DO NOTHING`,
      [machineId, covNo]
    );
  }
  await client.query(
    `INSERT INTO machine_power_state (machine_id, is_powered_on) VALUES ($1, FALSE)
     ON CONFLICT (machine_id) DO NOTHING`,
    [machineId]
  );
}

// GET /api/machines
router.get(
  '/',
  requirePermission('MACHINE_VIEW_OWN'),
  asyncHandler(async (req, res) => {
    const { clause, params } = machineScopeClause(req.user, 1);
    const { rows } = await query(
      `SELECT m.machine_id, m.machine_code, m.company_id, m.market_id, m.status, m.online_status,
              m.fill_level, m.is_faulty, m.firmware_version, m.last_seen_at, m.installed_at,
              m.display_name, m.summary_notes, m.owner_user_id, m.panel_page,
              c.company_name, mk.market_name, ou.email AS owner_email, ou.full_name AS owner_full_name,
              tech.user_id AS technician_user_id, tech.full_name AS technician_full_name,
              COALESCE(ps.is_powered_on, FALSE) AS is_powered_on
       FROM machines m
       JOIN companies c ON c.company_id = m.company_id
       LEFT JOIN markets mk ON mk.market_id = m.market_id
       LEFT JOIN users ou ON ou.user_id = m.owner_user_id
       LEFT JOIN machine_power_state ps ON ps.machine_id = m.machine_id
       LEFT JOIN LATERAL (
         SELECT u.user_id, u.full_name
         FROM service_personnel_machines spm
         JOIN users u ON u.user_id = spm.user_id
         WHERE spm.machine_id = m.machine_id
         ORDER BY spm.assigned_at ASC
         LIMIT 1
       ) tech ON TRUE
       WHERE m.deleted_at IS NULL AND (${clause})
       ORDER BY m.created_at DESC`,
      params
    );
    res.json(rows);
  })
);

// GET /api/machines/:id  (bölme/ünite/ekran/kapak durumlarıyla birlikte tam görünüm)
router.get(
  '/:id',
  requirePermission('MACHINE_VIEW_OWN'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);

    const [machine, compartments, units, screens, covers, power] = await Promise.all([
      query(
        `SELECT m.*, c.company_name, mk.market_name FROM machines m
         JOIN companies c ON c.company_id = m.company_id
         LEFT JOIN markets mk ON mk.market_id = m.market_id
         WHERE m.machine_id = $1`,
        [req.params.id]
      ),
      query('SELECT * FROM machine_compartments WHERE machine_id = $1 ORDER BY compartment_id', [req.params.id]),
      query('SELECT * FROM machine_units WHERE machine_id = $1 ORDER BY unit_id', [req.params.id]),
      query('SELECT * FROM machine_screens WHERE machine_id = $1 ORDER BY screen_id', [req.params.id]),
      query('SELECT * FROM machine_covers WHERE machine_id = $1 ORDER BY cover_number', [req.params.id]),
      query('SELECT * FROM machine_power_state WHERE machine_id = $1', [req.params.id]),
    ]);

    if (!machine.rows.length) throw ApiError.notFound('Makine bulunamadı.');

    res.json({
      ...machine.rows[0],
      compartments: compartments.rows,
      units: units.rows,
      screens: screens.rows,
      covers: covers.rows,
      power: power.rows[0] || null,
    });
  })
);

// POST /api/machines
router.post(
  '/',
  requirePermission('MACHINE_CREATE'),
  asyncHandler(async (req, res) => {
    const {
      machineCode, marketId, latitude, longitude, firmwareVersion,
      displayName, summaryNotes, ownerUserId, panelPage, technicianUserId,
    } = req.body || {};
    // COMPANY rolündeki kullanıcılar kendi firmalarının dışında makine oluşturamaz;
    // companyId gövdede gelmezse otomatik olarak kendi firmasına atanır.
    // SUPER_ADMIN için companyId gövdede zorunludur.
    const companyId = req.user.roleCode === 'SUPER_ADMIN'
      ? (req.body || {}).companyId
      : req.user.companyId;
    if (!machineCode || !companyId) throw ApiError.badRequest('machineCode ve companyId gereklidir.');

    const apiKey = crypto.randomBytes(16).toString('hex');
    const apiSecret = crypto.randomBytes(32).toString('hex');
    const apiSecretHash = crypto.createHash('sha256').update(apiSecret).digest('hex');

    const machine = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO machines (machine_code, company_id, market_id, latitude, longitude, firmware_version,
                                display_name, summary_notes, owner_user_id, panel_page,
                                device_api_key, device_api_secret_hash, device_key_rotated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
         RETURNING *`,
        [machineCode, companyId, marketId || null, latitude || null, longitude || null, firmwareVersion || null,
         displayName || null, summaryNotes || null, ownerUserId || null, panelPage || 'index.html',
         apiKey, apiSecretHash]
      );
      await provisionMachineDefaults(client, rows[0].machine_id);
      // Sorumlu teknisyen ataması — gerçek RBAC ilişkisi (service_personnel_machines),
      // serbest metin yerine SERVICE_PERSONNEL rolündeki bir kullanıcıya bağlanır.
      if (technicianUserId) {
        await client.query(
          `INSERT INTO service_personnel_machines (user_id, machine_id, assigned_by_user_id)
           VALUES ($1,$2,$3) ON CONFLICT (user_id, machine_id) DO NOTHING`,
          [technicianUserId, rows[0].machine_id, req.user.userId]
        );
      }
      return rows[0];
    });

    await logFromReq(req, { actionType: 'MACHINE_CREATE', entityType: 'Machine', entityId: machine.machine_id, details: req.body });

    // apiSecret sadece oluşturma anında bir kez gösterilir; sunucu sadece hash'ini saklar.
    res.status(201).json({ ...machine, deviceApiSecret: apiSecret });
  })
);

// PATCH /api/machines/:id
router.patch(
  '/:id',
  requirePermission('MACHINE_EDIT'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const map = {
      marketId: 'market_id',
      latitude: 'latitude',
      longitude: 'longitude',
      firmwareVersion: 'firmware_version',
      displayName: 'display_name',
      summaryNotes: 'summary_notes',
      ownerUserId: 'owner_user_id',
      panelPage: 'panel_page',
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

    // Sorumlu teknisyen ataması, machines tablosunda değil ayrı bir ilişki
    // tablosunda (service_personnel_machines) tutuluyor; bu yüzden genel
    // UPDATE'ten bağımsız olarak işlenir. technicianUserId gövdede
    // gelmemişse (undefined) hiç dokunulmaz; null/'' gelirse atama kaldırılır.
    if (req.body?.technicianUserId !== undefined) {
      await withTransaction(async (client) => {
        await client.query('DELETE FROM service_personnel_machines WHERE machine_id = $1', [req.params.id]);
        if (req.body.technicianUserId) {
          await client.query(
            `INSERT INTO service_personnel_machines (user_id, machine_id, assigned_by_user_id)
             VALUES ($1,$2,$3) ON CONFLICT (user_id, machine_id) DO NOTHING`,
            [req.body.technicianUserId, req.params.id, req.user.userId]
          );
        }
      });
    }

    if (!sets.length) {
      if (req.body?.technicianUserId !== undefined) {
        await logFromReq(req, { actionType: 'MACHINE_EDIT', entityType: 'Machine', entityId: req.params.id, details: req.body });
        const { rows } = await query('SELECT * FROM machines WHERE machine_id = $1 AND deleted_at IS NULL', [req.params.id]);
        if (!rows.length) throw ApiError.notFound('Makine bulunamadı.');
        return res.json(rows[0]);
      }
      throw ApiError.badRequest('Güncellenecek alan yok.');
    }
    sets.push('updated_at = now()');
    params.push(req.params.id);

    const { rows } = await query(
      `UPDATE machines SET ${sets.join(', ')} WHERE machine_id = $${i} AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (!rows.length) throw ApiError.notFound('Makine bulunamadı.');
    await logFromReq(req, { actionType: 'MACHINE_EDIT', entityType: 'Machine', entityId: req.params.id, details: req.body });
    res.json(rows[0]);
  })
);

// PATCH /api/machines/:id/status  { status: 'ACTIVE' | 'PASSIVE' }
router.patch(
  '/:id/status',
  requirePermission('MACHINE_ACTIVATE'),
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['ACTIVE', 'PASSIVE'].includes(status)) throw ApiError.badRequest("status 'ACTIVE' veya 'PASSIVE' olmalıdır.");
    await assertMachineInScope(req.user, req.params.id);

    const { rows } = await query(
      `UPDATE machines SET status = $1, updated_at = now() WHERE machine_id = $2 AND deleted_at IS NULL RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Makine bulunamadı.');
    await logFromReq(req, { actionType: 'MACHINE_ACTIVATE', entityType: 'Machine', entityId: req.params.id, details: { status } });
    res.json(rows[0]);
  })
);

// POST /api/machines/:id/restart
router.post(
  '/:id/restart',
  requirePermission('MACHINE_RESTART'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query(
      `INSERT INTO device_commands (machine_id, command_type, requested_by_user_id)
       VALUES ($1, 'RESTART', $2) RETURNING *`,
      [req.params.id, req.user.userId]
    );
    await logFromReq(req, { actionType: 'MACHINE_RESTART', entityType: 'Machine', entityId: req.params.id });
    res.status(202).json(rows[0]);
  })
);

// DELETE /api/machines/:id
router.delete(
  '/:id',
  requirePermission('MACHINE_DELETE'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE machines SET deleted_at = now(), status = 'PASSIVE' WHERE machine_id = $1 AND deleted_at IS NULL RETURNING machine_id`,
      [req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Makine bulunamadı.');
    await logFromReq(req, { actionType: 'MACHINE_DELETE', entityType: 'Machine', entityId: req.params.id });
    res.status(204).send();
  })
);

module.exports = router;
// Varsayılan bölme/ünite/ekran listeleri, backfill script'i ve olası testler
// tarafından tek bir kaynaktan (buradan) okunabilsin diye router nesnesine
// de iliştirildi. app.js'deki `app.use('/api/machines', machinesRoutes)`
// kullanımını etkilemez; router hâlâ doğrudan export ediliyor.
module.exports.DEFAULT_COMPARTMENTS = DEFAULT_COMPARTMENTS;
module.exports.DEFAULT_UNITS = DEFAULT_UNITS;
module.exports.DEFAULT_SCREENS = DEFAULT_SCREENS;