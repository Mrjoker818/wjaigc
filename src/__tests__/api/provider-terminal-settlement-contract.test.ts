import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiresAtomicTerminalSettlement } from '@/lib/task-core/terminal-settlement';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('brand and font durable terminal settlement wiring', () => {
  it('routes cancellation for both durable task types through atomic termination and refund', () => {
    const cancelSource = source('src/app/api/cancel-task/route.ts');
    expect(requiresAtomicTerminalSettlement({ type: 'brand-ecommerce' })).toBe(true);
    expect(requiresAtomicTerminalSettlement({ type: 'font-design' })).toBe(true);
    expect(cancelSource).toContain('requiresAtomicTerminalSettlement(persistedTask)');
    expect(cancelSource).toContain('terminateCloudTaskAndRefund(');
  });

  it('uses the same atomic terminal policy for remote polling failure, cancellation and completion', () => {
    const pollSource = source('src/app/api/poll-task/route.ts');
    expect(pollSource).toContain('const durableAtomicTask = requiresAtomicTerminalSettlement({');
    expect(pollSource).toMatch(/durableAtomicTask\s*\? await terminateCloudTaskAndRefund\(taskId, 'failed'/);
    expect(pollSource).toMatch(/durableAtomicTask\s*\? await terminateCloudTaskAndRefund\(taskId, 'cancelled'/);
    expect(pollSource).toMatch(/if \(durableAtomicTask\) \{\s*const generationCompletion = await completeCloudTask/);
  });
});
