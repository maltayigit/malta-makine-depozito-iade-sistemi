const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../lib/jwt');
const { authenticate } = require('../lib/auth.middleware');
const { logFromReq, logActivity } = require('../lib/activityLog');

const MAX_FAILED_ATTEMPTS = 3;
const LOCK_MINUTES = 15;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueTokenPair(user, req) {
  const refreshToken = signRefreshToken({ sub: user.user_id });
  const decoded = verifyRefreshToken(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);

  // Refresh token kaydını ÖNCE ekliyoruz ki dönen token_id'yi access token'ın
  // içine 'sid' (session id) olarak gömebilelim. auth.middleware.js bu sid'i
  // kullanarak her istekte doğru oturumun last_seen_at'ını güncelliyor —
  // böylece Aktif Oturumlar ekranı gerçek "şu an kullanılıyor mu" bilgisini
  // gösterebiliyor (sadece "süresi dolmamış mı" değil).
  const { rows } = await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent, last_seen_at)
     VALUES ($1,$2,$3,$4,$5, now()) RETURNING token_id`,
    [user.user_id, hashToken(refreshToken), expiresAt, req.ip, req.headers['user-agent'] || null]
  );
  const tokenId = rows[0].token_id;

  const accessToken = signAccessToken({ sub: user.user_id, role: user.role_code, sid: tokenId });

  return { accessToken, refreshToken };
}

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password, clientType } = req.body || {};
    if (!username || !password) {
      throw ApiError.badRequest('Kullanıcı adı ve şifre gereklidir.');
    }

    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'] || null;

    const { rows } = await query(
      `SELECT u.*, r.role_code FROM users u
       JOIN roles r ON r.role_id = u.role_id
       WHERE u.username = $1 OR u.email = $1`,
      [username]
    );
    const user = rows[0];

    // Kullanıcı adı yanlış olsa da aynı jenerik mesajı döndürüyoruz (enumeration önleme),
    // ama takip edebilmek için hangi kullanıcı adının denendiğini logluyoruz.
    if (!user || user.deleted_at) {
      await logActivity({
        userId: null,
        actionType: 'LOGIN_USER_NOT_FOUND',
        entityType: 'User',
        ipAddress,
        userAgent,
        details: { attemptedUsername: username },
      });
      throw ApiError.unauthorized('Kullanıcı adı veya şifre hatalı.');
    }

    // Mobil uygulama SADECE SERVICE_PERSONNEL rolündeki kullanıcıların girişine izin verir.
    // Roller tablosuna dokunulmadı; bu sadece istemci tipine göre bir erişim kısıtıdır.
    if (clientType === 'mobile' && user.role_code !== 'SERVICE_PERSONNEL') {
      throw ApiError.forbidden('Bu mobil uygulama sadece servis personeli girişine izin verir.');
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await logActivity({
        userId: user.user_id,
        roleCode: user.role_code,
        actionType: 'LOGIN_BLOCKED_LOCKED',
        entityType: 'User',
        entityId: user.user_id,
        ipAddress,
        userAgent,
        details: { lockedUntil: user.locked_until },
      });
      throw ApiError.forbidden(
        `Hesap çok fazla başarısız giriş denemesi nedeniyle kilitli. Lütfen ${new Date(
          user.locked_until
        ).toLocaleString('tr-TR')} sonrasında tekrar deneyin.`
      );
    }

    if (!user.is_active) {
      throw ApiError.forbidden('Hesabınız devre dışı bırakılmış. Yöneticinizle iletişime geçin.');
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      const attempts = user.failed_login_attempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      await query(
        `UPDATE users SET failed_login_attempts = $1,
                          locked_until = $2
         WHERE user_id = $3`,
        [
          shouldLock ? 0 : attempts,
          shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
          user.user_id,
        ]
      );

      await logActivity({
        userId: user.user_id,
        roleCode: user.role_code,
        actionType: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.user_id,
        ipAddress,
        userAgent,
        details: { attemptCount: attempts, locked: shouldLock },
      });

      // Bu deneme ile birlikte hesap kilitlendiyse ayrı bir olay olarak da logluyoruz,
      // log sayfasında "hesap kilitlendi" filtrelemesini kolaylaştırmak için.
      if (shouldLock) {
        await logActivity({
          userId: user.user_id,
          roleCode: user.role_code,
          actionType: 'ACCOUNT_LOCKED',
          entityType: 'User',
          entityId: user.user_id,
          ipAddress,
          userAgent,
          details: { attemptCount: attempts, lockMinutes: LOCK_MINUTES },
        });
      }

      throw ApiError.unauthorized('Kullanıcı adı veya şifre hatalı.');
    }

    await query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now()
       WHERE user_id = $1`,
      [user.user_id]
    );

    const { accessToken, refreshToken } = await issueTokenPair(user, req);

    await logActivity({
      userId: user.user_id,
      roleCode: user.role_code,
      actionType: 'LOGIN',
      entityType: 'User',
      entityId: user.user_id,
      ipAddress,
      userAgent,
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        userId: user.user_id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        roleCode: user.role_code,
        companyId: user.company_id,
        marketId: user.market_id,
        mustChangePassword: user.must_change_password,
      },
    });
  })
);

