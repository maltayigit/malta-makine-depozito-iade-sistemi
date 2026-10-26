const { verifyAccessToken } = require('./jwt');
const { query } = require('../db');
const ApiError = require('./errors');
const asyncHandler = require('./asyncHandler');

/**
 * Authorization: Bearer <token> header'ını okur, kullanıcıyı ve
 * güncel (silinmemiş / aktif) durumunu req.user içine koyar.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Erişim tokenı eksik veya hatalı biçimde gönderildi.');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw ApiError.unauthorized('Erişim tokenı geçersiz veya süresi dolmuş.');
  }

  const { rows } = await query(
    `SELECT u.user_id, u.username, u.full_name, u.email, u.is_active, u.deleted_at,
            u.company_id, u.market_id, r.role_code
     FROM users u
     JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = $1`,
    [payload.sub]
  );

  const user = rows[0];
  if (!user || user.deleted_at || !user.is_active) {
    throw ApiError.unauthorized('Kullanıcı bulunamadı veya devre dışı.');
  }

  req.user = {
    userId: user.user_id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    roleCode: user.role_code,
    companyId: user.company_id,
    marketId: user.market_id,
    sessionId: payload.sid || null,
  };

  // Aktif Oturumlar ekranının "şu an gerçekten sistemde mi" bilgisini
  // gösterebilmesi için, bu access token'ın bağlı olduğu refresh token
  // kaydının last_seen_at'ını güncelliyoruz. İsteği yavaşlatmaması ve
  // eski (sid içermeyen) access token'larla kırılmaması için sessizce
  // (await etmeden, hatasını yutarak) yapılıyor.
  if (payload.sid) {
    query('UPDATE refresh_tokens SET last_seen_at = now() WHERE token_id = $1 AND revoked_at IS NULL', [
      payload.sid,
    ]).catch(() => {});
  }

  next();
});

/**
 * Belirli bir permission_code gerektiren rotalar için.
 * vw_user_permissions view'ı hem role_permissions hem de
 * user_permissions override'larını hesaba katarak sonucu döner.
 */
function requirePermission(permissionCode) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) throw ApiError.unauthorized();

    const { rows } = await query(
      `SELECT 1 FROM vw_user_permissions
       WHERE user_id = $1 AND permission_code = $2
       LIMIT 1`,
      [req.user.userId, permissionCode]
    );

    if (!rows.length) {
      throw ApiError.forbidden(`Bu işlem '${permissionCode}' yetkisini gerektirir.`);
    }
    next();
  });
}

/** Sadece belirtilen rol kodlarına izin verir (ör. ['SUPER_ADMIN']). */
function requireRole(...roleCodes) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roleCodes.includes(req.user.roleCode)) {
      return next(ApiError.forbidden('Bu işlem için rolünüz yeterli değil.'));
    }
    next();
  };
}

module.exports = { authenticate, requirePermission, requireRole };