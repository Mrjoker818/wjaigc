import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as simpleChatTypes from '@/components/simple-chat/simple-chat-types';
import {
  diffSimpleChatProjects,
  replaySimpleChatOperations,
  validateSimpleChatProjects,
} from '@/lib/simple-chat-project-sync';
import type { WorkspaceSourceTrace } from '@/lib/asset-core/source-trace';

const typesSource = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/simple-chat-types.ts'),
  'utf8',
);
const chatAreaSource = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/chat-area.tsx'),
  'utf8',
);
const chatRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/simple-chat/chat/route.ts'),
  'utf8',
);
const canvasWorkspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

type BridgeReader = (value: unknown) => Array<{
  url: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  entityId?: string;
  sourceTrace?: WorkspaceSourceTrace;
}>;

type AssetReference = {
  url: string;
  name?: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
  entityId?: string;
  sourceTrace?: WorkspaceSourceTrace;
};

const sourceTraceFixture: WorkspaceSourceTrace = {
  source: 'simple-chat',
  chatProjectId: 'chat-project-a',
  chatTaskId: 'task-a',
  messageId: 'message-a',
  modelId: 'image-model-a',
  providerId: 'image-provider-a',
  generationTaskIds: ['generation-task-a'],
  createdAt: '2026-08-27T08:00:00.000Z',
};

type Attachment = {
  id: string;
  type: 'image';
  name: string;
  mimeType: string;
  url?: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
};

type AlignMediaSlots = (
  attachments: Attachment[],
  registrations: Array<AssetReference | null>,
) => {
  images: string[];
  imageRefs: AssetReference[];
  attachments: Attachment[];
};

type SendMediaToCanvas = (input: {
  images: string[];
  imageRefs: AssetReference[];
  targetProjectId: string;
  sourceTrace: WorkspaceSourceTrace;
  transfer: (input: {
    sourceVersionId: string;
    targetProjectId: string;
    index: number;
    sourceTrace?: WorkspaceSourceTrace;
  }) => Promise<AssetReference>;
  writeBridge: (references: AssetReference[]) => void;
}) => Promise<{ ok: boolean; references: AssetReference[]; reason?: string }>;

type CanTransferMedia = (images: string[], references: AssetReference[]) => boolean;

type BuildCanvasBridgeImages = (
  references: AssetReference[],
  timestamp: number,
) => Array<{ id: string; url: string; sourceTrace?: WorkspaceSourceTrace }>;

type SerializeCanvasBridgePayload = (
  projectId: string,
  references: AssetReference[],
) => unknown;

function bridgeReader(): BridgeReader | undefined {
  return (simpleChatTypes as unknown as { parseSimpleChatCanvasBridgePayload?: BridgeReader })
    .parseSimpleChatCanvasBridgePayload;
}

function alignMediaSlots(): AlignMediaSlots | undefined {
  return (simpleChatTypes as unknown as { alignSimpleChatMediaSlots?: AlignMediaSlots })
    .alignSimpleChatMediaSlots;
}

function sendMediaToCanvas(): SendMediaToCanvas | undefined {
  return (simpleChatTypes as unknown as { sendSimpleChatMediaToCanvas?: SendMediaToCanvas })
    .sendSimpleChatMediaToCanvas;
}

function canTransferMedia(): CanTransferMedia | undefined {
  return (simpleChatTypes as unknown as { canTransferSimpleChatMedia?: CanTransferMedia })
    .canTransferSimpleChatMedia;
}

function buildCanvasBridgeImages(): BuildCanvasBridgeImages | undefined {
  return (simpleChatTypes as unknown as {
    buildSimpleChatCanvasBridgeImages?: BuildCanvasBridgeImages;
  }).buildSimpleChatCanvasBridgeImages;
}

function serializeCanvasBridgePayload(): SerializeCanvasBridgePayload | undefined {
  return (simpleChatTypes as unknown as {
    serializeSimpleChatCanvasBridgePayload?: SerializeCanvasBridgePayload;
  }).serializeSimpleChatCanvasBridgePayload;
}

