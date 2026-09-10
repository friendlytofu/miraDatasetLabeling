-- Remove the retired translation feature and add persistent labeling missions.
DROP TABLE IF EXISTS translations;

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
