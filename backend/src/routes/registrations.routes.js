const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../db');
const ApiError = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');
const { authenticate, requireRole } = require('../lib/auth.middleware');
const { logActivity, logFromReq } = require('../lib/activityLog');

/* =====================================================================
   PUBLIC — register.html buradan çağırır. Auth GEREKTİRMEZ.
   Kayıt doğrudan companies/users tablosuna yazılmaz; PENDING olarak
   bekler, yönetici onaylayınca gerçek hesap oluşur.
   ===================================================================== */

// POST /api/registrations
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { fullName, storeName, email, password } = req.body || {};

    if (!fullName || !storeName || !email || !password) {
      throw ApiError.badRequest('fullName, storeName, email ve password gereklidir.');
    }
    if (password.length < 4) {
      throw ApiError.badRequest('Şifre en az 4 karakter olmalıdır.');
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Bu e-posta zaten aktif bir kullanıcıya mı ait? (silinmiş hesaplar hariç)
    const { rows: existingUser } = await query(
      'SELECT 1 FROM users WHERE lower(email) = $1 AND deleted_at IS NULL',
      [normalizedEmail]
    );
    if (existingUser.length) {
      throw ApiError.conflict('Bu e-posta adresiyle zaten bir hesap kayıtlı.');
    }

    // Bu e-posta ile bekleyen bir başvuru var mı?
    const { rows: existingPending } = await query(
      `SELECT 1 FROM pending_registrations WHERE lower(email) = $1 AND status = 'PENDING'`,
      [normalizedEmail]
    );
    if (existingPending.length) {
      throw ApiError.conflict('Bu e-posta ile zaten onay bekleyen bir başvurunuz var.');
    }

    // Aynı/çok benzer isimde bir firma zaten var mı? (olası mükerrer uyarısı)
    const { rows: dupCompanies } = await query(
      `SELECT company_id FROM companies
       WHERE deleted_at IS NULL AND lower(company_name) = lower($1)
       LIMIT 1`,
      [storeName]
    );
    const possibleDuplicateCompanyId = dupCompanies[0]?.company_id || null;

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await query(
      `INSERT INTO pending_registrations (full_name, store_name, email, password_hash, possible_duplicate_company_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING pending_id, created_at`,
      [fullName, storeName, normalizedEmail, passwordHash, possibleDuplicateCompanyId]
    );

    await logActivity({
      actionType: 'REGISTRATION_SUBMITTED',
      entityType: 'PendingRegistration',
      entityId: rows[0].pending_id,
      details: { storeName, email: normalizedEmail },
      ipAddress: req.ip,
    });

    res.status(201).json({
      pendingId: rows[0].pending_id,
      status: 'PENDING',
      message: 'Başvurunuz alındı, yönetici onayından sonra giriş yapabileceksiniz.',
    });
  })
);

/* =====================================================================
   ADMIN — kayitlar.html buradan çağırır. Sadece SUPER_ADMIN.
   ===================================================================== */

router.use(authenticate);

// GET /api/registrations?status=PENDING
router.get(
  '/',
  requireRole('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(req.query.status)
      ? req.query.status
      : null;

    const { rows } = await query(
      `SELECT pr.pending_id, pr.full_name, pr.store_name, pr.email, pr.status,
              pr.possible_duplicate_company_id, c.company_name AS duplicate_company_name,
              pr.reviewed_by_user_id, pr.reviewed_at, pr.review_note,
              pr.created_company_id, pr.created_user_id, pr.created_at
       FROM pending_registrations pr
       LEFT JOIN companies c ON c.company_id = pr.possible_duplicate_company_id
       WHERE ($1::text IS NULL OR pr.status = $1)
       ORDER BY pr.created_at DESC`,
      [status]
    );
    res.json(rows);
  })
);

// PATCH /api/registrations/:id  { fullName?, storeName?, email? }
// Başvuruyu ONAYLAMADAN düzeltmek için (yanlış girilen bilgileri fark edip
// hemen onaylamak istemiyorsanız). Sadece PENDING durumundaki başvurularda çalışır.
router.patch(
  '/:id',
  requireRole('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const { fullName, storeName, email } = req.body || {};

    const { rows: pendingRows } = await query(
      'SELECT * FROM pending_registrations WHERE pending_id = $1',
      [req.params.id]
    );
    const pending = pendingRows[0];
    if (!pending) throw ApiError.notFound('Başvuru bulunamadı.');
    if (pending.status !== 'PENDING') {
      throw ApiError.conflict('Sadece onay bekleyen başvurular düzenlenebilir.');
    }

    const finalFullName = fullName !== undefined ? fullName : pending.full_name;
    const finalStoreName = storeName !== undefined ? storeName : pending.store_name;
    const finalEmail = email !== undefined ? String(email).trim().toLowerCase() : pending.email;

    if (finalEmail !== pending.email) {
      const { rows: existingUser } = await query('SELECT 1 FROM users WHERE lower(email) = $1', [
        finalEmail,
      ]);
      if (existingUser.length) throw ApiError.conflict('Bu e-posta ile zaten bir kullanıcı mevcut.');
    }

    // İsim değiştiyse mükerrer firma kontrolünü tazele.
    const { rows: dupCompanies } = await query(
      `SELECT company_id FROM companies
       WHERE deleted_at IS NULL AND lower(company_name) = lower($1)
       LIMIT 1`,
      [finalStoreName]
    );

    const { rows } = await query(
      `UPDATE pending_registrations
       SET full_name = $1, store_name = $2, email = $3, possible_duplicate_company_id = $4
       WHERE pending_id = $5
       RETURNING pending_id, full_name, store_name, email, possible_duplicate_company_id`,
      [finalFullName, finalStoreName, finalEmail, dupCompanies[0]?.company_id || null, req.params.id]
    );

    await logFromReq(req, {
      actionType: 'REGISTRATION_EDITED',
      entityType: 'PendingRegistration',
      entityId: req.params.id,
      details: { fullName: finalFullName, storeName: finalStoreName, email: finalEmail },
    });

    res.json(rows[0]);
  })
);

