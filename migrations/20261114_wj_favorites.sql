CREATE TABLE IF NOT EXISTS wujie_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  aspect_ratio TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL DEFAULT '',
  image_width DOUBLE PRECISION NOT NULL DEFAULT 0,
  image_height DOUBLE PRECISION NOT NULL DEFAULT 0,
  original_width DOUBLE PRECISION NOT NULL DEFAULT 0,
  original_height DOUBLE PRECISION NOT NULL DEFAULT 0,
  api_provider TEXT NOT NULL DEFAULT '',
  api_base_url TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'generated',
  source_project_id TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS wujie_favorites_user_created_idx
  ON wujie_favorites (user_id, created_at DESC);
