const router = require('express').Router();
const { query, withTransaction } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requirePermission } = require('../lib/auth.middleware');
const { assertMachineInScope } = require('../lib/scope');
const { logFromReq } = require('../lib/activityLog');
const { notifyUsersForMachine } = require('../lib/notifications');

router.use(authenticate);

/* =====================================================================
   DOLULUK BÖLMELERİ  (machine_compartments)
   Frontend karşılığı: doluluk-veri.js
   ===================================================================== */

// GET /api/machines/:id/compartments
router.get(
  '/:id/compartments',
  requirePermission('FILL_LEVEL_VIEW'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query(
      'SELECT * FROM machine_compartments WHERE machine_id = $1 ORDER BY compartment_id',
      [req.params.id]
    );
    res.json(rows);
  })
);

// GET /api/machines/:id/doluluk  — doluluk-veri.js'in beklediği kısayol şekli:
// { plastik: 12, teneke: 4, cam: 88, atiksu: 30 }
router.get(
  '/:id/doluluk',
  requirePermission('FILL_LEVEL_VIEW'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query(
      'SELECT compartment_code, fill_percent FROM machine_compartments WHERE machine_id = $1',
      [req.params.id]
    );
    const out = {};
    rows.forEach((r) => (out[r.compartment_code] = Number(r.fill_percent)));
    res.json(out);
  })
);

// PATCH /api/machines/:id/compartments/:code  { fillPercent }  — cihazdan / manuel güncelleme
router.patch(
  '/:id/compartments/:code',
  requirePermission('DEVICE_COMMAND_SEND'),
  asyncHandler(async (req, res) => {
    const { fillPercent } = req.body || {};
    if (fillPercent === undefined || fillPercent < 0 || fillPercent > 100) {
      throw ApiError.badRequest('fillPercent 0-100 arasında bir sayı olmalıdır.');
    }
    await assertMachineInScope(req.user, req.params.id);

    const { rows } = await query(
      `UPDATE machine_compartments SET fill_percent = $1, updated_at = now()
       WHERE machine_id = $2 AND compartment_code = $3 RETURNING *`,
      [fillPercent, req.params.id, req.params.code]
    );
    if (!rows.length) throw ApiError.notFound('Bölme bulunamadı.');
    const compartment = rows[0];

    // Kritik eşik -> bildirim. Otomatik kapanma eşiği -> makineyi kapat.
    if (Number(fillPercent) >= Number(compartment.critical_threshold)) {
      await notifyUsersForMachine(req.params.id, {
        type: 'LOW_FILL',
        title: 'Kritik Doluluk Uyarısı',
        message: `${compartment.display_name} bölmesi %${fillPercent} doluluğa ulaştı.`,
        relatedEntityType: 'MachineCompartment',
        relatedEntityId: compartment.compartment_id,
      });
    }
    if (Number(fillPercent) >= Number(compartment.auto_shutdown_threshold)) {
      await query(
        `UPDATE machine_power_state SET is_powered_on = FALSE,
                power_blocked_reason = $1, updated_at = now()
         WHERE machine_id = $2`,
        [`${compartment.display_name} bölmesi %${compartment.auto_shutdown_threshold} eşiğine ulaştı.`, req.params.id]
      );
      await query(
        `UPDATE machine_units SET is_running = FALSE, last_stopped_at = now()
         WHERE machine_id = $1`,
        [req.params.id]
      );
    }

    await logFromReq(req, {
      actionType: 'COMPARTMENT_FILL_UPDATE',
      entityType: 'MachineCompartment',
      entityId: compartment.compartment_id,
      details: { code: req.params.code, fillPercent },
    });
    res.json(compartment);
  })
);

