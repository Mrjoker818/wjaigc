import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execSql: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('@/lib/db-client', () => mocks);
vi.mock('@/lib/refund-identity-claim', () => ({
  ensureRefundIdentityClaims: vi.fn(async (): Promise<void> => {}),
}));

describe('credit schema initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('creates and migrates the transaction reference used by atomic settlement', async () => {
    const { ensureCoreTables } = await import('@/lib/db-storage');
    await ensureCoreTables();

    const statements = mocks.execSql.mock.calls.map(([sql]) => String(sql));
    const createTransactions = statements.find((sql) => (
      sql.includes('CREATE TABLE IF NOT EXISTS wujie_credit_transactions')
    ));

    expect(createTransactions).toContain("reference_id TEXT DEFAULT ''");
    expect(statements).toContain(
      "ALTER TABLE wujie_credit_transactions ADD COLUMN IF NOT EXISTS reference_id TEXT DEFAULT ''",
    );

    const createAuditLogIndex = statements.findIndex((sql) => (
      sql.includes('CREATE TABLE IF NOT EXISTS wujie_audit_log')
    ));
    const migrateAuditLogIndex = statements.findIndex((sql) => (
      sql.includes('ALTER TABLE wujie_audit_log')
    ));

    expect(createAuditLogIndex).toBeGreaterThanOrEqual(0);
    expect(migrateAuditLogIndex).toBeGreaterThan(createAuditLogIndex);
  });

  it('creates the ecommerce template table required by a fresh deployment', async () => {
    const { ensureCoreTables } = await import('@/lib/db-storage');
    await ensureCoreTables();

    const statements = mocks.execSql.mock.calls.map(([sql]) => String(sql));
    const createTemplates = statements.find((sql) => (
      sql.includes('CREATE TABLE IF NOT EXISTS wujie_ecom_templates')
    ));

    expect(createTemplates).toContain('id TEXT PRIMARY KEY');
    expect(createTemplates).toContain('name TEXT NOT NULL');
    expect(createTemplates).toContain('prompt_template TEXT NOT NULL');
    expect(createTemplates).toContain("negative_prompt TEXT DEFAULT ''");
    expect(createTemplates).toContain("aspect_ratio TEXT DEFAULT '1:1'");
    expect(createTemplates).toContain("category TEXT DEFAULT 'general'");
    expect(createTemplates).toContain("fidelity_anchor TEXT DEFAULT ''");
    expect(createTemplates).toContain('sort_order INTEGER DEFAULT 0');
    expect(createTemplates).toContain('is_enabled BOOLEAN DEFAULT true');
    expect(createTemplates).toContain('is_builtin BOOLEAN DEFAULT false');
    expect(createTemplates).toContain('created_at BIGINT NOT NULL');
    expect(createTemplates).toContain('updated_at BIGINT NOT NULL');
    expect(statements).toContain(
      'CREATE INDEX IF NOT EXISTS idx_ecom_templates_enabled_order ON wujie_ecom_templates(is_enabled, sort_order)',
    );
  });
});
