const { query } = require('../db');

/**
 * Bir makineyle ilgili olayı, o makineyle ilgilenmesi gereken tüm
 * kullanıcılara (SUPER_ADMIN, ilgili COMPANY, ilgili MARKET, atanmış
 * SERVICE_PERSONNEL) bildirim olarak dağıtır.
 */
async function notifyUsersForMachine(machineId, { type, title, message, relatedEntityType, relatedEntityId }) {
  const { rows: machineRows } = await query('SELECT company_id, market_id FROM machines WHERE machine_id = $1', [
    machineId,
  ]);
  if (!machineRows.length) return;
  const { company_id: companyId, market_id: marketId } = machineRows[0];

  const { rows: users } = await query(
    `SELECT DISTINCT u.user_id FROM users u
     JOIN roles r ON r.role_id = u.role_id
     WHERE u.deleted_at IS NULL AND u.is_active AND (
       r.role_code = 'SUPER_ADMIN'
       OR (r.role_code = 'COMPANY' AND u.company_id = $1)
       OR (r.role_code = 'MARKET' AND u.market_id = $2)
       OR (r.role_code = 'SERVICE_PERSONNEL' AND u.user_id IN (
             SELECT user_id FROM service_personnel_machines WHERE machine_id = $3))
     )`,
    [companyId, marketId, machineId]
  );

  if (!users.length) return;

  const values = [];
  const placeholders = users.map((u, idx) => {
    const base = idx * 6;
    values.push(u.user_id, type, title, message, relatedEntityType || null, relatedEntityId || null);
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
  });

  await query(
    `INSERT INTO notifications (user_id, notification_type, title, message, related_entity_type, related_entity_id)
     VALUES ${placeholders.join(',')}`,
    values
  );
}

module.exports = { notifyUsersForMachine };
