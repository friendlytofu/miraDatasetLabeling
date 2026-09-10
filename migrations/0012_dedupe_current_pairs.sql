-- Normalize the current pair bank so one offer + want pair exists only once globally.
-- Historical creator_pair_events are intentionally preserved for audit purposes,
-- but Pair Quality never reads them. Keep the earliest current pair row when
-- identical pair_key values exist under different owners.
DELETE FROM creator_pairs
WHERE id NOT IN (
  SELECT MIN(id)
  FROM creator_pairs
  GROUP BY pair_key
);

-- Future saves cannot create the same normalized offer + want pair under
-- another owner. Existing per-owner uniqueness remains in place as well.
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_pairs_pair_key_global
  ON creator_pairs(pair_key);
