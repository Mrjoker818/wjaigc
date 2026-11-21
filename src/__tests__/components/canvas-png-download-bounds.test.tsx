// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage, type Canvas as RasterCanvas } from '@napi-rs/canvas';
import { Toaster, toast } from 'sonner';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';
import { browserBinaryResponse } from '../helpers/jsdom-native-web-boundary';
import { installJsdomMediaQueries } from '../helpers/jsdom-browser-apis';

let sourceBytes: Uint8Array<ArrayBuffer>;
let sourceMime: string;
let failDirect: boolean;
let proxyStatus: number;
let encodingFailure: 'null' | 'throw' | undefined;
let downloads: Array<{ blob: Blob; name: string }>;
let issuedUrls: Map<string, Blob>;
let requests: string[];
let canvasBounds: { left: number; top: number; width: number; height: number };
let resizeObservers: Set<() => void>;
let restoreMedia: () => void;
const INITIAL_VIEW = { offsetX: 0, offsetY: 0, zoom: 1 };

function Canvas({ source = '/api/serve-upload/photo.jpg' }: { source?: string }): React.JSX.Element {
  const image: CanvasImage = { id: 'photo', url: source, prompt: '山景',
    x: 400, y: 290, width: 120, height: 180, originalWidth: 600, originalHeight: 900 };
  const [selected, setSelected] = useState<CanvasImage | null>(null);
  return <><InfiniteCanvas images={[image]} onImagesChange={() => undefined}
    selectedImage={selected} onSelectImage={setSelected} onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined} onExtractKeywords={() => undefined}
    onFusion={() => undefined} onAddImages={() => undefined} projectId="download-project"
    initialViewState={INITIAL_VIEW}
    onRequestTaskPoll={async () => new Response('{}')} /><Toaster /></>;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
}

