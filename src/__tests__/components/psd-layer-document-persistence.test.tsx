// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
}));
const psd = vi.hoisted(() => ({ download: vi.fn() }));
const layering = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('@/lib/layer-decomposition-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/layer-decomposition-client')>();
  return { ...original, runLayerDecomposition: layering.run };
});

vi.mock('@/lib/layer-documents/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/layer-documents/client')>();
  return {
    ...original,
    loadLayerDocument: persistence.load,
    createLayerDocument: persistence.create,
    saveLayerDocument: persistence.save,
  };
});
vi.mock('@/lib/psd-export', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/psd-export')>();
  return { ...original, downloadEditedPSD: psd.download };
});
vi.mock('@/components/psd-editor/PsdCanvas', () => ({
  PsdCanvas: ({ layers, onLayerMove }: {
    layers: Array<{ id: string; name: string; offsetX?: number }>;
    onLayerMove: (id: string, x: number, y: number) => void;
  }) => (
    <div data-testid="mock-psd-canvas">
      <span data-testid="canvas-layer">{layers[0]?.name}:{layers[0]?.offsetX}</span>
      <button data-testid="move-layer" onClick={() => onLayerMove(layers[0].id, 88, 66)}>移动</button>
    </div>
  ),
}));
vi.mock('@/components/psd-editor/LayerPanel', () => ({
  LayerPanel: ({ layers, onRenameLayer, onToggleVisibility, onToggleLock, onReorderLayers }: {
    layers: Array<{ id: string; name: string }>;
    onRenameLayer: (id: string, name: string) => void;
    onToggleVisibility: (id: string) => void;
    onToggleLock: (id: string) => void;
    onReorderLayers: (from: number, to: number) => void;
  }) => (
    <div data-testid="mock-layer-panel">
      <span data-testid="panel-layer-name">{layers[0]?.name}</span>
      <button data-testid="rename-layer" onClick={() => onRenameLayer(layers[0].id, '本地修改')}>重命名</button>
      <button data-testid="visibility-layer" onClick={() => onToggleVisibility(layers[0].id)}>显隐</button>
      <button data-testid="lock-layer" onClick={() => onToggleLock(layers[0].id)}>锁定</button>
      <button data-testid="reorder-layer" onClick={() => onReorderLayers(0, Math.max(0, layers.length - 1))}>排序</button>
    </div>
  ),
}));
vi.mock('@/components/psd-editor/LayerInspector', () => ({
  LayerInspector: () => <div data-testid="mock-layer-inspector" />,
}));
vi.mock('@/components/psd-editor/ExportToolbar', () => ({
  ExportToolbar: ({ onModeChange, onExport }: {
    onModeChange: (mode: 'studio') => void;
    onExport: () => void;
  }) => (
    <div>
      <button data-testid="change-export-mode" onClick={() => onModeChange('studio')}>工作室</button>
      <button data-testid="layer-export-psd" onClick={onExport}>导出 PSD</button>
    </div>
  ),
}));

import PsdLayerEditor from '@/components/psd-editor/PsdLayerEditor';
import { LayerDocumentClientError } from '@/lib/layer-documents/client';
import type { LayerDocumentContent, LayerDocumentRecord } from '@/lib/layer-documents/types';
import type { LayerDecompositionResult } from '@/lib/layer-decomposition/types';

const source = {
  projectId: 'project-1',
  sourceImageId: 'image-1',
  sourceVersionId: 'version-1',
  imageUrl: '/api/serve-upload/source.png',
  taskId: 'task-1',
};

