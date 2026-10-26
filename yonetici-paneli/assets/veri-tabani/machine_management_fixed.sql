/* =====================================================================
   MAKİNE YÖNETİM SİSTEMİ - RBAC VERİTABANI ŞEMASI (PostgreSQL)
   v4 - DÜZELTİLMİŞ VE BİRLEŞTİRİLMİŞ ŞEMA
   =====================================================================
   Roller (DEĞİŞTİRİLMEDİ - aynen korundu):
       SUPER_ADMIN, COMPANY (Firma), MARKET, SERVICE_PERSONNEL, GOV_AGENCY

   BU DOSYA NEDEN OLUŞTURULDU?
   ---------------------------------------------------------------------
   Yüklenen 3 kaynak karşılaştırıldığında (backend/src/migrations/001,
   backend/src/migrations/002, veri-tabani/migration_gov_agency_malta.sql
   ve elinizdeki machine_1_.sql) aralarında tutarsızlıklar bulundu:

   1) [KRİTİK] machine_1_.sql (v3) "roller aynı kalsın" ilkesine rağmen
      COMPANY rolünü ROLES tablosuna hiç EKLEMİYORDU. Oysa backend kodu
      (scope.js, users.routes.js, auth akışı) COMPANY rolüne defalarca
      referans veriyor. Bu sürümde COMPANY rolü geri eklendi.
   2) [KRİTİK] backend/src/lib/scope.js dosyasında GOV_AGENCY rolü için
      hiç bir case yoktu (default -> FALSE), yani Çevre Ajansı kullanıcısı
      hiçbir makineyi göremiyordu. Bu, ayrı bir backend kod düzeltmesi
      olarak scope.js içinde de ayrıca düzeltildi (bu SQL dosyası bunu
      değiştirmez, sadece veritabanı tarafını tutarlı hale getirir).
   3) 002_frontend_extensions.sql'deki (machine_compartments, machine_units,
      machine_power_state, machine_screens) tabloları machine_1_.sql'de HİÇ
      yoktu; ama panel (doluluk.html, ezme*.html, cam-kirma.html,
      ekran-durumu.html) ve machines/machineOperations/dashboard route'ları
      bu tabloları KULLANIYOR. Bu sürüme eklendi.
   4) validate_user_role_scope() fonksiyonu, artık 5 rolün TÜMÜNÜ (COMPANY
      dahil) kapsayacak şekilde birleştirildi.
   5) Rol-izin (role_permissions) eşleştirmeleri COMPANY için de eklendi.

   Kurulum:
       createdb -U postgres machine_management_db
       psql -U postgres -d machine_management_db -f machine_management_fixed.sql
   ===================================================================== */

BEGIN;

/* =====================================================================
   0. YARDIMCI FONKSİYONLAR
   ===================================================================== */

CREATE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

/* ---------------------------------------------------------------------
   Rol-kapsam tutarlılık kontrolü (5 rolün tamamı).
   ---------------------------------------------------------------------
   - SUPER_ADMIN       -> HİÇBİR KISITLAMA YOK.
   - COMPANY           -> company_id dolu, market_id VE agency_id NULL olmalı
   - MARKET            -> company_id VE market_id dolu, agency_id NULL olmalı
   - SERVICE_PERSONNEL -> company_id dolu, agency_id NULL olmalı
   - GOV_AGENCY        -> agency_id dolu, company_id VE market_id NULL olmalı
   ===================================================================== */
