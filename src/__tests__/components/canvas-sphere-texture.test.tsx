// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiAngleSpherePreview } from '@/components/canvas/MultiAngleSpherePreview';
import { ImagePreview } from '@/components/image-preview';
import type { CanvasImage } from '@/components/infinite-canvas';

vi.mock('@/lib/psd-export', () => ({ exportAsPSD: vi.fn() }));
vi.mock('@/lib/svg-export', () => ({ downloadSVG: vi.fn() }));

const requests: FixtureImage[] = [];
const rasters: ImageData[] = [];
const rejectedReads = new Set<string>();

class FixtureImage {
  width = 2;
  height = 2;
  naturalWidth = 2;
  naturalHeight = 2;
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { requests.push(this); }
}

function pixels(width: number, height: number): ImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' };
}

function image(id: string): CanvasImage {
  return {
    id, url: `/synthetic/${id}.png`, x: 0, y: 0, width: 100, height: 100,
    originalWidth: 100, originalHeight: 100, rotation: 0, zIndex: 0, createdAt: 1,
  };
}

function dominantChannel() {
  const raster = rasters.at(-1);
  if (!raster) return 'unpainted';
  let red = 0;
  let blue = 0;
  for (let offset = 0; offset < raster.data.length; offset += 4) {
    red += raster.data[offset];
    blue += raster.data[offset + 2];
  }
  return red > blue ? 'red' : blue > red ? 'blue' : 'unpainted';
}

beforeEach(() => {
  vi.stubGlobal('Image', FixtureImage);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected fixture request'); }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    let source: FixtureImage | undefined;
    return {
      drawImage(image: unknown) { if (image instanceof FixtureImage) source = image; },
      getImageData(_x: number, _y: number, width: number, height: number) {
        if (source && rejectedReads.has(source.src)) throw new DOMException('Synthetic CORS error', 'SecurityError');
        const result = pixels(width, height);
        const channel = source?.src.endsWith('/b.png') ? 2 : 0;
        for (let offset = 0; offset < result.data.length; offset += 4) {
          result.data[offset + channel] = 240;
          result.data[offset + 3] = 255;
        }
        return result;
      },
      createImageData: pixels,
      putImageData(data: ImageData) { rasters.push(data); },
      clearRect() {}, fillRect() {}, fillText() {}, beginPath() {}, arc() {}, ellipse() {},
      stroke() {}, fill() {}, save() {}, restore() {}, clip() {}, moveTo() {}, lineTo() {},
    } as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  requests.length = 0;
  rasters.length = 0;
  rejectedReads.clear();
});

function openSphere() {
  fireEvent.click(screen.getByRole('button', { name: '3D' }));
  fireEvent.click(screen.getByRole('button', { name: '摄像头' }));
}

function redrawSphere() {
  fireEvent.click(screen.getByRole('button', { name: '主体' }));
  fireEvent.click(screen.getByRole('button', { name: '摄像头' }));
}

describe('image preview sphere', () => {
  it('repaints when the current texture loads while auto-rotation is off', () => {
    render(<ImagePreview image={image('b')} onClose={() => {}} />);
    openSphere();
    act(() => requests[0].onload?.());
    expect(dominantChannel()).toBe('blue');
  });

  it('cannot paint an obsolete direct Image callback over the new source', () => {
    const view = render(<ImagePreview image={image('a')} onClose={() => {}} />);
    openSphere();
    const staleLoad = requests[0].onload!;
    view.rerender(<ImagePreview image={image('b')} onClose={() => {}} />);
    act(() => requests[1].onload?.());
    act(() => staleLoad());
    redrawSphere();
    expect(dominantChannel()).toBe('blue');
  });

  it.each(['decode error', 'canvas read error'])('uses the cache JSON and ignores its obsolete Image callback after a %s', async error => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true, imageUrl: '/synthetic/cache-a.png' }));
    const view = render(<ImagePreview image={image('a')} onClose={() => {}} />);
    openSphere();
    if (error === 'canvas read error') rejectedReads.add(image('a').url);
    await act(async () => error === 'decode error' ? requests[0].onerror?.() : requests[0].onload?.());
    expect(requests[1].src).toBe('/synthetic/cache-a.png');
    const staleCacheLoad = requests[1].onload!;
    view.rerender(<ImagePreview image={image('b')} onClose={() => {}} />);
    act(() => requests[2].onload?.());
    act(() => staleCacheLoad());
    redrawSphere();
    expect(dominantChannel()).toBe('blue');
  });

  it('aborts the obsolete cache request and ignores even a response that arrives after abort', async () => {
    let resolveCache!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveCache = resolve; }));
    const view = render(<ImagePreview image={image('a')} onClose={() => {}} />);
    openSphere();
    act(() => requests[0].onerror?.());
    const options = vi.mocked(fetch).mock.calls[0][1];
    view.rerender(<ImagePreview image={image('b')} onClose={() => {}} />);
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => resolveCache(Response.json({ success: true, imageUrl: '/synthetic/cache-a.png' })));
    expect(requests).toHaveLength(2);
    act(() => requests[1].onload?.());
    expect(dominantChannel()).toBe('blue');
  });
});

describe('multi-angle sphere', () => {
  const renderSphere = (zoom: number, url = image('b').url) => (
    <MultiAngleSpherePreview imageUrl={url} zoom={zoom} tilt={0} rotation={0} isMonochrome />
  );

  it('paints successively smaller textured spheres for close-up, standard, and wide', () => {
    const view = render(renderSphere(0));
    act(() => requests[0].onload?.());
    const area = () => rasters.at(-1)!.data.filter((alpha, index) => index % 4 === 3 && alpha === 255).length;
    const closeUp = area();
    view.rerender(renderSphere(1));
    const standard = area();
    view.rerender(renderSphere(2));
    const wide = area();
    expect(closeUp).toBeGreaterThan(standard);
    expect(standard).toBeGreaterThan(wide);
    expect(wide).toBeGreaterThan(0);
  });

  it('keeps the new sphere texture when a replaced Image callback is invoked late', () => {
    const view = render(renderSphere(1, image('a').url));
    const staleLoad = requests[0].onload!;
    view.rerender(renderSphere(1));
    act(() => requests[1].onload?.());
    expect(dominantChannel()).toBe('blue');
    act(() => staleLoad());
    expect(dominantChannel()).toBe('blue');
  });
});
