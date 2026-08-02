import { describe, expect, it } from 'vitest';
import {
  buildFailedProcessingFrame,
  extractImageEditErrorMessage,
} from '@/lib/image-processing-state';

describe('image processing state', () => {
  it('converts a network failure into an explicit terminal processing-frame state', () => {
    expect(buildFailedProcessingFrame('network request failed', 'remove background failed')).toEqual({
      progress: -1,
      status: '❌ network request failed',
      error: 'network request failed',
    });
  });

  it('uses the supplied fallback when the failure message is blank', () => {
    expect(buildFailedProcessingFrame('', 'remove background failed')).toEqual({
      progress: -1,
      status: '❌ remove background failed',
      error: 'remove background failed',
    });
  });

  it('extracts the actionable backend error from a failed image-edit JSON response', () => {
    expect(
      extractImageEditErrorMessage(
        JSON.stringify({ success: false, error: 'mask area empty' }),
        400,
      ),
    ).toBe('mask area empty');
  });

  it('uses an HTTP fallback when a failed image-edit response has no readable body', () => {
    expect(extractImageEditErrorMessage('', 502)).toBe('服务器错误 (502)');
  });
});
