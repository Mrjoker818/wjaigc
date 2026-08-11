import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareCanvasAssetForChat } from '@/lib/asset-core/workspace-transfer';

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const chatSource = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');

describe('canvas to embedded chat asset transfer', () => {
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
});
