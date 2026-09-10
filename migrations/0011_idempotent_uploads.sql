-- Prevent a retried browser upload from creating duplicate items or creator-pair events.
ALTER TABLE items ADD COLUMN upload_key TEXT;
ALTER TABLE items ADD COLUMN upload_index INTEGER;
ALTER TABLE creator_pair_events ADD COLUMN upload_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_upload_key_index
  ON items(upload_key, upload_index)
  WHERE upload_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_pair_events_upload_key
  ON creator_pair_events(upload_key)
  WHERE upload_key IS NOT NULL;
