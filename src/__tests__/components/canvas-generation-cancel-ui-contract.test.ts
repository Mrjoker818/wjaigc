import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

describe('canvas generation cancellation UI contract', () => {
  it('keeps a cancelled poll result out of the generic non-retryable failure branch', () => {
    expect(source).toContain(
      "if (!pollData.success && !pollData.retryable && pollData.status !== 'cancelled')",
    );
  });

  it('reports user cancellation without an error toast', () => {
    const cancelledBranchStart = source.indexOf(
      "} else if (pollData.status === 'cancelled') {",
    );
    const nextBranchStart = source.indexOf('} else {', cancelledBranchStart);
    const cancelledBranch = source.slice(cancelledBranchStart, nextBranchStart);

    expect(cancelledBranchStart).toBeGreaterThan(-1);
    expect(cancelledBranch).toContain("toast.info('任务已取消'");
    expect(cancelledBranch).not.toContain("toast.error('任务已取消'");
    expect(cancelledBranch).not.toContain('border-red-900');
  });
});
