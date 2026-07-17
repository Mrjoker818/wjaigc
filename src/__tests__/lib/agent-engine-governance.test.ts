import { describe, expect, it, vi } from 'vitest';
import { executeAgentLoop, registerTool, type AgentContext } from '@/lib/agent-engine';

function createContext(taskId: string): AgentContext & { allowedTools: string[] } {
  return {
    taskId,
    userPrompt: 'test request',
    maxRounds: 1,
    currentRound: 0,
    contextHistory: [],
    allowedTools: [],
  };
}

describe('agent engine governance', () => {
  it('only exposes tools explicitly allowed for the task', async () => {
    const allowedName = `allowed-tool-${Date.now()}`;
    const hiddenName = `hidden-tool-${Date.now()}`;
    registerTool({ name: allowedName, description: 'allowed', parameters: [], execute: async () => ({ success: true, description: 'ok' }) });
    registerTool({ name: hiddenName, description: 'hidden', parameters: [], execute: async () => ({ success: true, description: 'ok' }) });
    const context = createContext('agent-allowed-tools');
    context.allowedTools = [allowedName];
    const seenToolNames: string[] = [];
    let systemPrompt = '';

    await executeAgentLoop(context, async (messages, tools) => {
      systemPrompt = messages[0]?.content || '';
      seenToolNames.push(...tools.map(tool => tool.function.name));
      return { content: 'done' };
    });

    expect(seenToolNames).toContain(allowedName);
    expect(seenToolNames).not.toContain(hiddenName);
    expect(systemPrompt).toContain(allowedName);
    expect(systemPrompt).not.toContain(hiddenName);
  });

  it('does not execute a tool when required arguments are missing', async () => {
    const toolName = `required-args-tool-${Date.now()}`;
    const execute = vi.fn(async () => ({ success: true, description: 'should not run' }));
    registerTool({
      name: toolName,
      description: 'requires a prompt',
      parameters: [{ name: 'prompt', type: 'string', description: 'prompt', required: true }],
      execute,
    });
    const context = createContext('agent-required-args');
    context.allowedTools = [toolName];

    const result = await executeAgentLoop(context, async () => ({
      toolCalls: [{ name: toolName, arguments: {} }],
    }));

    expect(execute).not.toHaveBeenCalled();
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName, success: false, result: expect.stringContaining('Missing required parameter') }),
    ]));
  });

  it('stops before calling the LLM when its task has been cancelled', async () => {
    const context = createContext('agent-cancelled');
    context.isCancelled = () => true;
    const llmCall = vi.fn();

    const result = await executeAgentLoop(context, llmCall);

    expect(llmCall).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, error: 'Task cancelled' });
  });
});
