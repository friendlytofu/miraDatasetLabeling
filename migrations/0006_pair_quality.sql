-- Pair quality analytics: preserve every pair-save attempt so duplicate rate is measurable.
CREATE TABLE IF NOT EXISTS creator_pair_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL DEFAULT 'default',
  pair_key TEXT NOT NULL,
  offer_text TEXT NOT NULL,
  want_text TEXT NOT NULL,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creator_pair_events_owner_created ON creator_pair_events(owner, created_at DESC);
-- Existing unique pairs are historical successes; seed one non-duplicate event for each so
-- quality stats remain useful immediately after migration.
INSERT INTO creator_pair_events(owner,pair_key,offer_text,want_text,is_duplicate,created_at)
SELECT p.owner,p.pair_key,p.offer_text,p.want_text,0,p.created_at
FROM creator_pairs p
WHERE NOT EXISTS (SELECT 1 FROM creator_pair_events e WHERE e.owner=p.owner AND e.pair_key=p.pair_key);
