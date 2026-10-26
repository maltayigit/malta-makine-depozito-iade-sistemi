/* =====================================================================
   008_add_atiksupompa_unit.sql
   -----------------------------------------------------------------
   BAĞLAM
   atik-su-pompa.html (Atık Su Pompa Motoru Durum) panelinin karşılığı
   olan 'atikSuPompa' machine_units satırı hiç provision edilmemişti
   (bkz. machines.routes.js -> DEFAULT_UNITS, 003_add_camkirma2_unit.sql
   ile aynı sınıf eksiklik). Bu yüzden GET /api/machines/:id/units
   cevabında 'atikSuPompa' hiç görünmüyor ve panel "Bu makinede
   atikSuPompa ünitesi bulunamadı" hatası veriyordu.

   NE YAPAR
   Silinmemiş (deleted_at IS NULL) her makineye 'atikSuPompa' ünitesini
   ekler. Bundan sonra oluşturulacak yeni makineler için
   machines.routes.js -> DEFAULT_UNITS listesi de güncellendi, o yüzden
   bu migration sadece GEÇMİŞE dönük (backfill) bir düzeltmedir.

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
      WHERE unit_code = 'atikSuPompa'
        AND is_running = FALSE
        AND cycle_count = 0
        AND last_started_at IS NULL;

   ===================================================================== */

DO $$
DECLARE
  inserted_count INT;
BEGIN
  INSERT INTO machine_units (machine_id, unit_code, display_name)
  SELECT m.machine_id, 'atikSuPompa', 'Atık Su Pompa Ünitesi'
  FROM machines m
  WHERE m.deleted_at IS NULL
  ON CONFLICT (machine_id, unit_code) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE '[008_add_atiksupompa_unit] % makineye atikSuPompa ünitesi eklendi.', inserted_count;
END $$;