// POST /api/machines/:id/compartments/:code/empty  — bölmeyi boşalt
router.post(
  '/:id/compartments/:code/empty',
  requirePermission('DEVICE_COMMAND_SEND'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query(
      `UPDATE machine_compartments SET fill_percent = 0, last_emptied_at = now(), updated_at = now()
       WHERE machine_id = $1 AND compartment_code = $2 RETURNING *`,
      [req.params.id, req.params.code]
    );
    if (!rows.length) throw ApiError.notFound('Bölme bulunamadı.');

    // Boşalttıktan sonra o makinede kapanmaya sebep olan başka dolu bölme yoksa engeli kaldır.
    const { rows: stillFull } = await query(
      `SELECT 1 FROM machine_compartments
       WHERE machine_id = $1 AND fill_percent >= auto_shutdown_threshold LIMIT 1`,
      [req.params.id]
    );
    if (!stillFull.length) {
      await query(
        `UPDATE machine_power_state SET power_blocked_reason = NULL, updated_at = now() WHERE machine_id = $1`,
        [req.params.id]
      );
    }

    await logFromReq(req, {
      actionType: 'COMPARTMENT_EMPTY',
      entityType: 'MachineCompartment',
      entityId: rows[0].compartment_id,
      details: { code: req.params.code },
    });
    res.json(rows[0]);
  })
);

/* =====================================================================
   İŞLEME ÜNİTELERİ  (machine_units)
   Frontend karşılığı: ezme-veri.js, cam-kirma.html, su-karistirma.html
   ===================================================================== */

// GET /api/machines/:id/units
router.get(
  '/:id/units',
  requirePermission('MACHINE_VIEW_OWN'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query('SELECT * FROM machine_units WHERE machine_id = $1 ORDER BY unit_id', [
      req.params.id,
    ]);
    res.json(rows);
  })
);

// PATCH /api/machines/:id/units/:code  { isRunning?, isJammed? }
router.patch(
  '/:id/units/:code',
  requirePermission('DEVICE_COMMAND_SEND'),
  asyncHandler(async (req, res) => {
    const { isRunning, isJammed } = req.body || {};
    await assertMachineInScope(req.user, req.params.id);

    // Ana makine kapalıyken hiçbir ünite çalıştırılamaz (index.html mantığıyla tutarlı).
    if (isRunning === true) {
      const { rows: powerRows } = await query('SELECT is_powered_on FROM machine_power_state WHERE machine_id = $1', [
        req.params.id,
      ]);
      if (!powerRows.length || !powerRows[0].is_powered_on) {
        throw ApiError.conflict('Ana makine kapalıyken ünite başlatılamaz.');
      }
    }

    const sets = [];
    const params = [];
    let i = 1;
    if (isRunning !== undefined) {
      sets.push(`is_running = $${i++}`, isRunning ? `last_started_at = now()` : `last_stopped_at = now()`);
      params.push(isRunning);
      if (isRunning) sets.push('cycle_count = cycle_count + 1');
    }
    if (isJammed !== undefined) {
      sets.push(`is_jammed = $${i++}`);
      params.push(isJammed);
    }
    if (!sets.length) throw ApiError.badRequest('Güncellenecek alan yok.');
    params.push(req.params.id, req.params.code);

    const { rows } = await query(
      `UPDATE machine_units SET ${sets.join(', ')}, updated_at = now()
       WHERE machine_id = $${i++} AND unit_code = $${i} RETURNING *`,
      params
    );
    if (!rows.length) throw ApiError.notFound('Ünite bulunamadı.');

    if (isJammed === true) {
      await notifyUsersForMachine(req.params.id, {
        type: 'FAULT',
        title: 'Ünite Sıkışması',
        message: `${rows[0].display_name} sıkışma bildirdi.`,
        relatedEntityType: 'MachineUnit',
        relatedEntityId: rows[0].unit_id,
      });
    }

    // Sıkışma giderildiğinde, bu üniteye ait açık arıza kayıtlarını da burada
    // (backend'de) otomatik olarak kapatıyoruz. fault_records tablosunda
    // ünitenin kendisine bir foreign key yok (yalnızca serbest metin
    // fault_description var), bu yüzden acilDurumAlarmVer'in yazdığı
    // "<ünite adı>: <mesaj>" formatına göre eşleştiriyoruz.
    //
    // ÖNEMLİ: Bundan önce bu kapatma işlemi SADECE frontend'de, sıkışmayı
    // gideren tarayıcının localStorage'ındaki kayıt üzerinden yapılıyordu
    // (bkz. acil-durum-veri.js -> acilDurumGiderKaynak). Arıza farklı bir
    // cihaz/oturumdan bildirilmişse ya da localStorage silinmişse hiçbir
    // zaman kapanmıyordu ve panel sonsuza dek "arızalı" göstermeye devam
    // ediyordu. Artık kaynağında (backend) kapatıldığı için hangi cihazın
    // sıkışmayı giderdiğinden bağımsız olarak doğru çalışır.
    if (isJammed === false) {
      const { rows: resolvedFaults } = await query(
        `UPDATE fault_records SET status = 'RESOLVED', resolved_by_user_id = $1, resolved_at = now()
         WHERE machine_id = $2 AND status != 'RESOLVED' AND fault_description LIKE $3
         RETURNING fault_id`,
        [req.user.userId, req.params.id, `${rows[0].display_name}:%`]
      );
      if (resolvedFaults.length) {
        const { rows: openOthers } = await query(
          "SELECT 1 FROM fault_records WHERE machine_id = $1 AND status != 'RESOLVED' LIMIT 1",
          [req.params.id]
        );
        if (!openOthers.length) {
          await query('UPDATE machines SET is_faulty = FALSE WHERE machine_id = $1', [req.params.id]);
        }
      }
    }

    await logFromReq(req, {
      actionType: 'UNIT_STATE_UPDATE',
      entityType: 'MachineUnit',
      entityId: rows[0].unit_id,
      details: { code: req.params.code, isRunning, isJammed },
    });
    res.json(rows[0]);
  })
);

