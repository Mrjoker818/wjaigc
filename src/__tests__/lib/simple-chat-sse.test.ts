import { describe, expect, it, vi } from 'vitest';
import {
  SimpleChatSseDecoder,
  SimpleChatSseProtocolError,
  consumeSimpleChatJsonStream,
} from '@/lib/simple-chat-sse';

const encoder = new TextEncoder();

function byteChunks(...values: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const value of values) controller.enqueue(encoder.encode(value));
      controller.close();
    },
  });
}

describe('SimpleChatSseDecoder', () => {
  it('reassembles JSON split across arbitrary byte chunks', () => {
    const decoder = new SimpleChatSseDecoder();
    expect(decoder.push(encoder.encode('data: {"type":"te'))).toEqual([]);
    expect(decoder.push(encoder.encode('xt","content":"ok"}\n\n')))
      .toEqual([{ data: '{"type":"text","content":"ok"}' }]);
  });

  it('supports CRLF, comments, event, id and multiline data', () => {
    const decoder = new SimpleChatSseDecoder();
    const events = decoder.push(encoder.encode(
      ':heartbeat\r\nevent: message\r\nid: 7\r\ndata: {"type":"text",\r\ndata: "content":"ok"}\r\n\r\n',
    ));
    expect(events).toEqual([{
      event: 'message',
      id: '7',
      data: '{"type":"text",\n"content":"ok"}',
    }]);
  });

  it('preserves a Chinese UTF-8 character split between byte chunks', () => {
    const bytes = encoder.encode('data: {"type":"text","content":"中文"}\n\n');
    const split = bytes.findIndex((value, index) => index > 0 && value >= 0x80);
    const decoder = new SimpleChatSseDecoder();
    expect(decoder.push(bytes.slice(0, split + 1))).toEqual([]);
    expect(decoder.push(bytes.slice(split + 1))).toEqual([
      { data: '{"type":"text","content":"中文"}' },
    ]);
  });

  it('returns every complete event from one chunk', () => {
    const decoder = new SimpleChatSseDecoder();
    expect(decoder.push(encoder.encode('data: {"n":1}\n\ndata: {"n":2}\n\n')))
      .toEqual([{ data: '{"n":1}' }, { data: '{"n":2}' }]);
  });

  it('flushes an event without a trailing newline', () => {
    const decoder = new SimpleChatSseDecoder();
    decoder.push(encoder.encode('data: {"tail":true}'));
    expect(decoder.finish()).toEqual([{ data: '{"tail":true}' }]);
  });
});

describe('consumeSimpleChatJsonStream', () => {
  it('stops cleanly at DONE and ignores late events', async () => {
    const onEvent = vi.fn();
    await expect(consumeSimpleChatJsonStream(
      byteChunks('data: {"n":1}\n\ndata: [DONE]\n\ndata: {"n":2}\n\n'),
      { onEvent },
    )).resolves.toBe('completed');
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ n: 1 });
  });

  it('fails fast on malformed non-empty JSON', async () => {
    await expect(consumeSimpleChatJsonStream(
      byteChunks('data: {"broken":\n\n'),
      { onEvent: vi.fn() },
    )).rejects.toMatchObject({
      name: 'SimpleChatSseProtocolError',
      code: 'SIMPLE_CHAT_SSE_MALFORMED',
    } satisfies Partial<SimpleChatSseProtocolError>);
  });

  it('does not swallow callback failures', async () => {
    const failure = new Error('business handler failed');
    await expect(consumeSimpleChatJsonStream(
      byteChunks('data: {"n":1}\n\n'),
      { onEvent: () => { throw failure; } },
    )).rejects.toBe(failure);
  });

  it('cancels a stale request before dispatching later events', async () => {
    let active = true;
    const onEvent = vi.fn(() => { active = false; });
    await expect(consumeSimpleChatJsonStream(
      byteChunks('data: {"n":1}\n\n', 'data: {"n":2}\n\n'),
      { onEvent, isActive: () => active },
    )).resolves.toBe('cancelled');
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