// POST /api/registrations/:id/approve  { note?, roleCode? }
// Onaylanınca: yeni company + o company'ye bağlı COMPANY rolünde kullanıcı oluşturulur.
router.post(
  '/:id/approve',
  requireRole('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const { note, fullName, storeName, email } = req.body || {};

    const { rows: pendingRows } = await query(
      'SELECT * FROM pending_registrations WHERE pending_id = $1',
      [req.params.id]
    );
    const pending = pendingRows[0];
    if (!pending) throw ApiError.notFound('Başvuru bulunamadı.');
    if (pending.status !== 'PENDING') {
      throw ApiError.conflict('Bu başvuru zaten sonuçlandırılmış.');
    }

    // Yönetici onaylarken alanları düzeltebilir (kullanıcı yanlış girdiyse).
    const finalFullName = fullName || pending.full_name;
    const finalStoreName = storeName || pending.store_name;
    const finalEmail = (email || pending.email).trim().toLowerCase();

    const { rows: existingUser } = await query(
      'SELECT 1 FROM users WHERE lower(email) = $1 AND deleted_at IS NULL',
      [finalEmail]
    );
    if (existingUser.length) {
      throw ApiError.conflict('Bu e-posta ile zaten bir kullanıcı mevcut.');
    }

    // NOT: register.html bir "mağaza" (market) başvurusudur. Onaylanınca, mağazayı
    // barındıracak bir Firma (company) + o firmaya bağlı bir Market kaydı oluşturulur
    // ve kullanıcı MARKET rolüyle, market_id set edilerek açılır (COMPANY rolüyle DEĞİL).
    const { rows: roleRows } = await query(`SELECT role_id FROM roles WHERE role_code = 'MARKET'`);
    if (!roleRows.length) throw ApiError.internal('MARKET rolü tanımlı değil.');

    const result = await withTransaction(async (client) => {
      const { rows: companyRows } = await client.query(
        `INSERT INTO companies (company_name, contact_person, email)
         VALUES ($1,$2,$3) RETURNING company_id`,
        [finalStoreName, finalFullName, finalEmail]
      );
      const companyId = companyRows[0].company_id;

      await client.query('INSERT INTO company_settings (company_id) VALUES ($1)', [companyId]);

      const { rows: marketRows } = await client.query(
        `INSERT INTO markets (company_id, market_name, contact_person)
         VALUES ($1,$2,$3) RETURNING market_id`,
        [companyId, finalStoreName, finalFullName]
      );
      const marketId = marketRows[0].market_id;

      // username: e-postanın @ öncesi + benzersizlik için market_id
      const usernameBase = finalEmail.split('@')[0];
      const username = `${usernameBase}.${marketId}`;

      const { rows: userRows } = await client.query(
        `INSERT INTO users (username, password_hash, full_name, email, role_id, company_id, market_id, password_changed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         RETURNING user_id`,
        [username, pending.password_hash, finalFullName, finalEmail, roleRows[0].role_id, companyId, marketId]
      );
      const userId = userRows[0].user_id;

      await client.query(
        `UPDATE pending_registrations
         SET status = 'APPROVED', reviewed_by_user_id = $1, reviewed_at = now(), review_note = $2,
             created_company_id = $3, created_user_id = $4
         WHERE pending_id = $5`,
        [req.user.userId, note || null, companyId, userId, pending.pending_id]
      );

      return { companyId, marketId, userId, username };
    });

    await logFromReq(req, {
      actionType: 'REGISTRATION_APPROVED',
      entityType: 'PendingRegistration',
      entityId: pending.pending_id,
      details: { companyId: result.companyId, userId: result.userId },
    });

    res.json({ status: 'APPROVED', ...result });
  })
);

// POST /api/registrations/:id/reject  { note? }
router.post(
  '/:id/reject',
  requireRole('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const { note } = req.body || {};

    const { rows } = await query(
      `UPDATE pending_registrations
       SET status = 'REJECTED', reviewed_by_user_id = $1, reviewed_at = now(), review_note = $2
       WHERE pending_id = $3 AND status = 'PENDING'
       RETURNING pending_id`,
      [req.user.userId, note || null, req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Başvuru bulunamadı veya zaten sonuçlandırılmış.');

    await logFromReq(req, {
      actionType: 'REGISTRATION_REJECTED',
      entityType: 'PendingRegistration',
      entityId: req.params.id,
      details: { note },
    });

    res.status(204).send();
  })
);

module.exports = router;
