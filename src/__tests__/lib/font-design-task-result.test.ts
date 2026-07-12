import { describe, expect, it } from 'vitest';
import { unwrapFontDesignTaskResult } from '@/lib/font-design-task-result';

describe('unwrapFontDesignTaskResult', () => {
  it('returns the completed image payload from the font-design fallback cache', () => {
    expect(unwrapFontDesignTaskResult({
      status: 'completed',
      result: {
        directImageUrls: ['https://cdn.example.com/font-design.png'],
        prompt: 'font image',
      },
      updatedAt: Date.now(),
    })).toEqual({
      directImageUrls: ['https://cdn.example.com/font-design.png'],
      prompt: 'font image',
    });
  });
});
