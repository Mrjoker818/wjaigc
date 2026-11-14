CREATE TABLE IF NOT EXISTS wujie_brand_kits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  brand_dna TEXT NOT NULL DEFAULT '{}',
  colors TEXT NOT NULL DEFAULT '{}',
  font_style TEXT NOT NULL DEFAULT 'sans-serif',
  style_keywords TEXT NOT NULL DEFAULT '[]',
  reference_images TEXT NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);