/* =====================================================================
   ANA MAKİNE GÜÇ DURUMU  (machine_power_state)
   Frontend karşılığı: index.html "makineAcik"
   ===================================================================== */

// GET /api/machines/:id/power
router.get(
  '/:id/power',
  requirePermission('MACHINE_VIEW_OWN'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query('SELECT * FROM machine_power_state WHERE machine_id = $1', [req.params.id]);
    res.json(rows[0] || { machine_id: req.params.id, is_powered_on: false });
  })
);

// PATCH /api/machines/:id/power  { isPoweredOn }
router.patch(
  '/:id/power',
  requirePermission('DEVICE_COMMAND_SEND'),
  asyncHandler(async (req, res) => {
    const { isPoweredOn } = req.body || {};
    if (typeof isPoweredOn !== 'boolean') throw ApiError.badRequest('isPoweredOn boolean olmalıdır.');
    await assertMachineInScope(req.user, req.params.id);

    if (isPoweredOn) {
      // doluluk-veri.js'teki dolulukMakineAcmaEngelliMi() ile aynı kural:
      // otomatik kapanma eşiğine ulaşmış bölme varsa açılış engellenir.
      const { rows: blocking } = await query(
        `SELECT compartment_code, display_name, fill_percent FROM machine_compartments
         WHERE machine_id = $1 AND fill_percent >= auto_shutdown_threshold`,
        [req.params.id]
      );
      if (blocking.length) {
        throw ApiError.conflict(
          `Makine açılamıyor: ${blocking.map((b) => `${b.display_name} (%${b.fill_percent})`).join(', ')} boşaltılmalı.`
        );
      }
    }

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE machine_power_state SET is_powered_on = $1, power_blocked_reason = NULL,
                changed_by_user_id = $2, updated_at = now()
         WHERE machine_id = $3 RETURNING *`,
        [isPoweredOn, req.user.userId, req.params.id]
      );
      if (!isPoweredOn) {
        await client.query(
          `UPDATE machine_units SET is_running = FALSE, last_stopped_at = now() WHERE machine_id = $1`,
          [req.params.id]
        );
      }
      return rows[0];
    });

    if (!result) throw ApiError.notFound('Makine bulunamadı.');
    await logFromReq(req, {
      actionType: isPoweredOn ? 'MACHINE_POWER_ON' : 'MACHINE_POWER_OFF',
      entityType: 'Machine',
      entityId: req.params.id,
    });
    res.json(result);
  })
);

/* =====================================================================
   EKRAN (TABLET) HEARTBEAT  (machine_screens)
   Frontend karşılığı: ekran-veri.js
   ===================================================================== */

const SCREEN_OFFLINE_THRESHOLD_MS = 8000;

// GET /api/machines/:id/screens  (online/offline hesaplanmış olarak döner)
router.get(
  '/:id/screens',
  requirePermission('MACHINE_VIEW_OWN'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query('SELECT * FROM machine_screens WHERE machine_id = $1 ORDER BY screen_id', [
      req.params.id,
    ]);
    const now = Date.now();
    res.json(
      rows.map((r) => ({
        ...r,
        isOnline:
          !!r.last_heartbeat_at && now - new Date(r.last_heartbeat_at).getTime() <= SCREEN_OFFLINE_THRESHOLD_MS,
      }))
    );
  })
);

// POST /api/machines/:id/screens/:code/heartbeat  { page? }  — tabletten gelen sinyal
router.post(
  '/:id/screens/:code/heartbeat',
  requirePermission('DEVICE_COMMAND_SEND'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query(
      `UPDATE machine_screens SET last_heartbeat_at = now(), last_page = $1, updated_at = now()
       WHERE machine_id = $2 AND screen_code = $3 RETURNING *`,
      [req.body?.page || null, req.params.id, req.params.code]
    );
    if (!rows.length) throw ApiError.notFound('Ekran bulunamadı.');
    res.json(rows[0]);
  })
);

/* =====================================================================
   KAPAKLAR (machine_covers) — 10 kapak / makine
   ===================================================================== */

// GET /api/machines/:id/covers
router.get(
  '/:id/covers',
  requirePermission('MACHINE_VIEW_OWN'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query('SELECT * FROM machine_covers WHERE machine_id = $1 ORDER BY cover_number', [
      req.params.id,
    ]);
    res.json(rows);
  })
);

// GET /api/machines/:id/covers/events?limit=200
router.get(
  '/:id/covers/events',
  requirePermission('MACHINE_VIEW_OWN'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const { rows } = await query(
      `SELECT e.event_id, e.cover_number, e.action, e.created_at, u.full_name AS performed_by
       FROM machine_cover_events e
       LEFT JOIN users u ON u.user_id = e.performed_by_user_id
       WHERE e.machine_id = $1
       ORDER BY e.created_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    res.json(rows);
  })
);

