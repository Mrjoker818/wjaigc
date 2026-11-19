import { describe, expect, it } from 'vitest';
import { extractReasoningDelta, formatSearchDisplay, safeSourceUrl } from '@/lib/simple-chat-tools';

describe('simple chat tools', () => {
  it('keeps only http(s) source links without credentials', () => {
    expect(safeSourceUrl('https://a.example/x?y=1')).toBe('https://a.example/x?y=1');
    expect(safeSourceUrl('javascript:alert(1)')).toBe('');
    expect(safeSourceUrl('https://user:pw@a.example')).toBe('');
    expect(safeSourceUrl('not a url')).toBe('');
  });

  it('puts every search of a turn into one card with continuous numbering', () => {
    const text = formatSearchDisplay(['a', 'b'], [
      { index: 1, title: 'One', url: 'https://a.example', snippet: 's1' },
      { index: 2, title: 'Two', url: '', snippet: 's2' },
    ], []);
    expect(text).toContain('搜索关键词: "a" / "b"');
    expect(text).toContain('[2] Two\nURL: 无\n摘要: s2');
  });

  it('reads reasoning under the field names relays use', () => {
    expect(extractReasoningDelta({ reasoning_content: 'r1' })).toBe('r1');
    expect(extractReasoningDelta({ reasoning: 'r2' })).toBe('r2');
    expect(extractReasoningDelta({ thinking: 'r3' })).toBe('r3');
    expect(extractReasoningDelta({ content: 'x' })).toBe('');
    expect(extractReasoningDelta(null)).toBe('');
  });
});
