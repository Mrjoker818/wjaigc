\set ON_ERROR_STOP on
\pset pager off

-- Usage: psql "$PGDATABASE_URL" -v run_id='uuid' -f scripts/task12-skill-run-audit.sql
BEGIN TRANSACTION READ ONLY;

\echo '=== parent run and discovered ownership ==='
SELECT parent.id,
       parent.user_id,
       parent.project_id,
       parent.type,
       parent.status,
       parent.credit_status,
       parent.credit_cost,
       parent.charged_transaction_id,
       parent.refunded_transaction_id,
       parent.created_at,
       parent.updated_at,
       lease.lease_owner,
       lease.lease_expires_at,
       lease.generation,
       lease.paused_at,
       lease.completed_at
FROM cloud_tasks parent
LEFT JOIN wujie_agent_execution_leases lease ON lease.task_id = parent.id
WHERE parent.id IN (SELECT id FROM cloud_tasks WHERE id = :'run_id');

\echo '=== immutable run events ==='
SELECT sequence, event_id, owner_id, project_id, workspace, event_type, created_at
FROM wujie_agent_events
WHERE task_id = :'run_id'
ORDER BY sequence;

\echo '=== downstream operations ==='
SELECT operation_key,
       owner_id,
       project_id,
       task_id,
       step_id,
       tool_id,
       status,
       provider_task_id,
       attempt_count,
       lease_owner,
       lease_expires_at,
       completed_at,
       created_at,
       updated_at
FROM wujie_agent_downstream_operations
WHERE task_id = :'run_id'
ORDER BY created_at, operation_key;

\echo '=== prepaid child tasks ==='
SELECT id,
       user_id,
       project_id,
       status,
       provider_id,
       model,
       remote_task_id,
       progress,
       credit_status,
       credit_cost,
       idempotency_key,
       result #>> '{skillBillingProvenance,stepId}' AS step_id,
       result #>> '{skillBillingProvenance,operationKey}' AS operation_key,
       created_at,
       updated_at
FROM cloud_tasks
WHERE result #>> '{skillBillingProvenance,runId}' = :'run_id'
ORDER BY created_at, id;

\echo '=== exact parent ledger links ==='
WITH parent AS (
  SELECT id, user_id, charged_transaction_id, refunded_transaction_id
  FROM cloud_tasks WHERE id = :'run_id'
)
SELECT transaction.id,
       transaction.user_id,
       transaction.task_id,
       transaction.type,
       transaction.amount,
       transaction.balance_after,
       transaction.reference_id,
       transaction.created_at,
       transaction.id = parent.charged_transaction_id AS is_parent_charge,
       transaction.id = parent.refunded_transaction_id AS is_parent_refund
FROM wujie_credit_transactions transaction
CROSS JOIN parent
WHERE transaction.user_id = parent.user_id
  AND (
    transaction.task_id = :'run_id'
    OR transaction.id = parent.charged_transaction_id
    OR transaction.id = parent.refunded_transaction_id
  )
ORDER BY transaction.created_at, transaction.id;

\echo '=== exact ledger cardinality ==='
WITH parent AS (
  SELECT id, user_id, charged_transaction_id, refunded_transaction_id
  FROM cloud_tasks WHERE id = :'run_id'
)
SELECT COUNT(*) FILTER (
         WHERE transaction.type = 'consume'
           AND transaction.id = parent.charged_transaction_id
       ) AS linked_charge_count,
       COUNT(*) FILTER (
         WHERE transaction.type = 'refund'
           AND transaction.id = parent.refunded_transaction_id
       ) AS linked_refund_count,
       COUNT(*) FILTER (
         WHERE transaction.type = 'consume' AND transaction.task_id = :'run_id'
       ) AS run_charge_count,
       COUNT(*) FILTER (
         WHERE transaction.type = 'refund' AND transaction.task_id = :'run_id'
       ) AS run_refund_count,
       COALESCE(SUM(transaction.amount) FILTER (
         WHERE transaction.task_id = :'run_id'
       ), 0) AS run_net_amount
FROM parent
LEFT JOIN wujie_credit_transactions transaction
  ON transaction.user_id = parent.user_id
 AND (
   transaction.task_id = parent.id
   OR transaction.id = parent.charged_transaction_id
   OR transaction.id = parent.refunded_transaction_id
 );

\echo '=== result asset versions and active placements ==='
WITH child_tasks AS (
  SELECT id
  FROM cloud_tasks
  WHERE result #>> '{skillBillingProvenance,runId}' = :'run_id'
), versions AS (
  SELECT version.*
  FROM wujie_asset_versions version
  WHERE version.task_id IN (SELECT id FROM child_tasks)
     OR version.metadata #>> '{sourceTrace,runId}' = :'run_id'
)
SELECT version.id AS asset_version_id,
       version.asset_id,
       version.owner_id,
       version.project_id,
       version.task_id,
       version.provider_id,
       version.model_id,
       version.availability,
       version.mime_type,
       version.byte_size,
       version.width,
       version.height,
       placement.id AS placement_id,
       placement.workspace_kind,
       placement.status AS placement_status
FROM versions version
LEFT JOIN wujie_workspace_placements placement
  ON placement.asset_version_id = version.id
 AND placement.asset_id = version.asset_id
 AND placement.owner_id = version.owner_id
 AND placement.project_id = version.project_id
ORDER BY version.created_at, version.id, placement.id;

ROLLBACK;
