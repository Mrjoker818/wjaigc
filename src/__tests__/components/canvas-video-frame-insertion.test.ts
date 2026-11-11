import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGeneratedVideoToolFiles } from '@/lib/collaboration/document-canvas-upload';
import type { CanvasVideoToolOutput } from '@/components/infinite-canvas';
import { actualTransferCallback, contractDeferred } from '../helpers/canvas-chat-transfer-contract-fixture';

const urls = ['/api/serve-upload/generated-videos/frame_1794367000000_0a1b2c3d_001.png'];
const frameOutput: CanvasVideoToolOutput = { format: 'image/png', urls };
type Insertion = { assertCurrent: () => void; insert: (output: CanvasVideoToolOutput) => Promise<number> };
afterEach(() => vi.unstubAllGlobals());

function fixture(authority: 'document' | 'legacy') {
  const project = { current: { id: 'test-project' } };
  const scope = { assertCurrent: vi.fn() };
  const captureCanvasInsertionScope = vi.fn(() => scope);
  const upload = vi.fn().mockResolvedValue(1);
  const add = vi.fn().mockResolvedValue(undefined);
  const setImages = vi.fn().mockReturnValue(true);
  const read = vi.fn().mockResolvedValue([new File(['fixture'], 'frame.png', { type: 'image/png' })]);
  const refreshMedia = vi.fn(), recordMediaHistory = vi.fn();
  const capture = actualTransferCallback<() => Insertion>('captureVideoToolInsertion', {
    currentUserRef: { current: { id: 'test-owner' } }, currentProjectRef: project,
    historyProjectIdRef: { current: 'test-project' }, historyTransitionEpochRef: { current: 1 },
    isMountedRef: { current: true }, historyLifecyclePendingRef: { current: false },
    collaborativeCanvasRef: { current: { projectId: 'test-project', authority, refreshMedia, recordMediaHistory, isWritable: () => true } },
    isDocumentHistoryRecoveryPending: () => false,
    captureCanvasInsertionScope, handleAddImages: add, handleDocumentCanvasFiles: upload,
    readGeneratedVideoToolFiles: read, latestImagesRef: { current: [] }, setImages,
  });
  return { capture, project, scope, add, upload, read, setImages };
}

describe('placing video extraction results through the active canvas', () => {
  it('reads the returned same-site frame as a file for the original upload validator', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    const [file] = await readGeneratedVideoToolFiles(urls, 'image/png', () => undefined);
    expect(file).toMatchObject({ name: 'frame_1794367000000_0a1b2c3d_001.png', type: 'image/png', size: 4 });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(urls[0], expect.objectContaining({ redirect: 'error', credentials: 'same-origin' }));
  });

  it('checks all returned frame paths before reading any file', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(readGeneratedVideoToolFiles([...urls, '/unexpected.png'], 'image/png', () => undefined)).rejects.toThrow('文件地址无效');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['image/gif', 'video_1794367000000_0a1b2c3d.gif'],
    ['video/mp4', 'compressed_1794367000000_0a1b2c3d.mp4'],
    ['video/mp4', 'merged_1794367000000_0a1b2c3d.mp4'],
  ] as const)('reads %s tool results through the original upload file contract', async (type, filename) => {
    const path = `/api/serve-upload/generated-videos/${filename}`;
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': type } }));
    vi.stubGlobal('fetch', fetcher);
    const [file] = await readGeneratedVideoToolFiles([path], type, () => undefined);
    expect(file).toMatchObject({ name: filename, type, size: 3 });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(path, expect.objectContaining({ credentials: 'same-origin', redirect: 'error' }));
  });

  it('uses document media admission and reports the confirmed count', async () => {
    const { capture, read, upload, add } = fixture('document');
    await expect(capture().insert(frameOutput)).resolves.toBe(1);
    expect(read).toHaveBeenCalledWith(urls, 'image/png', expect.any(Function));
    expect(upload).toHaveBeenCalledWith([expect.objectContaining({ type: 'image/png' })]);
    expect(add).not.toHaveBeenCalled();
  });

  it('preserves the legacy insertion path', async () => {
    const { capture, scope, add, upload } = fixture('legacy');
    await expect(capture().insert(frameOutput)).resolves.toBe(1);
    expect(add).toHaveBeenCalledWith(urls, undefined, { scope });
    expect(upload).not.toHaveBeenCalled();
  });

  it('discards results when the user changes canvas before frames are ready', async () => {
    const { capture, project, read, upload } = fixture('document');
    const ready = contractDeferred<File[]>();
    read.mockReturnValue(ready.promise);
    const insertion = capture();
    const operation = insertion.insert(frameOutput);
    project.current = { id: 'other-project' };
    expect(insertion.assertCurrent).toThrow('协作画布已切换');
    ready.release([new File(['fixture'], 'frame.png', { type: 'image/png' })]);
    await expect(operation).rejects.toThrow('协作画布已切换');
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports the actual upload count for compressed video without adding a legacy image', async () => {
    const { capture, read, upload, setImages } = fixture('document');
    const videoUrl = '/api/serve-upload/generated-videos/compressed_1794367000000_0a1b2c3d.mp4';
    const file = new File(['fixture'], 'compressed.mp4', { type: 'video/mp4' });
    read.mockResolvedValue([file]);
    upload.mockResolvedValue(0);
    await expect(capture().insert({ format: 'video/mp4', video: { id: 'result', url: '', videoUrl,
      mediaType: 'video', prompt: '', x: 0, y: 0, width: 32, height: 24, createdAt: 1 } })).resolves.toBe(0);
    expect(read).toHaveBeenCalledWith([videoUrl], 'video/mp4', expect.any(Function));
    expect(upload).toHaveBeenCalledWith([file]);
    expect(setImages).not.toHaveBeenCalled();
  });
});
