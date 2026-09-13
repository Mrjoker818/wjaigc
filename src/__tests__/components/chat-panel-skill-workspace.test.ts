import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { authorizeAgentContext } from '@/lib/agent-runtime/context-adapters';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';
import { requiredSkillModelRoles, skillStepModelRole } from '@/lib/skill-runtime/types';

// Execute the actual component callback, without mounting the unrelated chat UI.
const source = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');
const tree = ts.createSourceFile('chat-panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.Expression | undefined;
let unavailableReasonCallback: ts.Expression | undefined;
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'buildCanvasSkillRequest'
      && node.initializer && ts.isCallExpression(node.initializer)) {
    callback = node.initializer.arguments[0];
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'canvasSkillModelUnavailableReason'
      && node.initializer && ts.isCallExpression(node.initializer)) {
    unavailableReasonCallback = node.initializer.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (!callback) throw new Error('Canvas Skill request callback missing');
if (!unavailableReasonCallback) throw new Error('Canvas Skill model reason callback missing');
const script = ts.transpileModule(`(${callback.getText(tree)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const unavailableReasonScript = ts.transpileModule(`(${unavailableReasonCallback.getText(tree)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function requestFor(sessionId: string): SkillRunRequest {
  const build = runInNewContext(script, {
    activeSkill: { id: 'preset-mockup-showcase', version: 1, inputs: [], steps: [{ modelRole: 'image' }] },
    projectId: 'project-a', currentSessionId: sessionId,
    availableChatModels: [{ id: 'chat-model', providerId: 'chat-provider' }], model: 'chat-model',
    discoveredImageModels: [{ id: 'image-model', providerId: 'image-provider' }],
    imageModel: 'image-model', imageModelProviderId: 'image-provider',
    selectedCanvasImage: { id: 'image-a', assetVersionId: 'version-a' },
    pendingImages: [], activeMentions: [], skillParamValues: { designContent: 'Keep the selected product' },
    canvasSkillSourceVersionIds: ['version-a'],
    canvasSkillRequestSourceVersionIds: ['version-a'],
    canvasSkillInputValues: {
      designContent: 'Keep the selected product',
      sourceImages: ['version-a'],
    },
    createCanvasSkillIdempotencyKey: () => 'canvas-skill:test-request',
    requiredSkillModelRoles,
    crypto: { randomUUID: () => 'test-request' },
  }) as () => SkillRunRequest;
  return build();
}

function visionRequestFor(input: {
  selectedModel: string;
  models: Array<{ id: string; providerId: string; supportsVision?: boolean }>;
}): SkillRunRequest | null {
  const build = runInNewContext(script, {
    activeSkill: {
      id: 'preset-platform-compliance-audit', version: 1, inputs: [],
      steps: [{ modelRole: 'vision' }],
    },
    projectId: 'project-a',
    availableChatModels: input.models,
    model: input.selectedModel,
    discoveredImageModels: [], imageModel: '', imageModelProviderId: '',
    canvasSkillSourceVersionIds: ['version-a'],
    canvasSkillRequestSourceVersionIds: ['version-a'],
    canvasSkillInputValues: { sourceImages: ['version-a'] },
    createCanvasSkillIdempotencyKey: () => 'canvas-skill:vision-request',
    requiredSkillModelRoles,
    crypto: { randomUUID: () => 'vision-request' },
  }) as () => SkillRunRequest | null;
  return build();
}

function unavailableReasonFor(input: {
  selectedModel: string;
  models: Array<{ id: string; name: string; providerId: string; supportsVision?: boolean }>;
}): string | undefined {
  const reason = runInNewContext(unavailableReasonScript, {
    activeSkill: {
      id: 'preset-platform-compliance-audit', version: 1, inputs: [],
      steps: [{ modelRole: 'vision' }],
    },
    projectId: 'project-a',
    availableChatModels: input.models,
    model: input.selectedModel,
    discoveredImageModels: [], imageModel: '', imageModelProviderId: '',
    skillStepModelRole,
  }) as () => string | undefined;
  return reason();
}

describe('Canvas Skill asset workspace identity', () => {
  it('loads explicit vision capability from the unified task model catalog', () => {
    expect(source).toContain('descriptor?.supportsVision === true');
  });

  it.each(['session-old', 'session-new', ''])('uses the canvas placement regardless of chat session %s', async sessionId => {
    const request = requestFor(sessionId);
    expect(request.workspaceId).toBe('canvas:project-a');
    expect(request.sourceVersionIds).toEqual(['version-a']);
    expect(request.inputValues.sourceImages).toEqual(['version-a']);
    expect(request.modelBindings.image).toEqual({ providerId: 'image-provider', modelId: 'image-model' });

    const context = await authorizeAgentContext({
      actorUserId: 'owner-a',
      request: {
        ...request, workspace: 'canvas',
        context: { visibleVersionIds: [], selectedEntityIds: [] },
      } as unknown as AgentRunRequest,
      storage: {
        transaction: async execute => execute({
          findProject: async (owner, project) => owner === 'owner-a' && project === 'project-a',
          findAsset: async (owner, project, assetId) =>
            owner === 'owner-a' && project === 'project-a' && assetId === 'asset-a'
              ? { id: assetId, kind: 'image' as const } : null,
          findVersion: async (_owner, _project, version) => version === 'version-a'
            ? {
              id: version, assetId: 'asset-a',
              file: {
                url: '/api/serve-upload/product.png', availability: 'ready' as const, mimeType: 'image/png',
              },
            } : null,
          findVersionPlacement: async (_owner, _project, surface, workspace, version) =>
            surface === 'canvas' && workspace === 'canvas:project-a' && version === 'version-a'
              ? { id: 'placement-a', assetVersionId: version } : null,
        }),
      },
    });
    expect(context.mediaByVersionId['version-a']).toBe('/api/serve-upload/product.png');
  });

  it('binds the explicitly selected authorized VLM to the real Canvas vision request', () => {
    const request = visionRequestFor({
      selectedModel: 'vision-provider::vision-model',
      models: [{
        id: 'vision-provider::vision-model', providerId: 'vision-provider', supportsVision: true,
      }],
    });

    expect(request?.modelBindings).toEqual({
      orchestrator: { providerId: 'vision-provider', modelId: 'vision-model' },
      vision: { providerId: 'vision-provider', modelId: 'vision-model' },
    });
  });

  it('does not silently switch to another provider when the selected model lacks vision', () => {
    expect(visionRequestFor({
      selectedModel: 'chat-provider::chat-model',
      models: [
        { id: 'chat-provider::chat-model', providerId: 'chat-provider' },
        { id: 'vision-provider::vision-model', providerId: 'vision-provider', supportsVision: true },
      ],
    })).toBeNull();
  });

  it('explains that the selected chat model lacks vision and names an available VLM', () => {
    expect(unavailableReasonFor({
      selectedModel: 'chat-provider::chat-model',
      models: [
        { id: 'chat-provider::chat-model', name: '普通聊天模型', providerId: 'chat-provider' },
        {
          id: 'vision-provider::qwen-vl-max', name: '通义千问',
          providerId: 'vision-provider', supportsVision: true,
        },
      ],
    })).toBe('当前模型不支持图片理解，请切换到视觉模型：通义千问');
  });

  it('does not report a model error after the user explicitly selects a VLM', () => {
    expect(unavailableReasonFor({
      selectedModel: 'vision-provider::qwen-vl-max',
      models: [{
        id: 'vision-provider::qwen-vl-max', name: '通义千问',
        providerId: 'vision-provider', supportsVision: true,
      }],
    })).toBeUndefined();
  });
});
