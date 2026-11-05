// @vitest-environment jsdom

import { afterEach as afterMediaApis, beforeEach as beforeMediaApis } from 'vitest';
import { installJsdomMediaQueries, runJsdomFixtureCleanup } from '../helpers/jsdom-browser-apis';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/chat-panel';
import type { CanvasImage } from '@/components/infinite-canvas';

const image: CanvasImage = {
  id: 'synthetic-image', url: '/synthetic.png', x: 0, y: 0, width: 20, height: 20,
};

beforeEach(() => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('canvas image handoff to chat', () => {
  it.each([
    ['existing draft', '已有草稿', '已有草稿'],
    ['empty draft', '', '请帮我修改这张图片：'],
  ])('preserves the expected input for %s', async (_label, original, expected) => {
    const resolveImage = vi.fn(async (value: CanvasImage) => value);
    const consumed = vi.fn();
    const { rerender } = render(<ChatPanel themeStyle="gold" projectId="synthetic-project"
      canvasImages={[]} onResolveCanvasImageForChat={resolveImage} onChatInitialImageConsumed={consumed} />);
    const input = await screen.findByPlaceholderText('输入消息，@ 引用图片/品牌，/ 使用模板...');
    fireEvent.change(input, { target: { value: original } });
    rerender(<ChatPanel themeStyle="gold" projectId="synthetic-project" canvasImages={[]}
      chatInitialImage={image} onResolveCanvasImageForChat={resolveImage} onChatInitialImageConsumed={consumed} />);
    await waitFor(() => expect(consumed).toHaveBeenCalled());
    expect((input as HTMLTextAreaElement).value).toBe(expected);
    await waitFor(() => expect(resolveImage).toHaveBeenCalledWith(image));
  });

  it('does not transfer an image again when the workspace already resolved it', async () => {
    const resolveImage = vi.fn(async (value: CanvasImage) => value);
    const consumed = vi.fn();
    render(<ChatPanel themeStyle="gold" projectId="synthetic-project" canvasImages={[]}
      chatInitialImage={image} chatInitialImageResolved onResolveCanvasImageForChat={resolveImage}
      onChatInitialImageConsumed={consumed} />);
    await waitFor(() => expect(consumed).toHaveBeenCalled());
    await screen.findByPlaceholderText(/描述你想对这1张图片做什么/);
    expect(resolveImage).not.toHaveBeenCalled();
  });

  it('keeps the draft and does not attach an image when preparation is refused', async () => {
    const resolveImage = vi.fn(async (): Promise<CanvasImage> => {
      throw new Error('图片无法发送，请检查账号或项目访问权限');
    });
    const consumed = vi.fn();
    const { rerender } = render(<ChatPanel themeStyle="gold" projectId="synthetic-project"
      canvasImages={[]} onResolveCanvasImageForChat={resolveImage} onChatInitialImageConsumed={consumed} />);
    const input = await screen.findByPlaceholderText('输入消息，@ 引用图片/品牌，/ 使用模板...');
    fireEvent.change(input, { target: { value: '保留此草稿' } });
    rerender(<ChatPanel themeStyle="gold" projectId="synthetic-project" canvasImages={[]}
      chatInitialImage={image} onResolveCanvasImageForChat={resolveImage} onChatInitialImageConsumed={consumed} />);
    await waitFor(() => expect(resolveImage).toHaveBeenCalledWith(image));
    await waitFor(() => expect(consumed).toHaveBeenCalled());
    expect((input as HTMLTextAreaElement).value).toBe('保留此草稿');
    expect(screen.queryByPlaceholderText(/描述你想对这1张图片做什么/)).toBeNull();
  });
});

// Explicit file-local browser API fixture; business mocks and original tests are unchanged.
let restoreMediaApis: (() => void) | undefined;
beforeMediaApis((): void => { restoreMediaApis = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false }); });
afterMediaApis((): void => { runJsdomFixtureCleanup([cleanup, (): void => { const restore = restoreMediaApis; restoreMediaApis = undefined; restore?.(); }]); });
