-- 009_machine_display_fields.sql
-- "Makine Yönetimi" (makine-yonetimi.html) ekranı; makine numarası dışında
-- görüntü adı, sorumlu teknisyen adı, serbest metin özet notları ve
-- makineyi görebilecek tekil "mağaza sahibi" (MARKET rolündeki kullanıcı)
-- bilgisi topluyor. Bunların hiçbiri 001_core_schema.sql'de yoktu; bu
-- migration mevcut hiçbir kolonu değiştirmeden sadece üzerine ekleme yapar.

ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS display_name     VARCHAR(150),
  ADD COLUMN IF NOT EXISTS technician_name  VARCHAR(150),
  ADD COLUMN IF NOT EXISTS summary_notes    TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id    INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS panel_page       VARCHAR(50) NOT NULL DEFAULT 'index.html',
  ADD COLUMN IF NOT EXISTS branch_name      VARCHAR(150);

COMMENT ON COLUMN machines.display_name    IS 'Panelde gösterilen makine adı (örn. "Makine #005")';
COMMENT ON COLUMN machines.technician_name IS 'Sorumlu teknisyenin serbest metin adı';
COMMENT ON COLUMN machines.summary_notes   IS 'Makine kartında satır satır gösterilen özet bilgiler';
COMMENT ON COLUMN machines.owner_user_id   IS 'Bu makineyi "Makinelerim" sayfasında görecek MARKET rolündeki kullanıcı (opsiyonel)';
COMMENT ON COLUMN machines.panel_page      IS '"Makinelerim" listesindeki makine kartının yönlendirdiği bakım panosu sayfası (örn. index.html)';
COMMENT ON COLUMN machines.branch_name     IS 'Serbest metin şube/konum adı (markets tablosundan bağımsız, sadece görüntüleme amaçlı)';