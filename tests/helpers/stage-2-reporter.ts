import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export function stage2RunStatus(input: {
  baseStatus: FullResult['status'];
  failed: number;
  skipped: number;
}): 'passed' | 'failed' {
  return input.baseStatus === 'passed' && input.failed === 0 && input.skipped === 0
    ? 'passed'
    : 'failed';
}

export default class Stage2Reporter implements Reporter {
  private failed = 0;
  private skipped = 0;

  onTestEnd(_test: TestCase, result: TestResult): void {
    if (result.status === 'skipped') this.skipped += 1;
    else if (result.status !== 'passed') this.failed += 1;
  }

  async onEnd(result: FullResult): Promise<{ status: 'passed' | 'failed' }> {
    return {
      status: stage2RunStatus({
        baseStatus: result.status,
        failed: this.failed,
        skipped: this.skipped,
      }),
    };
  }
}
