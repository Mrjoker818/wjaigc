import { describe, expect, it } from 'vitest';
import { getStickerModelLoadDiagnosticMessage } from '@/lib/sticker-model-load-state';

describe('getStickerModelLoadDiagnosticMessage', () => {
  it('returns diagnostic when no models loaded', () => {
    const msg = getStickerModelLoadDiagnosticMessage(false, '');
    expect(msg).toBeTruthy();
    expect(typeof msg).toBe('string');
    // Should mention model/admin configuration
    expect(msg).toContain('模型');
  });

  it('returns empty string when models are available', () => {
    const msg = getStickerModelLoadDiagnosticMessage(true, 'model-1');
    expect(msg).toBe('');
  });

  it('returns empty string when models are empty but model is selected', () => {
    const msg = getStickerModelLoadDiagnosticMessage(false, 'model-1');
    expect(msg).toBe('');
  });
});
