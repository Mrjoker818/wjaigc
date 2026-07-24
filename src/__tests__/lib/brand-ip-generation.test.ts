import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { extractProviderTaskIds } from '@/lib/brand-ip-generation';

describe('brand IP generation task response parsing', () => {
  it('keeps provider task IDs returned as an array', () => {
    expect(extractProviderTaskIds({ taskIds: ['provider-task-a', 'provider-task-b'] })).toEqual([
      'provider-task-a',
      'provider-task-b',
    ]);
  });

  it('falls back to a single provider task ID', () => {
    expect(extractProviderTaskIds({ taskId: 'provider-task-a' })).toEqual(['provider-task-a']);
  });

  it('ignores empty and non-string task IDs', () => {
    expect(extractProviderTaskIds({ taskIds: ['', null, 'provider-task-a', 42] })).toEqual(['provider-task-a']);
  });
});
