ALTER TABLE cloud_tasks
  ADD COLUMN IF NOT EXISTS agent_execution_descriptor JSONB;

ALTER TABLE cloud_tasks
  DROP CONSTRAINT IF EXISTS cloud_tasks_agent_execution_descriptor_size;

ALTER TABLE cloud_tasks
  ADD CONSTRAINT cloud_tasks_agent_execution_descriptor_size
  CHECK (
    agent_execution_descriptor IS NULL
    OR octet_length(agent_execution_descriptor::text) <= 65536
  );
