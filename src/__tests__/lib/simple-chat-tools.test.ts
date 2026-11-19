import { describe, expect, it } from 'vitest';
import { extractReasoningDelta } from '@/lib/simple-chat-tools';

describe('extractReasoningDelta', () => {
  it('reads DeepSeek reasoning_content', () => {
    expect(extractReasoningDelta({ reasoning_content: '思考中' })).toBe('思考中');
  });

  it('reads reasoning and thinking field names', () => {
    expect(extractReasoningDelta({ reasoning: 'abc' })).toBe('abc');
    expect(extractReasoningDelta({ thinking: 'xyz' })).toBe('xyz');
  });

  it('returns empty string when there is no reasoning field', () => {
    expect(extractReasoningDelta({ content: 'hello' })).toBe('');
    expect(extractReasoningDelta(null)).toBe('');
    expect(extractReasoningDelta(undefined)).toBe('');
    expect(extractReasoningDelta({})).toBe('');
  });

  it('ignores non-string reasoning values', () => {
    expect(extractReasoningDelta({ reasoning: 123 as unknown as string })).toBe('');
  });
});
