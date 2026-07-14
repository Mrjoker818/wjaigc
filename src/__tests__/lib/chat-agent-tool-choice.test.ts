import { describe, expect, it } from 'vitest';
import { getAgentToolChoice } from '@/lib/chat-agent-tool-choice';

describe('getAgentToolChoice', () => {
  it('requires one tool call only for the first Agent turn', () => {
    expect(getAgentToolChoice(true, 1)).toBe('required');
    expect(getAgentToolChoice(true, 2)).toBe('auto');
  });

  it('keeps ordinary chat tool choice automatic', () => {
    expect(getAgentToolChoice(false, 1)).toBe('auto');
  });
});
