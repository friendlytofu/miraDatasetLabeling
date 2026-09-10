-- Stable users and durable quality snapshots. Mission owners use user:<id> so renaming a user does not split their history.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_ci ON users(lower(name));

CREATE TABLE IF NOT EXISTS creator_quality_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'all',
  owner TEXT,
  captured_at TEXT NOT NULL,
  total_pairs INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  duplicate_rate REAL NOT NULL DEFAULT 0,
  average_pair_words REAL NOT NULL DEFAULT 0,
  offer_themes TEXT NOT NULL DEFAULT '[]',
  want_themes TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_creator_quality_scope_time ON creator_quality_snapshots(scope, owner, captured_at DESC);
