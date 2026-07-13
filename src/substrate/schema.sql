PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  root_path TEXT NOT NULL,
  last_scan_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  repo_root TEXT NOT NULL,
  cwd TEXT NOT NULL,
  originator TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  meta_json TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_source_ref
  ON sessions(source_id, ref);
CREATE INDEX IF NOT EXISTS sessions_repo_started
  ON sessions(repo_root, started_at);
CREATE INDEX IF NOT EXISTS sessions_source_started
  ON sessions(source_id, started_at);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  meta_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS units_session
  ON units(session_id);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  lens TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('suggested', 'dismissed', 'exported')),
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS findings_lens_status
  ON findings(lens, status);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  placed_paths_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS artifacts_finding
  ON artifacts(finding_id);

CREATE TABLE IF NOT EXISTS watermarks (
  source_id TEXT NOT NULL,
  file_ref TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (source_id, file_ref)
);
