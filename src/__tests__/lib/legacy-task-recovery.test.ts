import { describe, expect, it } from 'vitest';
import {
  findUniqueLegacyTaskMatch,
  getLegacyRecoveryRetryAt,
} from '@/lib/legacy-task-recovery';

describe('findUniqueLegacyTaskMatch', () => {
  const placeholder = {
    id: 'frame-1',
    isProcessingPlaceholder: true,
    prompt: 'blue glass cube on a white background',
    model: 'provider-a::seedream-lite',
    processing: { status: 'submitting' },
  };

  it('attaches only an unambiguous active legacy task with the same prompt and model', () => {
    expect(findUniqueLegacyTaskMatch(placeholder, [
      {
        id: 'async-1', status: 'processing', prompt: 'blue glass cube on a white background',
        model: 'seedream-lite', providerId: 'provider-a', progress: 10, label: '准备中',
      },
    ])).toMatchObject({ id: 'async-1', providerId: 'provider-a' });
  });

  it('does not guess when more than one active task matches the placeholder', () => {
    expect(findUniqueLegacyTaskMatch(placeholder, [
      { id: 'async-1', status: 'processing', prompt: placeholder.prompt, model: 'seedream-lite' },
      { id: 'async-2', status: 'queued', prompt: placeholder.prompt, model: 'seedream-lite' },
    ])).toBeUndefined();
  });

  it('does not replace a placeholder that already has a durable task ID', () => {
    expect(findUniqueLegacyTaskMatch({ ...placeholder, processing: { status: 'processing', taskId: 'saved-task' } }, [
      { id: 'async-1', status: 'processing', prompt: placeholder.prompt, model: 'seedream-lite' },
    ])).toBeUndefined();
  });
});

describe('getLegacyRecoveryRetryAt', () => {
  it('honors the server retry window and applies a floor after transient failures', () => {
    expect(getLegacyRecoveryRetryAt({
      now: 10_000,
      retryAfterMs: 8_000,
    })).toBe(18_000);
    expect(getLegacyRecoveryRetryAt({
      now: 10_000,
      retryAfterMs: 0,
      requestFailed: true,
    })).toBe(13_000);
  });
});
