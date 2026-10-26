-- 013_add_gov_agency_role.sql
--
-- 1) Bakanlık için ulusal düzeyde, salt-okunur "GOV_AGENCY" rolü ekler.
--    scope.js dosyasında bu rol için kapsam zaten kısıtlamasız (TRUE)
--    tanımlıydı; burada sadece roles/role_permissions kayıtlarını
--    tamamlıyoruz.
--
-- 2) activity_logs route'unda GET (görüntüleme) ve DELETE (toplu silme)
--    şimdiye kadar TEK bir izinle (LOG_VIEW_ALL) korunuyordu. Bakanlığa
--    sadece görüntüleme vermek istediğimiz için bunları ayırıyoruz:
--    LOG_VIEW_ALL artık sadece görüntüleme, yeni LOG_DELETE ise silme
--    içindir. SUPER_ADMIN'in mevcut silme yetkisini kaybetmemesi için
--    SUPER_ADMIN'e LOG_DELETE de veriliyor.

BEGIN;

-- Yeni izin: log kayıtlarını silme (önceden LOG_VIEW_ALL'a gömülüydü)
INSERT INTO permissions (permission_code, permission_name, module_name, description)
VALUES ('LOG_DELETE', 'Log Kayıtlarını Silme', 'Log', 'Aktivite log kayıtlarını toplu/filtreli silme yetkisi')
ON CONFLICT (permission_code) DO NOTHING;

-- SUPER_ADMIN, LOG_VIEW_ALL'a zaten sahipti; artık silme ayrı izin
-- gerektirdiği için SUPER_ADMIN'e bunu da açıkça veriyoruz.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'SUPER_ADMIN' AND p.permission_code = 'LOG_DELETE'
ON CONFLICT DO NOTHING;

-- Yeni rol: Bakanlık
INSERT INTO roles (role_code, role_name, description, created_at)
VALUES (
  'GOV_AGENCY',
  'Bakanlık',
  'Ulusal düzeyde, tüm firmalara ait makineleri salt-okunur görüntüleme yetkisi',
  now()
)
ON CONFLICT (role_code) DO NOTHING;

-- Bakanlığa SADECE görüntüleme/rapor izinleri.
-- NOT: MACHINE_VIEW_OWN kullanıyoruz (isim yanıltıcı) çünkü tüm makine
-- route'ları gerçekte bu izni kontrol ediyor; "hepsini görme" kısıtlaması
-- zaten scope.js'de GOV_AGENCY için kısıtlamasız (TRUE) tanımlı.
-- DEVICE_COMMAND_SEND, MACHINE_ACTIVATE, MACHINE_RESTART, MACHINE_EDIT,
-- COVER_OPEN_* gibi hiçbir aksiyon/kontrol izni BİLİNÇLİ OLARAK verilmiyor.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'GOV_AGENCY'
  AND p.permission_code IN (
    'MACHINE_VIEW_OWN',
    'MACHINE_VIEW_ALL',
    'MACHINE_MAP_VIEW',
    'FILL_LEVEL_VIEW',
    'ONLINE_STATUS_VIEW',
    'DASHBOARD_VIEW',
    'REPORT_VIEW',
    'NOTIFICATION_VIEW',
    'FAULT_VIEW',
    'SENSOR_VIEW',
    'DEVICE_COMMAND_VIEW',
    'LOG_VIEW_ALL'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Denetim sırasında bulunan 2 ek "tek izinle görüntüleme+yazma karışık"
-- hatası da burada düzeltiliyor (GOV_AGENCY'nin sisteme hiçbir etkisi
-- olmaması için gerekliydi):
--
-- a) sessions.routes.js: aktif oturumları GÖRME ve oturumları ZORLA
--    SONLANDIRMA (tek kullanıcı veya toplu) tek bir izinle (LOG_VIEW_ALL)
--    korunuyordu. Ayrıştırıyoruz: SESSION_VIEW (görüntüleme) ve
--    SESSION_TERMINATE (sonlandırma). Önceden bu router'a sadece
--    SUPER_ADMIN erişebiliyordu (LOG_VIEW_ALL'a sahip tek rol), o yüzden
--    yetkiyi kaybetmemesi için ikisini de SUPER_ADMIN'e veriyoruz.
--
-- b) faults.routes.js: arıza durumunu güncelleme (PATCH /:id — "Çözüldü"
--    yapma, machines.is_faulty alanını da günceller) yanlışlıkla
--    FAULT_VIEW ile korunuyordu. Yeni FAULT_STATUS_UPDATE izniyle
--    ayırıyoruz; önceden FAULT_VIEW'a sahip olan roller (SUPER_ADMIN,
--    COMPANY, MARKET) yetkilerini kaybetmesin diye onlara da veriyoruz.
-- ---------------------------------------------------------------------

