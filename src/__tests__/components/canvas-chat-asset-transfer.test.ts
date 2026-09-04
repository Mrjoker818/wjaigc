import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canvasEntityIdForTransferredReference,
  extractTaskAssetReferences,
  findWorkspaceAssetReferenceByUrl,
  mergeWorkspaceAssetReferences,
  prepareCanvasAssetForChat,
} from '@/lib/asset-core/workspace-transfer';

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const chatSource = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');
const chatToolsSource = readFileSync(resolve(process.cwd(), 'src/lib/chat-tools.ts'), 'utf8');

describe('canvas to embedded chat asset transfer', () => {
  it('reconciles explicit Skill recovery revision and deletion markers only after the project scope guard', () => {
    const start = workspaceSource.indexOf('const handleAddEmbeddedChatImage');
    const end = workspaceSource.indexOf('const handleUploadEffectReverseSource', start);
    const receiver = workspaceSource.slice(start, end);
    const guard = receiver.indexOf('isWorkspaceResultScopeCurrent(expectedProjectId');
    const recovery = receiver.indexOf('if (meta?.restoreDeletedPlacement)');
    const insert = receiver.indexOf('await handleAddImages([{');
    expect(guard).toBeGreaterThan(0);
    expect(recovery).toBeGreaterThan(guard);
    expect(insert).toBeGreaterThan(recovery);
    expect(receiver).toContain('manager.advanceProjectSyncRevision(Number(transferred.projectRevision))');
    expect(receiver).toContain('recentlyDeletedIdsRef.current.delete(transferred.entityId)');
    expect(receiver).toContain('manager.clearRecentlyDeletedImageIds([transferred.entityId])');
  });
  it('returns the canonical chat attachment reference after transfer', async () => {
    const result = await prepareCanvasAssetForChat({
      id: 'canvas-a',
      url: '/canvas.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'canvas-placement-a',
    }, async () => ({
      url: '/canonical-chat.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'chat-placement-a',
    }));

    expect(result).toMatchObject({
      id: 'canvas-a',
      url: '/canonical-chat.png',
      assetVersionId: 'version-a',
      placementId: 'chat-placement-a',
    });
  });

  it('falls back explicitly to URL-only without a stale placement', async () => {
    const result = await prepareCanvasAssetForChat({
      id: 'canvas-a',
      url: '/canvas.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'canvas-placement-a',
    }, async () => { throw new Error('transfer failed'); });

    expect(result).toEqual({ id: 'canvas-a', url: '/canvas.png' });
  });

  it('creates a chat-attachment placement before handing the canvas image to embedded chat', () => {
    expect(workspaceSource).toContain("fetch('/api/assets/transfer'");
    expect(workspaceSource).toContain("entityType: 'chat-attachment'");
    expect(workspaceSource).toContain('sourceVersion: image.assetVersionId');
    expect(workspaceSource).toContain('setChatInitialImage(transferredImage)');
    expect(workspaceSource).toContain('prepareCanvasAssetForChat');
    expect(workspaceSource).toContain('onResolveCanvasImageForChat={resolveCanvasImageForChat}');
    expect(chatSource).toContain('void addCanvasImageToChat(chatInitialImage, false)');
    expect(chatSource).toContain('void addCanvasImageToChat(selectedCanvasImage, false)');
    expect(chatSource).toContain('void addCanvasImageToChat(sourceImage, true)');
    expect(chatSource).toContain('void addCanvasImageToChat(img, true)');
  });

  it('retains asset version identity in pending images, mentions, and persisted image anchors', () => {
    expect(chatSource).toMatch(/pendingImages[\s\S]*assetVersionId\?: string/);
    expect(chatSource).toMatch(/interface MentionRef[\s\S]*assetVersionId\?: string/);
    expect(chatSource).toContain('assetVersionId: resolved.assetVersionId');
    expect(chatSource).toContain('assetVersionId: img.assetVersionId');
    expect(chatSource).toContain('assetVersionId: m.assetVersionId');
  });

  it('resolves a generated image to exactly one persisted asset reference', () => {
    const references = [
      { url: '/a.png', assetVersionId: 'version-a', placementId: 'chat-a' },
      { url: '/b.png', assetVersionId: 'version-b', placementId: 'chat-b' },
    ];

    expect(findWorkspaceAssetReferenceByUrl('/b.png', references)).toEqual(references[1]);
    expect(findWorkspaceAssetReferenceByUrl('/missing.png', references)).toBeNull();
    expect(findWorkspaceAssetReferenceByUrl('/a.png', [...references, references[0]])).toBeNull();
  });

  it('routes persisted embedded-chat results through the canvas transfer boundary', () => {
    expect(chatSource).toContain('generatedImageRefs?: WorkspaceAssetReference[]');
    expect(chatSource).toContain('findWorkspaceAssetReferenceByUrl');
    expect(workspaceSource).toContain('handleAddEmbeddedChatImage');
    expect(workspaceSource).toContain("targetWorkspace: `canvas:${currentProject.id}`");
    expect(workspaceSource).toContain("entityType: 'canvas-image'");
    expect(chatSource).toContain("assetWorkspace: 'chat'");
    expect(chatSource).toContain('assetWorkspaceId: `embedded-chat:${taskSessionId}`');
    expect(chatSource).toContain('assetSourceEntityId: assistantMessageId');
    expect(chatToolsSource).toContain("assetWorkspace: 'chat'");
    expect(chatToolsSource).toContain('assetWorkspaceId: embeddedChatWorkspaceId(context)');
    expect(chatToolsSource).toContain('assetSourceEntityId: context.messageId');
    expect(chatSource).toContain('extractTaskAssetReferences(pollData)');
    expect(chatSource).toContain('mergeWorkspaceAssetReferences(');
    expect(workspaceSource).toContain('canvasEntityIdForTransferredReference(');
  });

  it('persists recovered projection references before adding recovered images to canvas', () => {
    expect(chatSource).toContain('persistTaskAssetReferences(message.id, pollData)');
    expect(chatSource).toContain('await addGeneratedImageToCanvas(settlement.result, recoveredMessage)');
  });

  it('routes automatic generated-image insertion through the same transfer helper', () => {
    expect(chatSource).not.toContain('onAddImages(newUrls)');
    expect(chatSource).not.toContain('onAddImages(uniqueResultUrls, imageSourceId');
    expect(chatSource).toContain('await addGeneratedImageToCanvas(imageUrl, generatedMessage)');
  });

  it('does not rewrite a projected task URL before resolving its immutable reference', () => {
    expect(chatSource).toContain('const projectedReference = findWorkspaceAssetReferenceByUrl(url, projectedMessage?.generatedImageRefs || [])');
    expect(chatSource).toContain('if (projectedReference) { savedUrls.push(url); continue; }');
  });

  it('uses the immutable task projection references returned by polling', () => {
    const pollData = {
      imageUrls: ['/generated-a.png'],
      assetProjection: { versionIds: ['version-generated-a'] },
    };
    const refs = extractTaskAssetReferences(pollData);

    expect(mergeWorkspaceAssetReferences([], refs)).toEqual([
      { url: '/generated-a.png', assetVersionId: 'version-generated-a' },
    ]);
    expect(canvasEntityIdForTransferredReference({ ...refs[0], entityId: 'canvas-result-a' }, 'fallback'))
      .toBe('canvas-result-a');
  });

  it('surfaces asynchronous add-to-canvas failures instead of leaking a rejection', () => {
    expect(chatSource).toContain('const addGeneratedImageToCanvas = useCallback');
    expect(chatSource).toContain("toast.error(error instanceof Error ? error.message : '添加到画布失败')");
    expect(chatSource).toContain('void addGeneratedImageToCanvas(');
  });

  it('persists cross-workspace canvas insertions before the caller may navigate away', () => {
    const handlerStart = workspaceSource.indexOf('const handleAddImages = useCallback');
    const handlerEnd = workspaceSource.indexOf('\n  const handleAddEmbeddedChatImage', handlerStart);
    const handler = workspaceSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handler).toContain('persistCanvasImagesNow(nextImages)');
    expect(handler).toContain('await UserManagerCore.getInstance().flushProjectsToServer()');
    expect(handler.indexOf('persistCanvasImagesNow(nextImages)')).toBeLessThan(
      handler.indexOf('await UserManagerCore.getInstance().flushProjectsToServer()'),
    );
  });
});
