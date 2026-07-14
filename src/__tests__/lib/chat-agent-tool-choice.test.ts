import { describe, expect, it } from 'vitest';
import { resolveChatAgentToolChoice } from '@/lib/chat-agent-tool-choice';

describe('resolveChatAgentToolChoice', () => {
  it('requires a tool only for the first Agent iteration', () => {
    expect(resolveChatAgentToolChoice(true, 0)).toBe('required');
    expect(resolveChatAgentToolChoice(true, 1)).toBe('auto');
  });

  it('leaves non-Agent requests in automatic mode', () => {
    expect(resolveChatAgentToolChoice(false, 0)).toBe('auto');
  });
});