describe('standalone simple-chat asset transfer', () => {
  it('deduplicates managed bridge references by placement identity while preserving order', () => {
    const mergeReferences = (simpleChatTypes as unknown as {
      mergeSimpleChatCanvasBridgeReferences?: (
        existing: AssetReference[],
        incoming: AssetReference[],
      ) => AssetReference[];
    }).mergeSimpleChatCanvasBridgeReferences;
    expect(mergeReferences).toBeTypeOf('function');
    if (!mergeReferences) return;
    const first = {
      url: '/first.png', assetVersionId: 'version-1', placementId: 'placement-1', entityId: 'entity-1',
    };
    const replacement = { ...first, url: '/canonical-first.png' };
    const second = {
      url: '/second.png', assetVersionId: 'version-2', placementId: 'placement-2', entityId: 'entity-2',
    };

    expect(mergeReferences([first], [replacement, second, second])).toEqual([
      replacement,
      second,
    ]);
  });

  it('consumes duplicate managed bridge entries only once', async () => {
    const duplicate = {
      url: '/source.png', assetVersionId: 'version-1', placementId: 'placement-1', entityId: 'entity-1',
    };
    const resolveReference = vi.fn(async ({ placementId }: { placementId: string }) => ({
      url: '/canonical.png', assetVersionId: 'version-1', placementId, entityId: 'entity-1',
    }));
    const merge = vi.fn();
    const remove = vi.fn();

    const result = await simpleChatTypes.consumeSimpleChatCanvasBridge({
      payload: { projectId: 'canvas-a', images: [duplicate, duplicate] },
      currentProjectId: 'canvas-a',
      resolveReference,
      merge,
      remove,
    });

    expect(result.references).toHaveLength(1);
    expect(resolveReference).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledWith([expect.objectContaining({ placementId: 'placement-1' })]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps legacy URLs while adding durable image and attachment identity', () => {
    expect(typesSource).toMatch(/images\?:\s*string\[\]/);
    expect(typesSource).toMatch(/imageRefs\?:\s*WorkspaceAssetReference\[\]/);
    expect(typesSource).toMatch(/interface ChatAttachment[\s\S]*?url\?:\s*string/);
    expect(typesSource).toMatch(/interface ChatAttachment[\s\S]*?assetId\?:\s*string/);
    expect(typesSource).toMatch(/interface ChatAttachment[\s\S]*?assetVersionId\?:\s*string/);
    expect(typesSource).toMatch(/interface ChatAttachment[\s\S]*?placementId\?:\s*string/);
  });

  it('reads both historical bridge payloads and preserves structured references', () => {
    const parse = bridgeReader();
    expect(parse).toBeTypeOf('function');
    if (!parse) return;

    expect(parse(['/legacy-array.png'])).toEqual([{ url: '/legacy-array.png' }]);
    expect(parse({ images: ['/legacy-object.png'] })).toEqual([{ url: '/legacy-object.png' }]);
    expect(parse({
      images: [{
        url: '/managed.png',
        assetId: 'asset-a',
        assetVersionId: 'version-a',
        placementId: 'canvas-placement-a',
      }],
    })).toEqual([{
      url: '/managed.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'canvas-placement-a',
    }]);
  });

  it('serializes every new Canvas bridge write as bounded IDs only', () => {
    const serialize = serializeCanvasBridgePayload();
    expect(serialize).toBeTypeOf('function');
    if (!serialize) return;

    const json = JSON.stringify(serialize('canvas-a', [{
      url: 'https://media.example/secret.png',
      name: 'private name',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-a',
      entityId: 'simple-chat:task-a:message-a:0',
      sourceTrace: sourceTraceFixture,
    }]));

    expect(JSON.parse(json)).toEqual({
      projectId: 'canvas-a',
      images: [{
        assetVersionId: 'version-a',
        placementId: 'placement-a',
        entityId: 'simple-chat:task-a:message-a:0',
      }],
    });
    expect(json).not.toMatch(/https?:|data:|blob:|prompt|name|url|sourceTrace/);
    expect(chatAreaSource).toContain('serializeSimpleChatCanvasBridgePayload(');
  });

  it('preserves only validated sourceTrace through the canvas and SSE bridge parsers', () => {
    const parse = bridgeReader();
    expect(parse).toBeTypeOf('function');
    if (!parse) return;

    expect(parse({
      images: [{
        url: '/managed.png',
        assetVersionId: 'version-1',
        placementId: 'placement-1',
        sourceTrace: { ...sourceTraceFixture, privatePlacementValue: 'do-not-return' },
      }],
    })[0]?.sourceTrace).toEqual(sourceTraceFixture);
    expect(parse({
      images: [{
        url: '/invalid.png',
        sourceTrace: { ...sourceTraceFixture, source: 'untrusted-source' },
      }],
    })[0]).not.toHaveProperty('sourceTrace');
    expect(chatAreaSource).toMatch(/readSimpleChatStreamAssetReference\(value\)/);
  });

  it('rejects a string imageRef at the SSE object boundary', () => {
    expect(simpleChatTypes.readSimpleChatStreamAssetReference('/legacy-string.png')).toBeNull();
    expect(simpleChatTypes.readSimpleChatStreamAssetReference({ url: '/object.png' })).toEqual({
      url: '/object.png',
    });
  });

  it('keeps the authoritative canvas entity id through both standalone-chat bridge parsers', () => {
    const parse = bridgeReader();
    expect(parse).toBeTypeOf('function');
    if (!parse) return;

    expect(parse({
      projectId: 'canvas-a',
      images: [{
        url: '/managed.png',
        assetId: 'asset-a',
        assetVersionId: 'version-a',
        placementId: 'placement-a',
        entityId: 'simple-chat:task-a:message-a:0',
      }],
    })).toEqual([expect.objectContaining({
      entityId: 'simple-chat:task-a:message-a:0',
    })]);
    expect(chatAreaSource).toMatch(/readSimpleChatStreamAssetReference\(value\)/);
  });

  it('persists imageRefs through the existing project storage round trip', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const projects = [{
      id: 'chat-project-a',
      name: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      agents: [],
      knowledgeItems: [],
      tasks: [{
        id: 'task-a',
        projectId: 'chat-project-a',
        name: 'Task',
        model: '',
        providerId: '',
        createdAt: 1,
        updatedAt: 1,
        messages: [{
          id: 'message-a',
          role: 'assistant' as const,
          content: 'image',
          images: ['/managed.png'],
          imageRefs: [{
            url: '/managed.png',
            assetId: 'asset-a',
            assetVersionId: 'version-a',
            placementId: 'chat-placement-a',
          }],
          createdAt: 1,
        }],
      }],
    }];

    simpleChatTypes.saveProjects(projects);

    expect(simpleChatTypes.loadProjects()[0].tasks[0].messages[0].imageRefs).toEqual([
      expect.objectContaining({
        assetVersionId: 'version-a',
        placementId: 'chat-placement-a',
      }),
    ]);
  });

  it('preserves sourceTrace through validated persisted snapshot replay', () => {
    const projects = [{
      id: 'chat-project-a',
      name: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      agents: [],
      knowledgeItems: [],
      tasks: [{
        id: 'task-a',
        projectId: 'chat-project-a',
        name: 'Task',
        model: 'chat-model-a',
        providerId: 'chat-provider-a',
        createdAt: 1,
        updatedAt: 1,
        messages: [{
          id: 'message-a',
          role: 'assistant' as const,
          content: 'image',
          images: ['/managed.png'],
          imageRefs: [{
            url: '/managed.png',
            assetId: 'asset-a',
            assetVersionId: 'version-a',
            placementId: 'chat-placement-a',
            sourceTrace: sourceTraceFixture,
          }],
          createdAt: 1,
        }],
      }],
    }];
    const serialized = JSON.parse(JSON.stringify({ schemaVersion: 1, revision: 1, projects }));

    expect(validateSimpleChatProjects(serialized.projects)).toEqual({ success: true });
    let operationIndex = 0;
    const operations = diffSimpleChatProjects([], serialized.projects, 1, {
      createOperationId: () => `00000000-0000-4000-8000-${String(++operationIndex).padStart(12, '0')}`,
    });
    const replayed = replaySimpleChatOperations([], operations);

    expect(replayed.projects[0]?.tasks[0]?.messages[0]?.imageRefs?.[0]?.sourceTrace)
      .toEqual(sourceTraceFixture);
  });

  it('uses authorized resolve and Task 5 transfer without re-uploading managed media', () => {
    expect(chatAreaSource).toMatch(/fetch\(\s*['"]\/api\/assets\/transfer['"]/);
    expect(chatAreaSource).not.toMatch(/fetch\(\s*['"]\/api\/assets['"]\s*,/);
    expect(chatAreaSource).not.toMatch(/fetch\(\s*['"]\/api\/save-image['"]/);
    expect(chatAreaSource).toContain('sendSimpleChatMediaToCanvas');
    expect(chatAreaSource).not.toMatch(/imageRefs\?\.find\(/);
    expect(chatAreaSource).not.toMatch(/transferred\.assetVersionId\s*!==/);
    expect(chatAreaSource).toMatch(/targetProject:\s*transferProjectId/);
    expect(chatAreaSource).toMatch(/entityType:\s*['"]canvas-image['"]/);
    expect(chatAreaSource).toMatch(/sourceTrace\s*\?\s*\{ sourceTrace \}/);
  });

  it('passes each validated message reference trace into the canvas transfer metadata', async () => {
    const send = sendMediaToCanvas();
    expect(send).toBeTypeOf('function');
    if (!send) return;
    const transfer = vi.fn(async () => ({
      url: '/canvas.png',
      assetVersionId: 'canvas-version',
      placementId: 'canvas-placement',
      sourceTrace: sourceTraceFixture,
    }));
    const writeBridge = vi.fn();

    await send({
      images: ['/managed.png'],
      imageRefs: [{
        url: '/managed.png',
        assetVersionId: 'version-a',
        placementId: 'chat-placement-a',
      }],
      targetProjectId: 'canvas-a',
      sourceTrace: sourceTraceFixture,
      transfer,
      writeBridge,
    });

    expect(transfer).toHaveBeenCalledWith({
      sourceVersionId: 'version-a',
      targetProjectId: 'canvas-a',
      index: 0,
      sourceTrace: sourceTraceFixture,
    });
    expect(writeBridge).toHaveBeenCalledWith([
      expect.objectContaining({ sourceTrace: sourceTraceFixture }),
    ]);
  });

  it('passes distinct actual image traces for each Canvas transfer', async () => {
    const send = sendMediaToCanvas();
    expect(send).toBeTypeOf('function');
    if (!send) return;
    const firstTrace = { ...sourceTraceFixture, modelId: 'vendor/image-one', providerId: 'provider-one' };
    const secondTrace = {
      ...sourceTraceFixture,
      modelId: 'vendor/image-two',
      providerId: 'provider-two',
      generationTaskIds: ['generation-task-two'],
    };
    const transfer = vi.fn(async ({ index }: {
      index: number;
      sourceTrace?: WorkspaceSourceTrace;
    }) => ({
      url: `/canvas-${index}.png`,
      assetVersionId: `canvas-version-${index}`,
      placementId: `canvas-placement-${index}`,
    }));

    await send({
      images: ['/first.png', '/second.png'],
      imageRefs: [
        { url: '/first.png', assetVersionId: 'version-1', placementId: 'placement-1', sourceTrace: firstTrace },
        { url: '/second.png', assetVersionId: 'version-2', placementId: 'placement-2', sourceTrace: secondTrace },
      ],
      targetProjectId: 'canvas-a',
      sourceTrace: sourceTraceFixture,
      transfer,
      writeBridge: vi.fn(),
    });

    expect(transfer.mock.calls.map(([value]) => value.sourceTrace)).toEqual([firstTrace, secondTrace]);
  });

  it('builds inserted Canvas images with the sanitized server-returned source trace', () => {
    const buildImages = buildCanvasBridgeImages();
    expect(buildImages).toBeTypeOf('function');
    if (!buildImages) return;

    expect(buildImages([{
      url: '/canonical-canvas.png',
      assetVersionId: 'canvas-version',
      placementId: 'canvas-placement',
      entityId: 'simple-chat:task-a:message-a:0',
      sourceTrace: sourceTraceFixture,
    }], 42)).toEqual([
      expect.objectContaining({
        id: 'simple-chat:task-a:message-a:0',
        url: '/canonical-canvas.png',
        sourceTrace: sourceTraceFixture,
      }),
    ]);
    expect(canvasWorkspaceSource).toContain('buildSimpleChatCanvasBridgeImages');
  });

  it('omits an invalid message reference trace from canvas transfer metadata', async () => {
    const send = sendMediaToCanvas();
    expect(send).toBeTypeOf('function');
    if (!send) return;
    const transfer = vi.fn(async () => ({
      url: '/canvas.png',
      assetVersionId: 'canvas-version',
      placementId: 'canvas-placement',
    }));

    await send({
      images: ['/managed.png'],
      imageRefs: [{
        url: '/managed.png',
        assetVersionId: 'version-a',
        placementId: 'chat-placement-a',
      }],
      targetProjectId: 'canvas-a',
      sourceTrace: { ...sourceTraceFixture, source: 'forged' } as unknown as WorkspaceSourceTrace,
      transfer,
      writeBridge: vi.fn(),
    });

    expect(transfer).toHaveBeenCalledWith({
      sourceVersionId: 'version-a',
      targetProjectId: 'canvas-a',
      index: 0,
    });
  });

  it('creates chat placements before exposing managed references and never migrates URL-only history on read', () => {
    expect(chatRouteSource).toMatch(/entityType:\s*['"]chat-(?:result|attachment)['"]/);
    expect(chatRouteSource).toMatch(/createVersionWithPlacement/);
    expect(chatAreaSource).toMatch(/parsed\.imageRef/);
    expect(chatAreaSource).not.toMatch(/messages[\s\S]{0,300}\/api\/save-image/);
    expect(canvasWorkspaceSource).toMatch(/consumeSimpleChatCanvasBridge/);
  });

  it('I1 keeps failed registration slots visible but blocks the entire Canvas bridge write', async () => {
    const align = alignMediaSlots();
    const send = sendMediaToCanvas();
    expect(align).toBeTypeOf('function');
    expect(send).toBeTypeOf('function');
    if (!align || !send) return;

    const slots = align([
      { id: 'a', type: 'image', name: 'a.png', mimeType: 'image/png', url: '/a.png' },
      { id: 'b', type: 'image', name: 'b.png', mimeType: 'image/png', url: '/b.png' },
    ], [{
      url: '/managed-a.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'chat-placement-a',
    }, null]);

    expect(slots.images).toEqual(['/managed-a.png', '/b.png']);
    expect(slots.images).toHaveLength(2);
    expect(slots.imageRefs).toHaveLength(2);
    expect(slots.attachments).toHaveLength(2);
    expect(slots.imageRefs[1]).toEqual({ url: '/b.png' });
    expect(slots.attachments[1]).not.toHaveProperty('assetVersionId');

    const transfer = vi.fn();
    const writeBridge = vi.fn();
    await expect(send({
      images: slots.images,
      imageRefs: slots.imageRefs,
      targetProjectId: 'canvas-a',
      sourceTrace: sourceTraceFixture,
      transfer,
      writeBridge,
    })).resolves.toEqual({ ok: false, references: [], reason: 'UNMANAGED_IMAGE_SLOT' });
    expect(transfer).not.toHaveBeenCalled();
    expect(writeBridge).not.toHaveBeenCalled();
  });

  it('I1 treats historical URL-only messages as visible but explicitly non-transferable', async () => {
    const send = sendMediaToCanvas();
    expect(send).toBeTypeOf('function');
    if (!send) return;
    const transfer = vi.fn();
    const writeBridge = vi.fn();

    const result = await send({
      images: ['/historical.png'],
      imageRefs: [{ url: '/historical.png' }],
      targetProjectId: 'canvas-a',
      sourceTrace: sourceTraceFixture,
      transfer,
      writeBridge,
    });

    expect(result).toEqual({ ok: false, references: [], reason: 'UNMANAGED_IMAGE_SLOT' });
    expect(transfer).not.toHaveBeenCalled();
    expect(writeBridge).not.toHaveBeenCalled();
  });

  it('I1 exposes an explicit transferable state only for complete index-aligned managed slots', () => {
    const canTransfer = canTransferMedia();
    expect(canTransfer).toBeTypeOf('function');
    if (!canTransfer) return;

    expect(canTransfer(['/historical.png'], [{ url: '/historical.png' }])).toBe(false);
    expect(canTransfer(['/a.png', '/b.png'], [{
      url: '/a.png', assetVersionId: 'version-a', placementId: 'placement-a',
    }])).toBe(false);
    expect(canTransfer(['/a.png'], [{
      url: '/a.png', assetVersionId: 'version-a', placementId: 'placement-a',
    }])).toBe(true);
  });

  it('I1 rejects a stale managed reference whose URL does not match its visible image slot', async () => {
    const canTransfer = canTransferMedia();
    const send = sendMediaToCanvas();
    expect(canTransfer).toBeTypeOf('function');
    expect(send).toBeTypeOf('function');
    if (!canTransfer || !send) return;

    const images = ['/visible.png'];
    const imageRefs = [{
      url: '/stale.png',
      assetVersionId: 'stale-version',
      placementId: 'stale-placement',
    }];
    const transfer = vi.fn();
    const writeBridge = vi.fn();

    expect(canTransfer(images, imageRefs)).toBe(false);
    await expect(send({
      images,
      imageRefs,
      targetProjectId: 'canvas-a',
      sourceTrace: sourceTraceFixture,
      transfer,
      writeBridge,
    })).resolves.toEqual({ ok: false, references: [], reason: 'UNMANAGED_IMAGE_SLOT' });
    expect(transfer).not.toHaveBeenCalled();
    expect(writeBridge).not.toHaveBeenCalled();
  });

  it('I2 binds equal URLs to their version by index instead of searching by URL', async () => {
    const send = sendMediaToCanvas();
    expect(send).toBeTypeOf('function');
    if (!send) return;
    const transfer = vi.fn(async ({ sourceVersionId, index }: { sourceVersionId: string; index: number }) => ({
      url: '/same.png',
      assetId: `asset-${index}`,
      assetVersionId: sourceVersionId,
      placementId: `canvas-placement-${index}`,
    }));
    const writeBridge = vi.fn();

    const result = await send({
      images: ['/same.png', '/same.png'],
      imageRefs: [
        { url: '/same.png', assetVersionId: 'version-1', placementId: 'chat-1' },
        { url: '/same.png', assetVersionId: 'version-2', placementId: 'chat-2' },
      ],
      targetProjectId: 'canvas-a',
      sourceTrace: sourceTraceFixture,
      transfer,
      writeBridge,
    });

    expect(transfer.mock.calls.map(([input]) => input)).toEqual([
      { sourceVersionId: 'version-1', targetProjectId: 'canvas-a', index: 0, sourceTrace: sourceTraceFixture },
      { sourceVersionId: 'version-2', targetProjectId: 'canvas-a', index: 1, sourceTrace: sourceTraceFixture },
    ]);
    expect(result.references.map(reference => reference.assetVersionId)).toEqual(['version-1', 'version-2']);
    expect(writeBridge).toHaveBeenCalledWith(result.references);
  });

  it('I3 accepts same-project reuse and a different canonical version for cross-project transfer', async () => {
    const send = sendMediaToCanvas();
    expect(send).toBeTypeOf('function');
    if (!send) return;

    const sameProject = await send({
      images: ['/source.png'],
      imageRefs: [{ url: '/source.png', assetVersionId: 'source-version', placementId: 'chat-placement' }],
      targetProjectId: 'source-project',
      sourceTrace: sourceTraceFixture,
      transfer: vi.fn(async () => ({
        url: '/source.png',
        assetVersionId: 'source-version',
        placementId: 'canvas-same-project',
      })),
      writeBridge: vi.fn(),
    });
    const crossProject = await send({
      images: ['/source.png'],
      imageRefs: [{ url: '/source.png', assetVersionId: 'source-version', placementId: 'chat-placement' }],
      targetProjectId: 'target-project',
      sourceTrace: sourceTraceFixture,
      transfer: vi.fn(async () => ({
        url: '/canonical-copy.png',
        assetId: 'target-asset',
        assetVersionId: 'target-version',
        placementId: 'canvas-cross-project',
      })),
      writeBridge: vi.fn(),
    });

    expect(sameProject.references[0]?.assetVersionId).toBe('source-version');
    expect(crossProject.references[0]).toEqual(expect.objectContaining({
      url: '/canonical-copy.png',
      assetVersionId: 'target-version',
      placementId: 'canvas-cross-project',
    }));
  });
});