async function bytesOf(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function rectangle(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height,
    x: left, y: top, toJSON: () => ({}) };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined,
    removeItem: () => undefined, clear: () => undefined });
  vi.stubGlobal('innerWidth', 1920);
  vi.stubGlobal('innerHeight', 1040);
  restoreMedia = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false });
  canvasBounds = { left: 24, top: 96, width: 1440, height: 900 };
  resizeObservers = new Set();
  vi.stubGlobal('ResizeObserver', class {
    private targets = new Set<Element>();
    private notify = (): void => this.callback(Array.from(this.targets, target => ({
      target, contentRect: target.getBoundingClientRect(),
    } as ResizeObserverEntry)));
    constructor(private callback: (entries: ResizeObserverEntry[]) => void) {}
    observe(target: Element): void { this.targets.add(target); resizeObservers.add(this.notify); }
    unobserve(target: Element): void { this.targets.delete(target); }
    disconnect(): void { resizeObservers.delete(this.notify); }
  });
  // jsdom has no layout engine. Supply measured element sizes, including SVG
  // expansion, and apply the rendered position/transform to obtain screen bounds.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-canvas-viewport')) {
      const { left, top, width, height } = canvasBounds;
      return rectangle(left, top, width, height);
    }
    if (this.getAttribute('data-popup') === 'download') {
      const width = Math.min(260, Number.parseFloat(this.style.maxWidth) || 260);
      const height = Math.min(this.textContent?.includes('矢量化模式') ? 440 : 270,
        Number.parseFloat(this.style.maxHeight) || Infinity);
      let left = Number.parseFloat(this.style.left) || 0;
      let top = Number.parseFloat(this.style.top) || 0;
      if (this.style.position !== 'fixed' && !this.classList.contains('fixed')) {
        left += canvasBounds.left; top += canvasBounds.top;
      }
      if (this.style.transform.startsWith('translate(-50%')) left -= width / 2;
      if (this.style.transform.startsWith('translate(-100%')) left -= width;
      if (this.style.transform.endsWith('-100%)')) top -= height;
      return rectangle(left, top, width, height);
    }
    return rectangle(0, 0, 0, 0);
  });

  // Only the missing browser raster boundary is adapted. Decode, draw, and PNG
  // encoding use the installed native codec; assertions inspect the actual bytes.
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    const image = await loadImage(Buffer.from(await bytesOf(blob)));
    return Object.assign(image, { close: () => undefined });
  });
  const surfaces = new WeakMap<HTMLCanvasElement, RasterCanvas>();
  function surface(element: HTMLCanvasElement): RasterCanvas {
    let result = surfaces.get(element);
    if (!result || result.width !== element.width || result.height !== element.height) {
      result = createCanvas(element.width, element.height); surfaces.set(element, result);
    }
    return result;
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return surface(this).getContext('2d');
  } as unknown as HTMLCanvasElement['getContext']);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, mime) {
    if (encodingFailure === 'throw') throw new Error('PNG encoder unavailable');
    if (encodingFailure === 'null') { callback(null); return; }
    if (mime !== 'image/png') throw new Error('Expected explicit PNG encoding');
    void surface(this).encode('png').then(bytes => callback(new Blob([new Uint8Array(bytes)], { type: 'image/png' })));
  });

  sourceBytes = new Uint8Array(createCanvas(600, 900).toBuffer('image/jpeg'));
  sourceMime = 'image/jpeg'; failDirect = false; proxyStatus = 200; encodingFailure = undefined;
  requests = []; downloads = []; issuedUrls = new Map();
  vi.stubGlobal('fetch', async (input: string): Promise<Response> => {
    if (input === '/api/save-image') {
      requests.push(input);
      return new Response(JSON.stringify({ success: true, url: '/api/serve-upload/proxied.jpg' }));
    }
    if (input === '/api/serve-upload/photo.jpg' || input === '/api/serve-upload/proxied.jpg') {
      requests.push(input);
      if (failDirect && input.endsWith('/photo.jpg')) throw new TypeError('CORS blocked');
      return browserBinaryResponse(sourceBytes, { status: input.endsWith('/proxied.jpg') ? proxyStatus : 200,
        headers: { 'content-type': sourceMime } });
    }
    return new Response('{}');
  });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob): string {
      const url = `blob:download-${issuedUrls.size}`; issuedUrls.set(url, blob); return url;
    }
    static revokeObjectURL(): void {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ blob: issuedUrls.get(this.href)!, name: this.download });
  });
});

