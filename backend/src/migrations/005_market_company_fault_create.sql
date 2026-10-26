/* =====================================================================
   005_market_company_fault_create.sql
   -----------------------------------------------------------------
   ariza-bildir.html (arıza bildirme formu) MARKET ve COMPANY ("yönetici")
   rollerinin POST /api/faults çağırabilmesini bekliyor — sayfa kendi
   yorumunda bunun "003_market_fault_create.sql" migration'ıyla
   sağlandığını belirtiyordu, ama böyle bir migration hiç oluşturulmamıştı
   (gerçek 003 dosyası, alakasız bir konu olan
   003_add_camkirma2_unit.sql). Sonuç: MARKET/COMPANY kullanıcıları
   formu doldurup gönderdiğinde backend 403 (FAULT_CREATE eksik)
   döndürüyordu.

   001_core_schema.sql hiçbir şekilde değiştirilmedi; bu, 004'teki gibi
   üzerine ekleme yapan ayrı bir migrationdır.
   ===================================================================== */

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_code = 'FAULT_CREATE'
WHERE r.role_code IN ('MARKET', 'COMPANY')
ON CONFLICT (role_id, permission_id) DO NOTHING;