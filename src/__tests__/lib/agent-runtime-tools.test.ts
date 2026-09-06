import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  AgentContextNotFoundError,
  authorizeAgentContext,
  resolveAgentMediaUrls,
  resolveOptionalSelectedAgentMediaUrl,
  resolveSelectedAgentMediaUrl,
} from '@/lib/agent-runtime/context-adapters';
import {
  authorizeAgentTools,
  type AgentToolDefinition,
} from '@/lib/agent-runtime/tool-registry';
import { toAgentModelCapabilitySet } from '@/lib/agent-runtime/model-capability-set';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { AgentRunRequest } from '@/lib/agent-runtime/types';
import { executeToolCall, validateChatToolCall } from '@/lib/chat-tools';

const registry: AgentToolDefinition[] = [
  {
    toolId: 'generate_image',
    workspaces: ['canvas', 'workflow', 'chat'],
    productTypes: ['canvas', 'simple-chat'],
    modelCapabilities: ['image'],
  },
  {
    toolId: 'edit_image',
    workspaces: ['canvas', 'workflow'],
    productTypes: ['canvas'],
    modelCapabilities: ['edit', 'image'],
  },
];

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    projectId: 'project-1',
    workspace: 'canvas',
    workspaceId: 'canvas-1',
    mode: 'agent',
    providerId: 'provider-1',
    modelId: 'model-1',
    prompt: 'Create a poster',
    sourceVersionIds: ['version-1'],
    allowedToolIds: ['generate_image'],
    idempotencyKey: 'agent-request-1',
    context: {
      selectedEntityIds: ['image-1'],
      visibleVersionIds: ['version-1'],
      locale: 'zh-CN',
    },
    ...overrides,
  };
}

