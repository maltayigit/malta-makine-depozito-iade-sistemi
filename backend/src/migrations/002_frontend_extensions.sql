/* =====================================================================
   002_frontend_extensions.sql
   -----------------------------------------------------------------
   Mevcut panelin (index.html, doluluk.html, ezme*.html, cam-kirma.html,
   su-karistirma.html, ekran-durumu.html) localStorage ile simüle ettiği
   canlı durumları gerçek bir backend'e taşımak için 001_core_schema.sql
   ÜZERİNE eklenen tablolardır. Orijinal şema hiçbir şekilde değiştirilmez.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. DOLULUK BÖLMELERİ (plastik / teneke / cam / atıksu)
   doluluk-veri.js'deki `bolmeler` dizisiyle birebir eşleşir.
   Her makinenin kendi bölme tanımları ve anlık doluluk yüzdesi olur.
   --------------------------------------------------------------------- */
CREATE TABLE machine_compartments (
    compartment_id      SERIAL PRIMARY KEY,
    machine_id           INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    compartment_code     VARCHAR(30) NOT NULL,     -- plastik, teneke, cam, atiksu
    display_name          VARCHAR(100) NOT NULL,
    unit                   VARCHAR(20) NOT NULL DEFAULT 'adet', -- adet / litre
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

/* ---------------------------------------------------------------------
   2. İŞLEME ÜNİTELERİ (ezme1, ezme2, ezme3, cam kırma, su karıştırma)
   ezme-veri.js / cam-kirma.html / su-karistirma.html'deki *State
   nesnelerinin sunucu tarafı karşılığı.
   --------------------------------------------------------------------- */
CREATE TABLE machine_units (
    unit_id              SERIAL PRIMARY KEY,
    machine_id            INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    unit_code               VARCHAR(30) NOT NULL,   -- ezme1, ezme2, ezme3, camKirma, suKaristirma
    display_name             VARCHAR(100) NOT NULL,
    is_running                 BOOLEAN NOT NULL DEFAULT FALSE,
    is_jammed                   BOOLEAN NOT NULL DEFAULT FALSE,   -- sikisma
    cycle_count                  INT NOT NULL DEFAULT 0,
    last_started_at               TIMESTAMPTZ,
    last_stopped_at                TIMESTAMPTZ,
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (machine_id, unit_code)
);
CREATE INDEX idx_machine_units_machine ON machine_units (machine_id);

/* ---------------------------------------------------------------------
   3. MAKİNE GÜÇ DURUMU (index.html'deki "makineAcik" anahtarı)
   machines tablosuna dokunmamak için ayrı, tek satırlık bir tablo.
   --------------------------------------------------------------------- */
CREATE TABLE machine_power_state (
    machine_id     INT PRIMARY KEY REFERENCES machines(machine_id) ON DELETE CASCADE,
    is_powered_on   BOOLEAN NOT NULL DEFAULT FALSE,
    power_blocked_reason  VARCHAR(500),   -- doluluk nedeniyle otomatik kapanma vb.
    changed_by_user_id     INT REFERENCES users(user_id),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ---------------------------------------------------------------------
   4. TABLET / EKRAN HEARTBEAT (ekran-veri.js)
   Her makinede fiziksel olarak bulunan ekranların "buradayım" sinyali.
   --------------------------------------------------------------------- */
CREATE TABLE machine_screens (
    screen_id         SERIAL PRIMARY KEY,
    machine_id          INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    screen_code            VARCHAR(30) NOT NULL,   -- ekran1..ekran4
    display_name             VARCHAR(100) NOT NULL,
    last_heartbeat_at          TIMESTAMPTZ,
    last_page                   VARCHAR(200),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (machine_id, screen_code)
);
CREATE INDEX idx_machine_screens_machine ON machine_screens (machine_id);

CREATE OR REPLACE FUNCTION set_updated_at_generic()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compartments_updated_at BEFORE UPDATE ON machine_compartments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_generic();
CREATE TRIGGER trg_units_updated_at BEFORE UPDATE ON machine_units
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_generic();
CREATE TRIGGER trg_power_state_updated_at BEFORE UPDATE ON machine_power_state
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_generic();
CREATE TRIGGER trg_screens_updated_at BEFORE UPDATE ON machine_screens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_generic();
