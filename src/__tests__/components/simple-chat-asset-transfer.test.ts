import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as simpleChatTypes from '@/components/simple-chat/simple-chat-types';

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
}>;

type AssetReference = {
  url: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
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
  transfer: (input: {
    sourceVersionId: string;
    targetProjectId: string;
    index: number;
  }) => Promise<AssetReference>;
  writeBridge: (references: AssetReference[]) => void;
}) => Promise<{ ok: boolean; references: AssetReference[]; reason?: string }>;

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

describe('standalone simple-chat asset transfer', () => {
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

  it('uses authorized resolve and Task 5 transfer without re-uploading managed media', () => {
    expect(chatAreaSource).toMatch(/fetch\(\s*['"]\/api\/assets['"]/);
    expect(chatAreaSource).toMatch(/fetch\(\s*['"]\/api\/assets\/transfer['"]/);
    expect(chatAreaSource).not.toMatch(/fetch\(\s*['"]\/api\/save-image['"]/);
    expect(chatAreaSource).toMatch(/transferred\.assetVersionId\s*!==\s*reference\.assetVersionId/);
    expect(chatAreaSource).toMatch(/targetProject:\s*targetProjectId/);
    expect(chatAreaSource).toMatch(/entityType:\s*['"]canvas-image['"]/);
  });

  it('creates chat placements before exposing managed references and never migrates URL-only history on read', () => {
    expect(chatRouteSource).toMatch(/entityType:\s*['"]chat-(?:result|attachment)['"]/);
    expect(chatRouteSource).toMatch(/createWorkspacePlacement/);
    expect(chatAreaSource).toMatch(/parsed\.imageRef/);
    expect(chatAreaSource).not.toMatch(/messages[\s\S]{0,300}\/api\/save-image/);
    expect(canvasWorkspaceSource).toMatch(/parseSimpleChatCanvasBridgePayload/);
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
      transfer,
      writeBridge,
    });

    expect(result).toEqual({ ok: false, references: [], reason: 'UNMANAGED_IMAGE_SLOT' });
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
      transfer,
      writeBridge,
    });

    expect(transfer.mock.calls.map(([input]) => input)).toEqual([
      { sourceVersionId: 'version-1', targetProjectId: 'canvas-a', index: 0 },
      { sourceVersionId: 'version-2', targetProjectId: 'canvas-a', index: 1 },
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
