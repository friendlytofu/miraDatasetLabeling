-- Scope mission presets and completed mission history to the labeler name.
ALTER TABLE mission_presets ADD COLUMN owner TEXT NOT NULL DEFAULT 'default';
ALTER TABLE mission_history ADD COLUMN owner TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_mission_history_owner_completed ON mission_history(owner, completed_at DESC);
