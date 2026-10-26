/* =====================================================================
   011. ACTIVITY_LOGS - USER AGENT (TARAYICI BİLGİSİ)
   ---------------------------------------------------------------------
   Giriş/çıkış olaylarında tarayıcı bilgisini (User-Agent) de saklamak
   için activity_logs tablosuna kolon ekleniyor. IP adresi zaten vardı.
   ===================================================================== */

ALTER TABLE activity_logs
    ADD COLUMN IF NOT EXISTS user_agent VARCHAR(300);