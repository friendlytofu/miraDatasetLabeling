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

DROP TABLE IF EXISTS translations;

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


CREATE TABLE IF NOT EXISTS mission_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  goal INTEGER NOT NULL DEFAULT 100,
  flag TEXT NOT NULL DEFAULT '🏁',
  labeler TEXT,
  baseline_labeled INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_total INTEGER
);

CREATE TABLE IF NOT EXISTS mission_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  goal INTEGER NOT NULL,
  flag TEXT NOT NULL DEFAULT '🏁',
  labeler TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal INTEGER NOT NULL,
  flag TEXT NOT NULL,
  labeler TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  baseline_labeled INTEGER NOT NULL DEFAULT 0,
  completed_total INTEGER NOT NULL DEFAULT 0,
  labels_completed INTEGER NOT NULL DEFAULT 0
);
