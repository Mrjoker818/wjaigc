ALTER TABLE wujie_agent_events
  DROP CONSTRAINT IF EXISTS wujie_agent_events_type_check;

ALTER TABLE wujie_agent_events
  ADD CONSTRAINT wujie_agent_events_type_check CHECK (
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
      'run.timeout',
      'run.paused',
      'run.resumed',
      'step.retrying',
      'quality.checked'
    )
  );