describe('Agent tool authorization', () => {
  it('authorizes the shared img2img tool for chat orchestration and reference-image execution', () => {
    const orchestrator = authorizeAgentTools({
      requestedToolIds: ['img2img'], workspace: 'canvas', userProductTypes: ['canvas'],
      modelCapabilities: ['chat'],
    });
    const downstream = authorizeAgentTools({
      requestedToolIds: ['img2img'], workspace: 'canvas', userProductTypes: ['canvas'],
      modelCapabilities: ['image', 'reference-images'], capabilityScope: 'downstream',
    });

    expect(orchestrator.denials).toEqual([]);
    expect(orchestrator.tools.map(tool => tool.toolId)).toEqual(['img2img']);
    expect(downstream.denials).toEqual([]);
    expect(downstream.tools.map(tool => tool.toolId)).toEqual(['img2img']);
  });

  it('derives every Agent capability from one exact task model descriptor', () => {
    const model: TaskModelDescriptor = {
      providerId: 'provider-video',
      modelId: 'model-video',
      kind: 'video',
      sourceType: 'video',
      protocol: 'async-video',
      executionMode: 'async',
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: true,
      supportsMask: true,
      supportedOperations: ['image-to-video', 'video-extend'],
      outputKinds: ['mp4'],
      capabilitySources: {},
    };

    expect(toAgentModelCapabilitySet(model)).toEqual(new Set([
      'video',
      'reference-images',
      'edit',
      'image-to-video',
      'video-extend',
    ]));
  });

  it('preserves the established edit model image capability without requiring a mask', () => {
    const model: TaskModelDescriptor = {
      providerId: 'provider-edit',
      modelId: 'model-edit',
      kind: 'edit',
      sourceType: 'imageEdit',
      protocol: 'images-edits',
      executionMode: 'async',
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      outputKinds: ['png'],
      capabilitySources: {},
    };

    expect(toAgentModelCapabilitySet(model)).toEqual(new Set(['edit', 'image']));
  });

  it('preserves VLM vision capability from the exact descriptor source type', () => {
    const model: TaskModelDescriptor = {
      providerId: 'provider-vlm',
      modelId: 'model-vlm',
      kind: 'chat',
      sourceType: 'vlm',
      protocol: 'chat-completions',
      executionMode: 'sync',
      allowedRatios: [],
      allowedSizes: [],
      qualityOptions: [],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      outputKinds: ['text'],
      capabilitySources: {},
    };

    expect(toAgentModelCapabilitySet(model)).toEqual(new Set(['chat', 'vision']));
  });

  it('uses the shared descriptor capability set in every Agent runtime admission path', () => {
    const runtimeFiles = [
      'src/lib/agent-runtime/admission-gate.ts',
      'src/lib/agent-runtime/service.ts',
      'src/lib/agent-runtime/same-task-adapter.ts',
    ];

    for (const file of runtimeFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).toContain('toAgentModelCapabilitySet');
      expect(source).not.toContain('function modelCapabilities(');
    }
  });

  it('denies requested tools when the exact model lacks the required capability', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['generate_image', 'edit_image'],
      workspace: 'chat',
      userProductTypes: ['simple-chat'],
      modelCapabilities: ['chat'],
      registry,
    });

    expect(authorization.tools).toEqual([]);
    expect(authorization.denials).toEqual(expect.arrayContaining([
      { toolId: 'generate_image', code: 'MODEL_CAPABILITY_REQUIRED' },
      { toolId: 'edit_image', code: 'WORKSPACE_FORBIDDEN' },
    ]));
  });

  it('returns a tool only when workspace, product, and every model capability are authorized', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['edit_image'],
      workspace: 'canvas',
      userProductTypes: ['canvas'],
      modelCapabilities: ['chat', 'image', 'edit'],
      registry,
    });

    expect(authorization.tools.map(tool => tool.toolId)).toEqual(['edit_image']);
    expect(authorization.denials).toEqual([]);
  });

  it('reports missing tools and product permissions without inventing a fallback tool', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['missing_tool', 'generate_image'],
      workspace: 'canvas',
      userProductTypes: ['unauthorized-product'],
      modelCapabilities: ['image'],
      registry,
    });

    expect(authorization.tools).toEqual([]);
    expect(authorization.denials).toEqual([
      { toolId: 'missing_tool', code: 'TOOL_NOT_FOUND' },
      { toolId: 'generate_image', code: 'PRODUCT_PERMISSION_REQUIRED' },
    ]);
  });

  it('does not treat reference-image input support as vision analysis capability', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['analyze_image'],
      workspace: 'chat',
      userProductTypes: ['simple-chat'],
      modelCapabilities: ['image', 'reference-images'],
    });

    expect(authorization.tools).toEqual([]);
    expect(authorization.denials).toEqual([
      { toolId: 'analyze_image', code: 'MODEL_CAPABILITY_REQUIRED' },
    ]);
  });

  it('authorizes the existing Agent-edit planner only for a canvas chat model', () => {
    const authorization = authorizeAgentTools({
      requestedToolIds: ['agent_edit'],
      workspace: 'canvas',
      userProductTypes: ['canvas'],
      modelCapabilities: ['chat'],
    });

    expect(authorization.tools.map(tool => tool.toolId)).toEqual(['agent_edit']);
    expect(authorization.denials).toEqual([]);
  });

  it('separates orchestrator chat admission from downstream image tool admission', () => {
    const orchestrator = authorizeAgentTools({
      requestedToolIds: ['generate_image'],
      workspace: 'chat',
      userProductTypes: ['simple-chat'],
      modelCapabilities: ['chat'],
      capabilityScope: 'orchestrator',
    });
    const downstream = authorizeAgentTools({
      requestedToolIds: ['generate_image'],
      workspace: 'chat',
      userProductTypes: ['simple-chat'],
      modelCapabilities: ['image'],
      capabilityScope: 'downstream',
    });

    expect(orchestrator.tools.map(tool => tool.toolId)).toEqual(['generate_image']);
    expect(downstream.tools.map(tool => tool.toolId)).toEqual(['generate_image']);
  });

  it('requires vision rather than plain chat for downstream image analysis', () => {
    const denied = authorizeAgentTools({
      requestedToolIds: ['analyze_image'],
      workspace: 'chat',
      userProductTypes: ['simple-chat'],
      modelCapabilities: ['chat'],
      capabilityScope: 'downstream',
    });
    const admitted = authorizeAgentTools({
      requestedToolIds: ['analyze_image'],
      workspace: 'chat',
      userProductTypes: ['simple-chat'],
      modelCapabilities: ['chat', 'vision'],
      capabilityScope: 'downstream',
    });

    expect(denied.tools).toEqual([]);
    expect(admitted.tools.map(tool => tool.toolId)).toEqual(['analyze_image']);
  });

  it('uses downstream capability scope only in per-tool admission paths', () => {
    const admissionSource = readFileSync(resolve(process.cwd(), 'src/lib/agent-runtime/admission-gate.ts'), 'utf8');
    const adoptionSource = readFileSync(resolve(process.cwd(), 'src/lib/agent-runtime/same-task-adapter.ts'), 'utf8');
    const serviceSource = readFileSync(resolve(process.cwd(), 'src/lib/agent-runtime/service.ts'), 'utf8');

    expect(admissionSource).toContain("capabilityScope: 'downstream'");
    expect(adoptionSource).toContain("capabilityScope: 'downstream'");
    expect(serviceSource).toContain("capabilityScope: 'orchestrator'");
  });
});