// POST /api/auth/refresh
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) throw ApiError.badRequest('refreshToken gereklidir.');

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      throw ApiError.unauthorized('Refresh token geçersiz veya süresi dolmuş.');
    }

    const tokenHash = hashToken(refreshToken);
    const { rows } = await query(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2`,
      [tokenHash, decoded.sub]
    );
    const stored = rows[0];

    if (!stored) {
      throw ApiError.unauthorized('Refresh token geçersiz veya iptal edilmiş.');
    }

    // YENİDEN KULLANIM TESPİTİ (reuse detection): rotasyonla zaten iptal
    // edilmiş bir refresh token tekrar kullanılmaya çalışılıyorsa, bu
    // token'ın çalınmış/kopyalanmış olabileceğinin işaretidir. Bu durumda
    // saldırgan mı gerçek kullanıcı mı olduğunu ayırt edemeyiz; güvenli
    // taraf, bu kullanıcının TÜM oturumlarını (tüm refresh token'larını)
    // iptal edip herkesi yeniden giriş yapmaya zorlamaktır.
    if (stored.revoked_at) {
      await query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [decoded.sub]
      );
      await logActivity({
        userId: decoded.sub,
        actionType: 'REFRESH_TOKEN_REUSE_DETECTED',
        entityType: 'User',
        entityId: decoded.sub,
        ipAddress: req.ip,
      });
      throw ApiError.unauthorized(
        'Bu oturum güvenlik nedeniyle sonlandırıldı, lütfen tekrar giriş yapın.'
      );
    }

    if (new Date(stored.expires_at) < new Date()) {
      throw ApiError.unauthorized('Refresh token geçersiz veya iptal edilmiş.');
    }

    // Rotasyon: eskisini iptal et, yenisini ver.
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_id = $1', [
      stored.token_id,
    ]);

    const { rows: userRows } = await query(
      `SELECT u.*, r.role_code FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = $1`,
      [decoded.sub]
    );
    const user = userRows[0];
    if (!user || user.deleted_at || !user.is_active) {
      throw ApiError.unauthorized('Kullanıcı bulunamadı veya devre dışı.');
    }

    const tokens = await issueTokenPair(user, req);
    res.json(tokens);
  })
);

// POST /api/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);

      // Loglamak için token'ı iptal etmeden önce sahibini buluyoruz.
      const { rows } = await query(
        `SELECT rt.user_id, r.role_code FROM refresh_tokens rt
         JOIN users u ON u.user_id = rt.user_id
         JOIN roles r ON r.role_id = u.role_id
         WHERE rt.token_hash = $1`,
        [tokenHash]
      );
      const owner = rows[0];

      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [
        tokenHash,
      ]);

      if (owner) {
        // Oturum süresini bulmak için bu kullanıcının en son LOGIN kaydına bakıyoruz.
        const { rows: lastLoginRows } = await query(
          `SELECT created_at FROM activity_logs
           WHERE user_id = $1 AND action_type = 'LOGIN'
           ORDER BY created_at DESC LIMIT 1`,
          [owner.user_id]
        );
        const lastLoginAt = lastLoginRows[0]?.created_at;
        const sessionDurationSeconds = lastLoginAt
          ? Math.round((Date.now() - new Date(lastLoginAt).getTime()) / 1000)
          : null;

        await logActivity({
          userId: owner.user_id,
          roleCode: owner.role_code,
          actionType: 'LOGOUT',
          entityType: 'User',
          entityId: owner.user_id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: { sessionDurationSeconds },
        });
      }
    }
    res.status(204).send();
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT permission_code FROM vw_user_permissions WHERE user_id = $1 ORDER BY permission_code`,
      [req.user.userId]
    );
    res.json({ ...req.user, permissions: rows.map((r) => r.permission_code) });
  })
);

// POST /api/auth/change-password
router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      throw ApiError.badRequest('currentPassword ve newPassword gereklidir.');
    }
    if (newPassword.length < 8) {
      throw ApiError.badRequest('Yeni şifre en az 8 karakter olmalıdır.');
    }

    const { rows } = await query('SELECT password_hash FROM users WHERE user_id = $1', [
      req.user.userId,
    ]);
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) throw ApiError.unauthorized('Mevcut şifre hatalı.');

    const newHash = await bcrypt.hash(newPassword, 12);
    await query(
      `UPDATE users SET password_hash = $1, password_changed_at = now(), must_change_password = FALSE
       WHERE user_id = $2`,
      [newHash, req.user.userId]
    );
    await logFromReq(req, { actionType: 'PASSWORD_CHANGE', entityType: 'User', entityId: req.user.userId });
    res.status(204).send();
  })
);

module.exports = router;