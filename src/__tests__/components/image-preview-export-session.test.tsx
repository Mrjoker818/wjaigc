// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/psd-export', () => ({ exportAsPSD: vi.fn(), downloadPSD: vi.fn() }));
vi.mock('@/lib/svg-export', () => ({ downloadSVG: vi.fn() }));

import { ImagePreview } from '@/components/image-preview';
import { downloadSVG } from '@/lib/svg-export';
import type { CanvasImage } from '@/components/infinite-canvas';

function image(id: string): CanvasImage {
  return { id, url: `/synthetic/${id}.png`, prompt: id, x: 0, y: 0, width: 100, height: 100, originalWidth: 100, originalHeight: 100, rotation: 0, zIndex: 0, createdAt: 1 };
}

describe('image preview export session', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('unlocks all export buttons after the current export finishes', async () => {
    let finish: () => void = () => {};
    vi.mocked(downloadSVG).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ImagePreview image={image('a')} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'SVG' }));
    expect(screen.getByRole('button', { name: 'PNG' })).toHaveProperty('disabled', true);
    await act(async () => { finish(); });
    expect(screen.getByRole('button', { name: 'PNG' })).toHaveProperty('disabled', false);
    expect(vi.mocked(downloadSVG)).toHaveBeenCalledWith('/synthetic/a.png', 'pro');
  });

  it('does not leave a new image export disabled by an earlier preview', () => {
    const view = render(<ImagePreview image={image('a')} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
    expect(screen.getByRole('button', { name: 'PNG' })).toHaveProperty('disabled', true);
    view.rerender(<ImagePreview image={null} onClose={() => {}} />);
    view.rerender(<ImagePreview image={image('b')} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'PNG' })).toHaveProperty('disabled', false);
  });

  it('does not let an earlier failed export unlock an export in the new preview', async () => {
    let rejectOld: (reason: Error) => void = () => {};
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise<Response>(() => {})));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const view = render(<ImagePreview image={image('a')} onClose={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
      view.rerender(<ImagePreview image={null} onClose={() => {}} />);
      view.rerender(<ImagePreview image={image('b')} onClose={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      await act(async () => { rejectOld(new Error('synthetic old export failure')); });
      expect(screen.getByRole('button', { name: 'PNG' })).toHaveProperty('disabled', true);
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { error.mockRestore(); }
  });

  it.each(['same-image-reopen', 'same-id-new-url'] as const)(
    'keeps the new export locked when the old export succeeds: %s',
    async (transition) => {
      let finishOld: () => void = () => {};
      let finishNew: () => void = () => {};
      vi.mocked(downloadSVG)
        .mockImplementationOnce(() => new Promise<void>(resolve => { finishOld = resolve; }))
        .mockImplementationOnce(() => new Promise<void>(resolve => { finishNew = resolve; }));
      const first = image('a');
      const view = render(<ImagePreview image={first} onClose={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'SVG' }));
      if (transition === 'same-image-reopen') {
        view.rerender(<ImagePreview image={null} onClose={() => {}} />);
        view.rerender(<ImagePreview image={first} onClose={() => {}} />);
      } else {
        view.rerender(<ImagePreview image={{ ...first, url: '/synthetic/new.png' }} onClose={() => {}} />);
      }
      expect(screen.getByRole('button', { name: 'SVG' })).toHaveProperty('disabled', false);
      fireEvent.click(screen.getByRole('button', { name: 'SVG' }));
      await act(async () => { finishOld(); });
      expect(screen.getByRole('button', { name: 'SVG' })).toHaveProperty('disabled', true);
      await act(async () => { finishNew(); });
      expect(screen.getByRole('button', { name: 'SVG' })).toHaveProperty('disabled', false);
    },
  );
});
