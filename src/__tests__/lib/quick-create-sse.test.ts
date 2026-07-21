import { describe, expect, it } from 'vitest';
import { flushQuickCreateSseBuffer, parseQuickCreateSseChunk } from '@/lib/quick-create-sse';

describe('quick create SSE parser', () => {
  it('buffers an event split across network chunks', () => {
    const first = parseQuickCreateSseChunk('', 'data: {"type":"delta","content":"创');
    expect(first.events).toEqual([]);

    const second = parseQuickCreateSseChunk(first.buffer, '意"}\n\n');
    expect(second.events).toEqual([{ type: 'delta', content: '创意' }]);
    expect(second.buffer).toBe('');
  });

  it('parses multiple events from one chunk', () => {
    const parsed = parseQuickCreateSseChunk('', [
      'event: status',
      'data: {"type":"status","phase":"understanding","message":"理解需求"}',
      '',
      'event: delta',
      'data: {"type":"delta","content":"内容"}',
      '',
      '',
    ].join('\n'));

    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({ type: 'status', phase: 'understanding' });
    expect(parsed.events[1]).toEqual({ type: 'delta', content: '内容' });
  });

  it('supports CRLF event separators', () => {
    const parsed = parseQuickCreateSseChunk('', 'data: {"type":"done"}\r\n\r\n');
    expect(parsed.events).toEqual([{ type: 'done' }]);
  });

  it('flushes a final event without a trailing blank line', () => {
    expect(flushQuickCreateSseBuffer('data: {"type":"done"}')).toEqual([{ type: 'done' }]);
  });

  it('rejects unknown event types', () => {
    expect(() => parseQuickCreateSseChunk('', 'data: {"type":"unknown"}\n\n')).toThrow('无法解析');
  });

  it('rejects events with missing required fields', () => {
    expect(() => parseQuickCreateSseChunk('', 'data: {"type":"status","phase":"routing"}\n\n')).toThrow('无法解析');
  });
});
