// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LayerPanel } from '@/components/layer-panel';
import type { CanvasImage } from '@/components/infinite-canvas';

const image: CanvasImage = {
  id: 'layer', name: '合成图层', url: '/synthetic/image.png', x: 0, y: 0,
  width: 64, height: 64, originalWidth: 64, originalHeight: 64, rotation: 0, zIndex: 0, createdAt: 1,
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renameLayer() {
  const rename = vi.fn();
  const { rerender } = render(<LayerPanel images={[image]} position="bottom" onRename={rename} />);
  const more = screen.getByRole('button', { name: '图层 合成图层 更多操作' });
  fireEvent.click(more);
  fireEvent.click(screen.getByRole('button', { name: '重命名' }));
  const field = screen.getByRole('textbox', { name: '重命名 合成图层' });
  expect(document.activeElement).toBe(field);
  fireEvent.change(field, { target: { value: ' 新名称 ' } });
  return { rename, more, field, rerender };
}

it('keeps the editor open as focus moves to Save and Cancel, then discards the draft', () => {
  const { rename, field } = renameLayer();
  const save = screen.getByRole('button', { name: '保存重命名' });
  const cancel = screen.getByRole('button', { name: '取消重命名' });
  act(() => save.focus());
  act(() => cancel.focus());
  expect(document.activeElement).toBe(cancel);
  expect(field).toHaveProperty('value', ' 新名称 ');
  expect(rename).not.toHaveBeenCalled();
  fireEvent.click(cancel);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(rename).not.toHaveBeenCalled();
});

it('commits once from the explicit Save button', () => {
  const { rename } = renameLayer();
  const save = screen.getByRole('button', { name: '保存重命名' });
  act(() => save.focus());
  expect(rename).not.toHaveBeenCalled();
  fireEvent.click(save);
  expect(rename).toHaveBeenCalledExactlyOnceWith('layer', '新名称');
});

it('preserves commit when focus leaves all rename controls', () => {
  const { rename, more } = renameLayer();
  act(() => more.focus());
  expect(rename).toHaveBeenCalledExactlyOnceWith('layer', '新名称');
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('preserves the in-progress draft when a remote name arrives', () => {
  const { rename, rerender } = renameLayer();
  rerender(<LayerPanel images={[{ ...image, name: '远端名称' }]} position="bottom" onRename={rename} />);
  const field = screen.getByRole('textbox', { name: '重命名 远端名称' });
  expect(field).toHaveProperty('value', ' 新名称 ');
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(rename).toHaveBeenCalledExactlyOnceWith('layer', '新名称');
});

it('keeps an incoming rename when the local editor has no draft', () => {
  const rename = vi.fn();
  const { rerender } = render(<LayerPanel images={[image]} position="bottom" onRename={rename} />);
  fireEvent.click(screen.getByRole('button', { name: '图层 合成图层 更多操作' }));
  fireEvent.click(screen.getByRole('button', { name: '重命名' }));
  rerender(<LayerPanel images={[{ ...image, name: '远端名称' }]} position="bottom" onRename={rename} />);
  const field = screen.getByRole('textbox', { name: '重命名 远端名称' });
  expect(field).toHaveProperty('value', '远端名称');
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(rename).not.toHaveBeenCalled();
});

it('shows a playable video without a poster as a video layer instead of an empty image', () => {
  const video: CanvasImage = { ...image, url: '', mediaType: 'video', videoUrl: '/synthetic/video.mp4' };
  const { container } = render(<LayerPanel images={[video]} position="bottom" />);
  expect(screen.getByRole('img', { name: '视频图层：合成图层' })).toBeInstanceOf(HTMLElement);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('video')).toBeNull();
});

it('uses the video poster and falls back to a video tile when the poster cannot load', () => {
  const video: CanvasImage = { ...image, url: '/synthetic/video.mp4', mediaType: 'video',
    videoUrl: '/synthetic/video.mp4', videoThumbnailUrl: '/synthetic/poster.jpg' };
  render(<LayerPanel images={[video]} position="bottom" />);
  const poster = screen.getByRole('img', { name: '合成图层' });
  expect(poster.getAttribute('src')).toBe(video.videoThumbnailUrl);
  fireEvent.error(poster);
  expect(screen.getByRole('img', { name: '视频图层：合成图层' })).toBeInstanceOf(HTMLElement);
});
