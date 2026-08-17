import { describe, expect, it } from 'vitest';

import {
  resolveAgentRuntimeMode,
  type AgentRuntimeMode,
} from '@/lib/agent-runtime/mode';
import {
  resolveDeliveredWorkflowRendererMode,
  resolveWorkflowRendererMode,
  type WorkflowRendererMode,
} from '@/lib/workflow-renderer/mode';

describe('Stage 4 runtime modes', () => {
  it('resolves the agent runtime mode with a legacy fallback', () => {
    const accepted: AgentRuntimeMode[] = ['legacy', 'shadow', 'agent-v2'];

    expect(accepted).toContain(resolveAgentRuntimeMode(undefined));
    expect(resolveAgentRuntimeMode(undefined)).toBe('legacy');
    expect(resolveAgentRuntimeMode('shadow')).toBe('shadow');
    expect(resolveAgentRuntimeMode('agent-v2')).toBe('agent-v2');
    expect(resolveAgentRuntimeMode('invalid')).toBe('legacy');
  });

  it('resolves the workflow renderer mode with a legacy fallback', () => {
    const accepted: WorkflowRendererMode[] = ['legacy', 'shadow', 'react-flow-v2'];

    expect(accepted).toContain(resolveWorkflowRendererMode(undefined));
    expect(resolveWorkflowRendererMode(undefined)).toBe('legacy');
    expect(resolveWorkflowRendererMode('shadow')).toBe('shadow');
    expect(resolveWorkflowRendererMode('react-flow-v2')).toBe('react-flow-v2');
    expect(resolveWorkflowRendererMode('invalid')).toBe('legacy');
  });

  it.each([
    ['legacy', 'legacy'],
    ['shadow', 'shadow'],
    ['react-flow-v2', 'legacy'],
    ['invalid', 'legacy'],
  ] as const)('clamps delivered workflow renderer mode %s to %s', (configured, delivered) => {
    expect(resolveDeliveredWorkflowRendererMode(configured)).toBe(delivered);
  });
});
