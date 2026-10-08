// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { Toaster, toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';
import { browserBinaryResponse } from '../helpers/jsdom-native-web-boundary';

function Canvas({ source }: { source: string }): React.JSX.Element {
  const image: CanvasImage = { id: 'clip', url: '', videoUrl: source, mediaType: 'video',
    prompt: 'original video', x: 0, y: 0, width: 256, height: 192, rotation: 0, zIndex: 1, createdAt: 1 };
  const [selected, setSelected] = useState<CanvasImage | null>(null);
  return <InfiniteCanvas images={[image]} onImagesChange={() => undefined}
    selectedImage={selected} onSelectImage={setSelected} onPreviewImage={() => undefined}
    onGenerateVariation={() => undefined} onExtractKeywords={() => undefined}
    onFusion={() => undefined} onAddImages={() => undefined} projectId="download-project"
    onRequestTaskPoll={async () => new Response('{}')} />;
}

async function settle(): Promise<void> {
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

async function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(reader.result as ArrayBuffer);
    reader.onerror = (): void => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value); },
    removeItem: (key: string): void => { values.delete(key); }, clear: (): void => values.clear() });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
});
afterEach(() => { toast.dismiss(); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('real canvas original-format video download', () => {
  it.each([
    ['/api/serve-upload/exports/clip.mp4', 'video/mp4', 'MP4 视频', 'mp4'],
    ['/api/serve-upload/exports/clip.webm', 'video/webm', 'WEBM 视频', 'webm'],
    ['/api/serve-upload/exports/clip.mov', 'video/quicktime', 'MOV 视频', 'mov'],
    ['/api/serve-upload/exports/clip.m4v', 'video/x-m4v', 'M4V 视频', 'm4v'],
    ['/api/serve-upload/exports/clip%2EMOV?name=wrong.mp4', 'Video/QuickTime; codecs=avc1', 'MOV 视频', 'mov'],
    ['https://example.org/result?id=clip.mov', 'video/webm', '原格式视频', 'webm'],
    ['/api/serve-upload/exports/clip.mov', 'video/mp4', 'MOV 视频', 'mp4'],
    ['/api/serve-upload/exports/clip.webm', 'application/octet-stream', 'WEBM 视频', 'webm'],
  ])('downloads %s through the normal popup without relabelling its bytes', async (source, mime, label, extension) => {
    const bytes = new Uint8Array([0, 255, 7, 3, 9]);
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      if (url.startsWith('/api/video/download?')) {
        requests.push(url);
        return browserBinaryResponse(bytes, { headers: { 'Content-Type': mime } });
      }
      return new Response('{}');
    });
    let capturedBlob: Blob | undefined;
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL(blob: Blob | MediaSource): string {
        capturedBlob = blob as Blob; return 'blob:original-download';
      }
      static revokeObjectURL(): void {}
    });
    const downloads: { filename: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement): void {
      downloads.push({ filename: this.download, href: this.getAttribute('href') ?? '' });
    });
    const view = render(<Canvas source={source} />); await settle();
    const root = view.container.querySelector('[data-canvas-image-id="clip"]')!;
    fireEvent.mouseEnter(root); await settle();
    fireEvent.click(within(root as HTMLElement).getByRole('button', { name: '下载' })); await settle();
    const popup = view.container.querySelector<HTMLElement>('[data-popup="download"]')!;
    expect(within(popup).getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    fireEvent.click(within(popup).getByRole('button', { name: '确认下载' })); await settle();
    expect(requests).toEqual([`/api/video/download?url=${encodeURIComponent(source)}`]);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toMatch(new RegExp(`^wujie_.*\\.${extension}$`));
    expect(downloads[0].href).toBe('blob:original-download');
    expect(new Uint8Array(await readBlob(capturedBlob!))).toEqual(bytes);
    expect(view.container.querySelector('[data-popup="download"]')).toBeNull();
  });

  it.each([204, 200])('refuses an empty successful %s response and reports a retryable download error', async (status) => {
    const source = '/api/serve-upload/exports/clip.mov';
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => url.startsWith('/api/video/download?')
      ? new Response(null, { status }) : new Response('{}'));
    let objectUrls = 0;
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL(): string { objectUrls++; return 'blob:empty-file'; }
      static revokeObjectURL(): void {}
    });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement): void {
      downloads.push(this.download);
    });
    const view = render(<><Canvas source={source} /><Toaster /></>); await settle();
    const root = view.container.querySelector<HTMLElement>('[data-canvas-image-id="clip"]')!;
    fireEvent.mouseEnter(root); await settle();
    fireEvent.click(within(root).getByRole('button', { name: '下载' })); await settle();
    const popup = view.container.querySelector<HTMLElement>('[data-popup="download"]')!;
    fireEvent.click(within(popup).getByRole('button', { name: '确认下载' })); await settle();
    expect(downloads).toEqual([]);
    expect(objectUrls).toBe(0);
    await waitFor(() => expect(view.getByText('视频下载未返回文件，请检查浏览器下载扩展或稍后重试')).toBeTruthy());
  });
});
