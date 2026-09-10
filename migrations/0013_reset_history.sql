-- Fresh history reset.
-- Keep the current authored item bank and creator_pairs intact.
-- Clear only historical/audit/progress records so the dashboard starts clean.
DELETE FROM label_history;

UPDATE entries
SET status = 'unlabeled',
    human_label = NULL,
    labeler = NULL,
    labeled_blind = NULL,
    labeled_at = NULL;

DELETE FROM creator_pair_events;
DELETE FROM creator_mission_history;
DELETE FROM active_creator_missions;
DELETE FROM creator_quality_snapshots;
