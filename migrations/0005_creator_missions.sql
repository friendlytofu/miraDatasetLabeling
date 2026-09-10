-- Creation missions: track unique offer + want pairs written by each labeler.
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
CREATE INDEX IF NOT EXISTS idx_creator_mission_presets_owner ON creator_mission_presets(owner, updated_at DESC);

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
