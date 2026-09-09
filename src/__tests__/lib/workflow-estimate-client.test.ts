import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '@/lib/workflow-engine';
import { estimateWorkflowSkills } from '@/lib/skill-runtime/workflow-estimate-client';
import type { SkillDefinition } from '@/lib/skill-runtime/types';

const skill: SkillDefinition = {
  id: 'test', version: 1, name: '测试', description: '测试', category: 'image', systemPrompt: 'test',
  inputs: [], steps: [{ id: 'image', label: '生成', toolId: 'generate_image', execution: 'sequential', promptTemplate: 'test', modelRole: 'image', qualityGateIds: [] }],
  allowedSurfaces: ['workflow'], enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
};
const bindings = {
  image: { providerId: 'image-provider', modelId: 'image-model' },
  orchestrator: { providerId: 'chat-provider', modelId: 'chat-model' },
};
function scope() {
  const node = createWorkflowNode('ai-skill', 0, 0);
  node.config = { ...node.config, skillId: skill.id, version: 1, modelBindings: bindings };
  return { nodes: [node], connections: [] };
}
const context = { projectId: 'project', workflowId: 'workflow', requestKey: 'estimate' };
afterEach(() => vi.unstubAllGlobals());

describe('workflow Skill quote response validation', () => {
  it.each([
    ['missing bindings', {}],
    ['missing orchestrator', { image: bindings.image }],
    ['changed provider', { ...bindings, image: { ...bindings.image, providerId: 'other' } }],
    ['changed model', { ...bindings, image: { ...bindings.image, modelId: 'other' } }],
  ])('rejects %s instead of freezing it into execution', async (_label, modelBindings) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ minimum: 62, maximum: 62, modelBindings }))));
    await expect(estimateWorkflowSkills(scope(), [skill], context, new AbortController().signal)).rejects.toThrow();
  });

  it('accepts exact server bindings and preserves the original graph', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ minimum: 62, maximum: 62, modelBindings: bindings }))));
    const original = scope();
    const before = JSON.stringify(original);
    const result = await estimateWorkflowSkills(original, [skill], context, new AbortController().signal);
    expect(result.quotes).toMatchObject([{ minimum: 62, maximum: 62 }]);
    expect(JSON.stringify(original)).toBe(before);
    expect(result.scope.nodes[0]).not.toBe(original.nodes[0]);
  });

  it('includes every managed upstream image version when estimating a fan-out Skill', async () => {
    const sources = [1, 2, 3].map(index => {
      const node = createWorkflowNode('input-image', 0, index * 100);
      node.config = {
        ...node.config,
        imageUrl: `/api/serve-upload/uploads/source-${index}.png`,
        assetId: `asset-${index}`,
        assetVersionId: `version-${index}`,
      };
      return node;
    });
    const skillScope = scope();
    const skillNode = skillScope.nodes[0];
    const graph = {
      nodes: [...sources, skillNode],
      connections: sources.map((source, index) => ({
        id: `source-${index + 1}`,
        fromNodeId: source.id,
        fromPortId: 'out-image',
        toNodeId: skillNode.id,
        toPortId: 'in-image',
        type: 'image' as const,
      })),
    };
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ minimum: 62, maximum: 62, modelBindings: bindings }));
    });
    vi.stubGlobal('fetch', fetcher);

    await estimateWorkflowSkills(graph, [skill], context, new AbortController().signal);

    const request = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { sourceVersionIds?: string[] };
    expect(body.sourceVersionIds).toEqual(['version-1', 'version-2', 'version-3']);
  });

  it('rejects a late successful response after cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      return new Response(JSON.stringify({ minimum: 62, maximum: 62, modelBindings: bindings }));
    }));
    await expect(estimateWorkflowSkills(scope(), [skill], context, controller.signal)).rejects.toThrow();
  });

  it('does not request a quote after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ minimum: 62, maximum: 62, modelBindings: bindings })));
    vi.stubGlobal('fetch', fetcher);
    await expect(estimateWorkflowSkills(scope(), [skill], context, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>proxy</html>')));
    await expect(estimateWorkflowSkills(scope(), [skill], context, new AbortController().signal)).rejects.toThrow('格式无效');
  });
});