INSERT INTO permissions (permission_code, permission_name, module_name, description)
VALUES
  ('SESSION_VIEW', 'Aktif Oturumları Görüntüleme', 'Session', 'Sistemdeki aktif kullanıcı oturumlarını görüntüleme yetkisi'),
  ('SESSION_TERMINATE', 'Oturumu Zorla Sonlandırma', 'Session', 'Bir veya birden çok kullanıcı oturumunu zorla sonlandırma (force logout) yetkisi'),
  ('FAULT_STATUS_UPDATE', 'Arıza Durumunu Güncelleme', 'Fault', 'Arıza kaydının durumunu (açık/işlemde/çözüldü) değiştirme yetkisi')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'SUPER_ADMIN'
  AND p.permission_code IN ('SESSION_VIEW', 'SESSION_TERMINATE', 'FAULT_STATUS_UPDATE')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code IN ('COMPANY', 'MARKET')
  AND p.permission_code = 'FAULT_STATUS_UPDATE'
ON CONFLICT DO NOTHING;

-- NOT: GOV_AGENCY'ye (bakanlık) SESSION_VIEW, SESSION_TERMINATE veya
-- FAULT_STATUS_UPDATE BİLİNÇLİ OLARAK verilmiyor — bunlar sisteme etki
-- eden (oturum sonlandırma, arıza durumu/makine durumu değiştirme)
-- yetkiler, bakanlık sadece görüntüleme yapmalı.

-- c) notifications.routes.js: bildirimi/bildirimleri "okundu" işaretleme
--    (PATCH /:id/read, PATCH /read-all) yanlışlıkla NOTIFICATION_VIEW ile
--    korunuyordu. Bu işlem sadece kullanıcının KENDİ bildirimlerini
--    etkiliyor (başka kullanıcıyı/makineyi etkilemiyor), ama "bakanlığın
--    sisteme hiçbir etkisi olmasın" isteği net olduğu için bunu da
--    ayırıyoruz: yeni NOTIFICATION_MANAGE izni. Önceden NOTIFICATION_VIEW'a
--    sahip roller (SUPER_ADMIN, COMPANY, MARKET, SERVICE_PERSONNEL)
--    yetkilerini kaybetmesin diye onlara da veriyoruz.
-- ---------------------------------------------------------------------

INSERT INTO permissions (permission_code, permission_name, module_name, description)
VALUES ('NOTIFICATION_MANAGE', 'Bildirimleri Okundu İşaretleme', 'Notification', 'Kendi bildirimlerini okundu olarak işaretleme yetkisi')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code IN ('SUPER_ADMIN', 'COMPANY', 'MARKET', 'SERVICE_PERSONNEL')
  AND p.permission_code = 'NOTIFICATION_MANAGE'
ON CONFLICT DO NOTHING;

-- NOT: GOV_AGENCY'ye NOTIFICATION_MANAGE de BİLİNÇLİ OLARAK verilmiyor —
-- bakanlık bildirimleri görebilir ama "okundu" durumunu bile değiştiremez;
-- gerçekten sıfır yazma/etki hedefleniyor.

COMMIT;

-- ---------------------------------------------------------------------
-- validate_user_role_scope trigger fonksiyonunu GOV_AGENCY için de
-- güncelliyoruz: SUPER_ADMIN gibi, bakanlık kullanıcısı da hiçbir firma/
-- markete bağlı olmamalı (scope.js zaten bu rol için kısıtlamasız
-- çalışıyor, DB seviyesinde de tutarlı olsun).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_user_role_scope()
RETURNS TRIGGER AS $$
DECLARE
    v_role_code VARCHAR(50);
BEGIN
    SELECT role_code INTO v_role_code FROM roles WHERE role_id = NEW.role_id;

    IF v_role_code = 'SUPER_ADMIN' AND (NEW.company_id IS NOT NULL OR NEW.market_id IS NOT NULL) THEN
        RAISE EXCEPTION 'SUPER_ADMIN rolündeki kullanıcı bir firma/markete bağlanamaz';
    END IF;

    IF v_role_code = 'GOV_AGENCY' AND (NEW.company_id IS NOT NULL OR NEW.market_id IS NOT NULL) THEN
        RAISE EXCEPTION 'GOV_AGENCY rolündeki kullanıcı bir firma/markete bağlanamaz';
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