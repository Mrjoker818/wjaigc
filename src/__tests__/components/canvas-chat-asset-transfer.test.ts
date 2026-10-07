// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actualTransferCallback, canvasTransferContractFixture, contractReference, contractSecondReference,
  type BatchTransfer,
} from '../helpers/canvas-chat-transfer-contract-fixture';
import {
  canvasEntityIdForTransferredReference,
  extractTaskAssetReferences,
  findWorkspaceAssetReferenceByUrl,
  mergeWorkspaceAssetReferences,
  prepareCanvasAssetForChat,
} from '@/lib/asset-core/workspace-transfer';

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const chatSource = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('canvas to embedded chat asset transfer', () => {
  it('reconciles explicit Skill recovery revision and deletion markers only after the project scope guard', async () => {
    // Breaks: clearing deletion/revision before admission or consuming an old actor/project result.
    const restored = canvasTransferContractFixture({ trashed: true });
    await restored.single(contractReference, { runId: 'run-a', restoreDeletedPlacement: true });
    expect(restored.requests.map(request => request.url)).toEqual(['/api/assets/transfer', '/api/assets/asset-a/restore']);
    expect(restored.images.current[1]).toMatchObject({ id: 'canvas-skill:run-a:version-a', assetVersionId: 'version-a', placementId: 'placement-a' });
    expect(restored.revision.current).toBe(6);
    expect([...restored.deleted.current]).toEqual([]);
    expect(restored.cleared).toEqual([['canvas-skill:run-a:version-a']]);
    expect(restored.writes).toHaveLength(1);
    for (const mutation of ['project', 'actor', 'revision', 'deletion'] as const) {
      const f = canvasTransferContractFixture({ trashed: true, pause: 'decode' });
      const operation = f.single(contractReference, { runId: 'run-a', restoreDeletedPlacement: true });
      const outcome = operation.then(() => undefined, error => error);
      await f.entered;
      expect(f.revision.current).toBe(4);
      if (mutation === 'project') { f.project.current = { id: 'project-b' }; f.historyProject.current = 'project-b'; f.epoch.current++; }
      if (mutation === 'actor') f.actor.current = { id: 'actor-b' };
      if (mutation === 'revision') f.revision.current = 7;
      if (mutation === 'deletion') f.deletion.current.set('canvas-skill:run-a:version-a', 1);
      const revision = f.revision.current;
      f.release();
      expect(await outcome).toBeInstanceOf(Error);
      expect(f.images.current.map(image => image.id)).toEqual(['original']);
      expect(f.revision.current).toBe(revision);
      expect([...f.deleted.current]).toEqual(['canvas-skill:run-a:version-a']);
      expect(f.cleared).toEqual([]); expect(f.writes).toEqual([]); expect(f.successes).toEqual([]);
    }
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

  it('routes persisted embedded-chat results through the canvas transfer boundary', async () => {
    // Breaks: using an old render project, losing immutable identity, or bypassing transfer with raw URLs.
    const f = canvasTransferContractFixture();
    const consume = actualTransferCallback<(url: string, message: unknown) => Promise<void>>('addGeneratedImageToCanvas', {
      findWorkspaceAssetReferenceByUrl, onAddGeneratedImage: f.single,
      onAddImages: (): never => { throw new Error('Unexpected URL-only fallback'); },
      providerDisplayName: (): string => 'provider-a', toast: { error: (error: string): void => { f.errors.push(error); } },
    }, 'chat');
    await consume('/result.png', { generatedImageRefs: [contractReference], generateModelName: 'model-a' });
    expect(f.requests.map(request => request.url)).toEqual(['/api/assets/transfer']);
    expect(f.requests[0].body).toMatchObject({ sourceVersion: 'version-a', targetProject: 'project-a', targetWorkspace: 'canvas:project-a', entityType: 'canvas-image' });
    expect(f.images.current.map(image => image.url)).toEqual(['/original.png', '/result.png']);
    expect(f.images.current[1]).toMatchObject({ assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a', modelName: 'model-a', apiProvider: 'provider-a' });
    expect(f.writes).toHaveLength(1); expect(f.saves).toHaveLength(1); expect(f.successes).toHaveLength(1); expect(f.errors).toEqual([]);
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

  it('projects multi-platform export results through one atomic canvas batch insertion', async () => {
    // Breaks: looping single insertions, omitting await, or accepting a mismatched export context.
    const f = canvasTransferContractFixture({ pause: 'flush' });
    const scope = { current: { epoch: 1, mounted: true } };
    const receiver = actualTransferCallback<BatchTransfer>('receiveSkillOutputs', {
      skillDeliveryScopeRef: scope, onAddGeneratedImages: f.batch, canvasAuthority: 'legacy',
      receiveSkillOutput: (): never => { throw new Error('Unexpected single-output fallback'); },
    }, 'chat');
    const context = { current: { runId: 'run-a', projectId: 'project-a', skillId: 'preset-multi-platform-export', sourceVersionIds: ['source-v'] } };
    const consume = actualTransferCallback<(references: Parameters<BatchTransfer>[0]) => Promise<void>>('onAddExportImagesToCanvas', {
      projectId: 'project-a', activeCanvasSkillRunRef: context, skillRun: { runId: 'run-a' },
      MULTI_PLATFORM_EXPORT_SKILL_ID: 'preset-multi-platform-export', receiveSkillOutputs: receiver,
    }, 'chat');
    let finished = false;
    const operation = consume([contractReference, contractSecondReference]).then(() => { finished = true; });
    await f.entered; await Promise.resolve();
    const completedBeforeFlush = finished;
    expect(f.successes).toEqual([]);
    expect(f.records).toEqual([]);
    f.release(); await operation;
    expect(completedBeforeFlush).toBe(false);
    expect(f.requests.map(request => request.url)).toEqual(['/api/assets/batch-transfer']);
    expect(f.requests[0].body).toEqual({ restoreDeletedPlacements: false, transfers: [
      { sourceVersion: 'version-a', targetProject: 'project-a', targetWorkspace: 'canvas:project-a', entityType: 'canvas-image', entityId: 'canvas-skill:run-a:version-a', idempotencyKey: 'canvas-skill:run-a:version-a', metadata: { source: 'canvas-skill', runId: 'run-a', sourceVersionIds: ['source-v'] } },
      { sourceVersion: 'version-b', targetProject: 'project-a', targetWorkspace: 'canvas:project-a', entityType: 'canvas-image', entityId: 'canvas-skill:run-a:version-b', idempotencyKey: 'canvas-skill:run-a:version-b', metadata: { source: 'canvas-skill', runId: 'run-a', sourceVersionIds: ['source-v'] } },
    ] });
    expect(f.writes.map(images => images.map(image => image.id))).toEqual([['original', 'canvas-skill:run-a:version-a', 'canvas-skill:run-a:version-b']]);
    expect(f.saves).toHaveLength(1); expect(f.successes).toHaveLength(1); expect(f.errors).toEqual([]);
    context.current = { ...context.current, projectId: 'project-b' };
    await expect(consume([contractReference, contractSecondReference])).rejects.toThrow('导出运行上下文已变化');
    expect(f.requests).toHaveLength(1); expect(f.writes).toHaveLength(1);
  });
});
