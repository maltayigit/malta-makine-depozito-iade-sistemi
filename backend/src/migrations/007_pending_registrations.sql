/* =====================================================================
   007 — BEKLEYEN KAYITLAR (self-service register.html onay akışı)
   register.html üzerinden gelen kayıtlar doğrudan companies/users
   tablosuna yazılmaz; önce burada PENDING olarak bekler. Yönetici
   (SUPER_ADMIN) kayitlar.html üzerinden onaylar ya da reddeder.
   Onaylandığında gerçek company + user satırları oluşturulur.
   ===================================================================== */

CREATE TABLE pending_registrations (
    pending_id          SERIAL PRIMARY KEY,
    full_name           VARCHAR(150) NOT NULL,
    store_name          VARCHAR(200) NOT NULL,
    email               VARCHAR(150) NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),

    -- Aynı/benzer isimde mevcut bir firma varsa kayıt sırasında tespit edilip
    -- burada işaretlenir; panelde "olası mükerrer" uyarısı olarak gösterilir.
    possible_duplicate_company_id INT REFERENCES companies(company_id),

    reviewed_by_user_id INT REFERENCES users(user_id),
    reviewed_at         TIMESTAMPTZ,
    review_note         VARCHAR(500),

    created_company_id  INT REFERENCES companies(company_id),
    created_user_id     INT REFERENCES users(user_id),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pending_registrations_status
    ON pending_registrations (status, created_at DESC);

-- Aynı e-posta ile birden fazla PENDING kayıt açılmasını engelle
-- (users.email zaten unique değil ama burada bekleyenler için mantıklı).
CREATE UNIQUE INDEX uq_pending_registrations_email_pending
    ON pending_registrations (email)
    WHERE status = 'PENDING';