// PATCH /api/machines/:id/covers/:coverNumber  { status: 'OPEN'|'CLOSED' }
// Bir device_command kaydı da açılır (yaşam döngüsü takibi için); burada
// senkron olarak ACKED işaretlenir çünkü panel doğrudan komutu uyguluyor.
router.patch(
  '/:id/covers/:coverNumber',
  requirePermission('COVER_OPEN_ALL'),
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['OPEN', 'CLOSED'].includes(status)) throw ApiError.badRequest("status 'OPEN' veya 'CLOSED' olmalıdır.");
    await assertMachineInScope(req.user, req.params.id);

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE machine_covers SET status = $1, last_action_at = now(), last_action_by_user_id = $2
         WHERE machine_id = $3 AND cover_number = $4 RETURNING *`,
        [status, req.user.userId, req.params.id, req.params.coverNumber]
      );
      if (!rows.length) return null;
      await client.query(
        `INSERT INTO device_commands (machine_id, command_type, payload, status, requested_by_user_id, sent_at, acked_at)
         VALUES ($1,$2,$3,'ACKED',$4, now(), now())`,
        [
          req.params.id,
          status === 'OPEN' ? 'COVER_OPEN' : 'COVER_CLOSE',
          JSON.stringify({ coverNumber: Number(req.params.coverNumber) }),
          req.user.userId,
        ]
      );
      await client.query(
        `INSERT INTO machine_cover_events (machine_id, cover_number, action, performed_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, req.params.coverNumber, status === 'OPEN' ? 'OPEN' : 'CLOSE', req.user.userId]
      );
      return rows[0];
    });

    if (!result) throw ApiError.notFound('Kapak bulunamadı.');
    await logFromReq(req, {
      actionType: status === 'OPEN' ? 'COVER_OPEN' : 'COVER_CLOSE',
      entityType: 'MachineCover',
      entityId: result.cover_id,
      details: { coverNumber: req.params.coverNumber },
    });
    res.json(result);
  })
);

