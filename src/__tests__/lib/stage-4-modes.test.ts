import { describe, expect, it } from 'vitest';

import {
  resolveAgentRuntimeMode,
  type AgentRuntimeMode,
} from '@/lib/agent-runtime/mode';

describe('Stage 4 runtime modes', () => {
  it('resolves the agent runtime mode with a legacy fallback', () => {
    const accepted: AgentRuntimeMode[] = ['legacy', 'shadow', 'agent-v2'];

    expect(accepted).toContain(resolveAgentRuntimeMode(undefined));
    expect(resolveAgentRuntimeMode(undefined)).toBe('legacy');
    expect(resolveAgentRuntimeMode('shadow')).toBe('shadow');
    expect(resolveAgentRuntimeMode('agent-v2')).toBe('agent-v2');
    expect(resolveAgentRuntimeMode('invalid')).toBe('legacy');
  });
});
