-- Aktif Oturumlar ekranında "şu an gerçekten sistemde aktif mi" bilgisini
-- göstermek için: refresh_tokens.issued_at/expires_at tek başına bunu
-- söyleyemiyor (30 günlük refresh token süresi boyunca kullanıcı sekmeyi
-- kapatıp gitmiş olsa bile "aktif" görünüyordu). last_seen_at, o oturuma
-- ait access token'ın her geçerli kullanımında auth.middleware.js
-- tarafından güncellenir.
ALTER TABLE refresh_tokens ADD COLUMN last_seen_at TIMESTAMPTZ;
UPDATE refresh_tokens SET last_seen_at = issued_at WHERE last_seen_at IS NULL;