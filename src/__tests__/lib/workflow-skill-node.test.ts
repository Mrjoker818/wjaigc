import { describe, expect, it } from 'vitest';

import {
  NODE_TEMPLATES,
  buildWorkflowSkillRunRequest,
  createWorkflowNode,
  getWorkflowNodeTemplates,
  getNodeInputs,
  getNodePropertyFields,
  updateWorkflowSkillModelBinding,
  workflowModelSupportsSkillRole,
  isWorkflowSkillNodeEnabled,
} from '@/lib/workflow-engine';
import type { SkillDefinition } from '@/lib/skill-runtime/types';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { loadWorkflowSkillCatalog } from '@/lib/skill-runtime/workflow-client';

const skill: SkillDefinition = {
  id: 'preset-product',
  version: 3,
  name: '产品套图',
  category: 'image',
  description: '测试工作流 Skill',
  systemPrompt: 'system',
  allowedSurfaces: ['canvas', 'workflow'],
  inputs: [
    { key: 'brief', label: '需求', kind: 'text', required: true },
    { key: 'product', label: '产品图', kind: 'image', required: true },
  ],
  steps: [{
    id: 'generate',
    label: '生成',
    toolId: 'generate_image',
    execution: 'sequential',
    promptTemplate: '{{brief}}',
    modelRole: 'image',
    qualityGateIds: ['output-present'],
  }],
  enabled: true,
  builtIn: true,
  createdAt: 1,
  updatedAt: 1,
  usageCount: 0,
};

