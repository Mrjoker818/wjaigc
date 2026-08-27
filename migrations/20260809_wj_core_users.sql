CREATE TABLE IF NOT EXISTS wujie_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  api_permissions JSONB DEFAULT '{}',
  storage_folder TEXT DEFAULT '',
  email TEXT DEFAULT '',
  credits INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
