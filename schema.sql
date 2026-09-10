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


CREATE TABLE IF NOT EXISTS mission_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  goal INTEGER NOT NULL,
  flag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL DEFAULT 'default',
  goal INTEGER NOT NULL,
  flag TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  starting_labeled INTEGER NOT NULL DEFAULT 0,
  labeled_total INTEGER NOT NULL DEFAULT 0,
  generated_total INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mission_history_completed ON mission_history(completed_at DESC);

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
