-- Fresh labeling reset.
-- Keeps the dataset activities/pairs intact, but removes every prior label
-- and every label-history/audit record so the team can start labeling again.

DELETE FROM label_history;

UPDATE entries
SET status = 'unlabeled',
    human_label = NULL,
    labeler = NULL,
    labeled_blind = NULL,
    labeled_at = NULL;
