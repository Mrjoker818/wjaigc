CREATE TABLE IF NOT EXISTS wujie_generated_audio (
  filename TEXT PRIMARY KEY CHECK (filename ~ '^ttsdb_[0-9]{13}_[0-9a-f]{8}_[0-9a-f]{64}[.](mp3|wav)$'),
  owner_id TEXT NOT NULL CHECK (owner_id <> ''),
  audio_bytes BYTEA NOT NULL CHECK (octet_length(audio_bytes) BETWEEN 12 AND 26214400),
  created_at BIGINT NOT NULL
);
