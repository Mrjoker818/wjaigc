ALTER TABLE wujie_workspace_placements
  DROP CONSTRAINT IF EXISTS wujie_workspace_placements_entity_type_check;

ALTER TABLE wujie_workspace_placements
  ADD CONSTRAINT wujie_workspace_placements_entity_type_check
  CHECK (entity_type IN (
    'canvas-image', 'canvas-video', 'workflow-input', 'workflow-output',
    'chat-attachment', 'chat-result'
  )) NOT VALID;

ALTER TABLE wujie_workspace_placements
  DROP CONSTRAINT IF EXISTS wujie_workspace_placements_workspace_entity_pair_check;

ALTER TABLE wujie_workspace_placements
  ADD CONSTRAINT wujie_workspace_placements_workspace_entity_pair_check
  CHECK (
    (workspace_kind = 'canvas' AND entity_type IN ('canvas-image', 'canvas-video'))
    OR (workspace_kind = 'workflow' AND entity_type IN ('workflow-input', 'workflow-output'))
    OR (workspace_kind = 'chat' AND entity_type IN ('chat-attachment', 'chat-result'))
  ) NOT VALID;

ALTER TABLE wujie_workspace_placements
  VALIDATE CONSTRAINT wujie_workspace_placements_entity_type_check;

ALTER TABLE wujie_workspace_placements
  VALIDATE CONSTRAINT wujie_workspace_placements_workspace_entity_pair_check;
