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

function bridgeReader(): BridgeReader | undefined {
  return (simpleChatTypes as unknown as { parseSimpleChatCanvasBridgePayload?: BridgeReader })
    .parseSimpleChatCanvasBridgePayload;
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
});
