import { describe, expect, it } from 'vitest';
import { getStickerFailureMessage } from '@/lib/sticker-failure-message';

describe('getStickerFailureMessage', () => {
  it('returns error message when status is failed with error detail', () => {
    const msg = getStickerFailureMessage('failed', '生成超时');
    expect(msg).toBe('生成超时');
  });

  it('returns default message when status is failed without error', () => {
    const msg = getStickerFailureMessage('failed', '');
    expect(msg).toBeTruthy();
    expect(typeof msg).toBe('string');
  });

  it('returns empty string when status is not failed', () => {
    const msg = getStickerFailureMessage('completed', '');
    expect(msg).toBe('');
  });

  it('returns empty string for generating status', () => {
    const msg = getStickerFailureMessage('generating', 'error');
    expect(msg).toBe('');
  });
});