/* =====================================================================
   SENSÖR VERİLERİ  (sensor_data)
   ===================================================================== */

// GET /api/machines/:id/sensor-data?type=&limit=
router.get(
  '/:id/sensor-data',
  requirePermission('SENSOR_VIEW'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const params = [req.params.id];
    let where = 'machine_id = $1';
    if (req.query.type) {
      params.push(req.query.type);
      where += ` AND sensor_type = $${params.length}`;
    }
    params.push(limit);
    const { rows } = await query(
      `SELECT * FROM sensor_data WHERE ${where} ORDER BY recorded_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  })
);

// POST /api/machines/:id/sensor-data  { sensorType, sensorValue, unit }  — cihazdan gelen veri
router.post(
  '/:id/sensor-data',
  requirePermission('DEVICE_COMMAND_SEND'),
  asyncHandler(async (req, res) => {
    const { sensorType, sensorValue, unit } = req.body || {};
    if (!sensorType || sensorValue === undefined) throw ApiError.badRequest('sensorType ve sensorValue gereklidir.');
    await assertMachineInScope(req.user, req.params.id);

    const { rows } = await query(
      `INSERT INTO sensor_data (machine_id, sensor_type, sensor_value, unit) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, sensorType, sensorValue, unit || null]
    );
    await query(`UPDATE machines SET last_seen_at = now(), online_status = 'ONLINE' WHERE machine_id = $1`, [
      req.params.id,
    ]);
    res.status(201).json(rows[0]);
  })
);

/* =====================================================================
   UZAKTAN KOMUTLAR (device_commands)
   ===================================================================== */

// GET /api/machines/:id/commands
router.get(
  '/:id/commands',
  requirePermission('DEVICE_COMMAND_VIEW'),
  asyncHandler(async (req, res) => {
    await assertMachineInScope(req.user, req.params.id);
    const { rows } = await query(
      'SELECT * FROM device_commands WHERE machine_id = $1 ORDER BY requested_at DESC LIMIT 200',
      [req.params.id]
    );
    res.json(rows);
  })
);

// POST /api/machines/:id/commands  { commandType, payload }
router.post(
  '/:id/commands',
  requirePermission('DEVICE_COMMAND_SEND'),
  asyncHandler(async (req, res) => {
    const { commandType, payload } = req.body || {};
    const allowed = ['COVER_OPEN', 'COVER_CLOSE', 'RESTART', 'FIRMWARE_PUSH'];
    if (!allowed.includes(commandType)) throw ApiError.badRequest(`commandType şunlardan biri olmalı: ${allowed.join(', ')}`);
    await assertMachineInScope(req.user, req.params.id);

    const { rows } = await query(
      `INSERT INTO device_commands (machine_id, command_type, payload, requested_by_user_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, commandType, payload ? JSON.stringify(payload) : null, req.user.userId]
    );
    await logFromReq(req, {
      actionType: 'DEVICE_COMMAND_SEND',
      entityType: 'DeviceCommand',
      entityId: rows[0].command_id,
      details: { commandType, payload },
    });
    res.status(202).json(rows[0]);
  })
);

// PATCH /api/machines/:id/commands/:commandId  { status, resultMessage }  — cihazın onayı
router.patch(
  '/:id/commands/:commandId',
  requirePermission('DEVICE_COMMAND_SEND'),
  asyncHandler(async (req, res) => {
    const { status, resultMessage } = req.body || {};
    const allowed = ['SENT', 'ACKED', 'FAILED', 'EXPIRED'];
    if (!allowed.includes(status)) throw ApiError.badRequest(`status şunlardan biri olmalı: ${allowed.join(', ')}`);
    await assertMachineInScope(req.user, req.params.id);

    const timestampCol = status === 'SENT' ? 'sent_at' : status === 'ACKED' ? 'acked_at' : null;
    const { rows } = await query(
      `UPDATE device_commands SET status = $1, result_message = $2 ${
        timestampCol ? `, ${timestampCol} = now()` : ''
      }
       WHERE command_id = $3 AND machine_id = $4 RETURNING *`,
      [status, resultMessage || null, req.params.commandId, req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Komut bulunamadı.');
    res.json(rows[0]);
  })
);

module.exports = router;