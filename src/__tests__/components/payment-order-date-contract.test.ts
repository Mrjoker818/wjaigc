import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../..', '..');

function readSource(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

describe('payment order date rendering', () => {
  it('uses the shared safe formatter in every administrator payment order view', () => {
    const rechargeOrders = readSource('src/components/dashboard/admin-recharge-orders.tsx');
    const dashboard = readSource('src/components/dashboard/dashboard-view.tsx');

    expect(rechargeOrders).toContain("import { formatPaymentTimestamp } from '@/lib/payment-order-time'");
    expect(rechargeOrders).not.toContain('new Date(order.createdAt).toLocaleString');
    expect(dashboard).toContain("import { formatPaymentTimestamp } from '@/lib/payment-order-time'");
    expect(dashboard).not.toContain('new Date(order.createdAt).toLocaleString');
  });
});
