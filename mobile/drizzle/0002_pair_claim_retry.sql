ALTER TABLE pair_sessions ADD COLUMN claim_key_hash TEXT;

PRAGMA optimize;
