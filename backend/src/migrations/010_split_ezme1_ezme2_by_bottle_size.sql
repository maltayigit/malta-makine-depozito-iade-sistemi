/* =====================================================================
   010_split_ezme1_ezme2_by_bottle_size.sql
   -----------------------------------------------------------------
   BAĞLAM
   1. ve 2. Plastik Ezme üniteleri artık şişe boyutuna göre FİZİKSEL
   OLARAK AYRI iki motora bölündü:
     - ezme1  → ezme1_05l (0.5L şişeler) + ezme1_13l (1-3L şişeler)
     - ezme2  → ezme2_05l (0.5L şişeler) + ezme2_13l (1-3L şişeler)
   Frontend tarafında bu, ezme1.html/ezme2.html'in yerini alan
   ezme1-05l.html / ezme1-13l.html / ezme2-05l.html / ezme2-13l.html
   sayfalarına ve uniteAyarlari (ezme-veri.js) içindeki yeni
   backendKod değerlerine karşılık gelir.

   NE YAPAR
   1) Silinmemiş (deleted_at IS NULL) her makineye 4 yeni üniteyi
      (ezme1_05l, ezme1_13l, ezme2_05l, ezme2_13l) sıfır durumda ekler.
   2) Eski 'ezme1' ve 'ezme2' ünite kayıtlarını SİLER — bunlar artık
      fiziksel olarak mevcut değil, yeni donanımla değiştirildi.

   VERİ KAYBI UYARISI
   Eski 'ezme1'/'ezme2' satırlarındaki cycle_count / is_running /
   is_jammed geçmişi bilerek korunmuyor (yeni donanım sıfırdan
   sayıyor). machine_units dışındaki hiçbir tabloda unit_id'ye FK
   yok (fault_records/sensor_data machine_id üzerinden bağlı), bu
   yüzden bu silme işlemi başka veriyi bozmaz.

   GÜVENLİK / IDEMPOTENCY
   - Yeni satırlar ON CONFLICT (machine_id, unit_code) DO NOTHING ile
     eklenir.
   - Eski satırların silinmesi de koşulsuz DELETE ... WHERE unit_code
     IN ('ezme1','ezme2') olduğu için bu dosya yanlışlıkla tekrar
     çalıştırılsa bile (zaten migrate.js bunu engeller) sonuç değişmez.

   GERİ ALMA
   Eski 'ezme1'/'ezme2' satırları silindiği için bu geri alınamaz
   (cycle_count geçmişi kaybolur). Sadece bu migration'ın eklediği
   yeni, henüz hiç kullanılmamış satırları geri almak isterseniz:

     DELETE FROM machine_units
      WHERE unit_code IN ('ezme1_05l','ezme1_13l','ezme2_05l','ezme2_13l')
        AND is_running = FALSE
        AND cycle_count = 0
        AND last_started_at IS NULL;
   ===================================================================== */

DO $$
DECLARE
  inserted_count INT;
  deleted_count INT;
BEGIN
  INSERT INTO machine_units (machine_id, unit_code, display_name)
  SELECT m.machine_id, u.code, u.name
  FROM machines m
  CROSS JOIN (VALUES
    ('ezme1_05l', '1. Plastik Ezme Ünitesi (0.5L)'),
    ('ezme1_13l', '1. Plastik Ezme Ünitesi (1-3L)'),
    ('ezme2_05l', '2. Plastik Ezme Ünitesi (0.5L)'),
    ('ezme2_13l', '2. Plastik Ezme Ünitesi (1-3L)')
  ) AS u(code, name)
  WHERE m.deleted_at IS NULL
  ON CONFLICT (machine_id, unit_code) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE '[010_split_ezme1_ezme2_by_bottle_size] % yeni ünite satırı eklendi.', inserted_count;

  DELETE FROM machine_units
   WHERE unit_code IN ('ezme1', 'ezme2');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE '[010_split_ezme1_ezme2_by_bottle_size] % eski ezme1/ezme2 satırı silindi.', deleted_count;
END $$;