describe('Agent context ownership adapter', () => {
  it('resolves authorized media in source-version order', () => {
    expect(resolveAgentMediaUrls({
      snapshot: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
      mediaByVersionId: { 'version-b': 'https://example.com/b.png', 'version-a': 'https://example.com/a.png' },
      selectedEntityVersionIds: {},
    }, ['version-a', 'version-b'])).toEqual([
      'https://example.com/a.png', 'https://example.com/b.png',
    ]);
  });

  it('omits the legacy single-image binding for a multi-selection', () => {
    expect(resolveOptionalSelectedAgentMediaUrl({
      snapshot: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
      mediaByVersionId: { 'version-a': 'https://example.com/a.png', 'version-b': 'https://example.com/b.png' },
      selectedEntityVersionIds: { 'entity-a': 'version-a', 'entity-b': 'version-b' },
    }, ['entity-a', 'entity-b'])).toBeUndefined();
  });

  it('resolves the selected entity placement regardless of source-version ordering', () => {
    const authorized = {
      snapshot: { selectedEntityIds: ['image-2'], visibleVersionIds: [], locale: 'zh-CN' as const },
      mediaByVersionId: {
        'version-1': 'https://media.example.com/version-1.png',
        'version-2': 'https://media.example.com/version-2.png',
      },
      selectedEntityVersionIds: { 'image-2': 'version-2' },
    };

    expect(resolveSelectedAgentMediaUrl(authorized, ['image-2']))
      .toBe('https://media.example.com/version-2.png');
  });

  it('fails closed before provider execution for a missing selected placement/version mapping', () => {
    const provider = vi.fn();
    const authorized = {
      snapshot: { selectedEntityIds: ['image-2'], visibleVersionIds: [], locale: 'zh-CN' as const },
      mediaByVersionId: { 'version-1': 'https://media.example.com/version-1.png' },
      selectedEntityVersionIds: { 'image-2': 'foreign-version' },
    };

    expect(() => resolveSelectedAgentMediaUrl(authorized, ['image-2']))
      .toThrow(AgentContextNotFoundError);
    expect(provider).not.toHaveBeenCalled();
  });

  it('validates project and every unique source or visible version through Asset Graph scope', async () => {
    const transaction = {
      findProject: vi.fn(async () => true),
      findVersion: vi.fn(async (_ownerId: string, _projectId: string, versionId: string) => (
        versionId === 'version-1' || versionId === 'version-2'
          ? { id: versionId, file: { url: `https://media.example.com/${versionId}.png` } }
          : null
      )),
      findEntityPlacement: vi.fn(async (
        _ownerId: string,
        _projectId: string,
        _workspace: string,
        _workspaceId: string,
        entityId: string,
      ) => entityId === 'image-1' ? { id: 'placement-1', assetVersionId: 'version-1' } : null),
      findVersionPlacement: vi.fn(async (
        _ownerId: string,
        _projectId: string,
        _workspace: string,
        _workspaceId: string,
        versionId: string,
      ) => versionId === 'version-1' ? { id: 'placement-1', assetVersionId: versionId } : null),
    };
    const storage = {
      transaction: async <T>(callback: (value: typeof transaction) => Promise<T>): Promise<T> => (
        callback(transaction)
      ),
    };

    await expect(authorizeAgentContext({
      actorUserId: 'owner-1',
      request: request({
        sourceVersionIds: ['version-1', 'version-1'],
        context: {
          selectedEntityIds: ['image-1'],
          visibleVersionIds: ['version-1', 'version-2'],
          locale: 'zh-CN',
        },
      }),
      storage,
    })).resolves.toMatchObject({
      snapshot: {
        selectedEntityIds: ['image-1'],
        visibleVersionIds: ['version-1', 'version-2'],
        locale: 'zh-CN',
      },
      mediaByVersionId: {
        'version-1': expect.any(String),
        'version-2': expect.any(String),
      },
      selectedEntityVersionIds: { 'image-1': 'version-1' },
    });
    expect(transaction.findProject).toHaveBeenCalledWith('owner-1', 'project-1');
    expect(transaction.findVersion).toHaveBeenCalledTimes(2);
    expect(transaction.findVersion).toHaveBeenCalledWith('owner-1', 'project-1', 'version-1');
    expect(transaction.findVersion).toHaveBeenCalledWith('owner-1', 'project-1', 'version-2');
    expect(transaction.findEntityPlacement).toHaveBeenCalledWith(
      'owner-1', 'project-1', 'canvas', 'canvas-1', 'image-1',
    );
    expect(transaction.findVersionPlacement).toHaveBeenCalledWith(
      'owner-1', 'project-1', 'canvas', 'canvas-1', 'version-1',
    );
  });

  it('rejects a source version placed only in another workspace of the same project', async () => {
    const storage = {
      transaction: async <T>(callback: (value: {
        findProject: () => Promise<boolean>;
        findVersion: () => Promise<{ id: string; file: { url: string } }>;
        findVersionPlacement: () => Promise<null>;
      }) => Promise<T>): Promise<T> => callback({
        findProject: async () => true,
        findVersion: async () => ({
          id: 'version-workflow-only',
          file: { url: 'https://media.example.com/workflow.png' },
        }),
        findVersionPlacement: async () => null,
      }),
    };

    await expect(authorizeAgentContext({
      actorUserId: 'owner-1',
      request: request({
        workspace: 'canvas',
        workspaceId: 'canvas-1',
        sourceVersionIds: ['version-workflow-only'],
        context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
      }),
      storage,
    })).rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND', status: 404 });
  });

  it('rejects a placement/version mismatch instead of authorizing an unrelated URL', async () => {
    const provider = vi.fn();
    const storage = {
      transaction: async <T>(callback: (value: {
        findProject: () => Promise<boolean>;
        findVersion: () => Promise<{ id: string; file: { url: string } }>;
        findVersionPlacement: () => Promise<{ id: string; assetVersionId: string }>;
        findEntityPlacement: () => Promise<{ id: string; assetVersionId: string }>;
      }) => Promise<T>): Promise<T> => callback({
        findProject: async () => true,
        findVersion: async () => ({ id: 'version-1', file: { url: 'https://media.example.com/v1.png' } }),
        findVersionPlacement: async () => ({ id: 'placement-1', assetVersionId: 'version-1' }),
        findEntityPlacement: async () => ({ id: 'placement-1', assetVersionId: 'foreign-version' }),
      }),
    };

    await expect(authorizeAgentContext({
      actorUserId: 'owner-1', request: request(), storage,
    })).rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('fails closed when a selected entity has no active placement in the requested workspace', async () => {
    const storage = {
      transaction: async <T>(callback: (value: {
        findProject: () => Promise<boolean>;
        findVersion: () => Promise<{ id: string }>;
        findVersionPlacement: () => Promise<{ id: string; assetVersionId: string }>;
        findEntityPlacement: () => Promise<null>;
      }) => Promise<T>): Promise<T> => callback({
        findProject: async () => true,
        findVersion: async () => ({ id: 'version-1' }),
        findVersionPlacement: async () => ({ id: 'placement-1', assetVersionId: 'version-1' }),
        findEntityPlacement: async () => null,
      }),
    };

    await expect(authorizeAgentContext({
      actorUserId: 'owner-1',
      request: request(),
      storage,
    })).rejects.toMatchObject({ code: 'AGENT_CONTEXT_NOT_FOUND', status: 404 });
  });

  it.each([
    { projectOwned: false, missingVersion: false },
    { projectOwned: true, missingVersion: true },
  ])('fails closed without distinguishing project or version existence: %j', async ({
    projectOwned,
    missingVersion,
  }) => {
    const storage = {
      transaction: async <T>(callback: (value: {
        findProject: () => Promise<boolean>;
        findVersion: () => Promise<null | { id: string }>;
        findVersionPlacement: () => Promise<null>;
      }) => Promise<T>): Promise<T> => callback({
        findProject: async () => projectOwned,
        findVersion: async () => missingVersion ? null : { id: 'version-1' },
        findVersionPlacement: async () => null,
      }),
    };

    await expect(authorizeAgentContext({
      actorUserId: 'wrong-or-unscoped-owner',
      request: request(),
      storage,
    })).rejects.toEqual(expect.objectContaining({
      name: AgentContextNotFoundError.name,
      code: 'AGENT_CONTEXT_NOT_FOUND',
      status: 404,
      message: 'Agent context not found',
    }));
  });
});

describe('controlled img2img media contract', () => {
  it.each([
    [[], 'Invalid image_urls'],
    [['https://example.com/a.png', ''], 'Invalid image_urls'],
    [['https://example.com/a.png', 'https://example.com/a.png'], 'Invalid image_urls'],
    [['https://example.com/a.png', 1], 'Invalid image_urls'],
    [Array.from({ length: 7 }, (_, index) => `https://example.com/${index}.png`), 'Invalid image_urls'],
  ])('rejects malformed image_urls before execution: %#', (imageUrls, message) => {
    expect(validateChatToolCall('img2img', { image_urls: imageUrls, prompt: 'variation' })).toContain(message);
  });

  it('rejects ambiguous single and multi-image arguments', () => {
    expect(validateChatToolCall('img2img', {
      image_url: 'https://example.com/a.png', image_urls: ['https://example.com/a.png'], prompt: 'variation',
    }) || '').toContain('ambiguous');
  });

  it('rejects an empty legacy image_url', () => {
    expect(validateChatToolCall('img2img', { image_url: '  ', prompt: 'variation' }))
      .toContain('Invalid image_url');
  });

  it('accepts the 4:5 aspect ratio exposed by marketing Skills', () => {
    expect(validateChatToolCall('img2img', {
      image_urls: ['https://example.com/a.png'], prompt: 'variation', aspect_ratio: '4:5',
    })).toBeNull();
  });

  it('rejects references that become duplicates after URL normalization', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const imageUrls = ['/api/serve-upload/source.png', 'http://localhost:5000/api/serve-upload/source.png'];
    const result = await executeToolCall('img2img', { image_urls: imageUrls, prompt: 'variation' }, {
      chatApiKey: '', chatBaseUrl: '', origin: 'https://example.com', userId: 'user-1',
      imageModel: 'image-model', imageProviderId: 'image-provider', deferAgentExecution: true,
      canonicalImageUrls: imageUrls,
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid image_urls') });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });

  it.each([
    ['reordered', ['https://example.com/b.png', 'https://example.com/a.png']],
    ['missing', ['https://example.com/a.png']],
    ['forged', ['https://example.com/a.png', 'https://example.com/c.png']],
  ])('fails closed for %s controlled references', async (_name, imageUrls) => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const result = await executeToolCall('img2img', { image_urls: imageUrls, prompt: 'variation' }, {
      chatApiKey: '', chatBaseUrl: '', origin: 'https://example.com', userId: 'user-1',
      imageModel: 'frozen-image-model', imageProviderId: 'frozen-provider', deferAgentExecution: true,
      canonicalImageUrls: ['https://example.com/a.png', 'https://example.com/b.png'],
    });
    expect(result).toMatchObject({ success: false, error: 'AGENT_MEDIA_URL_MISMATCH' });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });

  it('sends authorized references, aspect ratio, frozen route and Skill billing context unchanged', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true, imageUrls: ['https://example.com/result.png'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const billing = {
      runId: 'run-1', stepId: 'variant-a', requestDigest: 'd'.repeat(64), operationKey: 'operation-a',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    };

    const result = await executeToolCall('img2img', {
      image_urls: ['/api/serve-upload/source-a.png', '/api/serve-upload/source-b.png'],
      prompt: 'variation', aspect_ratio: '16:9',
    }, {
      chatApiKey: '', chatBaseUrl: '', origin: 'https://app.example.com', userId: 'user-1',
      imageModel: 'frozen-image-model', imageProviderId: 'frozen-provider', deferAgentExecution: true,
      canonicalImageUrls: ['/api/serve-upload/source-a.png', '/api/serve-upload/source-b.png'],
      idempotencyKey: 'step-key', skillBillingContext: billing,
    });

    expect(result.success).toBe(true);
    const generateBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(generateBody.referenceImages).toEqual([
      '/api/serve-upload/source-a.png', '/api/serve-upload/source-b.png',
    ]);
    expect(generateBody.aspectRatio).toBe('16:9');
    expect(generateBody.model).toBe('frozen-image-model');
    expect(generateBody.providerId).toBe('frozen-provider');
    expect(generateBody.skillBillingContext).toEqual(billing);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ 'idempotency-key': 'step-key' }),
    });
    fetcher.mockRestore();
  });

  it('preserves the authoritative model capability rejection without truncating references', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: false, code: 'MODEL_CAPABILITY_MISMATCH',
      error: '所选模型不支持当前参数：referenceImages',
      details: { field: 'referenceImages', received: 2, allowed: [0, 1] },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

    const result = await executeToolCall('img2img', {
      image_urls: ['https://example.com/a.png', 'https://example.com/b.png'], prompt: 'variation',
    }, {
      chatApiKey: '', chatBaseUrl: '', origin: 'https://example.com', userId: 'user-1',
      imageModel: 'single-reference-model', imageProviderId: 'frozen-provider', deferAgentExecution: true,
      canonicalImageUrls: ['https://example.com/a.png', 'https://example.com/b.png'],
    });

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).referenceImages)
      .toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
    expect(result).toMatchObject({
      success: false, errorCode: 'MODEL_CAPABILITY_MISMATCH',
      error: expect.stringContaining('referenceImages'),
    });
    fetcher.mockRestore();
  });

  it('preserves the legacy controlled image_url contract', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true, imageUrls: ['https://example.com/result.png'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await executeToolCall('img2img', {
      image_url: 'https://example.com/source.png', prompt: 'variation',
    }, {
      chatApiKey: '', chatBaseUrl: '', origin: 'https://example.com', userId: 'user-1',
      imageModel: 'image-model', imageProviderId: 'image-provider', deferAgentExecution: true,
      canonicalImageUrl: 'https://example.com/source.png',
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).referenceImages)
      .toEqual(['https://example.com/source.png']);
    fetcher.mockRestore();
  });
});
