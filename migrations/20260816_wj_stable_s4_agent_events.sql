CREATE TABLE IF NOT EXISTS wujie_agent_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  CONSTRAINT wujie_agent_events_identity_nonempty CHECK (
    event_id <> ''
    AND task_id <> ''
    AND owner_id <> ''
    AND project_id <> ''
    AND request_digest <> ''
  ),
  CONSTRAINT wujie_agent_events_workspace_check CHECK (
    workspace IN ('canvas', 'workflow', 'chat')
  ),
  CONSTRAINT wujie_agent_events_type_check CHECK (
    event_type IN (
      'run.created',
      'plan.updated',
      'tool.started',
      'tool.progress',
      'tool.completed',
      'asset.created',
      'run.completed',
      'run.failed',
      'run.cancelled',
      'run.timeout'
    )
  ),
  CONSTRAINT wujie_agent_events_task_sequence_unique UNIQUE (task_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_agent_events_owner_project_task_sequence
  ON wujie_agent_events(owner_id, project_id, task_id, sequence);
