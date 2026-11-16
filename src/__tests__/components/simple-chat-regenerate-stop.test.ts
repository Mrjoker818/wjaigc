import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSimpleChatRegenerateIdempotencyKey,
  isLatestSimpleChatAssistantMessage,
} from '@/components/simple-chat/chat-area';
import type { SimpleChatMessage } from '@/components/simple-chat/simple-chat-types';

const source = readFileSync(join(process.cwd(), 'src/components/simple-chat/chat-area.tsx'), 'utf8');

function message(id: string, role: SimpleChatMessage['role']): SimpleChatMessage {
  return { id, role, content: id, createdAt: 0 };
}

describe('simple chat regenerate', () => {
  it('only regenerates the latest assistant reply', () => {
    const messages = [message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user'), message('a2', 'assistant'), message('s', 'search')];
    expect(isLatestSimpleChatAssistantMessage(messages, 'a2')).toBe(true);
    expect(isLatestSimpleChatAssistantMessage(messages, 'a1')).toBe(false);
  });

  it('uses a fresh idempotency key that the retry context still accepts', () => {
    const first = buildSimpleChatRegenerateIdempotencyKey('task-1', 'assistant-1');
    const second = buildSimpleChatRegenerateIdempotencyKey('task-1', 'assistant-1');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^simple-chat-regenerate:task-1:assistant-1:[a-z0-9]+$/);
    expect(first.length).toBeLessThanOrEqual(256);
  });

  it('replaces the turn in place instead of clicking a missing send button', () => {
    expect(source).not.toContain("getElementById('send-btn')");
    expect(source).toContain('void regenerateMessage(msg.id)');
  });
});

describe('simple chat stop generation', () => {
  it('aborts both chat and deep research requests', () => {
    expect(source.match(/signal: abortController\.signal/g)).toHaveLength(2);
    expect(source).toContain('aria-label="停止生成"');
    expect(source).toContain('streamAbortRef.current?.abort()');
  });
});
