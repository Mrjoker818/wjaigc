import { describe, expect, it } from 'vitest';
import { getResumedTaskPollingOutcome } from '@/lib/resumed-task-polling';

describe('getResumedTaskPollingOutcome', () => {
  it('marks a still-processing recovered task as timed out after the 20 minute retry limit', () => {
    expect(getResumedTaskPollingOutcome(200, true)).toBeNull();
    expect(getResumedTaskPollingOutcome(400, true)).toEqual({
      status: 'failed',
      label: '任务恢复超时，请在任务中心确认供应商结果后重试',
    });
  });
});
