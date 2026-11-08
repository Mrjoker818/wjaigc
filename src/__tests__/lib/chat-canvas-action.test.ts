import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractCanvasActionFromAIResponse } from '@/lib/canvas-action-executor';
import { isChatCanvasActionRequest, resolveChatCanvasAction } from '@/lib/chat-canvas-action';

const images = [
  { id: 'img-1', name: '主图', mediaType: 'image' },
  { id: 'vid-1', name: '视频', mediaType: 'video' },
];

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('chat canvas action', () => {
  it('resolves a [CANVAS_ACTION] block against the selected image', () => {
    const action = extractCanvasActionFromAIResponse('好的\n[CANVAS_ACTION]\ntype: remove_bg\ntarget: selected\n[/CANVAS_ACTION]');
    expect(action).not.toBeNull();
    expect(resolveChatCanvasAction(action!, images, 'img-1')).toEqual({ type: 'remove_bg', imageId: 'img-1', imageName: '主图' });
  });

  it('maps filter to language editing and honours an explicit target', () => {
    expect(resolveChatCanvasAction({ type: 'filter', targetImageId: 'img-1' }, images, null)?.type).toBe('img2img');
  });

  it('refuses unsupported tools, missing targets and non-image targets', () => {
    expect(resolveChatCanvasAction({ type: 'delete' }, images, 'img-1')).toBeNull();
    expect(resolveChatCanvasAction({ type: 'upscale' }, images, null)).toBeNull();
    expect(resolveChatCanvasAction({ type: 'upscale' }, images, 'missing')).toBeNull();
    expect(resolveChatCanvasAction({ type: 'upscale' }, images, 'vid-1')).toBeNull();
  });

  it('validates event payloads', () => {
    expect(isChatCanvasActionRequest({ type: 'crop', imageId: 'img-1' })).toBe(true);
    expect(isChatCanvasActionRequest({ type: 'delete', imageId: 'img-1' })).toBe(false);
    expect(isChatCanvasActionRequest({ type: 'crop', imageId: '' })).toBe(false);
    expect(isChatCanvasActionRequest(null)).toBe(false);
  });

  it('wires the chat button to the canvas listener and keeps the workflow on the message', () => {
    const chat = source('src/components/chat-panel.tsx');
    const canvas = source('src/components/infinite-canvas.tsx');
    expect(chat).toContain('requestChatCanvasAction(action)');
    expect(chat).toContain('data-testid="chat-workflow-preview"');
    expect(chat).toContain('workflow: builtWorkflow');
    expect(canvas).toContain('window.addEventListener(CHAT_CANVAS_ACTION_EVENT, onChatCanvasAction)');
  });
});
