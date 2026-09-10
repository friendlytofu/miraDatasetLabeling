-- Persist active mission state server-side so progress follows each user across browsers/devices.
CREATE TABLE IF NOT EXISTS active_missions (
  owner TEXT PRIMARY KEY,
  goal INTEGER NOT NULL,
  flag TEXT NOT NULL,
  started_at TEXT NOT NULL,
  starting_labeled INTEGER NOT NULL DEFAULT 0,
  generated_total INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS active_creator_missions (
  owner TEXT PRIMARY KEY,
  goal INTEGER NOT NULL,
  flag TEXT NOT NULL,
  started_at TEXT NOT NULL,
  starting_pairs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
