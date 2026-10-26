/* Kapak açma/kapatma geçmişi: tarayıcı deposu yerine kalıcı kayıt. */
CREATE TABLE machine_cover_events (
    event_id              BIGSERIAL PRIMARY KEY,
    machine_id            INT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
    cover_number          SMALLINT NOT NULL CHECK (cover_number BETWEEN 1 AND 10),
    action                VARCHAR(10) NOT NULL CHECK (action IN ('OPEN', 'CLOSE')),
    performed_by_user_id  INT REFERENCES users(user_id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_machine_cover_events_history
    ON machine_cover_events (machine_id, created_at DESC);
