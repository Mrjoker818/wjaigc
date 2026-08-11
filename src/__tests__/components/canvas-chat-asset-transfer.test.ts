import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
const chatSource = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');

describe('canvas to embedded chat asset transfer', () => {
  it('creates a chat-attachment placement before handing the canvas image to embedded chat', () => {
    expect(workspaceSource).toContain("fetch('/api/assets/transfer'");
    expect(workspaceSource).toContain("entityType: 'chat-attachment'");
    expect(workspaceSource).toContain('sourceVersion: image.assetVersionId');
    expect(workspaceSource).toContain('setChatInitialImage(transferredImage)');
    expect(workspaceSource).toContain('assetVersionId: undefined');
  });

  it('retains asset version identity in pending images, mentions, and persisted image anchors', () => {
    expect(chatSource).toMatch(/pendingImages[\s\S]*assetVersionId\?: string/);
    expect(chatSource).toMatch(/interface MentionRef[\s\S]*assetVersionId\?: string/);
    expect(chatSource).toContain('assetVersionId: chatInitialImage.assetVersionId');
    expect(chatSource).toContain('assetVersionId: img.assetVersionId');
    expect(chatSource).toContain('assetVersionId: m.assetVersionId');
  });
});
