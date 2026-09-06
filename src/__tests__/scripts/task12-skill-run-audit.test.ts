import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const auditSqlPath = resolve(process.cwd(), 'scripts/task12-skill-run-audit.sql');

describe('Task12 Skill run read-only audit', () => {
  it('discovers ownership and links the parent run, children, ledger and assets without writes', () => {
    const sql = readFileSync(auditSqlPath, 'utf8');

    expect(sql).toContain('BEGIN TRANSACTION READ ONLY');
    expect(sql).toContain("cloud_tasks WHERE id = :'run_id'");
    expect(sql).toContain("result #>> '{skillBillingProvenance,runId}' = :'run_id'");
    expect(sql).toContain('charged_transaction_id');
    expect(sql).toContain('refunded_transaction_id');
    expect(sql).toContain("task_id = :'run_id'");
    expect(sql).toContain('wujie_agent_execution_leases');
    expect(sql).toContain('wujie_agent_downstream_operations');
    expect(sql).toContain('wujie_asset_versions');
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
  });
});
