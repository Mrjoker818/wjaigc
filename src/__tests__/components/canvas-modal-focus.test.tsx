// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CanvasHelpModal } from '@/components/canvas/CanvasHelpModal';
import { HelpGuide } from '@/components/help-guide';
import { ImageCompareDialog } from '@/components/image-compare-dialog';
import { ImagePreview } from '@/components/image-preview';
import VideoCompareDialog from '@/components/video-compare-dialog';
import { VideoEditPanel } from '@/components/video-edit-panel';
import VideoPlayer from '@/components/video-player';
import type { CanvasImage } from '@/components/infinite-canvas';

vi.mock('@/lib/psd-export', () => ({ exportAsPSD: vi.fn() }));
vi.mock('@/lib/svg-export', () => ({ downloadSVG: vi.fn() }));

const image: CanvasImage = {
  id: 'example', url: '/synthetic/image.png', x: 0, y: 0, width: 100, height: 100,
  originalWidth: 100, originalHeight: 100, rotation: 0, zIndex: 0, createdAt: 1,
};
const videoA = { url: '/synthetic/first.mp4' };
const videoB = { url: '/synthetic/second.mp4' };

const cases: Array<[string, (close: () => void) => React.ReactNode]> = [
  ['关闭画布帮助', onClose => <CanvasHelpModal mode="instructions" isMonochrome onClose={onClose} />],
  ['关闭使用说明', onClose => <HelpGuide isOpen onClose={onClose} />],
  ['关闭图片对比', onClose => <ImageCompareDialog leftImage={image} rightImage={{ url: '/synthetic/other.png' }} onClose={onClose} />],
  ['关闭图片预览', onClose => <ImagePreview image={image} onClose={onClose} />],
  ['关闭视频对比', onClose => <VideoCompareDialog open videoA={videoA} videoB={videoB} onClose={onClose} />],
  ['关闭视频预览', onClose => <VideoPlayer videoUrl={videoA.url} onClose={onClose} />],
  ['关闭视频编辑', onClose => <VideoEditPanel isOpen videoUrl={videoA.url} onEdit={() => {}} onClose={onClose} />],
];

beforeEach(() => {
  // jsdom has no layout. These fixtures have no responsive CSS loaded.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(cases)('%s enters and contains focus, shields the canvas keyboard, and restores the opener', (name, modal) => {
  const onClose = vi.fn();
  function Fixture() {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>打开</button>
      <button>画布选中项</button>
      {open && modal(() => { onClose(); setOpen(false); })}
    </>;
  }
  render(<Fixture />);
  const opener = screen.getByRole('button', { name: '打开' });
  const canvasItem = screen.getByRole('button', { name: '画布选中项' });
  opener.focus();
  fireEvent.click(opener);

  const dialog = screen.getByRole('dialog');
  const close = within(dialog).getByRole('button', { name });
  expect(document.activeElement).toBe(close);
  const stops = [...dialog.querySelectorAll<HTMLElement>('button, select, input, textarea, [tabindex="0"]')]
    .filter(control => control.tabIndex >= 0 && !control.matches(':disabled'));
  const first = stops[0];
  const last = stops.at(-1)!;
  first.focus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  canvasItem.focus();
  expect(document.activeElement).toBe(first);

  const shortcut = vi.fn();
  window.addEventListener('keydown', shortcut);
  try {
    fireEvent.keyDown(first, { key: 'Delete', code: 'Delete' });
    fireEvent.keyDown(document.body, { key: 'Backspace', code: 'Backspace' });
    expect(shortcut).not.toHaveBeenCalled();
    fireEvent.keyDown(first, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  } finally {
    window.removeEventListener('keydown', shortcut);
  }
});

it('lets the foreground modal close and restores the control in the underlying modal', () => {
  const closeHelp = vi.fn();
  const closeVideo = vi.fn();
  function Fixture() {
    const [video, setVideo] = useState(false);
    return <>
      <CanvasHelpModal mode="instructions" isMonochrome onClose={closeHelp} />
      <button onClick={() => setVideo(true)}>第二个弹窗</button>
      {video && <VideoPlayer videoUrl={videoA.url} onClose={() => { closeVideo(); setVideo(false); }} />}
    </>;
  }
  render(<Fixture />);
  const close = screen.getByRole('button', { name: '关闭画布帮助' });
  expect(document.activeElement).toBe(close);
  fireEvent.click(screen.getByRole('button', { name: '第二个弹窗' }));
  fireEvent.keyDown(screen.getByRole('button', { name: '关闭视频预览' }), { key: 'Escape' });
  expect(closeVideo).toHaveBeenCalledTimes(1);
  expect(closeHelp).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(close);
});

it('keeps the comparison slider and zoom keyboard controls working inside the trap', () => {
  render(<ImageCompareDialog leftImage={image} rightImage={{ url: '/synthetic/other.png' }} onClose={() => {}} />);
  const divider = screen.getByRole('slider', { name: '对比分界' });
  divider.focus();
  fireEvent.keyDown(divider, { key: 'ArrowRight' });
  expect(divider.getAttribute('aria-valuenow')).toBe('55');
  fireEvent.keyDown(divider, { key: '+' });
  expect(screen.getByAltText('A').style.transform).toContain('scale(1.1)');
});

it('keeps clipboard events from the canvas while allowing a modal text field to paste', () => {
  render(<VideoEditPanel isOpen videoUrl={videoA.url} onEdit={() => {}} onClose={() => {}} />);
  const canvasPaste = vi.fn();
  window.addEventListener('paste', canvasPaste);
  try {
    const draft = screen.getByRole('textbox', { name: '编辑描述' });
    draft.focus();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    fireEvent(draft, paste);
    expect(paste.defaultPrevented).toBe(false);
    const outsidePaste = new Event('paste', { bubbles: true, cancelable: true });
    fireEvent(document.body, outsidePaste);
    expect(outsidePaste.defaultPrevented).toBe(true);
    expect(canvasPaste).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener('paste', canvasPaste);
  }
});

it('describes canvas edit capabilities conditionally and preserves the changelog', () => {
  const view = render(<CanvasHelpModal mode="instructions" isMonochrome onClose={() => {}} />);
  const guide = screen.getByRole('region', { name: '使用说明内容' });
  expect(guide.textContent).toMatch(/擦除.*可用的图像编辑能力/);
  expect(guide.textContent).toMatch(/移除背景.*可用的去背景能力/);
  expect(guide.textContent).not.toMatch(/LaMa|BiRefNet|Silueta/);
  view.rerender(<CanvasHelpModal mode="changelog" isMonochrome onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: '更新内容' }).textContent).toContain('LaMa/ZITS/Anime-Lama');
});

it('describes the configured tools in the full guide and retains the historical IOPaint entry', () => {
  render(<HelpGuide isOpen initialSection="tools" onClose={() => {}} />);
  const guide = screen.getByRole('region', { name: '使用说明内容' });
  expect(guide.textContent).toMatch(/可用模型与处理方式以当前部署配置为准/);
  expect(guide.textContent).not.toMatch(/IOPaint|LaMa|BiRefNet|Silueta/);
  fireEvent.change(screen.getByRole('combobox', { name: '选择指南章节' }), { target: { value: 'changelog' } });
  expect(guide.textContent).toContain('IOPaint 本地集成');
});
