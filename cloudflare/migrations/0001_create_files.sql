CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL CHECK (size > 0),
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at INTEGER NOT NULL,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_files_published_created
  ON files (published, created_at DESC);
