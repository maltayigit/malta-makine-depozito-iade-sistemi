/* =====================================================================
   004_market_doluluk_permissions.sql
   -----------------------------------------------------------------
   001_core_schema.sql'deki orijinal seed verisinde MARKET rolüne
   FILL_LEVEL_VIEW yetkisi verilmişti ama doluluk.html sayfasının
   fiilen çalışabilmesi için gereken iki yetki eksikti:

     - MACHINE_VIEW_OWN     → GET /api/machines (market kendi makinesini
                               bulabilsin diye; scope zaten market_id'ye
                               göre filtreleniyor, bu yetki olmadan liste
                               uç noktası 403 dönüyordu)
     - DEVICE_COMMAND_SEND  → POST /compartments/:code/empty ("Tümünü
                               Boşalt" / tekil bölme boşaltma butonları
                               için)

   001_core_schema.sql hiçbir şekilde değiştirilmedi (talimat gereği);
   bu sadece üzerine ekleme yapan ayrı bir migrationdır.
   ===================================================================== */

INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT role_id FROM roles WHERE role_code = 'MARKET'), permission_id
FROM permissions
WHERE permission_code IN ('MACHINE_VIEW_OWN', 'DEVICE_COMMAND_SEND')
ON CONFLICT (role_id, permission_id) DO NOTHING;