CREATE FUNCTION validate_user_role_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_role_code VARCHAR(50);
BEGIN
    SELECT role_code INTO v_role_code FROM roles WHERE role_id = NEW.role_id;

    IF v_role_code = 'SUPER_ADMIN' THEN
        RETURN NEW;
    END IF;

    IF v_role_code = 'COMPANY' AND (NEW.company_id IS NULL OR NEW.market_id IS NOT NULL OR NEW.agency_id IS NOT NULL) THEN
        RAISE EXCEPTION 'COMPANY rolündeki kullanıcı bir firmaya bağlı olmalı; markete/kuruma bağlı olmamalı';
    END IF;

    IF v_role_code = 'MARKET' AND (NEW.company_id IS NULL OR NEW.market_id IS NULL OR NEW.agency_id IS NOT NULL) THEN
        RAISE EXCEPTION 'MARKET rolündeki kullanıcı hem firmaya hem markete bağlı olmalı, kuruma bağlı olmamalı';
    END IF;

    IF v_role_code = 'SERVICE_PERSONNEL' AND (NEW.company_id IS NULL OR NEW.agency_id IS NOT NULL) THEN
        RAISE EXCEPTION 'SERVICE_PERSONNEL rolündeki kullanıcı bir firmaya bağlı olmalı, kuruma bağlı olmamalı';
    END IF;

    IF v_role_code = 'GOV_AGENCY' AND (NEW.agency_id IS NULL OR NEW.company_id IS NOT NULL OR NEW.market_id IS NOT NULL) THEN
        RAISE EXCEPTION 'GOV_AGENCY rolündeki kullanıcı bir kuruma (bakanlık/ajans) bağlı olmalı; firma/markete bağlı olamaz';
    END IF;

    RETURN NEW;
END;
$$;

/* =====================================================================
   1. ROL VE YETKİ TABLOLARI (RBAC ÇEKİRDEĞİ)
   ===================================================================== */

CREATE TABLE roles (
    role_id         SERIAL PRIMARY KEY,
    role_code       VARCHAR(50)  NOT NULL UNIQUE,
    role_name       VARCHAR(100) NOT NULL,
    description     VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
    permission_id   SERIAL PRIMARY KEY,
    permission_code VARCHAR(100) NOT NULL UNIQUE,
    permission_name VARCHAR(150) NOT NULL,
    module_name     VARCHAR(100),
    description     VARCHAR(500)
);