const alternateSource = {
  projectId: 'project-2',
  sourceImageId: 'image-2',
  sourceVersionId: 'version-2',
  imageUrl: '/api/serve-upload/source-2.png',
  taskId: 'task-2',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function content(name = '服务器主体'): LayerDocumentContent {
  return {
    schemaVersion: 1,
    title: '分层文档',
    width: 800,
    height: 600,
    exportMode: 'pro',
    layers: [{
      id: 'layer-1', name, role: 'subject',
      imageUrl: '/api/serve-upload/layers/subject.png',
      width: 400, height: 300, offsetX: 20, offsetY: 30,
      opacity: 1, blendMode: 'normal', visible: true, locked: false,
      order: 0, source: 'pear-psd',
    }],
  };
}

function document(revision = 0, name = '服务器主体'): LayerDocumentRecord {
  return {
    id: 'doc-1', userId: 'user-1', projectId: source.projectId,
    sourceImageId: source.sourceImageId, sourceVersionId: source.sourceVersionId,
    taskId: 'task-1', engine: 'pear', schemaVersion: 1, revision,
    content: content(name), createdAt: 100, updatedAt: 200 + revision,
  };
}

function alternateDocument(revision = 0, name = '第二来源主体'): LayerDocumentRecord {
  return {
    ...document(revision, name),
    id: 'doc-2',
    projectId: alternateSource.projectId,
    sourceImageId: alternateSource.sourceImageId,
    sourceVersionId: alternateSource.sourceVersionId,
    taskId: alternateSource.taskId,
  };
}

const initialResult: LayerDecompositionResult = {
  width: 800,
  height: 600,
  engine: 'pear',
  quality: { status: 'pass', score: 95, warnings: [] },
  layers: [{
    id: 'layer-1', name: '初始主体', role: 'subject',
    imageUrl: '/api/serve-upload/layers/subject.png',
    width: 400, height: 300, offsetX: 20, offsetY: 30,
    opacity: 1, blendMode: 'normal', visible: true, source: 'pear-psd',
  }],
};

describe('PsdLayerEditor layer document persistence', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
        removeItem: (key: string) => { storage.delete(key); },
        clear: () => storage.clear(),
        key: (index: number) => Array.from(storage.keys())[index] ?? null,
        get length() { return storage.size; },
      },
    });
    persistence.load.mockResolvedValue(document());
    persistence.create.mockResolvedValue(document());
    persistence.save.mockImplementation(async (record: LayerDocumentRecord, next: LayerDocumentContent) => ({
      ...record,
      revision: record.revision + 1,
      content: next,
    }));
    psd.download.mockResolvedValue(undefined);
  });

  it('restores the latest exact source document and reports saved state', async () => {
    render(<PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={vi.fn()} />);
    expect((await screen.findByTestId('panel-layer-name')).textContent).toContain('服务器主体');
    expect(screen.getByTestId('layer-document-status').textContent).toContain('已保存');
    expect(persistence.load).toHaveBeenCalledWith(source, expect.any(Object));
  });

  it('creates the initial document after a completed task when none exists', async () => {
    persistence.load.mockResolvedValue(null);
    render(
      <PsdLayerEditor
        imageUrl={source.imageUrl}
        source={source}
        initialResult={initialResult}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(persistence.create).toHaveBeenCalledTimes(1));
    expect(persistence.create).toHaveBeenCalledWith(
      source,
      'task-1',
      expect.objectContaining({ title: '图片', layers: expect.any(Array) }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(layering.run).not.toHaveBeenCalled();
    expect(screen.getByTestId('layer-document-status').textContent).toContain('已保存');
  });

  it('flushes a dirty edit before closing and waits for confirmation', async () => {
    let release!: (value: LayerDocumentRecord) => void;
    persistence.save.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const onClose = vi.fn();
    render(<PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={onClose} />);
    await screen.findByTestId('panel-layer-name');
    fireEvent.click(screen.getByTestId('rename-layer'));
    expect(screen.getByTestId('layer-document-status').textContent).toContain('未保存');

    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(1));
    expect(persistence.save.mock.calls[0][2]).toEqual(expect.objectContaining({ keepalive: true }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => release({ ...document(), revision: 1, content: content('本地修改') }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('flushes before export so the downloaded order matches the saved revision', async () => {
    let release!: (value: LayerDocumentRecord) => void;
    persistence.save.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    render(<PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={vi.fn()} />);
    await screen.findByTestId('panel-layer-name');
    fireEvent.click(screen.getByTestId('move-layer'));
    fireEvent.click(screen.getAllByTestId('layer-export-psd')[0]);
    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(1));
    expect(psd.download).not.toHaveBeenCalled();
    await act(async () => release({ ...document(), revision: 1 }));
    await waitFor(() => expect(psd.download).toHaveBeenCalledTimes(1));
  });

  it('exports the final saved snapshot when another edit happens while export is waiting', async () => {
    const firstSave = deferred<LayerDocumentRecord>();
    const secondSave = deferred<LayerDocumentRecord>();
    persistence.save
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    render(<PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={vi.fn()} />);
    await screen.findByTestId('panel-layer-name');

    fireEvent.click(screen.getByTestId('move-layer'));
    fireEvent.click(screen.getAllByTestId('layer-export-psd')[0]);
    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('rename-layer'));

    await act(async () => firstSave.resolve({
      ...document(1),
      content: persistence.save.mock.calls[0][1],
    }));
    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(2));
    expect(psd.download).not.toHaveBeenCalled();

    await act(async () => secondSave.resolve({
      ...document(2, '本地修改'),
      content: persistence.save.mock.calls[1][1],
    }));
    await waitFor(() => expect(psd.download).toHaveBeenCalledTimes(1));
    expect(psd.download.mock.calls[0][0]).toEqual([
      expect.objectContaining({ name: '本地修改', offsetX: 88, offsetY: 66 }),
    ]);
  });

  it('registers an external close guard that waits for the latest save', async () => {
    const save = deferred<LayerDocumentRecord>();
    persistence.save.mockImplementationOnce(() => save.promise);
    const onClose = vi.fn();
    let guard: (() => Promise<boolean>) | null = null;
    render(
      <PsdLayerEditor
        imageUrl={source.imageUrl}
        source={source}
        onClose={onClose}
        registerCloseGuard={(nextGuard) => { guard = nextGuard; }}
      />,
    );
    await screen.findByTestId('panel-layer-name');
    fireEvent.click(screen.getByTestId('rename-layer'));

    let closePromise!: Promise<boolean>;
    await act(async () => {
      closePromise = guard!();
      await Promise.resolve();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => save.resolve({
      ...document(1, '本地修改'),
      content: persistence.save.mock.calls[0][1],
    }));
    await expect(closePromise).resolves.toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses keepalive when an unsaved initial document is unmounted', async () => {
    persistence.load.mockResolvedValueOnce(null);
    persistence.create.mockRejectedValueOnce(new Error('创建暂时失败'));
    const { unmount } = render(
      <PsdLayerEditor
        imageUrl={source.imageUrl}
        source={source}
        initialResult={initialResult}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('创建暂时失败');
    persistence.create.mockClear();

    unmount();

    expect(persistence.create).toHaveBeenCalledWith(
      source,
      source.taskId,
      expect.any(Object),
      expect.objectContaining({ keepalive: true }),
    );
  });

  it('warns before browser navigation while a document is still dirty', async () => {
    render(<PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={vi.fn()} />);
    await screen.findByTestId('panel-layer-name');
    fireEvent.click(screen.getByTestId('rename-layer'));

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('does not overwrite a revision conflict and can apply the server version', async () => {
    persistence.save.mockRejectedValueOnce(new LayerDocumentClientError(
      'LAYER_DOCUMENT_REVISION_CONFLICT',
      'conflict',
      409,
      false,
    ));
    persistence.load
      .mockResolvedValueOnce(document())
      .mockResolvedValueOnce(document(3, '另一窗口修改'));
    render(<PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={vi.fn()} />);
    await screen.findByTestId('panel-layer-name');
    fireEvent.click(screen.getByTestId('rename-layer'));
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));

    expect(await screen.findByTestId('layer-document-conflict')).toBeTruthy();
    expect(screen.getByTestId('layer-document-status').textContent).toContain('保存冲突');
    fireEvent.click(screen.getByRole('button', { name: '使用服务器版本' }));
    expect((await screen.findByTestId('panel-layer-name')).textContent).toContain('另一窗口修改');
  });

  it('rebases an explicitly kept local edit onto the latest revision and retries once', async () => {
    persistence.save.mockRejectedValueOnce(new LayerDocumentClientError(
      'LAYER_DOCUMENT_REVISION_CONFLICT',
      'conflict',
      409,
      false,
    ));
    persistence.load
      .mockResolvedValueOnce(document())
      .mockResolvedValueOnce(document(3, '另一窗口修改'));
    render(<PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={vi.fn()} />);
    await screen.findByTestId('panel-layer-name');
    fireEvent.click(screen.getByTestId('rename-layer'));
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));

    await screen.findByTestId('layer-document-conflict');
    fireEvent.click(screen.getByRole('button', { name: '保留当前修改并重试' }));

    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(2));
    expect(persistence.save.mock.calls[1][0]).toEqual(expect.objectContaining({ revision: 3 }));
    expect(persistence.save.mock.calls[1][1]).toEqual(expect.objectContaining({
      layers: [expect.objectContaining({ name: '本地修改' })],
    }));
    expect(screen.getByTestId('layer-document-status').textContent).toContain('已保存');
  });

  it('serializes a newer edit made during an in-flight save before closing', async () => {
    const firstSave = deferred<LayerDocumentRecord>();
    const secondSave = deferred<LayerDocumentRecord>();
    persistence.save
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const onClose = vi.fn();
    render(<PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={onClose} />);
    await screen.findByTestId('panel-layer-name');

    fireEvent.click(screen.getByTestId('rename-layer'));
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('move-layer'));

    await act(async () => firstSave.resolve({
      ...document(1, '本地修改'),
      content: persistence.save.mock.calls[0][1],
    }));
    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(2));
    expect(onClose).not.toHaveBeenCalled();
    expect(persistence.save.mock.calls[1][0]).toEqual(expect.objectContaining({ revision: 1 }));
    expect(persistence.save.mock.calls[1][1]).toEqual(expect.objectContaining({
      layers: [expect.objectContaining({ name: '本地修改', offsetX: 88, offsetY: 66 })],
    }));

    await act(async () => secondSave.resolve({
      ...document(2, '本地修改'),
      content: persistence.save.mock.calls[1][1],
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('ignores an old source save completion after switching to another source', async () => {
    const oldSave = deferred<LayerDocumentRecord>();
    persistence.load
      .mockResolvedValueOnce(document())
      .mockResolvedValueOnce(alternateDocument());
    persistence.save.mockImplementationOnce(() => oldSave.promise);
    const onClose = vi.fn();
    const { rerender } = render(
      <PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={onClose} />,
    );
    await screen.findByText('服务器主体');
    fireEvent.click(screen.getByTestId('rename-layer'));
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(1));

    rerender(
      <PsdLayerEditor
        imageUrl={alternateSource.imageUrl}
        source={alternateSource}
        onClose={onClose}
      />,
    );
    await screen.findByText('第二来源主体');
    await act(async () => oldSave.resolve({
      ...document(1, '本地修改'),
      content: persistence.save.mock.calls[0][1],
    }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('rename-layer'));
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    await waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(2));
    expect(persistence.save.mock.calls[1][0]).toEqual(expect.objectContaining({
      id: 'doc-2',
      projectId: alternateSource.projectId,
      sourceVersionId: alternateSource.sourceVersionId,
    }));
  });

  it('keeps an initial create failure dirty, blocks close, and offers a retry', async () => {
    persistence.load.mockResolvedValueOnce(null);
    persistence.create
      .mockRejectedValueOnce(new Error('创建暂时失败'))
      .mockResolvedValueOnce(document());
    const onClose = vi.fn();
    render(
      <PsdLayerEditor
        imageUrl={source.imageUrl}
        source={source}
        initialResult={initialResult}
        onClose={onClose}
      />,
    );

    expect(await screen.findByText('创建暂时失败')).toBeTruthy();
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    await act(async () => Promise.resolve());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(persistence.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('layer-document-status').textContent).toContain('已保存'));
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps a failed initial load recoverable and adopts an existing task document on retry', async () => {
    persistence.load.mockRejectedValueOnce(new Error('恢复请求暂时失败'));
    persistence.create.mockResolvedValueOnce(document(2, '服务器已有编辑'));
    const onClose = vi.fn();
    render(
      <PsdLayerEditor
        imageUrl={source.imageUrl}
        source={source}
        initialResult={initialResult}
        onClose={onClose}
      />,
    );

    expect(await screen.findByText('恢复请求暂时失败')).toBeTruthy();
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));

    await waitFor(() => expect(persistence.create).toHaveBeenCalledTimes(1));
    expect((await screen.findByTestId('panel-layer-name')).textContent).toContain('服务器已有编辑');
    expect(screen.getByTestId('layer-document-status').textContent).toContain('已保存');
  });

  it('offers an explicit reload when conflict recovery cannot load the server document', async () => {
    persistence.save.mockRejectedValueOnce(new LayerDocumentClientError(
      'LAYER_DOCUMENT_REVISION_CONFLICT',
      'conflict',
      409,
      false,
    ));
    persistence.load
      .mockResolvedValueOnce(document())
      .mockRejectedValueOnce(new Error('服务器版本加载失败'))
      .mockResolvedValueOnce(document(3, '重新加载成功'));
    render(<PsdLayerEditor imageUrl={source.imageUrl} source={source} onClose={vi.fn()} />);
    await screen.findByTestId('panel-layer-name');
    fireEvent.click(screen.getByTestId('rename-layer'));
    fireEvent.click(screen.getByTitle('关闭 (Esc)'));

    await screen.findByTestId('layer-document-conflict');
    expect(screen.queryByRole('button', { name: '使用服务器版本' })).toBeNull();
    expect(screen.queryByRole('button', { name: '保留当前修改并重试' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新加载服务器版本' }));
    await waitFor(() => expect(persistence.load).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('button', { name: '使用服务器版本' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保留当前修改并重试' })).toBeTruthy();
  });

  it('keeps legacy incomplete-source calls editable but labels them as temporary', () => {
    render(
      <PsdLayerEditor
        imageUrl={source.imageUrl}
        initialResult={initialResult}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('layer-document-status').textContent).toContain('未保存到项目');
    expect(persistence.load).not.toHaveBeenCalled();
  });
});
