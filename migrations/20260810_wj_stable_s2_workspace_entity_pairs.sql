ALTER TABLE wujie_workspace_placements
  ADD CONSTRAINT wujie_workspace_placements_workspace_entity_pair_check
  CHECK (
    (workspace_kind = 'canvas' AND entity_type = 'canvas-image')
    OR (workspace_kind = 'workflow' AND entity_type IN ('workflow-input', 'workflow-output'))
    OR (workspace_kind = 'chat' AND entity_type IN ('chat-attachment', 'chat-result'))
  ) NOT VALID;