describe('workflow Skill node contract', () => {
  it('registers one ai-skill node with stable prompt, image, reference and result ports', () => {
    const node = createWorkflowNode('ai-skill', 10, 20);

    expect(NODE_TEMPLATES.some(template => template.type === 'ai-skill')).toBe(true);
    expect(node.ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'in-prompt', type: 'prompt', direction: 'in' }),
      expect.objectContaining({ id: 'in-image', type: 'image', direction: 'in' }),
      expect.objectContaining({ id: 'in-reference', type: 'image', direction: 'in' }),
      expect.objectContaining({ id: 'out-image', type: 'image', direction: 'out' }),
      expect.objectContaining({ id: 'out-prompt', type: 'prompt', direction: 'out' }),
      expect.objectContaining({ id: 'out-task', type: 'data', direction: 'out' }),
    ]));
  });

  it('hides the Skill node when the shared rollout switch is disabled', () => {
    expect(isWorkflowSkillNodeEnabled('false')).toBe(false);
    expect(getWorkflowNodeTemplates(false).some(template => template.type === 'ai-skill')).toBe(false);
    expect(getWorkflowNodeTemplates(true).some(template => template.type === 'ai-skill')).toBe(true);
  });

  it('does not duplicate the legacy AI model and prompt form for dynamic Skill inputs', () => {
    expect(getNodePropertyFields('ai-skill').map(field => field.key)).toEqual(['label']);
  });

  it('uses the authoritative model capability catalog for Skill roles', () => {
    const descriptor = (overrides: Partial<TaskModelDescriptor>): TaskModelDescriptor => ({
      providerId: 'provider-1', modelId: 'model-1', kind: 'chat', sourceType: 'chat',
      protocol: 'openai', executionMode: 'sync', allowedRatios: [], allowedSizes: [],
      qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false,
      supportsMask: false, outputKinds: [], capabilitySources: {}, ...overrides,
    });

    expect(workflowModelSupportsSkillRole('vision', descriptor({ kind: 'chat', sourceType: 'vlm' }))).toBe(true);
    expect(workflowModelSupportsSkillRole('vision', descriptor({ kind: 'chat', sourceType: 'chat' }))).toBe(false);
    expect(workflowModelSupportsSkillRole('edit', descriptor({ kind: 'edit', sourceType: 'imageEdit' }))).toBe(true);
    expect(workflowModelSupportsSkillRole('edit', descriptor({ kind: 'image', sourceType: 'universal', supportsMask: true }))).toBe(true);
    expect(workflowModelSupportsSkillRole('image', descriptor({ kind: 'image', sourceType: 'general' }))).toBe(true);
  });

  it('builds an authoritative workflow Skill Run request and maps upstream values', () => {
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = {
      ...node.config,
      skillId: skill.id,
      version: skill.version,
      inputValues: { brief: '节点内需求' },
      modelBindings: {
        orchestrator: { providerId: 'pear', modelId: 'chat-model' },
        image: { providerId: 'apimart', modelId: 'image-model' },
      },
      runId: 'old-run-must-not-be-submitted',
      projectId: 'spoofed-project',
    };

    expect(buildWorkflowSkillRunRequest(node, {
      prompt: '上游需求',
      imageUrl: '/api/serve-upload/product.png',
      assetVersionId: 'version-product',
      assetReferences: [{ assetVersionId: 'version-reference', url: '/reference.png' }],
    }, skill, {
      projectId: 'project-real',
      workflowId: 'workflow-real',
      executionId: 'execution-real',
      attempt: 2,
    })).toEqual({
      endpoint: '/api/skill-runs',
      method: 'POST',
      body: {
        skillId: skill.id,
        skillVersion: skill.version,
        surface: 'workflow',
        projectId: 'project-real',
        workspaceId: 'workflow:workflow-real',
        inputValues: {
          brief: '节点内需求',
          product: '/api/serve-upload/product.png',
        },
        sourceVersionIds: ['version-product', 'version-reference'],
        modelBindings: node.config.modelBindings,
        idempotencyKey: `workflow:execution-real:${node.id}:attempt:2`,
      },
    });
  });

  it('excludes disabled Skills from the executable workflow catalog', async () => {
    const disabledSkill = { ...skill, id: 'disabled-skill', enabled: false };
    const fetcher = async () => new Response(JSON.stringify({ skills: [skill, disabledSkill] }), { status: 200 });

    await expect(loadWorkflowSkillCatalog(fetcher as typeof fetch)).resolves.toEqual([skill]);
  });

  it('maps the reference port to a separate required Skill image field', () => {
    const node = createWorkflowNode('ai-skill', 0, 0);
    const imageSkill: SkillDefinition = {
      ...skill,
      inputs: [
        { key: 'primary', label: '主图', kind: 'image', required: true },
        { key: 'reference', label: '参考图', kind: 'image', required: true },
      ],
    };
    node.config = { ...node.config, skillId: imageSkill.id, version: imageSkill.version };
    const results = new Map([
      ['primary-node', { nodeId: 'primary-node', status: 'success' as const, output: { imageUrl: '/primary.png', assetVersionId: 'version-primary' }, durationMs: 1 }],
      ['reference-node', { nodeId: 'reference-node', status: 'success' as const, output: { imageUrl: '/reference.png', assetVersionId: 'version-reference' }, durationMs: 1 }],
    ]);
    const inputs = getNodeInputs(node, [
      { id: 'primary-edge', fromNodeId: 'primary-node', fromPortId: 'out-image', toNodeId: node.id, toPortId: 'in-image', type: 'image' },
      { id: 'reference-edge', fromNodeId: 'reference-node', fromPortId: 'out-image', toNodeId: node.id, toPortId: 'in-reference', type: 'image' },
    ], results);

    expect(buildWorkflowSkillRunRequest(node, inputs, imageSkill, {
      projectId: 'project', workflowId: 'workflow', executionId: 'execution',
    }).body.inputValues).toEqual({
      primary: '/primary.png',
      reference: '/reference.png',
    });
  });

  it('preserves reference-port mapping when the primary image field is configured on the node', () => {
    const node = createWorkflowNode('ai-skill', 0, 0);
    const imageSkill: SkillDefinition = {
      ...skill,
      inputs: [
        { key: 'primary', label: '主图', kind: 'image', required: true },
        { key: 'reference', label: '参考图', kind: 'image', required: true },
      ],
    };
    node.config = {
      ...node.config,
      skillId: imageSkill.id,
      version: imageSkill.version,
      inputValues: { primary: '/configured-primary.png' },
    };

    expect(buildWorkflowSkillRunRequest(node, {
      imageUrl: '/connected-primary.png',
      referenceImageUrls: ['/connected-reference.png'],
    }, imageSkill, {
      projectId: 'project', workflowId: 'workflow', executionId: 'execution',
    }).body.inputValues).toEqual({
      primary: '/configured-primary.png',
      reference: '/connected-reference.png',
    });
  });

  it('does not promote a reference-only edge into the primary Skill image field', () => {
    const node = createWorkflowNode('ai-skill', 0, 0);
    const imageSkill: SkillDefinition = {
      ...skill,
      inputs: [
        { key: 'primary', label: '主图', kind: 'image', required: false },
        { key: 'reference', label: '参考图', kind: 'image', required: true },
      ],
    };
    node.config = { ...node.config, skillId: imageSkill.id, version: imageSkill.version };

    expect(buildWorkflowSkillRunRequest(node, {
      referenceImageUrls: ['/reference-only.png'],
    }, imageSkill, {
      projectId: 'project', workflowId: 'workflow', executionId: 'execution',
    }).body.inputValues).toEqual({
      reference: '/reference-only.png',
    });
  });

  it('treats cleared node fields as unset so connected inputs can populate them', () => {
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = {
      ...node.config,
      skillId: skill.id,
      version: skill.version,
      inputValues: { brief: '', product: '' },
    };

    expect(buildWorkflowSkillRunRequest(node, {
      prompt: '上游需求',
      imageUrl: '/connected-product.png',
    }, skill, {
      projectId: 'project', workflowId: 'workflow', executionId: 'execution',
    }).body.inputValues).toEqual({
      brief: '上游需求',
      product: '/connected-product.png',
    });
  });

  it('removes a stale role binding when the model selection is cleared', () => {
    expect(updateWorkflowSkillModelBinding({
      image: { providerId: 'pear', modelId: 'image-model' },
      orchestrator: { providerId: 'pear', modelId: 'chat-model' },
    }, 'image', null)).toEqual({
      orchestrator: { providerId: 'pear', modelId: 'chat-model' },
    });
  });

  it('uses a separate idempotency namespace for a manual retry', () => {
    const node = createWorkflowNode('ai-skill', 0, 0);
    node.config = { ...node.config, skillId: skill.id, version: skill.version };

    expect(buildWorkflowSkillRunRequest(node, {}, skill, {
      projectId: 'project', workflowId: 'workflow', executionId: 'execution',
      attempt: 1,
      attemptKey: 'retry:1',
    }).body.idempotencyKey).toBe(`workflow:execution:${node.id}:attempt:retry:1`);
  });
});
