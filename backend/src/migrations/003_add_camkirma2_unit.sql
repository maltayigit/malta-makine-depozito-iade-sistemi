/* =====================================================================
   003_add_camkirma2_unit.sql
   -----------------------------------------------------------------
   BAĞLAM
   cam-kirma2.html (2. Cam Kırma Durum) panelinin karşılığı olan
   'camKirma2' machine_units satırı hiç provision edilmemişti — sadece
   tek bir 'camKirma' ünitesi vardı (bkz. 002_frontend_extensions.sql,
   machines.routes.js -> DEFAULT_UNITS). Bu yüzden GET
   /api/machines/:id/units cevabında 'camKirma2' hiç görünmüyor ve
   panel "Bu makinede camKirma2 ünitesi tanımlı değil" hatası veriyordu.

   NE YAPAR
   Silinmemiş (deleted_at IS NULL) her makineye 'camKirma2' ünitesini
   ekler. Bundan sonra oluşturulacak yeni makineler için
   machines.routes.js -> DEFAULT_UNITS listesi zaten güncellendi, o
   yüzden bu migration sadece GEÇMİŞE dönük (backfill) bir düzeltmedir.

   GÜVENLİK / IDEMPOTENCY
   - ON CONFLICT (machine_id, unit_code) DO NOTHING sayesinde bu dosya
     yanlışlıkla elle tekrar çalıştırılsa bile veri bozulmaz.
   - migrate.js zaten schema_migrations tablosuna bakıp bu dosyayı bir
     daha uygulamaz; bu güvenlik ikinci bir katman olarak eklendi.
   - Var olan hiçbir satır UPDATE/DELETE edilmiyor; sadece eksik satır
     ekleniyor, dolayısıyla geri dönüşü olmayan bir veri kaybı riski yok.

   GERİ ALMA (bu migration sistemi "down" migration desteklemiyor;
   gerekirse aşağıdaki sorguyu elle çalıştırın — SADECE bu migration'ın
   eklediği, henüz hiç kullanılmamış satırları siler):

     DELETE FROM machine_units
      WHERE unit_code = 'camKirma2'
        AND is_running = FALSE
        AND cycle_count = 0
        AND last_started_at IS NULL;

   ===================================================================== */

DO $$
DECLARE
  inserted_count INT;
BEGIN
  INSERT INTO machine_units (machine_id, unit_code, display_name)
  SELECT m.machine_id, 'camKirma2', '2. Cam Kırma Ünitesi'
  FROM machines m
  WHERE m.deleted_at IS NULL
  ON CONFLICT (machine_id, unit_code) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE '[003_add_camkirma2_unit] % makineye camKirma2 ünitesi eklendi.', inserted_count;
END $$;