CREATE TABLE role_permissions (
    role_id         INT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id   INT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

/* =====================================================================
   2. ORGANİZASYON TABLOLARI (Firma / Market / Kamu Kurumu)
   ===================================================================== */

CREATE TABLE companies (
    company_id      SERIAL PRIMARY KEY,
    company_name    VARCHAR(200) NOT NULL,
    contact_person  VARCHAR(150),
    phone           VARCHAR(30),
    email           VARCHAR(150),
    address         VARCHAR(500),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE markets (
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
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE company_settings (
    company_id                 INT PRIMARY KEY REFERENCES companies(company_id) ON DELETE CASCADE,
    low_fill_alert_threshold   NUMERIC(5,2) NOT NULL DEFAULT 85.00,
    offline_alert_minutes      INT NOT NULL DEFAULT 60,
    notify_by_email            BOOLEAN NOT NULL DEFAULT TRUE,
    notify_by_push             BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at                 TIMESTAMPTZ
);

CREATE TABLE government_agencies (
    agency_id       SERIAL PRIMARY KEY,
    agency_name     VARCHAR(200) NOT NULL,
    agency_type     VARCHAR(100),
    contact_person  VARCHAR(150),
    phone           VARCHAR(30),
    email           VARCHAR(150),
    address         VARCHAR(500),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_government_agencies_active_name
    ON government_agencies (agency_name)
    WHERE deleted_at IS NULL;

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
    company_id      INT REFERENCES companies(company_id),
    market_id       INT REFERENCES markets(market_id),
    agency_id       INT REFERENCES government_agencies(agency_id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    failed_login_attempts  INT NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    password_changed_at     TIMESTAMPTZ,
    must_change_password    BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at              TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ
);

CREATE TABLE user_permissions (
    user_id             INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    permission_id       INT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    is_granted          BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by_user_id  INT REFERENCES users(user_id),
    granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    note                VARCHAR(300),
    PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE refresh_tokens (
    token_id        BIGSERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
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
    machine_code    VARCHAR(50) NOT NULL UNIQUE,
    company_id      INT NOT NULL REFERENCES companies(company_id),
    market_id       INT REFERENCES markets(market_id),
    latitude        NUMERIC(9,6),
    longitude       NUMERIC(9,6),
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','PASSIVE')),
    online_status   VARCHAR(20) NOT NULL DEFAULT 'OFFLINE'
        CHECK (online_status IN ('ONLINE','OFFLINE')),
    fill_level      NUMERIC(5,2),
    is_faulty       BOOLEAN NOT NULL DEFAULT FALSE,
    firmware_version VARCHAR(50),
    device_api_key         VARCHAR(255) UNIQUE,
    device_api_secret_hash VARCHAR(255),
    device_key_rotated_at  TIMESTAMPTZ,
    last_seen_at    TIMESTAMPTZ,
    installed_at    TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ
);

CREATE TABLE machine_covers (
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
    sensor_type     VARCHAR(50) NOT NULL,
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

CREATE TABLE device_commands (
    command_id          BIGSERIAL PRIMARY KEY,
    machine_id          INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    command_type        VARCHAR(50) NOT NULL,
    payload             JSONB,
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
   4b. PANEL (SİTE) İÇİN GEREKLİ EK TABLOLAR
   ---------------------------------------------------------------------
   machine_1_.sql'de (v3) eksikti; panel HTML sayfaları (doluluk.html,
   ezme1/2/3.html, cam-kirma.html, ekran-durumu.html) ve backend route'ları
   (machines.routes.js, machineOperations.routes.js, dashboard.routes.js)
   bu tabloları doğrudan kullanıyor.
   ===================================================================== */

CREATE TABLE machine_compartments (
    compartment_id      SERIAL PRIMARY KEY,
    machine_id           INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    compartment_code     VARCHAR(30) NOT NULL,
    display_name          VARCHAR(100) NOT NULL,
    unit                   VARCHAR(20) NOT NULL DEFAULT 'adet',
    capacity                NUMERIC(10,2) NOT NULL DEFAULT 100,
    fill_percent            NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (fill_percent BETWEEN 0 AND 100),
    warning_threshold        NUMERIC(5,2) NOT NULL DEFAULT 60,
    critical_threshold        NUMERIC(5,2) NOT NULL DEFAULT 85,
    auto_shutdown_threshold    NUMERIC(5,2) NOT NULL DEFAULT 98,
    last_emptied_at            TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (machine_id, compartment_code)
);
CREATE INDEX idx_machine_compartments_machine ON machine_compartments (machine_id);

CREATE TABLE machine_units (
    unit_id              SERIAL PRIMARY KEY,
    machine_id            INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    unit_code               VARCHAR(30) NOT NULL,
    display_name             VARCHAR(100) NOT NULL,
    is_running                 BOOLEAN NOT NULL DEFAULT FALSE,
    is_jammed                   BOOLEAN NOT NULL DEFAULT FALSE,
    cycle_count                  INT NOT NULL DEFAULT 0,
    last_started_at               TIMESTAMPTZ,
    last_stopped_at                TIMESTAMPTZ,
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (machine_id, unit_code)
);
CREATE INDEX idx_machine_units_machine ON machine_units (machine_id);

CREATE TABLE machine_power_state (
    machine_id     INT PRIMARY KEY REFERENCES machines(machine_id) ON DELETE CASCADE,
    is_powered_on   BOOLEAN NOT NULL DEFAULT FALSE,
    power_blocked_reason  VARCHAR(500),
    changed_by_user_id     INT REFERENCES users(user_id),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE machine_screens (
    screen_id         SERIAL PRIMARY KEY,
    machine_id          INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    screen_code            VARCHAR(30) NOT NULL,
    display_name             VARCHAR(100) NOT NULL,
    last_heartbeat_at          TIMESTAMPTZ,
    last_page                   VARCHAR(200),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (machine_id, screen_code)
);
CREATE INDEX idx_machine_screens_machine ON machine_screens (machine_id);

/* =====================================================================
   5. SERVİS PERSONELİ ATAMA VE İŞLEM TABLOLARI
   ===================================================================== */

CREATE TABLE service_personnel_machines (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(user_id),
    machine_id      INT NOT NULL REFERENCES machines(machine_id),
    assigned_by_user_id INT REFERENCES users(user_id),
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, machine_id)
);

CREATE TABLE fault_records (
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

CREATE TABLE fault_attachments (
    attachment_id       SERIAL PRIMARY KEY,
    fault_id            INT NOT NULL REFERENCES fault_records(fault_id) ON DELETE CASCADE,
    file_url            VARCHAR(500) NOT NULL,
    file_type           VARCHAR(50),
    uploaded_by_user_id INT NOT NULL REFERENCES users(user_id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fault_attachments_fault ON fault_attachments (fault_id);

CREATE TABLE service_requests (
    service_request_id SERIAL PRIMARY KEY,
    machine_id      INT NOT NULL REFERENCES machines(machine_id),
    requested_by_user_id INT NOT NULL REFERENCES users(user_id),
    description     VARCHAR(1000),
    status          VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED')),
    completed_by_user_id INT REFERENCES users(user_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

/* =====================================================================
   6. BİLDİRİMLER
   ===================================================================== */
CREATE TABLE notifications (
    notification_id     BIGSERIAL PRIMARY KEY,
    user_id              INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    notification_type    VARCHAR(50) NOT NULL,
    title                 VARCHAR(200) NOT NULL,
    message               VARCHAR(1000),
    related_entity_type   VARCHAR(100),
    related_entity_id     INT,
    is_read               BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at               TIMESTAMPTZ
);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, is_read, created_at DESC);

/* =====================================================================
   7. MALTA MAKİNE UYGULAMASI ENTEGRASYON TABLOLARI
   ===================================================================== */

CREATE TABLE malta_readings (
    malta_reading_id           BIGSERIAL PRIMARY KEY,
    machine_id               INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    external_reference_code  VARCHAR(100),
    data_type                VARCHAR(50) NOT NULL,
    value                    NUMERIC(10,2),
    unit                     VARCHAR(20),
    raw_payload              JSONB,
    recorded_at              TIMESTAMPTZ NOT NULL,
    synced_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_malta_readings_machine_id  ON malta_readings (machine_id);
CREATE INDEX idx_malta_readings_recorded_at ON malta_readings (recorded_at);
CREATE INDEX idx_malta_readings_ext_ref_code ON malta_readings (external_reference_code);

CREATE TABLE malta_sync_logs (
    sync_log_id        BIGSERIAL PRIMARY KEY,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
    records_processed   INT DEFAULT 0,
    error_message       VARCHAR(1000)
);
CREATE INDEX idx_malta_sync_logs_status ON malta_sync_logs (status);

/* =====================================================================
   8. DENETİM (LOG) TABLOSU
   ===================================================================== */

CREATE TABLE activity_logs (
    log_id          BIGSERIAL PRIMARY KEY,
    user_id         INT REFERENCES users(user_id),
    role_code       VARCHAR(50),
    action_type     VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(100),
    entity_id       INT,
    details         TEXT,
    ip_address      VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_logs_user_time ON activity_logs (user_id, created_at DESC);
CREATE INDEX idx_activity_logs_entity ON activity_logs (entity_type, entity_id);

/* =====================================================================
   9. EKSİK FK İNDEXLERİ
   ===================================================================== */
CREATE INDEX idx_markets_company            ON markets (company_id);
CREATE INDEX idx_users_role                 ON users (role_id);
CREATE INDEX idx_users_company              ON users (company_id);
CREATE INDEX idx_users_market               ON users (market_id);
CREATE INDEX idx_users_agency               ON users (agency_id);
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
   10. BAŞLANGIÇ VERİLERİ (SEED DATA) - Roller (5 ROL - AYNEN KORUNDU)
   ===================================================================== */

INSERT INTO roles (role_code, role_name, description) VALUES
('SUPER_ADMIN', 'Malta Makine (Super Admin)', 'Sistemin tam yetkili sahibi - her şeye bağlanabilir, her şeyi yönetir'),
('COMPANY', 'Firma', 'Kendi firmasına ait makineleri görüntüleme ve yönetme yetkisi'),
('MARKET', 'Market', 'Mağaza bazlı görüntüleme ve servis talebi yetkisi'),
('SERVICE_PERSONNEL', 'Servis Personeli', 'Saha operasyon yetkisi (mobil uygulama)'),
('GOV_AGENCY', 'Kamu Kurumu (Bakanlık/Ajans)', 'Tüm firmalara ait makineleri ulusal düzeyde salt-okunur izleme yetkisi: konum, arıza, doluluk oranı ve Malta Makine verisi');

/* =====================================================================
   11. BAŞLANGIÇ VERİLERİ - İzinler
   ===================================================================== */

INSERT INTO permissions (permission_code, permission_name, module_name) VALUES
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
('COVER_OPEN_ALL',  'Tüm Kapakları Açma/Kapama', 'Cover'),
('COVER_OPEN_ASSIGNED', 'Yetkili Olunan Kapakları Açma/Kapama', 'Cover'),
('SERVICE_PERSONNEL_CREATE', 'Servis Personeli Oluşturma', 'User'),
('FAULT_CREATE', 'Arıza Kaydı Oluşturma', 'Fault'),
('FAULT_VIEW', 'Arızalı Makineleri Görüntüleme', 'Fault'),
('SERVICE_REQUEST_CREATE', 'Servis Talebi Oluşturma', 'ServiceRequest'),
('SERVICE_REQUEST_COMPLETE', 'Servis İşlemini Tamamlama', 'ServiceRequest'),
('FIRMWARE_UPDATE', 'Firmware Güncellemesi Gönderme', 'Firmware'),
('SENSOR_VIEW', 'Sensör Verilerini Görüntüleme', 'Sensor'),
('QR_MANAGE', 'QR Kodlarını Yönetme', 'QR'),
('DASHBOARD_VIEW', 'Dashboard ve Raporları Görüntüleme', 'Report'),
('REPORT_VIEW', 'Günlük/Haftalık/Aylık/Yıllık Rapor Görüntüleme', 'Report'),
('LOG_VIEW_ALL', 'Tüm Log Kayıtlarını Görüntüleme', 'Log'),
('SETTINGS_MANAGE', 'Sistem Ayarlarını Yönetme', 'Settings'),
('FILL_LEVEL_VIEW', 'Doluluk Oranını Görüntüleme', 'Machine'),
('ONLINE_STATUS_VIEW', 'Online/Offline Durumu Görüntüleme', 'Machine'),
('NOTIFICATION_VIEW', 'Bildirimleri Görüntüleme', 'Notification'),
('DEVICE_COMMAND_SEND', 'Cihaza Uzaktan Komut Gönderme', 'DeviceCommand'),
('DEVICE_COMMAND_VIEW', 'Komut Geçmişini Görüntüleme', 'DeviceCommand'),
('USER_PERMISSION_OVERRIDE', 'Kullanıcıya Özel Yetki Tanımlama', 'User'),
('AGENCY_CREATE', 'Kurum/Ajans Ekleme', 'Agency'),
('AGENCY_EDIT',   'Kurum/Ajans Düzenleme', 'Agency'),
('AGENCY_DELETE', 'Kurum/Ajans Silme', 'Agency'),
('MALTA_DATA_VIEW', 'Malta Makine Entegrasyon Verilerini Görüntüleme', 'MALTA'),
('MALTA_SYNC_MANAGE', 'Malta Makine Senkronizasyon Yönetimi', 'MALTA');

/* =====================================================================
   12. ROL-İZİN EŞLEŞTİRMELERİ (5 rolün tamamı)
   ===================================================================== */

-- SUPER_ADMIN -> tüm yetkiler
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'SUPER_ADMIN'), permission_id FROM permissions;

-- COMPANY -> kendi firmasına ait makineleri görme + market/servis personeli yönetimi + raporlar
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'COMPANY'), permission_id
FROM permissions
WHERE permission_code IN (
    'MACHINE_VIEW_OWN','MACHINE_MAP_VIEW','ONLINE_STATUS_VIEW','FILL_LEVEL_VIEW',
    'FAULT_VIEW','REPORT_VIEW','DASHBOARD_VIEW','NOTIFICATION_VIEW',
    'MARKET_CREATE','MARKET_EDIT','MARKET_DELETE',
    'MACHINE_CREATE','MACHINE_EDIT','MACHINE_ASSIGN','MACHINE_ACTIVATE',
    'SERVICE_PERSONNEL_CREATE','COVER_OPEN_ALL','DEVICE_COMMAND_VIEW'
);

-- MARKET -> kendi marketini görme + kapak aç/kapa + makine aktif/pasif + arıza görme
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'MARKET'), permission_id
FROM permissions
WHERE permission_code IN (
    'MACHINE_VIEW_OWN','FILL_LEVEL_VIEW','FAULT_VIEW','ONLINE_STATUS_VIEW',
    'SERVICE_REQUEST_CREATE','NOTIFICATION_VIEW',
    'COVER_OPEN_ASSIGNED','MACHINE_ACTIVATE'
);

-- SERVICE_PERSONNEL (mobil uygulama - TEK giriş yapabilen rol)
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'SERVICE_PERSONNEL'), permission_id
FROM permissions
WHERE permission_code IN (
    'MACHINE_VIEW_OWN','COVER_OPEN_ASSIGNED','MACHINE_RESTART','MACHINE_ACTIVATE',
    'SENSOR_VIEW','FAULT_CREATE','SERVICE_REQUEST_COMPLETE','NOTIFICATION_VIEW',
    'DEVICE_COMMAND_VIEW'
);

-- GOV_AGENCY (Çevre Ajansı) -> SADECE salt-okunur, ULUSAL DÜZEYDE
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'GOV_AGENCY'), permission_id
FROM permissions
WHERE permission_code IN (
    'MACHINE_VIEW_ALL','MACHINE_MAP_VIEW','FAULT_VIEW','FILL_LEVEL_VIEW',
    'ONLINE_STATUS_VIEW','DASHBOARD_VIEW','REPORT_VIEW','NOTIFICATION_VIEW',
    'MALTA_DATA_VIEW'
);

/* =====================================================================
   13. YETKİ KONTROLÜ İÇİN YARDIMCI VIEW (override'ları da hesaba katar)
   ===================================================================== */
CREATE VIEW vw_user_permissions AS
WITH role_based AS (
    SELECT u.user_id, u.username, r.role_code, p.permission_id, p.permission_code
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
    SELECT u.user_id, u.username, r.role_code, p.permission_id, p.permission_code
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
   14. ÇEVRE AJANSI / BAKANLIK PANELİ İÇİN HAZIR GÖRÜNÜM (VIEW)
   ===================================================================== */
CREATE VIEW vw_agency_machine_overview AS
SELECT
    m.machine_id,
    m.machine_code,
    c.company_name,
    mk.market_name,
    m.latitude,
    m.longitude,
    m.status,
    m.online_status,
    m.fill_level,
    m.is_faulty,
    m.last_seen_at,
    (
        SELECT count(*)
        FROM fault_records fr
        WHERE fr.machine_id = m.machine_id
          AND fr.status <> 'RESOLVED'
    ) AS open_fault_count,
    malta.value        AS malta_last_value,
    malta.unit         AS malta_last_unit,
    malta.data_type    AS malta_last_data_type,
    malta.recorded_at  AS malta_last_recorded_at
FROM machines m
JOIN companies c ON c.company_id = m.company_id
LEFT JOIN markets mk ON mk.market_id = m.market_id
LEFT JOIN LATERAL (
    SELECT dr.value, dr.unit, dr.data_type, dr.recorded_at
    FROM malta_readings dr
    WHERE dr.machine_id = m.machine_id
    ORDER BY dr.recorded_at DESC
    LIMIT 1
) malta ON true
WHERE m.deleted_at IS NULL;

/* =====================================================================
   15. updated_at OTOMATİK GÜNCELLEME (trigger ile)
   ===================================================================== */

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
CREATE TRIGGER trg_government_agencies_updated_at BEFORE UPDATE ON government_agencies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_compartments_updated_at BEFORE UPDATE ON machine_compartments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_units_updated_at BEFORE UPDATE ON machine_units
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_power_state_updated_at BEFORE UPDATE ON machine_power_state
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_screens_updated_at BEFORE UPDATE ON machine_screens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* =====================================================================
   16. ROL-KAPSAM TUTARLILIK TRIGGER'I
   ===================================================================== */
CREATE TRIGGER trg_validate_user_role_scope
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION validate_user_role_scope();

/* =====================================================================
   17. GERÇEK KULLANIM İÇİN BAŞLANGIÇ VERİSİ
   ---------------------------------------------------------------------
   1 firma, 1 market, 1 kurum (Çevre Ajansı), 4 giriş kullanıcısı
   (+ 1 servis personeli - mobil uygulamayı test etmek için).
   Şifreler bcryptjs SALT_ROUNDS=12 ile hash'lenmiştir.
   ===================================================================== */

INSERT INTO companies (company_name, contact_person, phone, email)
VALUES ('Malta Makine', 'Yönetici', '0000000000', 'info@maltamakine.com');

INSERT INTO markets (company_id, market_name, address, contact_person, phone)
VALUES (1, 'Market 1', 'Adres bilgisi girilecek', 'Market Sorumlusu', '0000000000');

INSERT INTO company_settings (company_id) VALUES (1);

INSERT INTO government_agencies (agency_name, agency_type)
VALUES ('Çevre Ajansı', 'BAKANLIK');

-- superadmin       / SuperAdmin123!
-- firma            / Firma123!
-- market           / Market123!
-- servispersoneli  / Servis123!      <-- SADECE bu rol mobil uygulamaya giriş yapabilir
-- cevreajansi      / Bakanlik123!
INSERT INTO users (username, password_hash, full_name, email, role_id, company_id, market_id, agency_id, password_changed_at)
VALUES
  ('superadmin', '$2a$12$vv30.vY20eGJYf.OSIMOJ.3vaZTiwJOPBk88uleG.Ls0YtUNWqWy.', 'Sistem Yöneticisi', 'admin@maltamakine.com',
   (SELECT role_id FROM roles WHERE role_code = 'SUPER_ADMIN'), NULL, NULL, NULL, now()),
  ('firma', '$2a$12$8798R4QqsdhYhZFhdQA.iuq8ApeobnmtC6rxd/OslHuYaccAoTkyG', 'Firma Kullanıcısı', 'firma@maltamakine.com',
   (SELECT role_id FROM roles WHERE role_code = 'COMPANY'), 1, NULL, NULL, now()),
  ('market', '$2a$12$8798R4QqsdhYhZFhdQA.iuq8ApeobnmtC6rxd/OslHuYaccAoTkyG', 'Market Kullanıcısı', 'market@maltamakine.com',
   (SELECT role_id FROM roles WHERE role_code = 'MARKET'), 1, 1, NULL, now()),
  ('servispersoneli', '$2a$12$8798R4QqsdhYhZFhdQA.iuq8ApeobnmtC6rxd/OslHuYaccAoTkyG', 'Servis Personeli', 'servis@maltamakine.com',
   (SELECT role_id FROM roles WHERE role_code = 'SERVICE_PERSONNEL'), 1, NULL, NULL, now()),
  ('cevreajansi', '$2a$12$VSulPKDkPNmCKrzqwshCOu5JxFHoVCct1hdq6YVLtovHAiSD6c/xW', 'Çevre Ajansı Yetkilisi', 'cevreajansi@maltamakine.com',
   (SELECT role_id FROM roles WHERE role_code = 'GOV_AGENCY'), NULL, NULL, (SELECT agency_id FROM government_agencies WHERE agency_name = 'Çevre Ajansı'), now());

COMMIT;

/* =====================================================================
   ÖNEMLİ NOT — MOBİL UYGULAMA GİRİŞ KISITI:
   ---------------------------------------------------------------------
   "roller aynı kalsın" isteği gereği ROLES tablosuna dokunulmadı/yeni rol
   eklenmedi. Mobil uygulamanın SADECE SERVICE_PERSONNEL rolündeki
   kullanıcıları içeri alması, backend'de auth.routes.js login uç
   noktasına eklenen "clientType" kontrolüyle sağlanıyor (bkz. backend
   kod düzeltmeleri): mobil istemciden gelen bir login isteğinde
   role_code SERVICE_PERSONNEL değilse istek 403 ile reddedilir. Aynı
   kontrol Flutter tarafında da (login_screen.dart) tekrar uygulanır.

   ⚠️  Yukarıdaki şifreler test amaçlıdır, ilk girişten sonra değiştirilmelidir.
   ===================================================================== */
