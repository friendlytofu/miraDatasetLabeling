-- Mira dataset-builder schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('offer', 'want')),
  source_phrase TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_ids TEXT NOT NULL,      -- JSON array of item ids
  want_ids TEXT NOT NULL,       -- JSON array of item ids
  offers TEXT NOT NULL,         -- JSON array of item texts (snapshot at generation time)
  wants TEXT NOT NULL,          -- JSON array of item texts (snapshot at generation time)
  combo_key TEXT NOT NULL UNIQUE,  -- sorted offer_ids|sorted want_ids, enforces non-repetition
  offer_count INTEGER NOT NULL,
  want_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'unlabeled', -- unlabeled | labeled
  human_label TEXT,             -- 'yes' | 'no'
  labeler TEXT,
  labeled_blind INTEGER,        -- 0/1
  labeled_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_bucket ON entries(offer_count, want_count);

CREATE TABLE IF NOT EXISTS label_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  previous_label TEXT,
  new_label TEXT,
  labeler TEXT,
  acted_at TEXT NOT NULL,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_label_history_entry ON label_history(entry_id, acted_at DESC);



CREATE TABLE IF NOT EXISTS creator_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL DEFAULT 'default',
  pair_key TEXT NOT NULL,
  offer_text TEXT NOT NULL,
  want_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(owner, pair_key)
);
CREATE INDEX IF NOT EXISTS idx_creator_pairs_owner_created ON creator_pairs(owner, created_at DESC);

CREATE TABLE IF NOT EXISTS creator_mission_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  goal INTEGER NOT NULL,
  flag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_mission_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL DEFAULT 'default',
  goal INTEGER NOT NULL,
  flag TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  starting_pairs INTEGER NOT NULL DEFAULT 0,
  pairs_total INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_creator_mission_history_owner_completed ON creator_mission_history(owner, completed_at DESC);

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
  scope TEXT NOT NULL DEFAULT 'all', owner TEXT,
  captured_at TEXT NOT NULL, total_pairs INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0,
  duplicate_rate REAL NOT NULL DEFAULT 0, average_pair_words REAL NOT NULL DEFAULT 0,
  offer_themes TEXT NOT NULL DEFAULT '[]', want_themes TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_creator_quality_scope_time ON creator_quality_snapshots(scope, owner, captured_at DESC);

CREATE TABLE IF NOT EXISTS active_creator_missions (
  owner TEXT PRIMARY KEY, goal INTEGER NOT NULL, flag TEXT NOT NULL, started_at TEXT NOT NULL,
  starting_pairs INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
