import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn().mockResolvedValue({}),
}));

import { executeToolCall } from '@/lib/chat-tools';
import { parseAIBuildResponse } from '@/lib/workflow-engine';

const toolContext = {
  chatApiKey: 'test-key',
  chatBaseUrl: 'https://llm.example.com/v1',
  chatModel: 'chat-model',
  origin: 'https://app.example.com',
  userId: 'user-1',
};

const workflowJson = JSON.stringify({
  name: '商品主图流程',
  description: '生成商品主图并去掉背景',
  nodes: [
    { id: 'n1', type: 'input-text', label: '提示词' },
    { id: 'n2', type: 'ai-generate', label: '生成主图' },
    { id: 'n3', type: 'ai-removebg', label: '去背景' },
    { id: 'n4', type: 'output-image', label: '成品' },
  ],
  connections: [
    { fromNodeId: 'n1', fromPortId: 'text', toNodeId: 'n2', toPortId: 'prompt', type: 'text' },
    { fromNodeId: 'n2', fromPortId: 'image', toNodeId: 'n3', toPortId: 'image', type: 'image' },
    { fromNodeId: 'n3', fromPortId: 'image', toNodeId: 'n4', toPortId: 'image', type: 'image' },
  ],
});

describe('build_workflow chat tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the chat model for a workflow and returns a workflow the canvas can open', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: workflowJson } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await executeToolCall('build_workflow', {
      description: '做一个商品主图：先生成再去背景',
    }, toolContext);

    expect(result.success).toBe(true);
    const calledUrl = String(fetcher.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('llm.example.com');
    const workflow = (result.data as { workflow?: { name?: string; nodes?: unknown[] } }).workflow;
    expect(workflow?.name).toBe('商品主图流程');
    expect(workflow?.nodes?.length).toBeGreaterThanOrEqual(2);
    expect(parseAIBuildResponse(workflowJson)?.nodes).toHaveLength(4);
  });

  it('reads the workflow from an SSE body when the gateway streams anyway', async () => {
    const half = Math.floor(workflowJson.length / 2);
    const sse = [workflowJson.slice(0, half), workflowJson.slice(half)]
      .map(piece => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
      .join('') + 'data: [DONE]\n\n';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(sse, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    }));

    const result = await executeToolCall('build_workflow', {
      description: '做一个商品主图：先生成再去背景',
    }, toolContext);

    expect(result.success).toBe(true);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).stream).toBe(false);
    expect((result.data as { workflow?: { name?: string } }).workflow?.name).toBe('商品主图流程');
  });

  it('fails clearly when the model does not return a usable workflow', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '我不太明白你的需求' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await executeToolCall('build_workflow', {
      description: '随便做点什么',
    }, toolContext);

    expect(result.success).toBe(false);
    expect(result.resultText).toContain('工作流');
  });
});
