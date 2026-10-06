ALTER TABLE wujie_workflow_edit_publications
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT
    CHECK (rejection_reason IS NULL OR rejection_reason = 'WORKFLOW_EDIT_ACCEPTANCE_REJECTED');
