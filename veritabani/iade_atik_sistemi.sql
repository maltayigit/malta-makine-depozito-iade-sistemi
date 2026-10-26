/* =====================================================================
   MAKİNE YÖNETİM SİSTEMİ - RBAC VERİTABANI ŞEMASI (PostgreSQL)
   GENİŞLETİLMİŞ SÜRÜM - v2
   =====================================================================
   Roller: Super Admin, market Firması, Market, Servis Personeli

   Bu dosya orijinal şemanın (rbac_schema_postgresql.sql) üzerine
   eklenen tüm iyileştirmeleri içerir. Sıfırdan çalıştırılabilir,
   bağımsız bir dosyadır.

   ÖNEMLİ: PostgreSQL, CREATE DATABASE komutunu bir script/transaction
   içinde koşullu çalıştırmaya izin vermez. Bu yüzden veritabanını
   ÖNCE ayrı olarak oluşturman gerekiyor:

       createdb -U postgres machine_management_db

   veya psql içinden:

       CREATE DATABASE machine_management_db;

   Sonra o veritabanına bağlanıp (\c machine_management_db) bu script'in
   geri kalanını çalıştır.

   ---------------------------------------------------------------------
   v2'DE NELER EKLENDİ? (özet)
   ---------------------------------------------------------------------
   1. machines      -> cihaz kimlik doğrulama alanları (api_key/secret)
   2. users         -> hesap güvenliği alanları (login denemesi, kilit,
                        soft delete)
   3. refresh_tokens          -> JWT/oturum yönetimi
   4. user_permissions        -> role bağlı yetkilerin kullanıcı bazında
                                  istisnası (override)
   5. device_commands         -> uzaktan komutların (kapak aç, restart,
                                  firmware gönder) yaşam döngüsü takibi
   6. notifications           -> arıza / offline / doluluk uyarıları
   7. fault_attachments       -> arıza kaydına fotoğraf/dosya ekleme
   8. company_settings        -> firma bazlı eşik değerleri ve tercihler
   9. Eksik FK indexleri      -> performans
   10. Rol-kapsam tutarlılık trigger'ı -> veri bütünlüğü
   11. vw_user_permissions    -> override'ları da hesaba katacak şekilde
                                  güncellendi
   ===================================================================== */

/* =====================================================================
   1. ROL VE YETKİ TABLOLARI (RBAC ÇEKİRDEĞİ)
   ===================================================================== */

CREATE TABLE roles (
    role_id         SERIAL PRIMARY KEY,
    role_code       VARCHAR(50)  NOT NULL UNIQUE,   -- SUPER_ADMIN, COMPANY, MARKET, SERVICE_PERSONNEL
    role_name       VARCHAR(100) NOT NULL,
    description     VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
    permission_id   SERIAL PRIMARY KEY,
    permission_code VARCHAR(100) NOT NULL UNIQUE,   -- ör: MACHINE_CREATE, COVER_OPEN, LOG_VIEW
    permission_name VARCHAR(150) NOT NULL,
    module_name     VARCHAR(100),                   -- ör: Machine, Company, Market, Log, Report
    description     VARCHAR(500)
);

