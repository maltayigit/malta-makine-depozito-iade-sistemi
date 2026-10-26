const { query } = require('../db');

/**
 * activity_logs tablosuna kayıt atar. Hata durumunda ana işlemi
 * engellememesi için çağıran taraf await etse de etmese de sessizce
 * loglar (log yazımı başarısız olursa sadece konsola düşer).
 */
async function logActivity({ userId, roleCode, actionType, entityType, entityId, details, ipAddress, userAgent }) {
  try {
    await query(
      `INSERT INTO activity_logs (user_id, role_code, action_type, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        userId || null,
        roleCode || null,
        actionType,
        entityType || null,
        entityId || null,
        details ? JSON.stringify(details) : null,
        ipAddress || null,
        userAgent || null,
      ]
    );
  } catch (err) {
    console.error('[activityLog] kayıt yazılamadı:', err.message);
  }
}

function logFromReq(req, { actionType, entityType, entityId, details }) {
  return logActivity({
    userId: req.user?.userId,
    roleCode: req.user?.roleCode,
    actionType,
    entityType,
    entityId,
    details,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

module.exports = { logActivity, logFromReq };