afterEach(() => {
  cleanup(); toast.dismiss(); restoreMedia(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function openDownload(source?: string): Promise<HTMLElement> {
  const view = render(<Canvas source={source} />); await settle();
  const image = view.container.querySelector<HTMLElement>('[data-canvas-image-id="photo"]')!;
  fireEvent.mouseEnter(image); await settle();
  fireEvent.click(within(image).getByRole('button', { name: '下载' })); await settle();
  return document.querySelector<HTMLElement>('[data-popup="download"]')!;
}

async function confirmDownload(source?: string): Promise<void> {
  const popup = await openDownload(source);
  fireEvent.click(within(popup).getByRole('button', { name: '确认下载' }));
  await waitFor(() => expect(document.querySelector('[data-popup="download"]')).toBeNull());
}

describe('canvas PNG download bytes', () => {
  it.each(['image/jpeg', 'image/png'])('encodes a 600x900 JPEG served as %s to real PNG at original size', async mime => {
    sourceMime = mime;
    await confirmDownload();
    cleanup();
    expect(downloads).toHaveLength(1);
    const bytes = await bytesOf(downloads[0].blob);
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(downloads[0].blob.type).toBe('image/png');
    const decoded = await loadImage(Buffer.from(bytes));
    expect([decoded.width, decoded.height]).toEqual([600, 900]);
    expect(downloads[0].name).toMatch(/\.png$/);
  });

  it('preserves transparent pixels and intrinsic dimensions for data URLs', async () => {
    const original = createCanvas(3, 2);
    original.getContext('2d').fillStyle = '#ff0000';
    original.getContext('2d').fillRect(1, 0, 1, 1);
    await confirmDownload(original.toDataURL('image/png'));
    cleanup();
    expect(downloads).toHaveLength(1);
    const image = await loadImage(Buffer.from(await bytesOf(downloads[0].blob)));
    expect([image.width, image.height]).toEqual([3, 2]);
    const output = createCanvas(3, 2); output.getContext('2d').drawImage(image, 0, 0);
    expect(Array.from(output.getContext('2d').getImageData(0, 0, 2, 1).data))
      .toEqual([0, 0, 0, 0, 255, 0, 0, 255]);
    expect(requests).toEqual([]);
  });

  it('also encodes bytes obtained by the existing CORS proxy fallback', async () => {
    failDirect = true;
    await confirmDownload();
    cleanup();
    expect(requests).toEqual(['/api/serve-upload/photo.jpg', '/api/save-image', '/api/serve-upload/proxied.jpg']);
    expect(downloads).toHaveLength(1);
    expect(Array.from((await bytesOf(downloads[0].blob)).slice(0, 8)))
      .toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it.each(['decode', 'null', 'throw', 'http'] as const)('reports %s failure without downloading the source as PNG', async failure => {
    const originalError = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (args[0] !== 'Download proxy also failed:') originalError(...args);
    });
    if (failure === 'decode') sourceBytes = new TextEncoder().encode('<html>not an image</html>');
    else if (failure === 'http') { failDirect = true; proxyStatus = 403; }
    else encodingFailure = failure;
    await confirmDownload();
    expect(downloads).toEqual([]);
    await waitFor(() => expect(document.querySelector('[data-sonner-toast][data-type="error"]')).toBeTruthy());
  });
});

describe('canvas download popup bounds', () => {
  it('repositions after SVG expansion inside the canvas below the project header', async () => {
    const popup = await openDownload();
    fireEvent.click(within(popup).getByRole('button', { name: /SVG 格式/ })); await settle();
    await act(async () => { resizeObservers.forEach(notify => notify()); });
    const bounds = popup.getBoundingClientRect();
    expect(bounds.top).toBeGreaterThanOrEqual(112);
    expect(bounds.bottom).toBeLessThanOrEqual(980);
    expect(bounds.left).toBeGreaterThanOrEqual(40);
    expect(bounds.right).toBeLessThanOrEqual(1448);
    expect(popup.style.overflowY).toBe('auto');
    expect(popup.style.transform).toBe('');
    expect(document.body.contains(popup)).toBe(true);
  });

  it('constrains a tall panel on viewport resize and isolates wheel events from the canvas', async () => {
    const popup = await openDownload();
    fireEvent.click(within(popup).getByRole('button', { name: /SVG 格式/ })); await settle();
    vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 420);
    canvasBounds = { left: 0, top: 64, width: 390, height: 356 };
    fireEvent(window, new Event('resize')); await settle();
    await act(async () => { resizeObservers.forEach(notify => notify()); });
    const bounds = popup.getBoundingClientRect();
    expect(bounds.top).toBeGreaterThanOrEqual(80);
    expect(bounds.bottom).toBeLessThanOrEqual(404);
    expect(bounds.right).toBeLessThanOrEqual(374);
    expect(Number.parseFloat(popup.style.maxHeight)).toBeGreaterThan(0);
    expect(popup.style.overflowY).toBe('auto');
    expect(popup.style.overscrollBehavior).toBe('contain');
    expect(popup.style.touchAction).toBe('pan-y');
    const escapedWheel = vi.fn();
    document.addEventListener('wheel', escapedWheel);
    try {
      fireEvent.wheel(within(popup).getByRole('button', { name: /Studio/ }), { deltaY: 120 });
      expect(escapedWheel).not.toHaveBeenCalled();
    } finally { document.removeEventListener('wheel', escapedWheel); }
  });
});