CREATE TABLE role_permissions (
    role_id         INT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id   INT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

/* NOT: user_permissions tablosu, users tablosuna FK vereceği için
   bölüm 3'te (users tanımlandıktan hemen sonra) oluşturuluyor. */

/* =====================================================================
   2. ORGANİZASYON TABLOLARI
   ===================================================================== */

CREATE TABLE companies (               -- Firma / Bakanlık
    company_id      SERIAL PRIMARY KEY,
    company_name    VARCHAR(200) NOT NULL,
    contact_person  VARCHAR(150),
    phone           VARCHAR(30),
    email           VARCHAR(150),
    address         VARCHAR(500),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ                      -- YENİ: soft delete
);

CREATE TABLE markets (                 -- Market (mağaza konumu)
    market_id       SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(company_id),
    market_name     VARCHAR(200) NOT NULL,
    address         VARCHAR(500),
    latitude        NUMERIC(9,6),
    longitude       NUMERIC(9,6),
    contact_person  VARCHAR(150),
    phone           VARCHAR(30),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ                      -- YENİ: soft delete
);

/* ---------------------------------------------------------------------
   YENİ: Firma bazlı ayarlar (eşik değerleri, bildirim tercihleri).
   --------------------------------------------------------------------- */
CREATE TABLE company_settings (
    company_id                 INT PRIMARY KEY REFERENCES companies(company_id) ON DELETE CASCADE,
    low_fill_alert_threshold   NUMERIC(5,2) NOT NULL DEFAULT 85.00,  -- % doluluk uyarı eşiği
    offline_alert_minutes      INT NOT NULL DEFAULT 60,              -- kaç dk sinyal gelmezse "offline" say
    notify_by_email            BOOLEAN NOT NULL DEFAULT TRUE,
    notify_by_push             BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at                 TIMESTAMPTZ
);

/* =====================================================================
   3. KULLANICI TABLOSU
   ===================================================================== */

CREATE TABLE users (
    user_id         SERIAL PRIMARY KEY,
    username        VARCHAR(100) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(150) NOT NULL,
    email           VARCHAR(150),
    phone           VARCHAR(30),
    role_id         INT NOT NULL REFERENCES roles(role_id),
    company_id      INT REFERENCES companies(company_id),   -- Firma rolündeki kullanıcı için
    market_id       INT REFERENCES markets(market_id),      -- Market rolündeki kullanıcı için
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    -- YENİ: hesap güvenliği alanları
    failed_login_attempts  INT NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    password_changed_at     TIMESTAMPTZ,
    must_change_password    BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at              TIMESTAMPTZ,               -- soft delete
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ
);

/* ---------------------------------------------------------------------
   YENİ: Kullanıcı bazlı yetki istisnası (users tanımlandıktan sonra
   gerçek FK'lerle birlikte).
   --------------------------------------------------------------------- */
CREATE TABLE user_permissions (
    user_id             INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    permission_id       INT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    is_granted          BOOLEAN NOT NULL DEFAULT TRUE,   -- TRUE: ek yetki, FALSE: yetkiyi iptal et
    granted_by_user_id  INT REFERENCES users(user_id),
    granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    note                VARCHAR(300),
    PRIMARY KEY (user_id, permission_id)
);

/* ---------------------------------------------------------------------
   YENİ: Refresh token / oturum yönetimi (JWT tabanlı auth için).
   --------------------------------------------------------------------- */
CREATE TABLE refresh_tokens (
    token_id        BIGSERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,   -- token'ın kendisi değil, hash'i saklanır
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    ip_address      VARCHAR(50),
    user_agent      VARCHAR(300)
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

/* =====================================================================
   4. MAKİNE TABLOLARI
   ===================================================================== */

CREATE TABLE machines (
    machine_id      SERIAL PRIMARY KEY,
    machine_code    VARCHAR(50) NOT NULL UNIQUE,     -- seri no / cihaz kodu
    company_id      INT NOT NULL REFERENCES companies(company_id),
    market_id       INT REFERENCES markets(market_id),
    latitude        NUMERIC(9,6),
    longitude       NUMERIC(9,6),
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'   -- ACTIVE / PASSIVE
        CHECK (status IN ('ACTIVE','PASSIVE')),
    online_status   VARCHAR(20) NOT NULL DEFAULT 'OFFLINE'  -- ONLINE / OFFLINE
        CHECK (online_status IN ('ONLINE','OFFLINE')),
    fill_level      NUMERIC(5,2),                     -- doluluk oranı (%)
    is_faulty       BOOLEAN NOT NULL DEFAULT FALSE,
    firmware_version VARCHAR(50),
    -- YENİ: cihazın backend'e kimlik doğrulaması için
    device_api_key         VARCHAR(255) UNIQUE,
    device_api_secret_hash VARCHAR(255),
    device_key_rotated_at  TIMESTAMPTZ,
    last_seen_at    TIMESTAMPTZ,
    installed_at    TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,                       -- soft delete
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ
);

CREATE TABLE machine_covers (            -- her makinede 10 kapak
    cover_id        SERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    cover_number    SMALLINT NOT NULL CHECK (cover_number BETWEEN 1 AND 10),
    status          VARCHAR(20) NOT NULL DEFAULT 'CLOSED'
        CHECK (status IN ('OPEN','CLOSED')),
    last_action_at  TIMESTAMPTZ,
    last_action_by_user_id INT REFERENCES users(user_id),
    UNIQUE (machine_id, cover_number)
);

CREATE TABLE sensor_data (
    sensor_data_id  BIGSERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    sensor_type     VARCHAR(50) NOT NULL,     -- ör: TEMPERATURE, WEIGHT, DOOR_SENSOR
    sensor_value    NUMERIC(10,2),
    unit            VARCHAR(20),
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sensor_data_machine_time ON sensor_data (machine_id, recorded_at DESC);

CREATE TABLE qr_codes (
    qr_code_id      SERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    qr_code_value   VARCHAR(255) NOT NULL UNIQUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE firmware_updates (
    firmware_update_id SERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(machine_id),
    version         VARCHAR(50) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','SUCCESS','FAILED')),
    sent_by_user_id INT NOT NULL REFERENCES users(user_id),
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

/* ---------------------------------------------------------------------
   YENİ: Uzaktan komut kuyruğu.
   "Kapak aç", "restart", "firmware gönder" gibi komutların sadece
   sonucu değil, tüm yaşam döngüsü (gönderildi -> cihaza ulaştı ->
   onaylandı/başarısız) takip edilir. Cihaz offline ise komut PENDING
   kalır ve online olduğunda işlenir.
   --------------------------------------------------------------------- */
CREATE TABLE device_commands (
    command_id          BIGSERIAL PRIMARY KEY,
    machine_id          INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    command_type        VARCHAR(50) NOT NULL,     -- COVER_OPEN, COVER_CLOSE, RESTART, FIRMWARE_PUSH
    payload             JSONB,                    -- ör: {"cover_number": 3}
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','SENT','ACKED','FAILED','EXPIRED')),
    requested_by_user_id INT NOT NULL REFERENCES users(user_id),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at             TIMESTAMPTZ,
    acked_at            TIMESTAMPTZ,
    result_message       VARCHAR(500)
);
CREATE INDEX idx_device_commands_machine_status ON device_commands (machine_id, status);

/* =====================================================================
   5. SERVİS PERSONELİ ATAMA VE İŞLEM TABLOLARI
   ===================================================================== */

CREATE TABLE service_personnel_machines (   -- personel-makine yetkilendirme
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(user_id),      -- Servis Personeli
    machine_id      INT NOT NULL REFERENCES machines(machine_id),
    assigned_by_user_id INT REFERENCES users(user_id),
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, machine_id)
);

CREATE TABLE fault_records (               -- arıza kayıtları
    fault_id        SERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(machine_id),
    reported_by_user_id INT NOT NULL REFERENCES users(user_id),
    fault_description VARCHAR(1000) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
    resolved_by_user_id INT REFERENCES users(user_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

/* ---------------------------------------------------------------------
   YENİ: Arıza kaydına fotoğraf/dosya ekleme (kanıt, ekran görüntüsü vb.)
   --------------------------------------------------------------------- */
CREATE TABLE fault_attachments (
    attachment_id       SERIAL PRIMARY KEY,
    fault_id            INT NOT NULL REFERENCES fault_records(fault_id) ON DELETE CASCADE,
    file_url            VARCHAR(500) NOT NULL,
    file_type           VARCHAR(50),          -- IMAGE, VIDEO, DOCUMENT
    uploaded_by_user_id INT NOT NULL REFERENCES users(user_id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fault_attachments_fault ON fault_attachments (fault_id);

CREATE TABLE service_requests (             -- market tarafından açılan servis talebi
    service_request_id SERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(machine_id),
    requested_by_user_id INT NOT NULL REFERENCES users(user_id),  -- Market kullanıcısı
    description     VARCHAR(1000),
    status          VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED')),
    completed_by_user_id INT REFERENCES users(user_id),           -- Servis Personeli
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

/* =====================================================================
   6. BİLDİRİMLER (YENİ)
   ===================================================================== */
CREATE TABLE notifications (
    notification_id     BIGSERIAL PRIMARY KEY,
    user_id              INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    notification_type    VARCHAR(50) NOT NULL,   -- FAULT, OFFLINE, LOW_FILL, SERVICE_REQUEST, FIRMWARE
    title                 VARCHAR(200) NOT NULL,
    message               VARCHAR(1000),
    related_entity_type   VARCHAR(100),          -- ör: Machine, Fault, ServiceRequest
    related_entity_id     INT,
    is_read               BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at               TIMESTAMPTZ
);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, is_read, created_at DESC);

/* =====================================================================
   7. DENETİM (LOG) TABLOSU - Tüm işlemler otomatik loglanır
   ===================================================================== */

CREATE TABLE activity_logs (
    log_id          BIGSERIAL PRIMARY KEY,
    user_id         INT REFERENCES users(user_id),
    role_code       VARCHAR(50),
    action_type     VARCHAR(100) NOT NULL,   -- ör: COVER_OPEN, MACHINE_RESTART, MACHINE_CREATE
    entity_type     VARCHAR(100),            -- ör: Machine, Cover, Company
    entity_id       INT,
    details         TEXT,                    -- JSON serbest metin
    ip_address      VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_logs_user_time ON activity_logs (user_id, created_at DESC);
CREATE INDEX idx_activity_logs_entity ON activity_logs (entity_type, entity_id);

/* =====================================================================
   8. EKSİK FK İNDEXLERİ (YENİ)
   ---------------------------------------------------------------------
   PostgreSQL, foreign key sütunlarına otomatik index koymaz. Bu
   sütunlar sık JOIN / WHERE koşullarında kullanılacağı için index
   eklemek performans açısından önemlidir.
   ===================================================================== */
CREATE INDEX idx_markets_company            ON markets (company_id);
CREATE INDEX idx_users_role                 ON users (role_id);
CREATE INDEX idx_users_company              ON users (company_id);
CREATE INDEX idx_users_market               ON users (market_id);
CREATE INDEX idx_machines_company           ON machines (company_id);
CREATE INDEX idx_machines_market            ON machines (market_id);
CREATE INDEX idx_machine_covers_machine     ON machine_covers (machine_id);
CREATE INDEX idx_qr_codes_machine           ON qr_codes (machine_id);
CREATE INDEX idx_firmware_updates_machine   ON firmware_updates (machine_id);
CREATE INDEX idx_service_pers_machines_user     ON service_personnel_machines (user_id);
CREATE INDEX idx_service_pers_machines_machine  ON service_personnel_machines (machine_id);
CREATE INDEX idx_fault_records_machine      ON fault_records (machine_id);
CREATE INDEX idx_fault_records_status       ON fault_records (status);
CREATE INDEX idx_service_requests_machine   ON service_requests (machine_id);
CREATE INDEX idx_service_requests_status    ON service_requests (status);

/* =====================================================================
   9. BAŞLANGIÇ VERİLERİ (SEED DATA)
   ===================================================================== */

INSERT INTO roles (role_code, role_name, description) VALUES
('SUPER_ADMIN', 'Malta Makine (Super Admin)', 'Sistemin tam yetkili sahibi'),
('COMPANY', 'Firma (Bakanlık)', 'Kurumsal görüntüleme ve raporlama yetkisi'),
('MARKET', 'Market', 'Mağaza bazlı görüntüleme ve servis talebi yetkisi'),
('SERVICE_PERSONNEL', 'Servis Personeli', 'Saha operasyon yetkisi (mobil uygulama)');

INSERT INTO permissions (permission_code, permission_name, module_name) VALUES
-- Firma / Market / Makine yönetimi
('COMPANY_CREATE', 'Firma Ekleme', 'Company'),
('COMPANY_EDIT',   'Firma Düzenleme', 'Company'),
('COMPANY_DELETE', 'Firma Silme', 'Company'),
('MARKET_CREATE',  'Market Ekleme', 'Market'),
('MARKET_EDIT',    'Market Düzenleme', 'Market'),
('MARKET_DELETE',  'Market Silme', 'Market'),
('MACHINE_CREATE', 'Makine Ekleme', 'Machine'),
('MACHINE_EDIT',   'Makine Düzenleme', 'Machine'),
('MACHINE_DELETE', 'Makine Silme', 'Machine'),
('MACHINE_ASSIGN', 'Makine Atama (Firma/Market)', 'Machine'),
('MACHINE_VIEW_ALL', 'Tüm Makineleri Görüntüleme', 'Machine'),
('MACHINE_VIEW_OWN', 'Kendi Makinelerini Görüntüleme', 'Machine'),
('MACHINE_MAP_VIEW', 'Harita Üzerinde Görüntüleme', 'Machine'),
('MACHINE_ACTIVATE', 'Makine Aktif/Pasif Yapma', 'Machine'),
('MACHINE_RESTART', 'Makineyi Yeniden Başlatma', 'Machine'),
-- Kapak kontrol
('COVER_OPEN_ALL',  'Tüm Kapakları Açma/Kapama', 'Cover'),
('COVER_OPEN_ASSIGNED', 'Yetkili Olunan Kapakları Açma/Kapama', 'Cover'),
-- Servis personeli
('SERVICE_PERSONNEL_CREATE', 'Servis Personeli Oluşturma', 'User'),
('FAULT_CREATE', 'Arıza Kaydı Oluşturma', 'Fault'),
('FAULT_VIEW', 'Arızalı Makineleri Görüntüleme', 'Fault'),
('SERVICE_REQUEST_CREATE', 'Servis Talebi Oluşturma', 'ServiceRequest'),
('SERVICE_REQUEST_COMPLETE', 'Servis İşlemini Tamamlama', 'ServiceRequest'),
-- Firmware / Sensör / QR
('FIRMWARE_UPDATE', 'Firmware Güncellemesi Gönderme', 'Firmware'),
('SENSOR_VIEW', 'Sensör Verilerini Görüntüleme', 'Sensor'),
('QR_MANAGE', 'QR Kodlarını Yönetme', 'QR'),
-- Raporlama / Log / Ayarlar
('DASHBOARD_VIEW', 'Dashboard ve Raporları Görüntüleme', 'Report'),
('REPORT_VIEW', 'Günlük/Haftalık/Aylık/Yıllık Rapor Görüntüleme', 'Report'),
('LOG_VIEW_ALL', 'Tüm Log Kayıtlarını Görüntüleme', 'Log'),
('SETTINGS_MANAGE', 'Sistem Ayarlarını Yönetme', 'Settings'),
('FILL_LEVEL_VIEW', 'Doluluk Oranını Görüntüleme', 'Machine'),
('ONLINE_STATUS_VIEW', 'Online/Offline Durumu Görüntüleme', 'Machine'),
-- YENİ modüller
('NOTIFICATION_VIEW', 'Bildirimleri Görüntüleme', 'Notification'),
('DEVICE_COMMAND_SEND', 'Cihaza Uzaktan Komut Gönderme', 'DeviceCommand'),
('DEVICE_COMMAND_VIEW', 'Komut Geçmişini Görüntüleme', 'DeviceCommand'),
('USER_PERMISSION_OVERRIDE', 'Kullanıcıya Özel Yetki Tanımlama', 'User');

-- SUPER_ADMIN -> tüm yetkiler
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'SUPER_ADMIN'), permission_id FROM permissions;

-- COMPANY (Firma/Bakanlık)
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'COMPANY'), permission_id
FROM permissions
WHERE permission_code IN (
    'MACHINE_VIEW_OWN','MACHINE_MAP_VIEW','ONLINE_STATUS_VIEW','FILL_LEVEL_VIEW',
    'FAULT_VIEW','REPORT_VIEW','DASHBOARD_VIEW','NOTIFICATION_VIEW'
);

-- MARKET
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'MARKET'), permission_id
FROM permissions
WHERE permission_code IN (
    'FILL_LEVEL_VIEW','FAULT_VIEW','ONLINE_STATUS_VIEW','SERVICE_REQUEST_CREATE',
    'NOTIFICATION_VIEW'
);

-- SERVICE_PERSONNEL
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'SERVICE_PERSONNEL'), permission_id
FROM permissions
WHERE permission_code IN (
    'MACHINE_VIEW_OWN','COVER_OPEN_ASSIGNED','MACHINE_RESTART','MACHINE_ACTIVATE',
    'SENSOR_VIEW','FAULT_CREATE','SERVICE_REQUEST_COMPLETE','NOTIFICATION_VIEW',
    'DEVICE_COMMAND_VIEW'
);

/* =====================================================================
   10. YETKİ KONTROLÜ İÇİN YARDIMCI VIEW (override'ları da hesaba katar)
   ---------------------------------------------------------------------
   Mantık:
   1) Kullanıcının rolünden gelen tüm yetkiler alınır.
   2) user_permissions'da is_granted=FALSE olan bir istisna varsa,
      o yetki listeden çıkarılır.
   3) user_permissions'da is_granted=TRUE olan ek yetkiler listeye
      eklenir (rolünde olmasa bile).
   ===================================================================== */
CREATE VIEW vw_user_permissions AS
WITH role_based AS (
    SELECT
        u.user_id,
        u.username,
        r.role_code,
        p.permission_id,
        p.permission_code
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    JOIN role_permissions rp ON rp.role_id = r.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.deleted_at IS NULL
),
role_based_minus_revoked AS (
    SELECT rb.*
    FROM role_based rb
    LEFT JOIN user_permissions up
        ON up.user_id = rb.user_id
       AND up.permission_id = rb.permission_id
       AND up.is_granted = FALSE
    WHERE up.user_id IS NULL
),
extra_granted AS (
    SELECT
        u.user_id,
        u.username,
        r.role_code,
        p.permission_id,
        p.permission_code
    FROM user_permissions up
    JOIN users u ON u.user_id = up.user_id
    JOIN roles r ON r.role_id = u.role_id
    JOIN permissions p ON p.permission_id = up.permission_id
    WHERE up.is_granted = TRUE
)
SELECT DISTINCT user_id, username, role_code, permission_code
FROM (
    SELECT * FROM role_based_minus_revoked
    UNION
    SELECT * FROM extra_granted
) combined;

/* =====================================================================
   11. updated_at OTOMATİK GÜNCELLEME (trigger ile)
   ===================================================================== */

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_markets_updated_at BEFORE UPDATE ON markets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_machines_updated_at BEFORE UPDATE ON machines
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_company_settings_updated_at BEFORE UPDATE ON company_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* =====================================================================
   12. ROL-KAPSAM TUTARLILIK KONTROLÜ (YENİ)
   ---------------------------------------------------------------------
   İş kuralı:
   - SUPER_ADMIN     -> company_id ve market_id NULL olmalı
   - COMPANY         -> company_id dolu, market_id NULL olmalı
   - MARKET          -> company_id VE market_id dolu olmalı
   - SERVICE_PERSONNEL -> company_id dolu olmalı (hangi firmaya bağlı
     olduğu bilinsin), market_id genelde NULL (saha personeli olduğu
     için tek bir markete bağlı olmayabilir)

   Bu kural önceden sadece uygulama katmanında kontrol edilebiliyordu;
   artık veritabanı seviyesinde de garanti altına alınıyor.
   ===================================================================== */
CREATE OR REPLACE FUNCTION validate_user_role_scope()
RETURNS TRIGGER AS $$
DECLARE
    v_role_code VARCHAR(50);
BEGIN
    SELECT role_code INTO v_role_code FROM roles WHERE role_id = NEW.role_id;

    IF v_role_code = 'SUPER_ADMIN' AND (NEW.company_id IS NOT NULL OR NEW.market_id IS NOT NULL) THEN
        RAISE EXCEPTION 'SUPER_ADMIN rolündeki kullanıcı bir firma/markete bağlanamaz';
    END IF;

    IF v_role_code = 'COMPANY' AND (NEW.company_id IS NULL OR NEW.market_id IS NOT NULL) THEN
        RAISE EXCEPTION 'COMPANY rolündeki kullanıcı bir firmaya bağlı olmalı ve markete bağlı olmamalı';
    END IF;

    IF v_role_code = 'MARKET' AND (NEW.company_id IS NULL OR NEW.market_id IS NULL) THEN
        RAISE EXCEPTION 'MARKET rolündeki kullanıcı hem firmaya hem markete bağlı olmalı';
    END IF;

    IF v_role_code = 'SERVICE_PERSONNEL' AND NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'SERVICE_PERSONNEL rolündeki kullanıcı bir firmaya bağlı olmalı';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_user_role_scope
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION validate_user_role_scope();

/* =====================================================================
   NOT:
   - Kapsam kontrolü (Firma yalnızca kendi makinelerini görsün, Market
     yalnızca kendi makinesini görsün vb.) uygulama katmanında
     users.company_id / users.market_id ile machines.company_id /
     market_id karşılaştırılarak yapılmalıdır (satır bazlı güvenlik).
     İstersen PostgreSQL'in ROW LEVEL SECURITY (RLS) özelliğiyle bunu
     veritabanı seviyesinde de zorunlu kılabiliriz (ayrı bir adım
     olarak eklenebilir, aşağıda taslak bırakıldı).
   - Servis personelinin hangi makinelere erişebileceği
     service_personnel_machines tablosundan kontrol edilir.
   - Tüm CRUD ve kontrol işlemleri (kapak aç/kapa, restart, firmware vb.)
     uygulama katmanında activity_logs tablosuna otomatik yazılmalıdır.
   - device_commands tablosu sayesinde artık "komut gönderildi mi",
     "cihaza ulaştı mı", "onaylandı mı" ayrı ayrı takip edilebilir;
     activity_logs ise nihai/özet kaydı tutmaya devam eder.

   RLS TASLAĞI (isteğe bağlı, aktif etmek için yorum satırından çıkar):
   ---------------------------------------------------------------------
   ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
   CREATE POLICY machines_company_scope ON machines
       USING (company_id = current_setting('app.current_company_id')::INT);
   -- Uygulama, her bağlantıda SET app.current_company_id = '<id>' çalıştırmalı.
   ===================================================================== */