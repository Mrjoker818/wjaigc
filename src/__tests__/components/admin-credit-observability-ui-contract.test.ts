import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/dashboard/admin-tabs.tsx'),
  'utf8',
);

describe('admin credit observability UI contract', () => {
  it('renders transaction labels and signs from the server classification', () => {
    expect(source).toContain('typeLabel: string; direction: \'credit\' | \'debit\'');
    expect(source).toContain("t.direction === 'credit' ? '+' : '-'");
    expect(source).toContain('{t.typeLabel}');
  });

  it('normalizes legacy responses before rendering or exporting transactions', () => {
    expect(source).toContain('normalizeCreditTransaction');
    expect(source).toContain("transaction.direction === 'credit' || transaction.direction === 'debit'");
    expect(source).toContain('CREDIT_TRANSACTION_LABELS[transaction.type]');
  });

  it('offers explicit filters for refunds and compensation', () => {
    expect(source).toContain('<option value="refund">退款</option>');
    expect(source).toContain('<option value="compensation">补偿</option>');
    expect(source).toContain('<option value="adjustment">扣减</option>');
  });

  it('shows gross consumption, refunds, recharge and compensation as separate totals', () => {
    expect(source).toContain('co?.flows?.consumed');
    expect(source).toContain('co?.flows?.refunded');
    expect(source).toContain('co?.flows?.recharged');
    expect(source).toContain('co?.flows?.compensated');
  });

  it('describes system balance as the authoritative balance sum instead of recharge minus consumption', () => {
    expect(source).toContain('sub="当前用户余额合计"');
    expect(source).not.toContain('sub="充值 − 消耗"');
  });
});
