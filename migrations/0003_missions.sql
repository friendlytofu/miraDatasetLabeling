-- Saved mission presets and completed labeling mission history.
CREATE TABLE IF NOT EXISTS mission_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, goal INTEGER NOT NULL, flag TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mission_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, goal INTEGER NOT NULL, flag TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, starting_labeled INTEGER NOT NULL DEFAULT 0, labeled_total INTEGER NOT NULL DEFAULT 0, generated_total INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mission_history_completed ON mission_history(completed_at DESC);
