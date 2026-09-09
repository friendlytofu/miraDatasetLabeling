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

CREATE TABLE IF NOT EXISTS translations (
  text_hash TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
